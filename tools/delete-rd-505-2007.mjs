import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const TARGET_CODIGO = "RD-505-2007";

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function requireSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Falta variable SUPABASE_URL.");
  if (!supabaseKey) throw new Error("Falta variable SUPABASE_SERVICE_ROLE_KEY.");

  return createClient(supabaseUrl, supabaseKey);
}

async function fetchTargetNormas(supabase) {
  const { data, error } = await supabase
    .from("normas")
    .select("id,codigo,titulo,num_fragmentos")
    .eq("codigo", TARGET_CODIGO);

  if (error) throw new Error(`Error buscando norma ${TARGET_CODIGO}: ${error.message}`);
  return data || [];
}

async function countTargetFragments(supabase, normaIds) {
  if (normaIds.length === 0) return 0;

  const { count, error } = await supabase
    .from("normas_partes")
    .select("*", { count: "exact", head: true })
    .in("norma_id", normaIds);

  if (error) throw new Error(`Error contando fragmentos asociados: ${error.message}`);
  return count ?? 0;
}

function printPlan({ normas, fragmentCount, confirmDelete }) {
  console.log("\n[DELETE_RD_505_2007] Plan de borrado seguro");
  console.log(`Codigo objetivo: ${TARGET_CODIGO}`);
  console.log(`Modo: ${confirmDelete ? "CONFIRM_DELETE" : "DRY_RUN"}`);
  console.log(`Normas encontradas: ${normas.length}`);

  normas.forEach((norma) => {
    console.log(`- id=${norma.id} | titulo=${norma.titulo || "N/D"} | num_fragmentos=${norma.num_fragmentos ?? "N/D"}`);
  });

  console.log(`Fragmentos asociados encontrados: ${fragmentCount}`);
}

async function deleteTargetNorma() {
  const confirmDelete = hasFlag("confirm-delete");
  const supabase = requireSupabaseClient();
  const normas = await fetchTargetNormas(supabase);
  const normaIds = normas.map((norma) => norma.id);
  const fragmentCount = await countTargetFragments(supabase, normaIds);

  printPlan({ normas, fragmentCount, confirmDelete });

  if (normas.length === 0) {
    console.log("\nNo hay nada que borrar.");
    return;
  }

  if (!confirmDelete) {
    console.log("\n[DRY_RUN] No se ha borrado nada. Para borrar, ejecuta con --confirm-delete.");
    return;
  }

  const { data: deletedFragments, error: deleteFragmentsError } = await supabase
    .from("normas_partes")
    .delete()
    .in("norma_id", normaIds)
    .select("id,norma_id");

  if (deleteFragmentsError) {
    throw new Error(`Error borrando normas_partes de ${TARGET_CODIGO}: ${deleteFragmentsError.message}`);
  }

  const { data: deletedNormas, error: deleteNormasError } = await supabase
    .from("normas")
    .delete()
    .eq("codigo", TARGET_CODIGO)
    .select("id,codigo");

  if (deleteNormasError) {
    throw new Error(`Error borrando norma ${TARGET_CODIGO}: ${deleteNormasError.message}`);
  }

  console.log("\n[DELETE_RD_505_2007] Borrado completado");
  console.log(`Fragmentos borrados: ${deletedFragments?.length ?? 0}`);
  console.log(`Normas borradas: ${deletedNormas?.length ?? 0}`);
}

deleteTargetNorma().catch((error) => {
  console.error(`[DELETE_RD_505_2007][ERROR] ${error.message}`);
  process.exit(1);
});
