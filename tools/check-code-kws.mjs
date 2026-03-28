import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase.from('normas').select('id, codigo, materia, submateria, keywords');
  if (error) {
    console.error(error);
    return;
  }
  
  data.forEach(d => {
    console.log(`[${d.id}] ${d.codigo}: ${d.keywords}`);
  });
}

main();
