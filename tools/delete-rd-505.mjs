import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Error: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY obligatorios.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function deleteNorma1() {
    console.log("== Iniciando borrado de RD 505/2007 (id=1) ==");

    // 1. Borrar fragmentos (normas_partes)
    console.log("1. Borrando fragmentos en normas_partes...");
    const { data: dataPartes, error: errPartes } = await supabase
        .from('normas_partes')
        .delete()
        .eq('norma_id', 1)
        .select();

    if (errPartes) {
        console.error("Error borrando normas_partes:", errPartes);
        return;
    }
    console.log(`Fragmentos borrados: ${dataPartes ? dataPartes.length : 0}`);

    // 2. Borrar la norma principal (normas)
    console.log("2. Borrando entrada en tabla normas...");
    const { data: dataNormas, error: errNormas } = await supabase
        .from('normas')
        .delete()
        .eq('id', 1)
        .select();

    if (errNormas) {
        console.error("Error borrando normas:", errNormas);
        return;
    }
    console.log(`Norma borrada: ${dataNormas && dataNormas.length > 0 ? "Sí" : "No (o ya no existía)"}`);

    // 3. Verificación final
    console.log("3. Verificando limpieza...");
    const { count } = await supabase
        .from('normas_partes')
        .select('*', { count: 'exact', head: true })
        .eq('norma_id', 1);

    console.log(`Fragmentos huérfanos restantes con norma_id = 1: ${count}`);

    console.log("== Proceso terminado ==");
}

deleteNorma1().catch(console.error);
