import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE credentials in env variables");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const ids = [17, 19, 15];
  const { data, error } = await supabase
    .from('normas')
    .select('id, codigo, titulo, materia, submateria, keywords')
    .in('id', ids);
    
  if (error) {
    console.error(error);
    return;
  }
  
  // Sort data to match 17, 19, 15 or just print as is
  const order = [17, 19, 15];
  data.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  for (const row of data) {
    console.log(`NORMA ${row.id} - ${row.codigo}`);
    console.log(`- materia: ${row.materia}`);
    console.log(`- submateria: ${row.submateria}`);
    console.log(`- keywords: ${row.keywords}`);
    console.log('');
  }
}

main();
