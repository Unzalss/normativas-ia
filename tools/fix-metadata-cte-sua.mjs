// Check and update metadata for CTE-DB-SUA
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

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
    }
} catch (e) { console.error('Error loading .env.local:', e); }

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 1. Read current metadata
const { data: norma, error } = await supabase
    .from('normas')
    .select('id, codigo, materia, submateria, keywords')
    .ilike('codigo', '%SUA%')
    .maybeSingle();

if (error || !norma) { console.error('Norma no encontrada:', error?.message); process.exit(1); }

console.log('\n=== Estado actual de CTE-DB-SUA ===');
console.log(`  id:         ${norma.id}`);
console.log(`  codigo:     ${norma.codigo}`);
console.log(`  materia:    ${norma.materia ?? '(null)'}`);
console.log(`  submateria: ${norma.submateria ?? '(null)'}`);
console.log(`  keywords:   ${JSON.stringify(norma.keywords) ?? '(null)'}`);

const needsUpdate = true; // Force update: current keywords are too generic

// 2. Apply recommended values
const newKeywords = [
    "resbaladicidad", "resbalamiento", "suelos", "escaleras",
    "barandillas", "pasamanos", "accesibilidad", "seguridad de utilización",
    "caídas", "desniveles", "seguridad de uso"
];

const { error: updateErr } = await supabase
    .from('normas')
    .update({
        materia: 'seguridad de utilización',
        submateria: 'accesibilidad y seguridad de uso',
        keywords: newKeywords,
    })
    .eq('id', norma.id);

if (updateErr) {
    console.error('\n❌ Error al actualizar:', updateErr.message);
    process.exit(1);
}

console.log('\n✅ Metadata actualizada correctamente.');
console.log('\n=== SQL equivalente aplicado ===');
console.log(`UPDATE normas SET`);
console.log(`  materia    = 'seguridad de utilización',`);
console.log(`  submateria = 'accesibilidad y seguridad de uso',`);
console.log(`  keywords   = '${JSON.stringify(newKeywords)}'::jsonb`);
console.log(`WHERE id = ${norma.id};`);
