import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data } = await supabase.from('normas').select('id, codigo, materia, keywords');
  console.log(JSON.stringify(data, null, 2));
}
main();
