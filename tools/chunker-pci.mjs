import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Error: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY obligatorios.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function semanticChunking(text, max = 700, min = 400) {
    if (!text) return [];
    text = text.trim();
    if (text.length <= max) return [text];

    const paragraphs = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
    let result = [];
    let currentChunk = '';

    for (let para of paragraphs) {
        if (currentChunk.length + para.length + 1 > max) {
            if (currentChunk.length >= min) {
                result.push(currentChunk.trim());
                currentChunk = para;
            } else {
                if (currentChunk.length > 0) currentChunk += "\n";
                const sentences = para.split(/(?<=\. |: |; )/);
                for (let sent of sentences) {
                    if (currentChunk.length + sent.length > max) {
                        if (currentChunk.length >= min) {
                            result.push(currentChunk.trim());
                            currentChunk = sent;
                        } else if (currentChunk.length > 0) {
                            result.push(currentChunk.trim());
                            currentChunk = sent;
                        } else {
                            result.push(sent.trim());
                            currentChunk = '';
                        }
                    } else {
                        currentChunk += sent;
                    }
                }
            }
        } else {
            currentChunk = currentChunk ? currentChunk + "\n" + para : para;
        }
    }

    if (currentChunk.trim().length > 0) {
        result.push(currentChunk.trim());
    }

    if (result.length > 1 && result[result.length - 1].length < 150) {
        const last = result.pop();
        result[result.length - 1] += "\n" + last;
    }

    return result;
}

async function rebuildNorma2() {
    console.log("== Descargando norma_id = 2 desde Supabase ==");
    const { data, error } = await supabase
        .from('normas_partes')
        .select('*')
        .eq('norma_id', 2)
        .order('id', { ascending: true });

    if (error) {
        console.error("Error DB:", error);
        return;
    }

    // 1. Unificar TODO el texto en un solo string gigante respetando el orden físico
    console.log("== Reconstruyendo el texto original completo ==");
    let textoCompleto = data.map(r => r.texto).join("\n\n");

    // Limpieza agresiva de basura de PDFs antiguos
    textoCompleto = textoCompleto.replace(/Página \d+/gi, '');
    textoCompleto = textoCompleto.replace(/BOLETÍN OFICIAL DE LA PROVINCIA DE ZARAGOZA/gi, '');
    textoCompleto = textoCompleto.replace(/Núm\. \d+/gi, '');

    // 2. Extraer artículos usando Expresiones Regulares
    console.log("== Detectando estructura jurídica (Artículos, Capítulos, Títulos) ==");

    const lines = textoCompleto.split('\n');
    let articulos = [];

    let currentTitle = null;
    let currentChapter = null;
    let currentSection = null;

    let activeArticle = null;
    let textBuffer = [];

    // Regex matchers
    const rmTitulo = /^T[IÍ]TULO\s+[IVXLCDM]+\b/i;
    const rmCapitulo = /^CAP[IÍ]TULO\s+[IVXLCDM]+\b/i;
    const rmSeccion = /^Secci[óo]n\s+\d+/i;
    const rmArticulo = /^Art[íi]culo\s+\d+/i;
    const rmDisposicion = /^\s*Disposici[óo]n\s+(adicional|transitoria|derogatoria|final|general)/i;
    const rmAnexo = /^\s*ANEXO\b/i;

    const flushArticle = () => {
        if (activeArticle && textBuffer.length > 0) {
            articulos.push({
                ...activeArticle,
                texto: textBuffer.join('\n').trim()
            });
            textBuffer = [];
        }
    };

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;

        // Títulos
        if (rmTitulo.test(line)) {
            currentTitle = line;
            currentChapter = null; // resets
            currentSection = null;
            continue;
        }
        // Capítulos
        if (rmCapitulo.test(line)) {
            currentChapter = line;
            currentSection = null;
            continue;
        }
        // Secciones
        if (rmSeccion.test(line)) {
            currentSection = line;
            continue;
        }

        // Nuevo Artículo o Disposición
        const isArticulo = rmArticulo.test(line);
        const isDisposicion = rmDisposicion.test(line);
        const isAnexo = rmAnexo.test(line);

        if (isArticulo || isDisposicion || isAnexo) {
            flushArticle();

            let matchedName = "";
            let tipo = "articulo";

            if (isArticulo) {
                matchedName = line.match(/^Art[íi]culo\s+\d+(\.-)?/i)[0].replace(/\.-?$/, '').trim();
                tipo = "articulo";
            } else if (isDisposicion) {
                const match = line.match(/^\s*(Disposici[óo]n\s+(adicional|transitoria|derogatoria|final|general)\s+[a-z0-9A-Z]+)/i);
                matchedName = match ? match[1] : line.substring(0, 30);
                tipo = "disposicion";
            } else if (isAnexo) {
                const match = line.match(/^\s*(ANEXO\s+[IVXLCDM\d]+)/i);
                matchedName = match ? match[1] : "ANEXO";
                tipo = "anexo";
            }

            // Build hierarchical section string
            let hierarchy = [];
            if (currentTitle) hierarchy.push(currentTitle);
            if (currentChapter) hierarchy.push(currentChapter);
            if (currentSection) hierarchy.push(currentSection);

            activeArticle = {
                articulo: matchedName,
                tipo: tipo,
                seccion: hierarchy.length > 0 ? hierarchy.join(" / ") : null,
                es_indice: false
            };
            textBuffer.push(line);
        } else {
            // Continuation of existing text
            if (activeArticle) {
                textBuffer.push(line);
            } else {
                // Orphan text before Article 1 (Exposicion de motivos, indice, etc)
                // Let's create a catch-all "Preámbulo/Índice"
                activeArticle = {
                    articulo: null,
                    tipo: "preambulo",
                    seccion: "Preámbulo",
                    es_indice: line.toLowerCase().includes("índice") || line.toLowerCase().includes("indice")
                };
                textBuffer.push(line);
            }
        }
    }
    flushArticle(); // Last one

    console.log(`Estructura detectada: ${articulos.length} artículos/bloques válidos.`);

    // 3. Re-generar chunks semánticos (400-700 chars)
    console.log("== Aplicando Semantic Chunking estricto bajo jerarquía ==");
    let finalDataset = [];
    let globalOrden = 1;

    for (let group of articulos) {
        if (!group.texto || group.texto.length < 20) continue;

        let chunks = semanticChunking(group.texto, 700, 400);

        for (let chunk of chunks) {
            if (chunk.length < 10) continue;

            finalDataset.push({
                norma_id: 2,
                tipo: group.tipo,
                seccion: group.seccion,
                articulo: group.articulo,
                texto: chunk,
                es_indice: group.es_indice,
                orden: globalOrden++
            });
        }
    }

    console.log(`Nuevos chunks generados: ${finalDataset.length}`);

    const outputPath = path.join(__dirname, '..', 'data', 'ordenanza_pci_zaragoza_estructurada.jsonl');

    if (!fs.existsSync(path.join(__dirname, '..', 'data'))) {
        fs.mkdirSync(path.join(__dirname, '..', 'data'));
    }

    const stream = fs.createWriteStream(outputPath, { flags: 'w' });
    finalDataset.forEach(doc => {
        stream.write(JSON.stringify(doc) + '\n');
    });
    stream.end();

    console.log(`== ÉXITO ==\nArchivo generado en: ${outputPath}`);
}

rebuildNorma2();
