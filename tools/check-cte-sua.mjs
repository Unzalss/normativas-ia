// Diagnostic: check whether CTE-DB-SUA has been indexed and contains "resbal"
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load .env.local the same way other tools in this project do
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
        console.log('-> Cargado .env.local');
    }
} catch (e) { console.error('Error cargando .env.local:', e); }

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('\n=== STEP 1: Buscar CTE-DB-SUA en tabla normas ===');
const { data: normas, error: normasErr } = await supabase
    .from('normas')
    .select('id, codigo, titulo, num_fragmentos, estado_ingesta')
    .ilike('codigo', '%SUA%');

if (normasErr) { console.error('Error:', normasErr.message); process.exit(1); }
if (!normas || normas.length === 0) {
    console.log('❌ No se encontró ninguna norma con codigo LIKE "%SUA%"');
    console.log('   → La norma CTE-DB-SUA NO está cargada. Hay que subir el PDF.');
    process.exit(0);
}

console.log(`✅ Normas encontradas: ${normas.length}`);
normas.forEach(n => console.log(`   id=${n.id} | codigo="${n.codigo}" | fragmentos=${n.num_fragmentos} | estado="${n.estado_ingesta}"`));

const normaId = normas[0].id;

console.log(`\n=== STEP 2: Total fragmentos para norma_id=${normaId} ===`);
const { count: totalFrags } = await supabase
    .from('normas_partes')
    .select('*', { count: 'exact', head: true })
    .eq('norma_id', normaId);

console.log(`Total fragmentos en normas_partes: ${totalFrags ?? 0}`);

console.log('\n=== STEP 3: Fragmentos que contienen "resbal" ===');
const { data: resbalFrags, error: resbalErr } = await supabase
    .from('normas_partes')
    .select('id, seccion, texto')
    .eq('norma_id', normaId)
    .ilike('texto', '%resbal%')
    .limit(5);

if (resbalErr) { console.error('Error:', resbalErr.message); process.exit(1); }

if (!resbalFrags || resbalFrags.length === 0) {
    console.log('❌ 0 fragmentos con "resbal" en esta norma.');
    console.log('   → El texto no fue indexado correctamente o el PDF no lo contiene con ese término.');
} else {
    console.log(`✅ Fragmentos con "resbal": ${resbalFrags.length}`);
    resbalFrags.forEach((f, i) => {
        console.log(`\n--- Fragmento ${i + 1} (id=${f.id}) ---`);
        console.log(`  seccion: ${f.seccion}`);
        // Find and show the surrounding context of "resbal"
        const idx = f.texto?.toLowerCase().indexOf('resbal') ?? -1;
        const snippet = idx >= 0 ? f.texto.substring(Math.max(0, idx - 100), idx + 200) : f.texto?.substring(0, 300);
        console.log(`  extracto: ...${snippet}...`);
    });
}

console.log('\n=== STEP 4: Búsqueda global de "resbal" en toda la BD ===');
const { data: globalFrags } = await supabase
    .from('normas_partes')
    .select('id, norma_id, seccion, texto')
    .ilike('texto', '%resbal%')
    .limit(5);

console.log(`Fragmentos con "resbal" en toda la BD: ${globalFrags?.length ?? 0}`);
globalFrags?.forEach((f, i) => {
    console.log(`  [${i+1}] norma_id=${f.norma_id} | seccion=${f.seccion}`);
});
