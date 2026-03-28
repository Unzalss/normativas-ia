import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkNorma(id, name) {
  const { data, error } = await supabase
    .from('normas_partes')
    .select('seccion, articulo')
    .eq('norma_id', id)
    .limit(10);
    
  if (error) {
    console.error(`Error fetching ${name}:`, error);
    return;
  }
  
  console.log(`\n--- Samples for ${name} (ID: ${id}) ---`);
  data.forEach(d => console.log(`seccion: "${d.seccion}", articulo: "${d.articulo}"`));
}

async function main() {
  await checkNorma(18, "RIPCI");
  await checkNorma(17, "CTE-DB-SI");
  await checkNorma(19, "CTE-DB-SUA");
  await checkNorma(15, "RSCIEI");
}

main();
