import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
    console.error('Error: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y OPENAI_API_KEY son obligatorios.');
    process.exit(1);
}

// Clients
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function ingestDataset() {
    const inputPath = path.join(__dirname, '..', 'data', 'ordenanza_pci_zaragoza_estructurada.jsonl');

    if (!fs.existsSync(inputPath)) {
        console.error(`Error: Archivo no encontrado en ${inputPath}`);
        return;
    }

    console.log(`== Leyendo dataset desde ${inputPath} ==`);
    const fileContent = fs.readFileSync(inputPath, 'utf8');
    const lines = fileContent.split('\n').filter(line => line.trim() !== '');

    let validChunks = [];
    for (const line of lines) {
        try {
            validChunks.push(JSON.parse(line));
        } catch (e) {
            console.error("Error parseando linea:", e);
        }
    }

    console.log(`Se cargaron ${validChunks.length} chunks JSON válidos.`);
    if (validChunks.length === 0) return;

    // We must delete the old norma_id = 2 to avoid duplicate garbage in PROD.
    console.log("== Eliminando fragmentos antiguos de norma_id = 2 ==");
    const { error: deleteError } = await supabase
        .from('normas_partes')
        .delete()
        .eq('norma_id', 2);

    if (deleteError) {
        console.error("Fallo al eliminar chunks viejos. Abortando. Error:", deleteError);
        return;
    }

    console.log("== Generando Embeddings y Subiendo a Supabase ==");

    let successCount = 0;
    let failCount = 0;

    // Procesamos en pequeños lotes o secuencialmente para no saturar OpenAI rate limits ni Supabase
    for (let i = 0; i < validChunks.length; i++) {
        const doc = validChunks[i];

        try {
            // Generar Embedding
            const embeddingRes = await openai.embeddings.create({
                model: "text-embedding-3-small",
                input: doc.texto,
                dimensions: 1536,
            });

            const embedding = embeddingRes.data[0].embedding;

            // Preparar row
            const row = {
                norma_id: doc.norma_id,
                tipo: doc.tipo,
                seccion: doc.seccion,
                articulo: doc.articulo,
                texto: doc.texto,
                es_indice: doc.es_indice || false,
                orden: doc.orden,
                embedding: embedding
            };

            // Insertar
            const { error: insertError } = await supabase
                .from('normas_partes')
                .insert(row);

            if (insertError) {
                console.error(`Fallo inserción Chunk ${i + 1}:`, insertError.message);
                failCount++;
            } else {
                successCount++;
                process.stdout.write('.'); // Progreso visual
            }
        } catch (err) {
            console.error(`\nError fatal en Chunk ${i + 1}:`, err.message);
            failCount++;
        }
    }

    console.log(`\n\n== RESULTADO FINAL INGESTA ==`);
    console.log(`Total intentaros: ${validChunks.length}`);
    console.log(`✅ Inserciones Exitosas: ${successCount}`);
    console.log(`❌ Fallos: ${failCount}`);

    if (successCount === validChunks.length) {
        console.log("Ingesta completada al 100%. La norma Zaragoza está lista en Producción.");
    }
}

ingestDataset().catch(console.error);
