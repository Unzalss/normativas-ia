import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const artNum = "3";
  const validNormaId = 15;

  console.log(`Ejecutando Supabase '.or' tal y como está en /api/ask...`);
  const { data: exactData, error: exactError } = await supabase
      .from("normas_partes")
      .select("id, norma_id, seccion, articulo, article_number, texto, tipo, orden")
      .eq("norma_id", validNormaId)
      .eq("article_number", artNum)
      .order('orden', { ascending: true })
      .limit(50);

  if (exactError) {
      console.log('Error SQL Supabase:', exactError);
  } else {
      console.log(`La consulta devolvió ${exactData?.length} filas.`);
      if (exactData?.length > 0) {
         console.log(exactData[0]);
      }
  }

}
run();
