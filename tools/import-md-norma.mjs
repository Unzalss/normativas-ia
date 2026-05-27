import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = path.join("tools", "output");
const MAX_FRAGMENT_LENGTH = 12000;

const cliArgs = process.argv.slice(2);

function hasFlag(name) {
  return cliArgs.includes(`--${name}`);
}

function getCliArg(name) {
  const inlineArg = cliArgs.find(arg => arg.startsWith(`--${name}=`));
  if (inlineArg) return inlineArg.slice(name.length + 3).trim();

  const argIndex = cliArgs.indexOf(`--${name}`);
  if (argIndex !== -1) return (cliArgs[argIndex + 1] || "").trim();

  return null;
}

function requiredCliArg(name) {
  const value = getCliArg(name);
  if (!value) throw new Error(`Falta argumento obligatorio --${name}`);
  return value;
}

function normalizeMarkdown(text) {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function markdownValue(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  return String(value);
}

function markdownSnippet(text, maxLength = 900) {
  const cleanText = String(text || "").trim();
  if (cleanText.length <= maxLength) return cleanText;

  const half = Math.floor((maxLength - 48) / 2);
  return `${cleanText.slice(0, half)}\n\n[... texto recortado para preview ...]\n\n${cleanText.slice(-half)}`;
}

function sectionKey(title) {
  const match = title.match(/^([A-Z]{1,5})\s+(\d+[A-Z]?)\b/i);
  return match ? `${match[1].toUpperCase()} ${match[2]}` : null;
}

function parseMarkdownNorma(markdown) {
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const documentTitle = titleMatch ? titleMatch[1].trim() : null;
  const headingRegex = /^##\s+(.+)$/gm;
  const headings = [];
  let match;

  while ((match = headingRegex.exec(markdown)) !== null) {
    headings.push({
      title: match[1].trim(),
      index: match.index,
      contentStart: match.index + match[0].length
    });
  }

  if (headings.length === 0) {
    throw new Error("No se encontraron headings de nivel 2. El Markdown debe usar secciones tipo: ## SI 1 Propagación interior");
  }

  const preambleEnd = headings[0].index;
  const preamble = markdown.slice(0, preambleEnd).trim();
  const fragments = [];

  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    const nextIndex = i + 1 < headings.length ? headings[i + 1].index : markdown.length;
    const body = markdown.slice(current.contentStart, nextIndex).trim();

    if (!body) {
      fragments.push({
        orden: i + 1,
        tipo: "Sección",
        source_label: current.title,
        seccion: current.title,
        section_key: sectionKey(current.title),
        texto: "",
        warnings: ["Sección sin texto."]
      });
      continue;
    }

    fragments.push({
      orden: i + 1,
      tipo: "Sección",
      source_label: current.title,
      seccion: current.title,
      section_key: sectionKey(current.title),
      texto: body,
      warnings: body.length > MAX_FRAGMENT_LENGTH ? [`Fragmento largo: ${body.length} caracteres.`] : []
    });
  }

  return { documentTitle, preamble, fragments };
}

function buildWarnings(preview) {
  const warnings = [];
  const fragments = preview.fragments || [];

  if (!preview.metadata.titulo_detectado) {
    warnings.push("No se detectó heading H1 (# Título) en el Markdown.");
  }

  if (fragments.length === 0) {
    warnings.push("No se detectaron fragmentos.");
  }

  for (const fragment of fragments) {
    if (!fragment.texto) warnings.push(`Bloque ${fragment.orden} sin texto: ${fragment.source_label}`);
    if (!fragment.section_key) warnings.push(`Bloque ${fragment.orden} sin clave técnica reconocible: ${fragment.source_label}`);
    if (fragment.texto && fragment.texto.length > MAX_FRAGMENT_LENGTH) {
      warnings.push(`Bloque ${fragment.orden} demasiado largo: ${fragment.texto.length} caracteres.`);
    }
  }

  return warnings;
}

function buildMarkdownPreview(preview) {
  const metadata = preview.metadata;
  const stats = preview.stats;
  const warnings = preview.warnings || [];
  const fragments = preview.fragments || [];
  const lines = [];

  lines.push(`# Preview Markdown - ${markdownValue(metadata.codigo)}`);
  lines.push("");
  lines.push("Este archivo es un preview técnico de fragmentación automática antes de subir una norma a Supabase.");
  lines.push("No es una subida real. Sirve para revisión humana y con ChatGPT/Gemini.");
  lines.push("");
  lines.push("## Instrucciones de revisión");
  lines.push("");
  lines.push("Revisar el preview completo y responder si está APTO PARA SUBIR o NO APTO PARA SUBIR.");
  lines.push("");
  lines.push("Comprobar especialmente:");
  lines.push("- Si faltan secciones esperadas.");
  lines.push("- Si el orden de las secciones es correcto.");
  lines.push("- Si hay tablas rotas, partidas o sin sentido.");
  lines.push("- Si hay fragmentos demasiado largos.");
  lines.push("- Si cada bloque conserva texto normativo literal y revisable.");
  lines.push("- Si hay texto decorativo, índices o instrucciones mezcladas como contenido jurídico.");
  lines.push("");
  lines.push("## Metadatos");
  lines.push("");
  lines.push(`- Código: ${markdownValue(metadata.codigo)}`);
  lines.push(`- Título indicado: ${markdownValue(metadata.titulo)}`);
  lines.push(`- Título detectado en Markdown: ${markdownValue(metadata.titulo_detectado)}`);
  lines.push(`- Archivo fuente: ${markdownValue(metadata.file)}`);
  lines.push(`- Generado: ${markdownValue(metadata.generated_at)}`);
  lines.push("");
  lines.push("## Estadísticas");
  lines.push("");
  lines.push(`- Total fragmentos: ${markdownValue(stats.total_fragmentos)}`);
  lines.push(`- Fragmento más largo: ${markdownValue(stats.fragmento_mas_largo)} caracteres`);
  lines.push(`- Fragmentos largos: ${markdownValue(stats.fragmentos_largos)}`);
  lines.push(`- Fragmentos vacíos: ${markdownValue(stats.fragmentos_vacios)}`);
  lines.push("");
  lines.push("## Warnings");
  lines.push("");

  if (warnings.length === 0) {
    lines.push("- Sin warnings técnicos.");
  } else {
    warnings.forEach(warning => lines.push(`- ${markdownValue(warning)}`));
  }

  lines.push("");
  lines.push("## Resumen de bloques");
  lines.push("");
  lines.push("| # | Tipo | source_label | Caracteres | Warnings |");
  lines.push("|---|---|---|---:|---|");

  fragments.forEach(fragment => {
    const label = markdownValue(fragment.source_label).replace(/\|/g, "\\|");
    lines.push(`| ${fragment.orden} | ${markdownValue(fragment.tipo)} | ${label} | ${String(fragment.texto || "").length} | ${fragment.warnings?.length || "OK"} |`);
  });

  lines.push("");
  lines.push("## Detalle de fragmentos");
  lines.push("");

  fragments.forEach(fragment => {
    lines.push(`### Bloque ${fragment.orden}: ${markdownValue(fragment.source_label)}`);
    lines.push("");
    lines.push(`- tipo: ${markdownValue(fragment.tipo)}`);
    lines.push(`- seccion: ${markdownValue(fragment.seccion)}`);
    lines.push(`- section_key: ${markdownValue(fragment.section_key)}`);
    lines.push(`- caracteres: ${String(fragment.texto || "").length}`);
    lines.push(`- warnings: ${fragment.warnings?.length ? fragment.warnings.map(markdownValue).join("; ") : "OK"}`);
    lines.push("");
    lines.push("Texto:");
    lines.push("");
    lines.push("```md");
    lines.push(markdownSnippet(fragment.texto));
    lines.push("```");
    lines.push("");
  });

  lines.push("## Conclusión técnica inicial");
  lines.push("");
  lines.push(warnings.length === 0
    ? "Sin warnings técnicos automáticos. Pendiente de revisión externa completa."
    : "Hay warnings técnicos automáticos. Revisar antes de cualquier subida.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function writePreviewFiles(preview) {
  const previewDir = path.join(OUTPUT_DIR, preview.metadata.codigo);
  const jsonPath = path.join(previewDir, "preview.json");
  const markdownPath = path.join(previewDir, "preview.md");

  await fs.mkdir(previewDir, { recursive: true });
  await fs.writeFile(jsonPath, JSON.stringify(preview, null, 2), "utf8");
  await fs.writeFile(markdownPath, buildMarkdownPreview(preview), "utf8");

  return { previewDir, jsonPath, markdownPath };
}

async function main() {
  const dryRun = hasFlag("dry-run");
  const confirmUpload = hasFlag("confirm-upload");
  const executeUpload = hasFlag("execute-upload");

  if (confirmUpload || executeUpload) {
    throw new Error("Subida real no implementada en import-md-norma.mjs");
  }

  if (!dryRun) {
    throw new Error("Este script exige --dry-run. Abortando sin procesar.");
  }

  const file = requiredCliArg("file");
  const codigo = requiredCliArg("codigo");
  const titulo = requiredCliArg("titulo");

  const rawMarkdown = await fs.readFile(file, "utf8");
  const markdown = normalizeMarkdown(rawMarkdown);
  const parsed = parseMarkdownNorma(markdown);

  const preview = {
    metadata: {
      codigo,
      titulo,
      titulo_detectado: parsed.documentTitle,
      file,
      generated_at: new Date().toISOString(),
      source_type: "markdown"
    },
    stats: {
      total_fragmentos: parsed.fragments.length,
      fragmento_mas_largo: parsed.fragments.reduce((max, fragment) => Math.max(max, String(fragment.texto || "").length), 0),
      fragmentos_largos: parsed.fragments.filter(fragment => String(fragment.texto || "").length > MAX_FRAGMENT_LENGTH).length,
      fragmentos_vacios: parsed.fragments.filter(fragment => !String(fragment.texto || "").trim()).length
    },
    preamble: parsed.preamble,
    warnings: [],
    fragments: parsed.fragments
  };

  preview.warnings = buildWarnings(preview);

  const paths = await writePreviewFiles(preview);

  console.log("[MD][DRY_RUN] Preview generado correctamente.");
  console.log(`Preview JSON: ${paths.jsonPath}`);
  console.log(`Preview Markdown: ${paths.markdownPath}`);
  console.log(`Fragmentos: ${preview.stats.total_fragmentos}`);
  console.log(`Warnings: ${preview.warnings.length}`);
  console.log("[MD][DRY_RUN] No se ha inicializado Supabase ni OpenAI. No se ha subido nada.");
}

main().catch(error => {
  console.error("[MD][ERROR]", error.message);
  process.exit(1);
});
