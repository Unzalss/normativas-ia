const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
// Carga manual de .env.local para que funcione localmente con node sin 'next' o 'dotenv'
try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach((line) => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                const value = match[2].trim().replace(/^['"]|['"]$/g, '');
                if (!process.env[key]) process.env[key] = value;
            }
        });
        console.log('-> Cargado .env.local manualmente');
    }
} catch (e) {
    console.error('Error cargando .env.local:', e);
}
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
    console.error('Faltan variables de entorno');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const PDF_FILE = 'normas/Ley_21_2013_Evaluacion_Ambiental.pdf';
function normalizeText(text) {
    return text
        .replace(/\r/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
// Divide el texto en fragmentos de 1000-1500 caracteres aprox.
function chunkText(text, minLen = 1000, maxLen = 1500) {
    const paragraphs = normalizeText(text).split(/\n\s*\n/);
    const chunks = [];
    let currentChunk = '';
    for (const p of paragraphs) {
        const paragraph = p.trim();
        if (!paragraph) continue;
        if (currentChunk.length + paragraph.length + 2 > maxLen && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
            // Si un párrafo individual supera el máximo, se parte en trozos
            if (paragraph.length > maxLen) {
                const subparts = paragraph.match(new RegExp(`[\\s\\S]{1,${maxLen}}`, 'g')) || [];
                for (let i = 0; i < subparts.length - 1; i++) {
                    const sub = subparts[i].trim();
                    if (sub) chunks.push(sub);
                }
                currentChunk = (subparts[subparts.length - 1] || '').trim();
                continue;
            }
        }
        if (currentChunk) currentChunk += '\n\n';
        currentChunk += paragraph;
    }
    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }
    // Evita fragmentos vacíos o absurdamente pequeños
    return chunks.filter((c) => c && c.trim().length >= Math.min(200, minLen));
}
async function getOrCreateNorma() {
    const titulo = 'Ley 21/2013, de 9 de diciembre, de evaluación ambiental';
    // Primero intentamos localizarla
    const { data: existingData, error: existingErr } = await supabase
        .from('normas')
        .select('id')
        .eq('titulo', titulo)
        .maybeSingle();
    if (existingErr) {
        console.error('Error buscando norma existente:', existingErr);
        throw existingErr;
    }
    if (existingData?.id) {
        console.log('-> La norma ya existe. Usando ID existente:', existingData.id);
        return existingData.id;
    }
    // Si no existe, la insertamos
    const { data: normaData, error: normaErr } = await supabase
        .from('normas')
        .insert({
            titulo: titulo,
            codigo: 'LEY-21-2013-EA',
            ambito: 'medio ambiente',
            rango: 'ley',
            estado: 'vigente',
            jurisdiccion: 'España',
            prioridad: 50,
            jerarquia: 50
        })
        .select('id')
        .single();
    if (normaErr) {
        console.error('Error insertando norma:', normaErr);
        throw normaErr;
    }
    console.log('-> Norma creada con ID:', normaData.id);
    return normaData.id;
}
async function ingest() {
    console.log('== 1. Leyendo y parseando PDF ==');
    if (!fs.existsSync(PDF_FILE)) {
        console.error(`ERROR: El archivo ${PDF_FILE} no existe.`);
        process.exit(1);
    }
    const dataBuffer = fs.readFileSync(PDF_FILE);
    
    // Instanciar PDFParse porque el require devuelve un objeto con la clase
    const pdfData = await pdfParse(dataBuffer);
    const text = normalizeText(pdfData.text || '');
    if (!text || text.length < 500) {
        console.error('ERROR: No se ha podido extraer suficiente texto del PDF.');
        process.exit(1);
    }
    const fragments = chunkText(text, 1000, 1500);
    console.log(`-> Extraídos ${fragments.length} fragmentos del PDF. (Páginas totales: ${pdfData.numpages})`);
    console.log('\n== 2. Creando o recuperando norma ==');
    const normaId = await getOrCreateNorma();
    console.log('\n== 3. Procesando embeddings e insertando fragmentos en normas_partes ==');
    let okCount = 0;
    let failCount = 0;
    for (let i = 0; i < fragments.length; i++) {
        const chunk = fragments[i];
        try {
            const embRes = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: chunk,
                dimensions: 1536
            });
            const embedding = embRes.data[0].embedding;
            const { data: insData, error: insErr } = await supabase
                .from('normas_partes')
                .insert({
                    norma_id: normaId,
                    texto: chunk,
                    orden: i,
                    embedding: embedding,
                    jurisdiction: 'España',
                    norm_type: 'ley estatal',
                    year: 2013
                })
                .select('id');
            if (insErr) {
                console.error(`\nError de BD fragmento ${i}:`, insErr);
                failCount++;
            } else if (!insData || insData.length === 0) {
                console.error(`\nERROR insertando fragmento ${i}: no se devolvió fila creada.`);
                failCount++;
            } else {
                okCount++;
                process.stdout.write(`\r[OK] Insertado fragmento ${i + 1}/${fragments.length}`);
            }
        } catch (embError) {
            console.error(`\nError solicitando embedding fragmento ${i}:`, embError?.message || embError);
            failCount++;
        }
    }
    console.log(`\n\nProceso terminado. Fragmentos procesados: ${fragments.length}. OK: ${okCount}. Fallos: ${failCount}`);
}
ingest().catch((err) => {
    console.error('\nERROR GENERAL:', err);
    process.exit(1);
});