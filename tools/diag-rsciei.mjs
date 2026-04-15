import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase
    .from('normas_partes')
    .select('id, seccion, articulo, article_number, texto, tipo, apartado, orden')
    .eq('norma_id', 15)
    .order('id', { ascending: true })
    .limit(300);

  if (error) {
    console.error("DB Error:", error);
    return;
  }

  console.log(`Recuperadas ${data.length} filas de la norma_id = 15 (RSCIEI).`);
  
  console.log('\n--- 1. Búsqueda estricta: article_number == "3" ---');
  const stricto = data.filter(r => r.article_number == '3' || r.article_number === 3);
  if (stricto.length > 0) {
      stricto.forEach(r => printRow(r));
  } else {
      console.log("No hay resultados con article_number == 3");
  }

  console.log('\n--- 2. Búsqueda textual ("3") en seccion / articulo / texto ---');
  const contiene3 = data.filter(r => 
     (r.seccion && String(r.seccion).includes('3')) || 
     (r.articulo && String(r.articulo).includes('3')) ||
     (r.texto && String(r.texto).toLowerCase().includes('artículo 3')) ||
     (r.texto && String(r.texto).toLowerCase().includes('art 3')) ||
     (r.texto && String(r.texto).toLowerCase().includes('art. 3'))
  );
  if (contiene3.length > 0) {
      contiene3.forEach(r => printRow(r));
  } else {
      console.log("No hay resultados de contención.");
  }

  console.log('\n--- 3. Muestra Primeras 20 Filas de la Norma RSCIEI ---');
  data.slice(0, 20).forEach(r => printRow(r));
}

function printRow(r) {
     console.log(`\n[Fila ID: ${r.id} | orden: ${r.orden}]`);
     console.log(`- article_number: "${r.article_number ?? 'null'}"`);
     console.log(`- seccion: "${r.seccion ?? 'null'}"`);
     console.log(`- articulo: "${r.articulo ?? 'null'}"`);
     console.log(`- tipo: "${r.tipo ?? 'null'}"`);
     console.log(`- apartado: "${r.apartado ?? 'null'}"`);
     console.log(`- texto (corto): ${String(r.texto || '').substring(0, 120).replace(/\n/g, ' ')}...`);
}

run();
