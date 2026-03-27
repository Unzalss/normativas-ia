import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data: norma, error: fetchErr } = await supabase.from('normas').select('keywords').eq('id', 17).single();
  if (fetchErr) {
    console.error(fetchErr);
    return;
  }
  
  let currentKws = typeof norma.keywords === 'string' ? norma.keywords.split(',') : (Array.isArray(norma.keywords) ? norma.keywords : []);
  
  // Limpiamos los arrays quitando espacios extra
  currentKws = currentKws.map(k => k.trim()).filter(Boolean);

  const newKwsToAdd = ['ocupación', 'pública concurrencia', 'aforo', 'evacuación'];
  
  const finalKws = Array.from(new Set([...currentKws, ...newKwsToAdd]));
  const finalString = finalKws.join(',');

  const { error: upErr } = await supabase.from('normas').update({ keywords: finalKws }).eq('id', 17);
  if (upErr) {
    console.error("Error updating:", upErr);
  } else {
    console.log("CTE-DB-SI (17) updated successfully with new keywords.");
    console.log("New keywords sequence:", finalKws);
  }
}

main();
