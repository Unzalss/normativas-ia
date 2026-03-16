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

        let apartadosArr = splitByApartadosAndLists(blockText);

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

// Wrapper para aplicar la subdivisión semántica a fragmentos demasiado largos (> 800 char)
function pushSplitFragments(fragments: ParsedFragment[], template: ParsedFragment) {
    const rawText = template.texto;

    // Base label: section title without internal block marker (e.g. "Artículo 5")
    const baseLabel = template.seccion.replace(/\s*\[Bloque\s+\d+\]/gi, '').trim();

    if (rawText.length > 800) {
        const chunks = splitTextWithOverlap(rawText, 800, 120);
        chunks.forEach((chunk, i) => {
            // Prepend the article/section header so every stored fragment is self-contained
            const labelledText = baseLabel ? `${baseLabel}\n${chunk}` : chunk;
            fragments.push({
                ...template,
                seccion: chunks.length > 1 ? `${template.seccion} [Bloque ${i + 1}]` : template.seccion,
                texto: labelledText
            });
        });
    } else {
        // Single fragment: also prepend header for consistency
        const labelledText = baseLabel ? `${baseLabel}\n${rawText}` : rawText;
        fragments.push({ ...template, texto: labelledText });
    }
}

// División estricta de apartados y listas numeradas o alfanuméricas
function splitByApartadosAndLists(texto: string): string[] {
    // Busca: nueva linea seguida de "1.", "a)", "1º", "iv)", "-", etc. (listas comunes)
    const listRegex = /\n\s*(?:\d+[\.\)º]|\b[a-z]\)|\b[ivxlcdm]+\)|\-|\•)\s+[A-Z¿¡]/gi;
    const matches = Array.from(texto.matchAll(listRegex));
    if (matches.length < 1) return [texto];

    const out: string[] = [];
    let prevIndex = 0;

    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        if (match.index > prevIndex + 30) {
            out.push(texto.substring(prevIndex, match.index).trim());
            prevIndex = match.index;
        }
    }

    out.push(texto.substring(prevIndex).trim());
    return out.filter(x => x.length > 20);
}

// Subdivisión semántica con tamaño límite estricto y solapamiento sin romper frases
export function splitTextWithOverlap(texto: string, maxLength: number, overlapChars: number): string[] {
    if (texto.length <= maxLength) return [texto.trim()];

    const chunks: string[] = [];
    let start = 0;

    while (start < texto.length) {
        let end = start + maxLength;

        if (end >= texto.length) {
            chunks.push(texto.substring(start).trim());
            break;
        }

        // Buscar el último punto o salto de línea antes del corte límite de 800
        const cutDotSpace = texto.lastIndexOf('. ', end);
        const cutDotNL = texto.lastIndexOf('.\n', end);
        const cutNL = texto.lastIndexOf('\n', end);
        let bestCut = Math.max(cutDotSpace, cutDotNL, cutNL);

        if (bestCut <= start) {
            // Backup 1: último espacio
            bestCut = texto.lastIndexOf(' ', end);
            if (bestCut <= start) {
                // Backup crítico: forzar corte
                bestCut = end;
            }
        }

        const chunk = texto.substring(start, bestCut + 1).trim();
        if (chunk.length > 0) chunks.push(chunk);

        let nextStart = bestCut + 1;
        if (nextStart >= texto.length) break;

        // Calcular el punto de partida del siguiente fragmento teniendo en cuenta el solapamiento
        let overlapTarget = Math.max(start, nextStart - overlapChars);

        const overlapDot = texto.indexOf('. ', overlapTarget);
        const overlapNL = texto.indexOf('\n', overlapTarget);

        let bestOverlapStart = -1;
        if (overlapDot !== -1 && overlapDot < nextStart) bestOverlapStart = overlapDot + 2;
        if (overlapNL !== -1 && overlapNL < nextStart && (bestOverlapStart === -1 || overlapNL < bestOverlapStart)) bestOverlapStart = overlapNL + 1;

        if (bestOverlapStart !== -1 && bestOverlapStart < nextStart) {
            start = bestOverlapStart;
        } else {
            // Intento final para no romper palabras en el overlap
            const spaceOverlap = texto.indexOf(' ', overlapTarget);
            start = (spaceOverlap !== -1 && spaceOverlap < nextStart) ? spaceOverlap + 1 : nextStart;
        }

        // Prevención de bucles infinitos en zonas anómalas sin espacios
        if (start <= bestCut && chunk.length === 0) {
            start = end;
        }
    }

    return chunks;
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

    // Función de ayuda para extraer solo enteros válidos o anular a null
    const safeNumericCast = (rawText: string): string | null => {
        const numMatch = rawText.match(/\d+/);
        return numMatch ? numMatch[0] : null;
    };

    if (tLower.startsWith('art') || tLower.startsWith('art.')) {
        res.tipo = 'Artículo';
        const rawNum = title.replace(/art(?:í|i)culo\s+/i, '').replace(/art\.\s*/i, '').trim();
        res.numero = safeNumericCast(rawNum);
        res.article_number = res.numero ? parseInt(res.numero) : null;
    } else if (tLower.includes('disposición')) {
        res.tipo = 'Disposición';
        const rawNum = title.replace(/disposición\s+\w+\s+/i, '').trim();
        res.numero = safeNumericCast(rawNum);
    } else if (tLower.startsWith('anexo')) {
        res.tipo = 'Anexo';
        const rawNum = title.replace(/anexo\s+/i, '').trim();
        res.numero = safeNumericCast(rawNum);
    } else if (tLower.startsWith('capítulo')) {
        res.tipo = 'Capítulo';
        const rawNum = title.replace(/capítulo\s+/i, '').trim();
        res.numero = safeNumericCast(rawNum);
    }

    return res;
}
