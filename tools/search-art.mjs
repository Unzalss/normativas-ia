import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function searchArt(id, term) {
  const { data, error } = await supabase
    .from('normas_partes')
    .select('seccion, articulo, texto')
    .eq('norma_id', id)
    .ilike('seccion', `%${term}%`)
    .limit(5);
    
  if (error) {
    console.error(`Error fetching ${term} in ${id}:`, error);
    return;
  }
  
  console.log(`\n--- Searching for "${term}" in Norma ID ${id} ---`);
  if (data.length === 0) console.log("Not found.");
  data.forEach(d => console.log(`seccion: "${d.seccion}", articulo: "${d.articulo}"`));
}

async function main() {
  await searchArt(19, "artículo 11"); // CTE-DB-SUA
  await searchArt(15, "artículo 7");  // RSCIEI
  await searchArt(17, "artículo 6");  // CTE-DB-SI
}

main();
