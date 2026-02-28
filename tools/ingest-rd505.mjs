import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// Carga manual de .env.local para que funcione localmente con node sin 'next' o 'dotenv'
try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                const value = match[2].trim().replace(/^['"]|['"]$/g, '');
                if (!process.env[key]) process.env[key] = value;
            }
        });
        console.log("-> Cargado .env.local manualmente");
    }
} catch (e) {
    console.error("Error cargando .env.local:", e);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
    console.error("Faltan variables de entorno");
    process.exit(1);
}

console.log(`-> Conectando a Supabase: ${SUPABASE_URL.substring(0, 30)}...`);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const JSONL_FILE = 'data/rd505_nuevo.jsonl';

async function ingest() {
    console.log("== 1. Preparando Ingestión de RD 505/2007 ==");

    const { data: normaData, error: normaErr } = await supabase
        .from('normas')
        .upsert({
            id: 1,
            codigo: 'RD 505/2007',
            titulo: 'Real Decreto 505/2007, de 20 de abril...',
            ambito: 'Estatal',
            fecha_publicacion: '2007-04-20'
        }, { onConflict: 'id' })
        .select()
        .single();

    if (normaErr) {
        console.error("Error insertando norma:", normaErr);
        return;
    }
    const normaId = normaData.id;
    console.log("-> Norma ID upserted:", normaId);

    if (!fs.existsSync(JSONL_FILE)) {
        console.error(`ERROR: El archivo ${JSONL_FILE} no existe.`);
        process.exit(1);
    }

    const fileStream = fs.createReadStream(JSONL_FILE);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let parts = [];
    for await (const line of rl) {
        if (!line.trim()) continue;
        const obj = JSON.parse(line);
        parts.push(obj);
    }
    console.log(`-> Leídos ${parts.length} fragmentos del JSONL.\n`);

    console.log("== 2. Procesando embeddings e insertando ==");
    let failCount = 0;

    for (let i = 0; i < parts.length; i++) {
        const item = parts[i];

        const inputTexto = `Sección: ${item.seccion || ''}\nTexto: ${item.texto || ''}`;
        const embRes = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: inputTexto,
            dimensions: 1536
        });
        const embedding = embRes.data[0].embedding;

        // .select() es CLAVE. Fuerza a que devuelva la fila. Si devuelve [], el RLS lo bloqueó.
        const { data: insData, error: insErr } = await supabase
            .from('normas_partes')
            .insert({
                norma_id: normaId,
                tipo: item.tipo,
                seccion: item.seccion,
                texto: item.texto,
                embedding: embedding,
                orden: i
            })
            .select();

        if (insErr) {
            console.error(`Error de BD fragmento ${i} (${item.seccion}):`, insErr);
            failCount++;
        } else if (!insData || insData.length === 0) {
            console.error(`ERROR RLS SILENCIOSO insertando fragmento ${i}. (La fila no se creó).`);
            failCount++;
        } else {
            console.log(`[OK] Insertado fragmento ${i + 1}/${parts.length} - ID en BD: ${insData[0].id}`);
        }
    }

    console.log(`\n== 3. Validación Final (Fallos: ${failCount}) ==`);
    const { data: validacionArt1, error: valErr } = await supabase
        .from('normas_partes')
        .select('seccion, texto')
        .eq('norma_id', normaId)
        .ilike('seccion', '%Artículo 1%')
        .limit(1)
        .single();

    if (validacionArt1) {
        console.log("¡ÉXITO REAL! Se encontró el Artículo 1 en la base de datos.");
        console.log("Sección:", validacionArt1.seccion);
    } else {
        console.log("ADVERTENCIA REAL: No se encontró 'Artículo 1' en la lectura directa. ValErr:", valErr);
    }

    console.log("\nProceso terminado.");
}

ingest().catch(console.error);
