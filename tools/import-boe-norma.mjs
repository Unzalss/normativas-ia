import fs from "node:fs/promises";
import path from "node:path";

const BOE_TEXT_URL = "https://www.boe.es/datosabiertos/api/legislacion-consolidada/id";
const OUTPUT_DIR = path.join("tools", "output");
const MAX_FRAGMENT_LENGTH = 8000;
const SPLIT_TARGET_LENGTH = 7600;

function getArg(name) {
  const args = process.argv.slice(2);
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3).trim();

  const index = args.indexOf(`--${name}`);
  if (index !== -1) return (args[index + 1] || "").trim();

  return null;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function requireArgs() {
  const boeId = getArg("boe-id");
  const dryRun = hasFlag("dry-run");
  const validatePreview = hasFlag("validate-preview");

  if (!boeId) throw new Error("Falta argumento obligatorio --boe-id");
  if (!/^BOE-A-\d{4}-\d+$/i.test(boeId)) {
    throw new Error(`Formato BOE inválido: ${boeId}. Esperado: BOE-A-YYYY-NNNN`);
  }
  if (!dryRun && !validatePreview) {
    throw new Error("Esta primera versión exige --dry-run o --validate-preview. Abortando sin descargar ni procesar.");
  }

  return { boeId: boeId.toUpperCase(), dryRun, validatePreview };
}

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripTags(xml) {
  return cleanInternalLabels(decodeXmlEntities(xml)
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h\d|articulo|anexo|disposicion|bloque|parrafo)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function getAttr(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? decodeXmlEntities(match[1]).trim() : null;
}

function firstTagText(xml, tagNames) {
  for (const tag of tagNames) {
    const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (match) {
      const text = stripTags(match[1]);
      if (text) return text;
    }
  }
  return null;
}

function formatBoeDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : raw || null;
}

function normalizeTipo(raw) {
  const value = String(raw || "").toLowerCase();
  if (value.includes("preamb")) return "Preámbulo";
  if (value.includes("art")) return "Artículo";
  if (value.includes("anexo")) return "Anexo";
  if (value.includes("dispos")) return "Disposición";
  if (value.includes("cap")) return "Capítulo";
  if (value.includes("secc")) return "Sección";
  return "Texto";
}

function articleNumberFrom(text) {
  const match = String(text || "").match(/\bart(?:í|i)culo\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function sourceLabel(tipo, seccion) {
  if (tipo === "Artículo") {
    const n = articleNumberFrom(seccion);
    return n ? `Artículo ${n}` : seccion;
  }
  return seccion;
}

function cleanInternalLabels(text) {
  return String(text || "")
    .replace(/^\s*\[(?:preambulo|preámbulo|firma|anexos)\]\s*/gim, "")
    .replace(/\s*\[(?:preambulo|preámbulo|firma|anexos)\]\s*/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function cleanSectionTitle(title, tipo) {
  const clean = cleanInternalLabels(title);
  if (clean) return clean;
  if (tipo === "Preámbulo") return "Preámbulo";
  return clean;
}

function isInformationalBlock(text) {
  const value = String(text || "").trim();
  return /^Incluye\s+correcci(?:ó|o)n\s+de\s+errores\b/i.test(value) ||
    /^Correcci(?:ó|o)n\s+de\s+errores\b/i.test(value) ||
    /^Nota(?:\s+informativa)?\s*:/i.test(value);
}

function metadataFromXml(xml, boeId) {
  const metadatos = xml.match(/<metadatos\b[^>]*>([\s\S]*?)<\/metadatos>/i)?.[1] || xml;
  const title =
    firstTagText(metadatos, ["titulo", "titulo_norma", "denominacion", "nombre"]) ||
    null;

  const rango =
    firstTagText(metadatos, ["rango", "departamento_rango", "tipo_disposicion"]) ||
    title?.match(/\b(Real Decreto-ley|Real Decreto Legislativo|Real Decreto|Ley Orgánica|Ley|Orden|Resolución|Decreto)\b/i)?.[1] ||
    null;

  const fechaDisposicion = formatBoeDate(firstTagText(metadatos, ["fecha_disposicion"]));
  const fechaPublicacion = formatBoeDate(firstTagText(metadatos, ["fecha_publicacion"]));
  const fecha = fechaDisposicion || fechaPublicacion || formatBoeDate(firstTagText(metadatos, ["fecha"]));

  const identificador =
    firstTagText(metadatos, ["identificador", "id", "id_boe"]) ||
    boeId;
  const numeroOficial = firstTagText(metadatos, ["numero_oficial"]);

  return {
    boeId,
    titulo: title,
    rango,
    fecha,
    fecha_disposicion: fechaDisposicion,
    fecha_publicacion: fechaPublicacion,
    identificador,
    numero_oficial: numeroOficial,
  };
}

function tipoFromBloque(attrs, title) {
  const rawTipo = getAttr(attrs, "tipo");
  const rawTitle = String(title || "");

  if (/^art(?:í|i)culo\b/i.test(rawTitle)) return "Artículo";
  if (/^anexo\b/i.test(rawTitle)) return "Anexo";
  if (/^disposici(?:ó|o)n\b/i.test(rawTitle)) return "Disposición";
  if (/^cap(?:í|i)tulo\b/i.test(rawTitle)) return "Capítulo";
  if (/^secci(?:ó|o)n\b/i.test(rawTitle)) return "Sección";
  return normalizeTipo(rawTipo);
}

function textFromBloqueBody(body, title) {
  const text = stripTags(body);
  if (!title || text.toLowerCase().startsWith(title.toLowerCase())) return text;
  return `${title}\n${text}`.trim();
}

function selectLatestVersionBody(body) {
  const versions = [];
  const versionRegex = /<version\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/version>/gi;
  let match;

  while ((match = versionRegex.exec(body)) !== null) {
    const attrs = match.groups.attrs || "";
    versions.push({
      body: match.groups.body || "",
      fecha_publicacion: getAttr(attrs, "fecha_publicacion"),
      fecha_vigencia: getAttr(attrs, "fecha_vigencia"),
      id_norma: getAttr(attrs, "id_norma"),
      order: versions.length,
    });
  }

  if (versions.length === 0) {
    return {
      body,
      selected: null,
      discarded: 0,
    };
  }

  versions.sort((a, b) => {
    const dateA = a.fecha_publicacion || a.fecha_vigencia || "";
    const dateB = b.fecha_publicacion || b.fecha_vigencia || "";
    return dateA.localeCompare(dateB) || a.order - b.order;
  });

  return {
    body: versions[versions.length - 1].body,
    selected: versions[versions.length - 1],
    discarded: versions.length - 1,
  };
}

function fragmentsFromStructuredXml(xml, warnings) {
  const fragments = [];
  const blockRegex = /<bloque\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/bloque>/gi;
  let match;
  let currentAnexo = null;

  while ((match = blockRegex.exec(xml)) !== null) {
    const attrs = match.groups.attrs || "";
    const body = match.groups.body || "";
    const id = getAttr(attrs, "id") || getAttr(attrs, "identificador") || null;
    const rawTitleAttr = getAttr(attrs, "titulo") || getAttr(attrs, "nombre");
    const titleAttr = cleanSectionTitle(rawTitleAttr, tipoFromBloque(attrs, rawTitleAttr));
    const tipo = tipoFromBloque(attrs, titleAttr);

    if (id === "ans" || /^ANEXOS$/i.test(titleAttr || "")) continue;
    if (tipo === "Texto" && id === "firma") continue;

    const selectedVersion = selectLatestVersionBody(body);
    if (selectedVersion.discarded > 0) {
      warnings.push(
        `Bloque con versiones consolidadas: ${titleAttr || id || "sin título"} conserva fecha_publicacion=${selectedVersion.selected.fecha_publicacion || "N/D"} y descarta ${selectedVersion.discarded} versión(es) anterior(es).`
      );
    }

    const text = textFromBloqueBody(selectedVersion.body, titleAttr);
    if (text.length < 20) continue;
    if (isInformationalBlock(text)) {
      warnings.push(`Bloque informativo BOE excluido de fragmentos jurídicos: ${text.slice(0, 140).replace(/\s+/g, " ")}`);
      continue;
    }

    const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean);
    let seccion = titleAttr || firstLine || `${tipo} ${fragments.length + 1}`;
    let fragmentTipo = tipo;

    if (tipo === "Anexo") {
      currentAnexo = anexoRootLabel(seccion) || seccion;
    } else if (currentAnexo && (tipo === "Sección" || /^AP[ÉE]NDICE\b/i.test(seccion))) {
      seccion = `${currentAnexo} - ${seccion}`;
      fragmentTipo = "Anexo";
    } else if (tipo !== "Texto") {
      currentAnexo = null;
    }

    fragments.push({
      tipo: fragmentTipo,
      seccion,
      article_number: fragmentTipo === "Artículo" ? articleNumberFrom(seccion) || articleNumberFrom(text) : null,
      orden: fragments.length + 1,
      texto: text,
      source_label: sourceLabel(fragmentTipo, seccion),
      fuente_bloque_id: id,
      fuente_version_fecha: selectedVersion.selected?.fecha_publicacion || null,
    });
  }

  return withOrden(splitOversizedFragments(splitLargeAnexos(dedupeAnexos(fragments, warnings), warnings), warnings));
}

function anexoRootLabel(seccion) {
  const match = String(seccion || "").match(/\bANEXO\s+(?:[IVXLCDM]+|ÚNICO|UNICO)\b/i);
  return match ? match[0].toUpperCase().replace(/\s+UNICO\b/, " ÚNICO") : null;
}

function dedupeAnexos(fragments, warnings) {
  const output = [];
  const anexoIndexByKey = new Map();

  for (const fragment of fragments) {
    if (fragment.tipo !== "Anexo") {
      output.push(fragment);
      continue;
    }

    const key = anexoRootLabel(fragment.seccion);
    if (!key || fragment.seccion.trim().toUpperCase() !== key) {
      output.push(fragment);
      continue;
    }

    if (!anexoIndexByKey.has(key)) {
      anexoIndexByKey.set(key, output.length);
      output.push(fragment);
      continue;
    }

    const existingIndex = anexoIndexByKey.get(key);
    const existing = output[existingIndex];
    const keepNew = fragment.texto.length >= existing.texto.length;
    const discarded = keepNew ? existing : fragment;
    const kept = keepNew ? fragment : existing;

    output[existingIndex] = kept;
    warnings.push(
      `Anexo duplicado descartado (${key}): se conserva la versión de ${kept.texto.length} caracteres y se descarta otra de ${discarded.texto.length}.`
    );
  }

  return output;
}

function findInternalAnexoHeadings(text) {
  const headings = [];
  const headingRegex = /(?:^|\n)\s*((?:Observaci(?:ó|o)n preliminar)|(?:ANEXO\s+(?:[IVXLCDM]+|ÚNICO|UNICO)\b[^\n]{0,120})|(?:AP[ÉE]NDICE\b[^\n]{0,140})|(?:Secci(?:ó|o)n\s+\d+[.ªº]?\b[^\n]{0,140})|(?:Sistemas?\s+de\s+[A-ZÁÉÍÓÚÜÑa-záéíóúüñ][^\n]{5,140})|(?:Tabla\s+[IVXLCDM\d]+\b[^\n]{0,140})|(?:(?:\d{1,2}\.\s+)|(?:\d{1,2}(?:\.\d{1,2})+\.?\s+))[A-ZÁÉÍÓÚÜÑ][^\n]{3,140})\s*(?=\n|$)/gi;
  let match;

  while ((match = headingRegex.exec(text)) !== null) {
    const title = match[1].trim();
    const titleAfterNumber = title.replace(/^(?:(?:\d{1,2}\.\s+)|(?:\d{1,2}(?:\.\d{1,2})+\.?\s+))/, "");
    if (/^\d+[.ªº]/.test(titleAfterNumber)) {
      continue;
    }
    if (/^(El|La|Los|Las|En|Para|Estos|Estas|Tanto|A falta|Cada|Cuando)\b/i.test(titleAfterNumber)) {
      continue;
    }
    headings.push({
      title,
      index: match.index + match[0].indexOf(match[1]),
    });
  }

  return headings;
}

function splitTextByApproxLimit(text, limit = SPLIT_TARGET_LENGTH) {
  const parts = [];
  let offset = 0;

  while (offset < text.length) {
    if (text.length - offset <= MAX_FRAGMENT_LENGTH) {
      parts.push(text.slice(offset).trim());
      break;
    }

    const target = offset + limit;
    const hardLimit = Math.min(text.length, offset + MAX_FRAGMENT_LENGTH);
    const windowStart = Math.max(offset + Math.floor(limit * 0.55), target - 1800);
    const window = text.slice(windowStart, hardLimit);
    const candidates = ["\n\n", "\n", ". "]
      .map((separator) => {
        const localIndex = window.lastIndexOf(separator);
        return localIndex === -1 ? -1 : windowStart + localIndex + separator.length;
      })
      .filter((index) => index > offset);
    let cut = candidates.length > 0 ? Math.max(...candidates) : -1;
    if (cut === -1) {
      const spaceIndex = text.slice(offset, hardLimit).lastIndexOf(" ");
      cut = spaceIndex > Math.floor(limit * 0.55) ? offset + spaceIndex : target;
    }

    parts.push(text.slice(offset, cut).trim());
    offset = cut;
  }

  return parts.filter(Boolean);
}

function appendFragmentHeadingLabel(parentLabel, headingTitle) {
  const parent = String(parentLabel || "").trim();
  const heading = String(headingTitle || "").trim();
  const sectionMatch = heading.match(/^Secci(?:ó|o)n\s+(\d+)/i);

  if (sectionMatch) {
    const repeatedSection = new RegExp(`\\s+-\\s+Secci(?:ó|o)n\\s+${sectionMatch[1]}\\s*$`, "i");
    return parent.replace(repeatedSection, ` - ${heading}`);
  }

  return `${parent} - ${heading}`;
}

function splitOversizedFragments(fragments, warnings) {
  const output = [];

  for (const fragment of fragments) {
    if (fragment.texto.length <= MAX_FRAGMENT_LENGTH) {
      output.push(fragment);
      continue;
    }

    const pieces = splitLargeAnexoFragment(fragment).flatMap((piece) => {
      if (piece.texto.length <= MAX_FRAGMENT_LENGTH) return [piece];
      return splitTextByApproxLimit(piece.texto).map((texto, index) => ({
        ...piece,
        seccion: `${piece.seccion} - Parte ${index + 1}`,
        source_label: `${piece.source_label} - Parte ${index + 1}`,
        texto,
      }));
    });

    output.push(...pieces);
    warnings.push(
      `Fragmento grande dividido: ${fragment.source_label} (${fragment.texto.length} caracteres) en ${pieces.length} fragmentos.`
    );
  }

  return output;
}

function splitLargeAnexoFragment(fragment) {
  const headings = findInternalAnexoHeadings(fragment.texto);
  if (headings.length < 2) {
    return splitTextByApproxLimit(fragment.texto).map((texto, index) => ({
      ...fragment,
      seccion: `${fragment.seccion} - Parte ${index + 1}`,
      source_label: `${fragment.source_label} - Parte ${index + 1}`,
      texto,
    }));
  }

  const pieces = [];
  const prefix = fragment.texto.slice(0, headings[0].index).trim();
  if (prefix.length >= 20) {
    pieces.push({
      ...fragment,
      seccion: `${fragment.seccion} - Introducción`,
      source_label: `${fragment.source_label} - Introducción`,
      texto: prefix,
    });
  }

  headings.forEach((heading, index) => {
    const next = headings[index + 1];
    const text = fragment.texto.slice(heading.index, next ? next.index : fragment.texto.length).trim();
    if (text.length < 20) return;

    const base = {
      ...fragment,
      seccion: appendFragmentHeadingLabel(fragment.seccion, heading.title),
      source_label: appendFragmentHeadingLabel(fragment.source_label, heading.title),
      texto: text,
    };

    if (text.length <= MAX_FRAGMENT_LENGTH) {
      pieces.push(base);
      return;
    }

    splitTextByApproxLimit(text).forEach((partText, partIndex) => {
      pieces.push({
        ...base,
        seccion: `${base.seccion} - Parte ${partIndex + 1}`,
        source_label: `${base.source_label} - Parte ${partIndex + 1}`,
        texto: partText,
      });
    });
  });

  return pieces;
}

function splitLargeAnexos(fragments, warnings) {
  const output = [];

  for (const fragment of fragments) {
    if (fragment.tipo !== "Anexo" || fragment.texto.length <= MAX_FRAGMENT_LENGTH) {
      output.push(fragment);
      continue;
    }

    const pieces = splitLargeAnexoFragment(fragment);
    output.push(...pieces);
    warnings.push(
      `Anexo grande dividido: ${fragment.source_label} (${fragment.texto.length} caracteres) en ${pieces.length} fragmentos.`
    );
  }

  return output;
}

function withOrden(fragments) {
  return fragments.map((fragment, index) => ({
    ...fragment,
    orden: index + 1,
  }));
}

function fragmentsFromPlainText(xml) {
  const text = stripTags(xml);
  const headingRegex = /(?:^|\n)\s*((?:Art(?:í|i)culo\s+\d+\.?.*)|(?:Disposici(?:ó|o)n\s+(?:adicional|transitoria|final|derogatoria|única).*)|(?:ANEXO\s+(?:[IVX]+|ÚNICO).*)|(?:Anexo\s+(?:[IVX]+|único).*)|(?:CAP(?:Í|I)TULO\s+[IVX]+.*)|(?:Secci(?:ó|o)n\s+\d+.*))(?=\n|$)/g;
  const matches = [];
  let match;

  while ((match = headingRegex.exec(text)) !== null) {
    matches.push({
      title: match[1].trim(),
      index: match.index + match[0].indexOf(match[1]),
    });
  }

  if (matches.length === 0) {
    return text.length > 20
      ? [{
          tipo: "Texto",
          seccion: "Texto completo",
          article_number: null,
          orden: 1,
          texto: text,
          source_label: "Texto completo",
          fuente_bloque_id: null,
        }]
      : [];
  }

  return matches.map((current, index) => {
    const next = matches[index + 1];
    const blockText = text.slice(current.index, next ? next.index : text.length).trim();
    const tipo = normalizeTipo(current.title);
    return {
      tipo,
      seccion: current.title,
      article_number: tipo === "Artículo" ? articleNumberFrom(current.title) : null,
      orden: index + 1,
      texto: blockText,
      source_label: sourceLabel(tipo, current.title),
      fuente_bloque_id: null,
    };
  }).filter((fragment) => fragment.texto.length >= 20);
}

function buildStats(fragments) {
  const longest = fragments.reduce((max, fragment) => Math.max(max, fragment.texto.length), 0);
  const anexoFragments = fragments.filter((f) => f.tipo === "Anexo");
  const anexoRoots = new Set(anexoFragments.map((f) => anexoRootLabel(f.seccion)).filter(Boolean));
  return {
    total_fragmentos_candidatos: fragments.length,
    articulos_detectados: fragments.filter((f) => f.tipo === "Artículo").length,
    anexos_detectados: anexoRoots.size || anexoFragments.length,
    fragmentos_anexo: anexoFragments.length,
    disposiciones_detectadas: fragments.filter((f) => f.tipo === "Disposición").length,
    fragmento_mas_largo: longest,
  };
}

async function fetchBoeXmlUrl(url, boeId) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/xml,text/xml,*/*",
      "User-Agent": "NormativasIA-BOE-Importer/0.1",
    },
  });

  if (response.status === 404) {
    throw new Error(`BOE no encontrado (404): ${boeId}`);
  }
  if (!response.ok) {
    throw new Error(`Error BOE HTTP ${response.status}: ${response.statusText}`);
  }

  const xml = await response.text();
  if (!xml || xml.trim().length < 100) {
    throw new Error(`XML vacío o insuficiente para ${boeId}`);
  }

  return { url, xml };
}

async function fetchBoeXml(boeId) {
  return fetchBoeXmlUrl(`${BOE_TEXT_URL}/${encodeURIComponent(boeId)}/texto`, boeId);
}

async function fetchBoeMetadataXml(boeId) {
  return fetchBoeXmlUrl(`${BOE_TEXT_URL}/${encodeURIComponent(boeId)}`, boeId);
}

function printSummary({ metadata, stats, warnings, fragments }) {
  console.log("\n[BOE][DRY_RUN] Preview de importación");
  console.log(`BOE ID: ${metadata.boeId}`);
  console.log(`Título: ${metadata.titulo || "N/D"}`);
  console.log(`Rango: ${metadata.rango || "N/D"}`);
  console.log(`Fecha: ${metadata.fecha || "N/D"}`);
  console.log(`Identificador: ${metadata.identificador || "N/D"}`);
  console.log(`Total bloques XML/candidatos: ${stats.total_fragmentos_candidatos}`);
  console.log(`Total fragmentos candidatos: ${stats.total_fragmentos_candidatos}`);
  console.log(`Artículos detectados: ${stats.articulos_detectados}`);
  console.log(`Anexos detectados: ${stats.anexos_detectados}`);
  console.log(`Fragmentos de anexo: ${stats.fragmentos_anexo}`);
  console.log(`Disposiciones detectadas: ${stats.disposiciones_detectadas}`);
  console.log(`Fragmento más largo: ${stats.fragmento_mas_largo} caracteres`);

  if (warnings.length > 0) {
    console.log("\nWarnings:");
    warnings.forEach((warning) => console.log(`- ${warning}`));
  }

  console.log("\nPrimeros 5 fragmentos:");
  fragments.slice(0, 5).forEach((fragment) => {
    const preview = fragment.texto.slice(0, 180).replace(/\s+/g, " ");
    console.log(`\n[${fragment.orden}] ${fragment.tipo} | ${fragment.source_label}`);
    console.log(`article_number=${fragment.article_number ?? "null"} | fuente_bloque_id=${fragment.fuente_bloque_id ?? "null"}`);
    console.log(`"${preview}${fragment.texto.length > 180 ? "..." : ""}"`);
  });
}

async function readPreviewJson(boeId) {
  const outputPath = path.join(OUTPUT_DIR, `boe-preview-${boeId}.json`);
  let raw;

  try {
    raw = await fs.readFile(outputPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`No existe el preview local: ${outputPath}`);
    }
    throw error;
  }

  try {
    return {
      outputPath,
      preview: JSON.parse(raw),
    };
  } catch (error) {
    throw new Error(`El preview no es JSON válido: ${outputPath}. Detalle: ${error.message}`);
  }
}

function validatePreviewShape(preview, expectedBoeId) {
  const errors = [];
  const warnings = Array.isArray(preview?.warnings) ? [...preview.warnings] : [];

  if (!preview || typeof preview !== "object") {
    return {
      errors: ["El preview no es un objeto JSON."],
      warnings,
      stats: {
        total: 0,
        articulos: 0,
        anexos: 0,
        disposiciones: 0,
        maxLength: 0,
      },
    };
  }

  if (!preview.metadata || typeof preview.metadata !== "object") errors.push("Falta objeto metadata.");
  if (!preview.stats || typeof preview.stats !== "object") errors.push("Falta objeto stats.");
  if (!Array.isArray(preview.warnings)) errors.push("Falta array warnings.");
  if (!Array.isArray(preview.fragments)) errors.push("Falta array fragments.");

  const metadata = preview.metadata || {};
  const requiredMetadata = ["boeId", "titulo", "rango", "fecha", "identificador", "source_url"];
  for (const field of requiredMetadata) {
    if (!metadata[field] || typeof metadata[field] !== "string") {
      errors.push(`Metadata incompleta: falta ${field}.`);
    }
  }
  if (metadata.boeId && String(metadata.boeId).toUpperCase() !== expectedBoeId) {
    errors.push(`Metadata boeId no coincide: ${metadata.boeId} != ${expectedBoeId}.`);
  }

  const fragments = Array.isArray(preview.fragments) ? preview.fragments : [];
  if (fragments.length === 0) errors.push("No hay fragmentos.");

  const textHashes = new Map();
  let maxLength = 0;

  fragments.forEach((fragment, index) => {
    const prefix = `Fragmento ${index + 1}`;
    const requiredFields = ["tipo", "seccion", "orden", "texto", "source_label"];
    for (const field of requiredFields) {
      if (fragment?.[field] === undefined || fragment?.[field] === null || fragment?.[field] === "") {
        errors.push(`${prefix}: falta ${field}.`);
      }
    }

    if (typeof fragment?.texto !== "string" || fragment.texto.trim().length === 0) {
      errors.push(`${prefix}: texto vacío.`);
      return;
    }

    if (typeof fragment?.source_label !== "string" || fragment.source_label.trim().length === 0) {
      errors.push(`${prefix}: source_label vacío.`);
    }

    if (!Number.isInteger(fragment?.orden) || fragment.orden <= 0) {
      errors.push(`${prefix}: orden inválido.`);
    }

    maxLength = Math.max(maxLength, fragment.texto.length);
    if (fragment.texto.length > MAX_FRAGMENT_LENGTH) {
      errors.push(`${prefix}: supera ${MAX_FRAGMENT_LENGTH} caracteres (${fragment.texto.length}).`);
    }

    const previous = textHashes.get(fragment.texto);
    if (previous !== undefined) {
      errors.push(`${prefix}: texto duplicado exacto con fragmento ${previous + 1}.`);
    } else {
      textHashes.set(fragment.texto, index);
    }
  });

  return {
    errors,
    warnings,
    stats: {
      total: fragments.length,
      articulos: fragments.filter((f) => String(f?.tipo || "").toLowerCase().includes("art")).length,
      anexos: fragments.filter((f) => String(f?.tipo || "").toLowerCase().includes("anex")).length,
      disposiciones: fragments.filter((f) => String(f?.tipo || "").toLowerCase().includes("dispos")).length,
      maxLength,
    },
  };
}

async function validatePreviewMode(boeId) {
  const { outputPath, preview } = await readPreviewJson(boeId);
  const result = validatePreviewShape(preview, boeId);
  const metadata = preview?.metadata || {};
  const stats = preview?.stats || {};

  console.log("\n[BOE][VALIDATE_PREVIEW] Validación de preview local");
  console.log(`Archivo: ${outputPath}`);
  console.log(`Título: ${metadata.titulo || "N/D"}`);
  console.log(`BOE ID: ${metadata.boeId || "N/D"}`);
  console.log(`Fecha: ${metadata.fecha || "N/D"}`);
  console.log(`Total fragmentos: ${result.stats.total}`);
  console.log(`Artículos: ${stats.articulos_detectados ?? result.stats.articulos}`);
  console.log(`Anexos: ${stats.anexos_detectados ?? result.stats.anexos}`);
  console.log(`Disposiciones: ${stats.disposiciones_detectadas ?? result.stats.disposiciones}`);
  console.log(`Fragmento máximo: ${stats.fragmento_mas_largo ?? result.stats.maxLength} caracteres`);

  console.log("\nErrores:");
  if (result.errors.length === 0) {
    console.log("- Ninguno");
  } else {
    result.errors.forEach((error) => console.log(`- ${error}`));
  }

  console.log("\nWarnings:");
  if (result.warnings.length === 0) {
    console.log("- Ninguno");
  } else {
    result.warnings.forEach((warning) => console.log(`- ${warning}`));
  }

  const ok = result.errors.length === 0;
  console.log(`\nResultado final: ${ok ? "VALIDADO" : "NO VALIDADO"}`);
  console.log("[BOE][VALIDATE_PREVIEW] No se ha tocado Supabase ni se han generado embeddings.");

  if (!ok) process.exitCode = 1;
}

async function main() {
  const { boeId, validatePreview } = requireArgs();
  const warnings = [];

  if (validatePreview) {
    await validatePreviewMode(boeId);
    return;
  }

  console.log(`[BOE] Descargando XML: ${boeId}`);
  const { url, xml } = await fetchBoeXml(boeId);

  let metadataXml = xml;
  let metadataUrl = url;
  try {
    const metadataResponse = await fetchBoeMetadataXml(boeId);
    metadataXml = metadataResponse.xml;
    metadataUrl = metadataResponse.url;
  } catch (error) {
    warnings.push(`No se pudo descargar metadatos principales; se usan metadatos del XML de texto. Detalle: ${error.message}`);
  }

  const metadata = metadataFromXml(metadataXml, boeId);
  let fragments = fragmentsFromStructuredXml(xml, warnings);
  if (fragments.length === 0) {
    warnings.push("No se encontraron bloques XML estructurados; se usó fallback por encabezados en texto plano.");
    fragments = fragmentsFromPlainText(xml);
  }

  if (fragments.length === 0) {
    warnings.push("No se pudieron generar fragmentos candidatos.");
  }

  const stats = buildStats(fragments);
  const preview = {
    metadata: {
      ...metadata,
      source_url: url,
      metadata_url: metadataUrl,
    },
    stats,
    warnings,
    fragments,
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, `boe-preview-${boeId}.json`);
  await fs.writeFile(outputPath, JSON.stringify(preview, null, 2), "utf8");

  printSummary({ metadata, stats, warnings, fragments });
  console.log(`\n[BOE][DRY_RUN] JSON guardado en ${outputPath}`);
  console.log("[BOE][DRY_RUN] No se ha tocado Supabase ni se han generado embeddings.");
}

main().catch((error) => {
  console.error(`[BOE][ERROR] ${error.message}`);
  process.exit(1);
});
