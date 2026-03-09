// --- 1. EXTRACCIÓN ROBUSTA EN SERVIDOR ---
export async function extractTextFromUploadedFile(file: Blob | any, fileName: string = ''): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();

    // Protección contra PDFs demasiado grandes (máx 20MB)
    if (arrayBuffer.byteLength > 20_000_000) {
        throw new Error("Archivo demasiado grande (máx 20MB)");
    }

    const mimeType = file.type || '';
    const name = fileName.toLowerCase();

    let text = '';

    if (mimeType.includes('pdf') || name.endsWith('.pdf')) {
        const buffer = Buffer.from(arrayBuffer);
        // Import dinámico para Next.js
        // @ts-expect-error - no types available for pdf-parse
        const pdfParseModule = await import('pdf-parse/lib/pdf-parse.js');
        const pdfParse = pdfParseModule.default || pdfParseModule;
        const data = await pdfParse(buffer);
        text = normalizeText(data.text);
    } else if (mimeType.includes('text') || name.endsWith('.txt')) {
        const decoder = new TextDecoder('utf-8');
        text = normalizeText(decoder.decode(arrayBuffer));
    } else {
        throw new Error(`Formato no soportado: ${mimeType || name}`);
    }

    if (text.length < 100) {
        throw new Error("El PDF no contiene texto extraíble");
    }

    return text;
}

function normalizeText(text: string): string {
    return text
        .replace(/BOLETÍN OFICIAL DEL ESTADO/gi, '')
        .replace(/LEGISLACIÓN CONSOLIDADA/gi, '')
        .replace(/Página\s+\d+/gi, '')
        .replace(/-\s*\n\s*/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export interface NormaMetadataBase {
    titulo: string;
    codigo: string;
    ambito: string | null;
    rango: string | null;
    jurisdiccion: string | null;
}

export interface ParsedFragment {
    tipo: string | null;
    numero: string | null;
    seccion: string;
    texto: string;
    articulo: string | null;
    article_number: number | null;
    apartado: string | null;
    es_indice: boolean;
}

// --- 2. PARSER JURÍDICO ESPAÑOL ESTABLE ---
export function parseNormaJuridica(text: string, _metadata: NormaMetadataBase): ParsedFragment[] {
    const fragments: ParsedFragment[] = [];

    // Regex de detección ajustada y robusta
    const splitterRegex = /(?:Artículo|Art\.)\s+(?:\d+|[ivxlcdm]+|primero|segundo|tercero|cuarto|quinto|sexto|séptimo|octavo|noveno|décimo)\.?|Disposición\s+(?:adicional|transitoria|final|derogatoria|única)\s*(?:\d+|[ivxlcdm]+|primera|segunda|tercera|cuarta|quinta|sexta|séptima|octava|novena|décima|único|única)?|Anexo\s*(?:\d+|[ivxlcdm]+|único)?|Capítulo\s+(?:\d+|[ivxlcdm]+)/gi;

    interface MatchPos {
        title: string;
        index: number;
    }

    const matches: MatchPos[] = [];
    let match;

    // 1. Detectar todas las posiciones
    while ((match = splitterRegex.exec(text)) !== null) {
        matches.push({
            title: match[0],
            index: match.index
        });
    }

    if (matches.length === 0) {
        if (text.trim().length > 0) {
            pushSplitFragments(fragments, createBaseFragment('Texto General', 'Texto Íntegro', text.trim(), false));
        }
        return fragments;
    }

    // 2. Extraer bloque inicial (Preámbulo)
    const preambleText = text.substring(0, matches[0].index).trim();
    if (preambleText.length > 50) {
        const isIndice = preambleText.toLowerCase().includes('índice') && preambleText.length < 1500;
        pushSplitFragments(fragments, createBaseFragment('Preámbulo', 'Preámbulo / Exposición de Motivos', preambleText, isIndice));
    }

    // 3. Iterar posiciones y cortar bloques reales
    for (let i = 0; i < matches.length; i++) {
        const currentTitle = matches[i].title.trim().replace(/\.$/, ''); // Limpiar punto final si "Artículo 3."
        const startIndex = matches[i].index + matches[i].title.length;
        const endIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;

        let blockText = text.substring(startIndex, endIndex).trim();
        blockText = blockText.replace(/^[\.\-:]\s*/, '').trim();

        if (blockText.length < 20) continue;

        const ext = extractMetadataFromTitle(currentTitle);
        const esIndice = blockText.toLowerCase().includes('índice') && blockText.length < 500;

        let apartadosArr = [blockText];
        // Solo dividimos por apartados si garantizamos coherencia (Artículos)
        if (ext.tipo === 'Artículo') {
            apartadosArr = splitLongLegalUnitByApartados(blockText);
        }

        apartadosArr.forEach((apText, idx) => {
            const subTitle = apartadosArr.length > 1 ? `${currentTitle} - Ap. ${idx + 1}` : currentTitle;

            const fragTemplate = {
                tipo: ext.tipo,
                numero: ext.numero,
                seccion: subTitle,
                articulo: ext.tipo === 'Artículo' ? currentTitle : null,
                article_number: ext.article_number,
                apartado: apartadosArr.length > 1 ? `Ap. ${idx + 1}` : null,
                texto: apText,
                es_indice: esIndice
            };

            pushSplitFragments(fragments, fragTemplate);
        });
    }

    return fragments;
}

// Wrapper para aplicar la subdivisión por longitud extrema (> 6000) de forma bruta a los fragmentos resultantes
function pushSplitFragments(fragments: ParsedFragment[], template: ParsedFragment) {
    const rawText = template.texto;
    if (rawText.length > 6000) {
        const chunks = splitLongTextBruteForce(rawText, 6000);
        chunks.forEach((chunk, i) => {
            fragments.push({
                ...template,
                seccion: chunks.length > 1 ? `${template.seccion} [Parte ${i + 1}]` : template.seccion,
                texto: chunk
            });
        });
    } else {
        fragments.push(template);
    }
}

// División estricta de apartados (solo para artículos, buscando naturalidad)
function splitLongLegalUnitByApartados(texto: string): string[] {
    const apartadoRegex = /\n\s*(?:\d+[\.\)]|[a-z]\))\s+[A-Z]/g;
    const matches = Array.from(texto.matchAll(apartadoRegex));
    if (matches.length < 1) return [texto];

    const out: string[] = [];
    let prevIndex = 0;

    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        if (match.index > prevIndex + 50) {
            out.push(texto.substring(prevIndex, match.index).trim());
            prevIndex = match.index;
        }
    }

    out.push(texto.substring(prevIndex).trim());
    return out.filter(x => x.length > 20);
}

// Subdivisión bruta por longitud para asegurar calidad de embeddings y evitar errores de token límite
function splitLongTextBruteForce(texto: string, maxLength: number): string[] {
    const out: string[] = [];
    let start = 0;

    while (start < texto.length) {
        let end = start + maxLength;

        if (end < texto.length) {
            const searchWindow = texto.substring(end - 300, end);
            const lastPara = searchWindow.lastIndexOf('\n\n');
            if (lastPara !== -1) {
                end = end - 300 + lastPara;
            } else {
                const lastDot = searchWindow.lastIndexOf('. ');
                if (lastDot !== -1) {
                    end = end - 300 + lastDot + 1;
                }
            }
        }

        out.push(texto.substring(start, end).trim());
        start = end;
    }

    return out;
}

function createBaseFragment(tipo: string, seccion: string, texto: string, es_indice: boolean): ParsedFragment {
    return {
        tipo,
        numero: null,
        seccion,
        articulo: null,
        article_number: null,
        apartado: null,
        texto,
        es_indice
    };
}

function extractMetadataFromTitle(title: string) {
    const res = { tipo: null as string | null, numero: null as string | null, article_number: null as number | null };
    const tLower = title.toLowerCase();

    if (tLower.startsWith('art') || tLower.startsWith('art.')) {
        res.tipo = 'Artículo';
        const numMatch = title.match(/\d+/);
        if (numMatch) {
            res.numero = numMatch[0];
            res.article_number = parseInt(numMatch[0]);
        } else {
            res.numero = title.replace(/art(?:í|i)culo\s+/i, '').trim() || null;
        }
    } else if (tLower.includes('disposición')) {
        res.tipo = 'Disposición';
        res.numero = title.replace(/disposición\s+\w+\s+/i, '').trim() || null;
    } else if (tLower.startsWith('anexo')) {
        res.tipo = 'Anexo';
        res.numero = title.replace(/anexo\s+/i, '').trim() || null;
    } else if (tLower.startsWith('capítulo')) {
        res.tipo = 'Capítulo';
        res.numero = title.replace(/capítulo\s+/i, '').trim() || null;
    }

    return res;
}
