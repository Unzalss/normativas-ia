import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const BOE_TEXT_URL = "https://www.boe.es/datosabiertos/api/legislacion-consolidada/id";
const OUTPUT_DIR = path.join("tools", "output");
const MAX_FRAGMENT_LENGTH = 5000;
const SPLIT_TARGET_LENGTH = 4600;
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_BATCH_SIZE = 50;

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

function parseKeywordsArg(value) {
  if (!value) return null;
  const keywords = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return keywords.length > 0 ? keywords : null;
}

function requireArgs() {
  const boeId = getArg("boe-id");
  const dryRun = hasFlag("dry-run");
  const validatePreview = hasFlag("validate-preview");
  const confirmUpload = hasFlag("confirm-upload");

  if (!boeId) throw new Error("Falta argumento obligatorio --boe-id");
  if (!/^BOE-A-\d{4}-\d+$/i.test(boeId)) {
    throw new Error(`Formato BOE inválido: ${boeId}. Esperado: BOE-A-YYYY-NNNN`);
  }
  if (!dryRun && !validatePreview && !confirmUpload) {
    throw new Error("Esta primera versión exige --dry-run, --validate-preview o --confirm-upload. Abortando sin descargar ni procesar.");
  }

  return { boeId: boeId.toUpperCase(), dryRun, validatePreview, confirmUpload };
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
  const match = String(text || "").match(/\bart(?:í|i)culo\s+(\d+)(?:\s+(bis|ter|quater))?\b/i);
  if (!match) return null;
  return match[2] ? `${match[1]} ${match[2].toLowerCase()}` : Number(match[1]);
}

function sourceLabel(tipo, seccion, text = "") {
  if (tipo === "Artículo") {
    const n = articleNumberFrom(text) || articleNumberFrom(seccion);
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

function isSubmittableLegalBlock(text) {
  const value = String(text || "").trim();
  const normalized = normalizeReviewText(value);
  if (isInformationalBlock(value)) return false;
  return !(normalized.startsWith("informacion relacionada") || normalized.startsWith("tengase en cuenta"));
}

function normalizeCodeSource(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function numberYearFromOfficialNumber(value) {
  const match = normalizeCodeSource(value).match(/\b(\d{1,5})\s*\/\s*(\d{4})\b/);
  return match ? { number: match[1], year: match[2] } : null;
}

function deriveLegalCodeFromMetadata(metadata) {
  const title = normalizeCodeSource(metadata?.titulo);
  const rango = normalizeCodeSource(metadata?.rango).toLowerCase();
  const official = numberYearFromOfficialNumber(metadata?.numero_oficial);

  const patterns = [
    { prefix: "RDL", regex: /\breal decreto legislativo\s+(\d{1,5})\s*\/\s*(\d{4})\b/i },
    { prefix: "RDL", regex: /\breal decreto-ley\s+(\d{1,5})\s*\/\s*(\d{4})\b/i },
    { prefix: "RD", regex: /\breal decreto\s+(\d{1,5})\s*\/\s*(\d{4})\b/i },
    { prefix: "LEY", regex: /\bley(?:\s+organica)?\s+(\d{1,5})\s*\/\s*(\d{4})\b/i },
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern.regex);
    if (match) return `${pattern.prefix}-${match[1]}-${match[2]}`;
  }

  if (official) {
    if (rango.includes("real decreto legislativo") || rango.includes("real decreto-ley")) {
      return `RDL-${official.number}-${official.year}`;
    }
    if (rango === "real decreto" || rango.includes("real decreto")) {
      return `RD-${official.number}-${official.year}`;
    }
    if (rango.includes("ley")) {
      return `LEY-${official.number}-${official.year}`;
    }
  }

  return metadata?.boeId || metadata?.identificador || null;
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

  const metadata = {
    boeId,
    titulo: title,
    rango,
    fecha,
    fecha_disposicion: fechaDisposicion,
    fecha_publicacion: fechaPublicacion,
    identificador,
    numero_oficial: numeroOficial,
  };
  return {
    ...metadata,
    codigo_sugerido: deriveLegalCodeFromMetadata(metadata),
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
  if (/^pre(?:Ã¡|á|a)mbulo$/i.test(String(title || "").trim())) return text;
  const technicalSectionMatch = String(title || "").trim().match(/^SECCION\s+(\d+)$/i);
  if (technicalSectionMatch && new RegExp(`^Secci(?:ó|o)n\\s+${technicalSectionMatch[1]}[.ªº]?\\b`, "i").test(text)) {
    return text;
  }
  if (!title || text.toLowerCase().startsWith(title.toLowerCase())) return text;
  return `${title}\n${text}`.trim();
}

function removeDuplicatedArticleHeading(text) {
  return String(text || "").replace(
    /^\s*(Art(?:Ã­|í|i)culo\s+(\d+))\s+Art(?:Ã­|í|i)culo\s+\2\.\s*/i,
    "Artículo $2. "
  );
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

    const text = removeDuplicatedArticleHeading(textFromBloqueBody(selectedVersion.body, titleAttr));
    if (text.length < 20) continue;
    if (!isSubmittableLegalBlock(text)) {
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
      article_number: fragmentTipo === "Artículo" ? articleNumberFrom(text) || articleNumberFrom(seccion) : null,
      orden: fragments.length + 1,
      texto: text,
      source_label: sourceLabel(fragmentTipo, seccion, text),
      fuente_bloque_id: id,
      fuente_version_fecha: selectedVersion.selected?.fecha_publicacion || null,
    });
  }

  const splitFragments = splitOversizedFragments(splitLargeAnexos(dedupeAnexos(fragments, warnings), warnings), warnings);
  const cleanedFragments = cleanTinyOrphanFragments(splitFragments, warnings);
  return withOrden(splitOversizedFragments(cleanedFragments, warnings));
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

function findInternalAnexoHeadings(text, parentLabel = "") {
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

  const supplementalHeadingRegex = /(?:^|\n)\s*((?:[A-C]\)\s+[^\n]{5,260})|(?:\d{1,2}\.\s+(?:El|La|Los|Las|En|Para|Estos|Estas|Tanto|A falta|Cada|Cuando)\b[^\n]{3,160}))\s*(?=\n|$)/g;
  while ((match = supplementalHeadingRegex.exec(text)) !== null) {
    const title = match[1].trim();
    if (isAnexoVIShortOptativeOptionHeading(title, parentLabel)) {
      continue;
    }
    headings.push({
      title,
      index: match.index + match[0].indexOf(match[1]),
    });
  }

  if (/\bANEXO\s+II\b/i.test(String(parentLabel || ""))) {
    const anexoIIMaintenanceHeadingRegex = /(?:^|\n)\s*((?:Sistemas?\s+de\s+detecci[^\n.]{0,80})|(?:Fuentes\s+de\s+alimentaci[^\n.]{0,80})|(?:Dispositivos\s+para\s+la\s+activaci[^\n.]{0,100})|(?:Dispositivos\s+de\s+transmisi[^\n.]{0,100})|(?:Extintores\s+de\s+incendio)|(?:Bocas\s+de\s+incendios?\s+equipadas\s+\(BIE\))|(?:Hidrantes)|(?:Columnas\s+secas)|(?:Sistemas?\s+de\s+abastecimiento\s+de\s+agua\s+contra\s+incendios)|(?:Sistemas?\s+fijos?\s+de\s+extinci[^\n:]{0,80}:?)|(?:Sistemas?\s+para\s+el\s+control\s+de\s+humos\s+y\s+de\s+calor)|(?:Sistemas?\s+de\s+se[^\n.]{0,30}alizaci[^\n.]{0,80}))\.?\s*(?=\n|$)/gi;

    while ((match = anexoIIMaintenanceHeadingRegex.exec(text)) !== null) {
      const title = match[1].trim();
      headings.push({
        title,
        index: match.index + match[0].indexOf(match[1]),
      });
    }
  }

  return headings
    .sort((a, b) => a.index - b.index)
    .filter((heading, index, sorted) => index === 0 || heading.index !== sorted[index - 1].index);
}

function isAnexoVIShortOptativeOptionHeading(title, parentLabel = "") {
  if (!/\bANEXO\s+VI\b/i.test(String(parentLabel || ""))) return false;
  const normalized = normalizeReviewText(title).replace(/\s+/g, " ");
  return normalized === "a seguridad en el trabajo" ||
    normalized === "b higiene industrial" ||
    normalized === "c ergonomia y psicosociologia aplicada";
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

function splitTextByReviewLimit(text, limit = SPLIT_TARGET_LENGTH) {
  if (String(text || "").length <= limit) return [String(text || "").trim()].filter(Boolean);

  const parts = [];
  let offset = 0;

  while (offset < text.length) {
    if (text.length - offset <= limit) {
      parts.push(text.slice(offset).trim());
      break;
    }

    const target = offset + limit;
    const windowStart = Math.max(offset + Math.floor(limit * 0.45), target - 1800);
    const window = text.slice(windowStart, Math.min(text.length, target));
    const candidates = ["\n\n", "\n", ". "]
      .map((separator) => {
        const localIndex = window.lastIndexOf(separator);
        return localIndex === -1 ? -1 : windowStart + localIndex + separator.length;
      })
      .filter((index) => index > offset);
    let cut = candidates.length > 0 ? Math.max(...candidates) : -1;
    if (cut === -1) {
      const spaceIndex = text.slice(offset, target).lastIndexOf(" ");
      cut = spaceIndex > Math.floor(limit * 0.45) ? offset + spaceIndex : target;
    }

    parts.push(text.slice(offset, cut).trim());
    offset = cut;
  }

  return parts.filter(Boolean);
}

function splitAnexoRootByOfficialParts(fragment) {
  const text = String(fragment?.texto || "");
  const partRegex = /(?:^|\n)\s*([A-C]\)\s+[^\n]+)\s*(?=\n|$)/g;
  const headings = [];
  let match;

  while ((match = partRegex.exec(text)) !== null) {
    headings.push({
      title: match[1].trim(),
      index: match.index + match[0].indexOf(match[1]),
    });
  }

  if (headings.length === 0) return [fragment];

  const pieces = [];
  const prefix = text.slice(0, headings[0].index).trim();
  if (prefix.length >= 20) {
    pieces.push({
      ...fragment,
      seccion: `${fragment.seccion} - Cabecera`,
      source_label: `${fragment.source_label} - Cabecera`,
      texto: prefix,
    });
  }

  headings.forEach((heading, index) => {
    const next = headings[index + 1];
    const fragmentText = text.slice(heading.index, next ? next.index : text.length).trim();
    if (fragmentText.length < 20) return;

    if (/^ANEXO\s+VI$/i.test(String(fragment.source_label || "").trim())) {
      const numberedPieces = splitOfficialPartByNumberedParagraphs(fragment, heading.title, fragmentText);
      if (numberedPieces.length > 1) {
        pieces.push(...numberedPieces);
        return;
      }
    }

    pieces.push({
      ...fragment,
      seccion: appendFragmentHeadingLabel(fragment.seccion, heading.title),
      source_label: appendFragmentHeadingLabel(fragment.source_label, heading.title),
      texto: fragmentText,
    });
  });

  return pieces;
}

function splitOfficialPartByNumberedParagraphs(fragment, partTitle, partText) {
  const numberedHeadingRegex = /(?:^|\n)\s*(\d{1,2}\.\s+[^\n]{3,220})/g;
  const headings = [];
  let match;

  while ((match = numberedHeadingRegex.exec(partText)) !== null) {
    headings.push({
      title: match[1].trim(),
      index: match.index + match[0].indexOf(match[1]),
    });
  }

  if (headings.length < 2) return [];

  const pieces = [];
  const partSection = appendFragmentHeadingLabel(fragment.seccion, partTitle);
  const partLabel = appendFragmentHeadingLabel(fragment.source_label, partTitle);
  const prefix = partText.slice(0, headings[0].index).trim();

  if (prefix.length >= 20) {
    pieces.push({
      ...fragment,
      seccion: partSection,
      source_label: partLabel,
      texto: prefix,
    });
  }

  headings.forEach((heading, index) => {
    const next = headings[index + 1];
    const fragmentText = partText.slice(heading.index, next ? next.index : partText.length).trim();
    if (fragmentText.length < 20) return;

    pieces.push({
      ...fragment,
      seccion: appendFragmentHeadingLabel(partSection, heading.title),
      source_label: appendFragmentHeadingLabel(partLabel, heading.title),
      texto: fragmentText,
    });
  });

  return pieces;
}

function compactFragmentHeadingLabel(headingTitle) {
  const heading = String(headingTitle || "").trim();
  const partMatch = heading.match(/^([A-C]\))\s+Disposiciones aplicables\b/i);
  if (partMatch) return `${partMatch[1]} Disposiciones aplicables`;

  const numberedMatch = heading.match(/^(\d{1,2})\.\s+(.+)$/);
  if (!numberedMatch || heading.length <= 70) return heading;

  const number = numberedMatch[1];
  const body = numberedMatch[2].trim();
  const subjectMatch = body.match(/^(?:El|La|Los|Las)\s+(.+?)\s+(?:deber|dispondr|est[aá]r|ser[aá]n|se\s+)/i);
  if (!subjectMatch) return `${number}`;

  let subject = subjectMatch[1].trim().replace(/\s+de los lugares de trabajo$/i, "");
  if (subject.length > 70) return `${number}`;
  subject = subject.charAt(0).toUpperCase() + subject.slice(1);
  return `${number}. ${subject}`;
}

function appendFragmentHeadingLabel(parentLabel, headingTitle) {
  const parent = String(parentLabel || "").trim();
  const heading = compactFragmentHeadingLabel(headingTitle);
  const sectionMatch = heading.match(/^Secci(?:ó|o)n\s+(\d+)/i);

  if (sectionMatch) {
    const repeatedSection = new RegExp(`\\s+-\\s+Secci(?:ó|o)n\\s+${sectionMatch[1]}\\s*$`, "i");
    return parent.replace(repeatedSection, ` - ${heading}`);
  }

  return `${parent} - ${heading}`;
}

function isAnexoIIFragment(fragment) {
  return /\bANEXO\s+II\b/i.test(String(fragment?.source_label || fragment?.seccion || ""));
}

function isAnexoIITableHeading(title) {
  return /^Tabla\s+(?:I{1,3}|IV|V|\d+)\b/i.test(String(title || ""));
}

function hasOfficialAnexoPartHeadings(fragment) {
  return (
    fragment?.tipo === "Anexo" &&
    /^ANEXO\s+(?:[IVXLCDM]+|ÃšNICO|UNICO)$/i.test(String(fragment?.source_label || "").trim()) &&
    /(?:^|\n)\s*[A-C]\)\s+Disposiciones\b/.test(String(fragment?.texto || ""))
  );
}

function isAnexoIIMaintenanceHeading(title) {
  return /^(?:Sistemas?|Fuentes|Dispositivos|Extintores|Bocas|Hidrantes|Columnas)\b/i.test(String(title || ""));
}

function tableContextLabel(title) {
  const value = String(title || "").trim();
  const tableMatch = value.match(/^Tabla\s+([IVXLCDM\d]+)/i);
  if (!tableMatch) return value;

  const tableName = `Tabla ${tableMatch[1].toUpperCase()}`;
  const normalized = normalizeReviewText(value);
  const periods = [];
  if (/\btrimestral\b/.test(normalized)) periods.push("Trimestral");
  if (/\bsemestral\b/.test(normalized)) periods.push("Semestral");
  if (/\banual\b/.test(normalized)) periods.push("Anual");
  if (/\bquinquenal\b/.test(normalized)) periods.push("Quinquenal");

  return periods.length > 0 ? `${tableName} - ${periods.join("/")}` : tableName;
}

function hasMaintenanceOperationText(text) {
  const normalized = normalizeReviewText(text);
  return /\b(paso|revision|implementacion|prueba|comprobacion|comprobar|verificacion|verificar|inspeccion|inspeccionar|limpieza|limpiar|realizar|engrasar|cambio|sustitucion|sustituir|apertura|cierre|abrir|cerrar|funcionamiento|estanquidad|estado|accesibilidad|senalizacion|mantenimiento)\b/.test(normalized);
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
  if (/^ANEXO\s+II$/i.test(String(fragment.source_label || "").trim()) && fragment.texto.length > SPLIT_TARGET_LENGTH) {
    return splitTextByReviewLimit(fragment.texto, SPLIT_TARGET_LENGTH).map((texto, index) => ({
      ...fragment,
      seccion: `${fragment.seccion} - Parte ${index + 1}`,
      source_label: `${fragment.source_label} - Parte ${index + 1}`,
      texto,
    }));
  }

  if (/^ANEXO\s+VI$/i.test(String(fragment.source_label || "").trim()) && hasOfficialAnexoPartHeadings(fragment)) {
    return splitAnexoRootByOfficialParts(fragment);
  }

  const headings = findInternalAnexoHeadings(fragment.texto, fragment.source_label || fragment.seccion);
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

  let currentTableTitle = "";

  headings.forEach((heading, index) => {
    const next = headings[index + 1];
    const text = fragment.texto.slice(heading.index, next ? next.index : fragment.texto.length).trim();
    if (text.length < 20) return;

    const anexoII = isAnexoIIFragment(fragment);
    if (anexoII && isAnexoIITableHeading(heading.title)) {
      currentTableTitle = heading.title;
    }

    const shouldApplyTableContext =
      anexoII &&
      currentTableTitle &&
      !isAnexoIITableHeading(heading.title) &&
      isAnexoIIMaintenanceHeading(heading.title);
    const parentSeccion = shouldApplyTableContext
      ? appendFragmentHeadingLabel(fragment.seccion, tableContextLabel(currentTableTitle))
      : fragment.seccion;
    const parentSourceLabel = shouldApplyTableContext
      ? appendFragmentHeadingLabel(fragment.source_label, tableContextLabel(currentTableTitle))
      : fragment.source_label;
    const fragmentText = text;

    if (shouldApplyTableContext && !hasMaintenanceOperationText(text)) {
      return;
    }

    const base = {
      ...fragment,
      seccion: appendFragmentHeadingLabel(parentSeccion, heading.title),
      source_label: appendFragmentHeadingLabel(parentSourceLabel, heading.title),
      texto: fragmentText,
    };

    if (fragmentText.length <= MAX_FRAGMENT_LENGTH) {
      pieces.push(base);
      return;
    }

    splitTextByApproxLimit(fragmentText).forEach((partText, partIndex) => {
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
    const shouldSplitAnexoIIForReview =
      /^ANEXO\s+II$/i.test(String(fragment.source_label || "").trim()) &&
      fragment.texto.length > SPLIT_TARGET_LENGTH;
    const shouldSplitAnexoPartsForReview = hasOfficialAnexoPartHeadings(fragment);

    if (fragment.tipo !== "Anexo" || (fragment.texto.length <= MAX_FRAGMENT_LENGTH && !shouldSplitAnexoIIForReview && !shouldSplitAnexoPartsForReview)) {
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

function normalizeReviewText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function anexoPrefixLabel(fragment) {
  const label = String(fragment?.source_label || fragment?.seccion || "");
  const match = label.match(/\bANEXO\s+(?:[IVXLCDM]+|ÚNICO|UNICO)\b/i);
  return match ? match[0].toUpperCase() : "";
}

function leadingSectionNumber(value) {
  const match = String(value || "").trim().match(/^(\d+(?:\.\d+)*)\b/);
  return match ? match[1] : "";
}

function isAnexoIVShortEpigraph(fragment) {
  const label = String(fragment?.source_label || "");
  const text = String(fragment?.texto || "");
  return /^ANEXO\s+IV\s+-\s+[4-9]\./i.test(label) && text.length < 120;
}

function isTitleOnlyFragment(fragment) {
  const text = String(fragment?.texto || "").trim();
  if (!text || text.length >= 130) return false;

  const textNorm = normalizeReviewText(text);
  const labelNorm = normalizeReviewText(fragment?.source_label || fragment?.seccion || "");
  if (!textNorm || !labelNorm) return false;
  const labelTailNorm = normalizeReviewText(String(fragment?.source_label || fragment?.seccion || "").split(" - ").pop());
  const hasActionVerb = /\b(verificar|comprobar|realizar|limpieza|prueba|revision|inspeccion|cambio|sustituir|engrasar|abrir|cerrar)\b/.test(textNorm);

  if (!hasActionVerb && (labelNorm.endsWith(textNorm) || textNorm.startsWith(labelNorm) || (labelTailNorm && textNorm.startsWith(labelTailNorm)))) return true;
  if (textNorm.startsWith("anexo ") && labelNorm.startsWith(textNorm.split(" ").slice(0, 2).join(" "))) return true;
  return /^(reglamento|anexo|seccion|capitulo|tabla|\d+\s+)/.test(textNorm) && !hasActionVerb;
}

function canMergeTitleWithNext(current, next) {
  if (!next) return false;
  if (current?.tipo !== "Anexo" || next?.tipo !== "Anexo") return false;
  const currentAnexo = anexoPrefixLabel(current);
  const nextAnexo = anexoPrefixLabel(next);
  if (currentAnexo !== nextAnexo) return false;
  if (!["ANEXO II", "ANEXO III"].includes(currentAnexo)) return false;

  const currentNumber = leadingSectionNumber(current.texto);
  const nextNumber = leadingSectionNumber(next.texto);
  if (!currentNumber || !nextNumber) return currentAnexo === "ANEXO II";

  return nextNumber.startsWith(`${currentNumber}.`);
}

function dispositionRootLabel(fragment) {
  const label = String(fragment?.source_label || fragment?.seccion || "").trim();
  const match = label.match(/^(Disposici(?:Ã³|ó|o)n\s+(?:adicional|transitoria|final|derogatoria|Ãºnica|única)(?:\s+\S+)?)/i);
  return match ? normalizeReviewText(match[1]) : "";
}

function canMergeTinyDispositionWithPrevious(current, previous) {
  if (!previous) return false;
  if (normalizeReviewText(current?.tipo) !== "disposicion" || normalizeReviewText(previous?.tipo) !== "disposicion") return false;
  if (String(current?.texto || "").trim().length >= 120) return false;
  if (!/^\d+\./.test(String(current?.texto || "").trim())) return false;
  const currentRoot = dispositionRootLabel(current);
  const previousRoot = dispositionRootLabel(previous);
  return Boolean(currentRoot && previousRoot && currentRoot === previousRoot);
}

function cleanTinyOrphanFragments(fragments, warnings) {
  const output = [];
  let mergedTinyTitles = 0;
  let mergedAnexoIVEpigraphs = 0;

  for (let i = 0; i < fragments.length; i += 1) {
    const fragment = fragments[i];

    if (isAnexoIVShortEpigraph(fragment)) {
      const group = [fragment];
      let j = i + 1;
      while (j < fragments.length && isAnexoIVShortEpigraph(fragments[j])) {
        group.push(fragments[j]);
        j += 1;
      }

      if (group.length > 1) {
        output.push({
          ...fragment,
          seccion: "ANEXO IV - 4 a 9. Epígrafes técnicos",
          source_label: "ANEXO IV - 4 a 9. Epígrafes técnicos",
          texto: group.map((item) => item.texto).join("\n"),
        });
        mergedAnexoIVEpigraphs += group.length;
        i = j - 1;
        continue;
      }
    }

    const next = fragments[i + 1];
    if (isTitleOnlyFragment(fragment) && canMergeTitleWithNext(fragment, next)) {
      fragments[i + 1] = {
        ...next,
        texto: `${fragment.texto}\n${next.texto}`.trim(),
      };
      mergedTinyTitles += 1;
      continue;
    }

    const previous = output[output.length - 1];
    if (isTitleOnlyFragment(fragment) && canMergeTinyDispositionWithPrevious(fragment, previous)) {
      output[output.length - 1] = {
        ...previous,
        texto: `${previous.texto}\n${fragment.texto}`.trim(),
      };
      mergedTinyTitles += 1;
      continue;
    }

    output.push(fragment);
  }

  if (mergedTinyTitles > 0) {
    warnings.push(`Fragmentos titulo huerfanos fusionados con el bloque siguiente: ${mergedTinyTitles}.`);
  }
  if (mergedAnexoIVEpigraphs > 0) {
    warnings.push(`Epigrafes cortos del ANEXO IV agrupados para revision: ${mergedAnexoIVEpigraphs}.`);
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
      source_label: sourceLabel(tipo, current.title, blockText),
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
  console.log(`CÃ³digo sugerido: ${metadata.codigo_sugerido || metadata.boeId || "N/D"}`);
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

function markdownValue(value) {
  if (value === null || value === undefined || value === "") return "N/D";
  return String(value).replace(/\s+/g, " ").trim();
}

function markdownSnippet(text, maxLength = 420) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trim()}...`;
}

function fragmentSimpleWarnings(fragment) {
  const warnings = [];
  const text = String(fragment?.texto || "");
  const sourceLabel = String(fragment?.source_label || "");
  const seccion = String(fragment?.seccion || "");

  if (text.length > SPLIT_TARGET_LENGTH) {
    warnings.push(`Bloque largo (${text.length} caracteres). Revisar si conviene dividirlo mejor.`);
  }
  if (text.length > MAX_FRAGMENT_LENGTH) {
    warnings.push(`Supera el maximo previsto (${MAX_FRAGMENT_LENGTH} caracteres).`);
  }
  if (!sourceLabel.trim()) {
    warnings.push("source_label vacio.");
  }
  if (!seccion.trim()) {
    warnings.push("seccion vacia.");
  }
  if (/parte\s+\d+$/i.test(sourceLabel)) {
    warnings.push("Bloque dividido por longitud; revisar continuidad del texto.");
  }
  if (fragment?.tipo === "Anexo" && /art(?:í|i)culo/i.test(seccion)) {
    warnings.push("Tipo Anexo con seccion que parece articulo.");
  }
  if (fragment?.tipo === "ArtÃ­culo" && fragment?.article_number === null) {
    warnings.push("Articulo sin article_number detectado.");
  }

  return warnings;
}

function buildMarkdownPreview(preview) {
  const metadata = preview.metadata || {};
  const currentBoeId = metadata.boeId || "BOE-ID";
  const stats = preview.stats || {};
  const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
  const fragments = Array.isArray(preview.fragments) ? preview.fragments : [];
  const lines = [];

  lines.push(`# Preview BOE - ${markdownValue(metadata.boeId)}`);
  lines.push("");
  lines.push("# INSTRUCCIONES PARA REVISIÓN CON IA");
  lines.push("");
  lines.push("Este archivo es un preview tecnico de fragmentacion automatica antes de subir una norma a Supabase.");
  lines.push("Este archivo es autosuficiente: la IA revisora debe revisar el preview completo usando solo estas instrucciones, sin pedir mensajes externos al usuario.");
  lines.push("");
  lines.push("La IA revisora debe seguir estas reglas:");
  lines.push("");
  lines.push("- Debe revisar el preview completo sin necesitar instrucciones externas.");
  lines.push("- Debe revisar solo la version actual de este preview. Si una version anterior tenia problemas, no debe asumir que siguen existiendo.");
  lines.push("- No debe inventar problemas no presentes en el preview actual.");
  lines.push("- No debe pedir instrucciones externas al usuario.");
  lines.push("- Si el dry-run indica APTO PARA SUBIR, aun asi debe hacer una revision estructural basica antes de responder OK.");
  lines.push("- Si el preview incluye la seccion DETALLE DE FALLOS DE INTEGRIDAD, debe centrar la revision especialmente en esos fallos concretos.");
  lines.push("- No debe reescribir la norma.");
  lines.push("- No debe inventar texto.");
  lines.push("- No debe corregir contenido juridico.");
  lines.push("- No debe crear nuevos fragmentos manualmente.");
  lines.push("- Solo debe revisar si la division automatica es buena.");
  lines.push("- Debe comprobar si source_label coincide con el texto inicial.");
  lines.push("- Debe detectar bloques mezclados.");
  lines.push("- Debe detectar anexos o tablas mal divididos.");
  lines.push("- Debe detectar bloques demasiado largos.");
  lines.push("- Debe revisar especialmente anexos, tablas, apendices, epigrafes tecnicos y mantenimiento.");
  lines.push("- Debe revisar la estructura interna de anexos: partes A), B), C), subapartados numerados, saltos de numeracion, tablas, epigrafes tecnicos, titulos pegados al bloque anterior, anexos mezclados y apartados que desaparecen o quedan absorbidos por otro bloque.");
  lines.push("- Debe comprobar que las condiciones juridicas no se crucen entre elementos distintos por culpa de la segmentacion.");
  lines.push("- Debe decir si esta OK para subir o NO subir todavia.");
  lines.push("- Si la IA revisora no esta segura sobre un apartado, salto de numeracion o posible ausencia de contenido, debe responder \"REVISION DUDOSA\" y pedir comprobacion a ChatGPT.");
  lines.push("- Si responde NO SUBIR TODAVIA o REVISION DUDOSA, debe aportar evidencia textual suficiente de cada bloque problemático.");
  lines.push("- No debe preparar el prompt final para Codex.");
  lines.push("- Si detecta problemas, debe preparar INSTRUCCIONES PARA CHATGPT para que ChatGPT redacte despues el prompt bueno para Codex.");
  lines.push("- Si responde OK PARA SUBIR, debe confirmar expresamente que no ve texto inventado, texto reescrito, perdida de contiguidad, bloques huerfanos graves, anexos mal mezclados ni source_label incompatible con el texto.");
  lines.push("");
  lines.push("## RESPUESTA SI LA NORMA ES APTA");
  lines.push("");
  lines.push("Si no hay errores graves, responder exactamente con:");
  lines.push("");
  lines.push("VEREDICTO: APTO PARA SUBIR");
  lines.push("Motivo resumido: [explicacion breve]");
  lines.push("");
  lines.push("Y anadir obligatoriamente:");
  lines.push("");
  lines.push("SIGUIENTE PASO PARA CODEX");
  lines.push("");
  lines.push("- No subir directamente desde terminal sin revision final.");
  lines.push("- Preparar un prompt para Codex para hacer una ultima revision local.");
  lines.push("- Codex debe verificar:");
  lines.push("  1. numero total de bloques;");
  lines.push("  2. articulos detectados;");
  lines.push("  3. anexos detectados;");
  lines.push("  4. anexos complejos, partes internas y numeracion repetida;");
  lines.push("  5. que no hay fragmentos vacios;");
  lines.push("  6. que las instrucciones del preview no se han colado como fragmentos juridicos;");
  lines.push("  7. que no hay texto inventado ni reescrito;");
  lines.push("  8. que no se toca frontend, /api/ask, SQL, ranking ni contenido juridico;");
  lines.push("  9. que si todo esta correcto, se hace la subida controlada con el flujo real del script;");
  lines.push("  10. que despues Codex informe de norma_id, fragmentos subidos, embeddings generados, errores y pruebas reales recomendadas;");
  lines.push("  11. que no se haga commit hasta validar la norma en produccion.");
  lines.push("");
  lines.push("Si el veredicto es APTO PARA SUBIR, la respuesta nunca debe quedarse solo en el veredicto; debe incluir siempre la seccion SIGUIENTE PASO PARA CODEX.");
  lines.push("");
  lines.push("## EVIDENCIA TEXTUAL OBLIGATORIA");
  lines.push("");
  lines.push("- Si la IA revisora responde NO SUBIR TODAVIA o REVISION DUDOSA, esta obligada a aportar evidencia concreta.");
  lines.push("- Un veredicto negativo o dudoso sin evidencia suficiente se considera INCOMPLETO y no debe pasar directamente a Codex.");
  lines.push("- En ese caso, debe pedirse a la IA revisora una revision ampliada con los bloques y textos afectados antes de preparar cualquier prompt para Codex.");
  lines.push("- No basta con decir frases generales como \"hay 2 fragmentos\", \"ANEXO VI esta mal\", \"hay texto inventado\", \"hay texto reescrito\" o \"hay perdida de contiguidad\".");
  lines.push("- Todo problema debe quedar asociado a bloques concretos del preview. Si no se listan los bloques afectados uno por uno, la evidencia es insuficiente.");
  lines.push("- Si el validador automatico indica una cifra de fragmentos no literales, textos inventados o textos reescritos, la IA revisora debe listar exactamente esos fragmentos uno por uno.");
  lines.push("- Si la IA revisora detecta un problema o duda en un bloque, debe incluir para CADA problema:");
  lines.push("  1. Numero de bloque.");
  lines.push("  2. source_label exacto.");
  lines.push("  3. Tipo de problema.");
  lines.push("  4. Articulo, anexo o disposicion afectada.");
  lines.push("  5. Texto completo del bloque si es corto.");
  lines.push("  6. Si el bloque es largo, minimo 30 lineas antes y 30 lineas despues del punto problematico.");
  lines.push("  7. Bloque anterior completo si es corto.");
  lines.push("  8. Bloque posterior completo si es corto.");
  lines.push("  9. Frase exacta donde empieza el problema.");
  lines.push("  10. Comparacion clara entre texto oficial esperado segun BOE/XML y texto generado en el preview.");
  lines.push("  11. Explicacion de si el fallo es texto inventado, texto reescrito, perdida de texto, mezcla de bloques, mal corte, mal source_label o simple bloque corto sin fallo real.");
  lines.push("  12. Estructura que deberia mantenerse unida o separada y si es fallo real confirmado o solo duda.");
  lines.push("- No debe pegar toda la norma.");
  lines.push("- Solo debe pegar bloques problematicos o extractos suficientes para que ChatGPT pueda preparar un prompt concreto.");
  lines.push("- Si sospecha que un apartado esta absorbido, debe indicar que bloque puede contenerlo y aportar el texto alrededor.");
  lines.push("- Si sospecha que falta un apartado, debe explicar por que lo cree, pero no inventarlo.");
  lines.push("- Si detecta fragmento no literal/no contiguo, texto anadido o inventado, texto juridico reescrito, perdida de texto, mezcla de bloques, hiperfragmentacion con perdida de sentido o mal source_label que pueda afectar a busquedas, debe aportar la evidencia completa anterior para cada bloque afectado.");
  lines.push("- Si menciona fragmentos inventados, texto reescrito o texto no literal, debe listar TODOS los fragmentos afectados uno por uno.");
  lines.push("- No vale decir solo \"hay 18 fragmentos\" o una cifra global: debe indicar numero de bloque, source_label, tipo de problema y extracto de cada fragmento afectado.");
  lines.push("- Si no puede aportar esta evidencia, debe responder que su veredicto es INCOMPLETO y pedir una revision ampliada, no pedir cambios al parser.");
  lines.push("- ChatGPT debe usar esa evidencia para preparar un prompt mas concreto para Codex.");
  lines.push("- Codex seguira verificando en local antes de corregir.");
  lines.push("");
  lines.push("## REGLA CRITICA SOBRE TEXTO JURIDICO");
  lines.push("");
  lines.push("- Gemini no puede inventar texto.");
  lines.push("- ChatGPT no puede inventar texto.");
  lines.push("- Antigravity no puede inventar texto.");
  lines.push("- Codex no puede inventar texto.");
  lines.push("- Nadie puede reescribir, resumir, completar, corregir ni alterar el texto juridico.");
  lines.push("- Solo se permite cambiar la forma en que el script segmenta texto oficial ya existente.");
  lines.push("- El texto de normas_partes.texto debe ser literal, contiguo y procedente de BOE/XML/fuente oficial.");
  lines.push("- El texto final debe conservar exactamente el mismo sentido que la ley original.");
  lines.push("- Solo se pueden cambiar reglas de segmentacion, nunca el contenido juridico.");
  lines.push("- No se puede cambiar el significado ni mover condiciones entre elementos.");
  lines.push("- Ejemplo conceptual: si el texto oficial dice que una condicion aplica a un elemento A y otra a un elemento B, la segmentacion nunca puede provocar que esas condiciones se crucen, mezclen o parezcan aplicarse al elemento equivocado.");
  lines.push("- Codex no debe corregir supuestas ausencias si no estan confirmadas por el preview y la revision de ChatGPT.");
  lines.push("");
  lines.push("## FLUJO DE VALIDACION");
  lines.push("");
  lines.push("1. Gemini o la IA revisora revisa este preview.");
  lines.push("2. Si todo esta bien, responde OK PARA SUBIR.");
  lines.push("3. Si ve un problema real, responde NO SUBIR TODAVIA y explica los bloques afectados.");
  lines.push("4. Si hay duda, responde REVISION DUDOSA.");
  lines.push("5. Si Gemini responde NO SUBIR TODAVIA o REVISION DUDOSA sin evidencia concreta suficiente, el veredicto queda incompleto.");
  lines.push("6. Un veredicto incompleto debe pedir revision ampliada a Gemini/IA revisora; no debe pasar directamente a Codex.");
  lines.push("7. ChatGPT analiza solo la ultima iteracion del preview y el veredicto de Gemini.");
  lines.push("8. ChatGPT se centra especialmente en los bloques marcados por Gemini, salvo que vea un fallo evidente adicional.");
  lines.push("9. Si Gemini detecta un problema o una duda concreta, ChatGPT NO debe pedir al usuario que ejecute comandos manuales.");
  lines.push("10. ChatGPT debe preparar un prompt cerrado para Codex solo cuando tenga evidencia suficiente o una duda concreta verificable.");
  lines.push("11. Codex comprueba los archivos locales, confirma si la duda es real, corrige solo si procede, ejecuta el dry-run y devuelve resultado.");
  lines.push("12. El usuario debe recibir el prompt para Codex o el analisis final, no una lista de comandos intermedios.");
  lines.push("13. ChatGPT prepara un prompt cerrado para Codex solo si hay fallo real o duda concreta que Codex deba verificar.");
  lines.push("14. Si Gemini marca una duda concreta, ChatGPT debe incluirla en el prompt para Codex como tarea de verificacion previa.");
  lines.push("15. Ejemplo: si Gemini dice \"posible ausencia del apartado 9\", ChatGPT debe pedir a Codex que compruebe en preview.json/preview.md si el apartado 9 existe, si fue omitido o absorbido, y que solo corrija si confirma el fallo.");
  lines.push("16. Codex debe hacer las comprobaciones necesarias en los archivos locales.");
  lines.push("17. Codex solo debe modificar tools/import-boe-norma.mjs si confirma un fallo real de segmentacion.");
  lines.push("18. Codex no puede inventar apartados, reescribir texto juridico, cambiar contenido normativo ni mover condiciones entre elementos.");
  lines.push("19. Codex modifica unicamente reglas de segmentacion en tools/import-boe-norma.mjs.");
  lines.push("20. Codex ejecuta el dry-run de la misma norma.");
  lines.push("21. Codex deja regenerado el preview.md.");
  lines.push("22. Codex devuelve resumen del diagnostico, cambios y resultado.");
  lines.push("23. Nadie sube a Supabase hasta que el dry-run y la revision final indiquen que esta apto.");
  lines.push("");
  lines.push("## FLUJO RAPIDO TRAS CODEX");
  lines.push("");
  lines.push("- Si Codex modifica tools/import-boe-norma.mjs, ejecuta el dry-run y regenera correctamente preview.md, el usuario NO esta obligado a pasar primero el resumen de Codex a ChatGPT.");
  lines.push("- En ese caso, el usuario puede enviar directamente el nuevo preview.md a Gemini o a la IA revisora.");
  lines.push("- ChatGPT solo debe intervenir despues de Gemini si Gemini responde NO SUBIR TODAVIA o REVISION DUDOSA.");
  lines.push("- Si Gemini responde OK PARA SUBIR, el usuario puede volver a ChatGPT solo para confirmacion final antes de una subida real.");
  lines.push("- Esta regla no elimina el dry-run obligatorio ni la prohibicion de tocar Supabase durante la revision.");
  lines.push("");
  lines.push("## REGLA ANTI-COMANDOS MANUALES");
  lines.push("");
  lines.push("- ChatGPT no debe responder al usuario con comandos manuales tipo Select-String, rg, cat, node o busquedas en preview.json para que el usuario los ejecute.");
  lines.push("- Si hace falta comprobar algo en los archivos locales, ChatGPT debe convertir esa comprobacion en una tarea para Codex.");
  lines.push("- Codex debe comprobar la duda antes de modificar.");
  lines.push("- Codex debe ejecutar el dry-run obligatorio, regenerar preview.md y devolver resultado.");
  lines.push("- Codex solo puede modificar reglas de segmentacion si confirma un fallo real.");
  lines.push("- Codex no puede reescribir texto juridico, inventar apartados, cambiar contenido normativo ni alterar el significado.");
  lines.push("- El texto juridico debe seguir siendo literal, contiguo y procedente del BOE/XML/fuente oficial.");
  lines.push("");
  lines.push("## REGLA DE DECISION FINAL");
  lines.push("");
  lines.push("- La IA revisora puede detectar problemas y proponer instrucciones.");
  lines.push("- Gemini u otra IA revisora no decide la subida definitiva.");
  lines.push("- La decision final depende del dry-run de integridad y de la revision final de ChatGPT.");
  lines.push("- Si el dry-run indica APTO PARA SUBIR y confirma:");
  lines.push("  - preview.json contiene instrucciones: no");
  lines.push("  - Fragmentos con instrucciones del preview: 0");
  lines.push("  - Fragmentos vacios/decorativos: 0");
  lines.push("  - Mezclas evidentes en ANEXO II: 0");
  lines.push("  - source_label con '/' de fusion artificial: 0");
  lines.push("  - Contexto de tabla dentro de texto operativo ANEXO II: 0");
  lines.push("  - Fragmentos no literales/contiguos detectados: 0");
  lines.push("  entonces la IA revisora no debe marcar NO SUBIR por simples bloques cortos, titulos oficiales repetidos o texto oficial que tambien aparezca en source_label.");
  lines.push("- Solo debe marcar NO SUBIR si detecta mezcla real de contenidos, texto inventado, perdida de texto juridico, fragmentos no literales, instrucciones dentro de preview.json o bloques realmente vacios/decorativos.");
  lines.push("");
  lines.push("La IA revisora debe responder SIEMPRE con esta estructura exacta:");
  lines.push("");
  lines.push("VEREDICTO:");
  lines.push("OK PARA SUBIR / NO SUBIR TODAVIA / REVISION DUDOSA");
  lines.push("");
  lines.push("DIAGNOSTICO:");
  lines.push("explicacion breve del problema");
  lines.push("");
  lines.push("BLOQUES CON PROBLEMAS:");
  lines.push("para cada bloque: numero de bloque, source_label exacto, articulo/anexo/disposicion afectada, tipo de problema, frase exacta donde empieza, estructura que deberia separarse o mantenerse unida, si es fallo real confirmado o duda");
  lines.push("");
  lines.push("EVIDENCIA TEXTUAL:");
  lines.push("por cada bloque problematico: numero de bloque, source_label exacto, tipo de problema, articulo/anexo/disposicion afectada, texto completo si el bloque es corto o minimo 30 lineas antes y 30 lineas despues si es largo, bloque anterior completo si es corto, bloque posterior completo si es corto, frase exacta donde empieza el problema, comparacion texto oficial esperado segun BOE/XML vs texto generado en preview, explicacion de si es texto inventado, texto reescrito, perdida de texto, mezcla de bloques, mal corte, mal source_label o simple bloque corto sin fallo real, estructura que deberia mantenerse unida o separada y si es fallo real confirmado o duda");
  lines.push("si se alegan fragmentos inventados, texto reescrito, texto no literal, perdida de contiguidad o una cifra del validador automatico: listar TODOS los fragmentos afectados uno por uno; no vale indicar solo una cifra global");
  lines.push("si no se aporta esta evidencia, el veredicto NO SUBIR TODAVIA o REVISION DUDOSA es INCOMPLETO y ChatGPT no debe preparar prompt para Codex todavia");
  lines.push("");
  lines.push("INSTRUCCIONES PARA CHATGPT:");
  lines.push("- Norma revisada:");
  lines.push("- Archivo que podria tocar Codex: tools/import-boe-norma.mjs");
  lines.push("- Problema detectado:");
  lines.push("- Bloques afectados: numero de bloque, source_label actual, texto inicial o punto exacto del problema.");
  lines.push("- Estructura que deberia separarse o mantenerse unida:");
  lines.push("- Duda concreta si existe:");
  lines.push("- Evidencia textual aportada por Gemini:");
  lines.push("- Si la evidencia es insuficiente, ChatGPT debe pedir revision ampliada a Gemini/IA revisora y NO preparar todavia prompt para Codex.");
  lines.push("- Cambio minimo recomendado:");
  lines.push("- Que debe comprobar ChatGPT antes de preparar prompt para Codex:");
  lines.push("  - Si el problema sigue existiendo en esta ultima iteracion del preview.");
  lines.push("  - Si el dry-run no devuelve APTO PARA SUBIR.");
  lines.push("  - Si hay mezcla real visible en los bloques.");
  lines.push("  - Si la duda de Gemini esta confirmada o debe quedar como revision dudosa sin cambio agresivo.");
  lines.push("  - ChatGPT no debe pedir al usuario comprobaciones manuales por terminal; debe trasladarlas a Codex.");
  lines.push("  - Si hay una duda concreta, ChatGPT debe incluirla en el prompt para Codex como verificacion previa obligatoria.");
  lines.push("- Si ChatGPT prepara prompt para Codex, debe dejar el trabajo mascado:");
  lines.push("  - archivo a tocar: tools/import-boe-norma.mjs");
  lines.push("  - problema exacto");
  lines.push("  - comprobaciones locales que debe hacer Codex antes de corregir");
  lines.push("  - regla minima de segmentacion");
  lines.push("  - ejemplo de texto disparador");
  lines.push("  - resultado esperado en el preview");
  lines.push("  - prueba obligatoria");
  lines.push("  - que no debe tocar Codex");
  lines.push("- Que NO debe tocar Codex:");
  lines.push("  - Supabase");
  lines.push("  - /api/ask");
  lines.push("  - frontend");
  lines.push("  - SQL");
  lines.push("  - embeddings");
  lines.push("  - subida real");
  lines.push("  - contenido juridico");
  lines.push("  - texto juridico oficial");
  lines.push("- Prueba obligatoria:");
  lines.push(`  node tools/import-boe-norma.mjs --boe-id ${currentBoeId} --dry-run`);
  lines.push("- Obligacion que debe incluir el PROMPT PARA CODEX:");
  lines.push(`  - Despues de modificar tools/import-boe-norma.mjs, Codex debe ejecutar siempre: node tools/import-boe-norma.mjs --boe-id ${currentBoeId} --dry-run`);
  lines.push(`  - Codex debe dejar regenerado el archivo: tools/output/${currentBoeId}/preview.md`);
  lines.push("  - Codex no debe pedir al usuario que ejecute el comando.");
  lines.push("  - Codex debe hacer la prueba y devolver el resultado.");
  lines.push("- Que debe comprobar ChatGPT antes de preparar el prompt para Codex:");
  lines.push("  - ChatGPT solo debe intervenir despues de Gemini si Gemini responde NO SUBIR TODAVIA o REVISION DUDOSA.");
  lines.push("  - Si Gemini responde OK PARA SUBIR, ChatGPT puede hacer solo una confirmacion final antes de subida real.");
  lines.push("  - ChatGPT debe preparar prompt para Codex solo si el problema sigue existiendo despues del dry-run.");
  lines.push("  - ChatGPT debe preparar prompt para Codex solo si el dry-run no devuelve APTO PARA SUBIR.");
  lines.push("  - ChatGPT debe preparar prompt para Codex solo si hay una mezcla real visible en los bloques.");
  lines.push("  - ChatGPT no debe pedir al usuario que ejecute comandos de comprobacion; si hay que verificar algo, debe incluirlo como tarea para Codex.");
  lines.push("");
  lines.push("RESUMEN FINAL:");
  lines.push("maximo 5 lineas");
  lines.push("");
  lines.push("## 1. Datos de la norma");
  lines.push("");
  lines.push(`- BOE ID: ${markdownValue(metadata.boeId)}`);
  lines.push(`- Titulo: ${markdownValue(metadata.titulo)}`);
  lines.push(`- Rango: ${markdownValue(metadata.rango)}`);
  lines.push(`- Fecha: ${markdownValue(metadata.fecha)}`);
  lines.push(`- Fecha disposicion: ${markdownValue(metadata.fecha_disposicion)}`);
  lines.push(`- Fecha publicacion: ${markdownValue(metadata.fecha_publicacion)}`);
  lines.push(`- Identificador: ${markdownValue(metadata.identificador)}`);
  lines.push(`- Codigo sugerido: ${markdownValue(metadata.codigo_sugerido || metadata.boeId)}`);
  lines.push(`- Source URL: ${markdownValue(metadata.source_url)}`);
  lines.push(`- Metadata URL: ${markdownValue(metadata.metadata_url)}`);
  lines.push("");
  lines.push("## 2. Estadisticas generales");
  lines.push("");
  lines.push(`- Total fragmentos candidatos: ${markdownValue(stats.total_fragmentos_candidatos)}`);
  lines.push(`- Articulos detectados: ${markdownValue(stats.articulos_detectados)}`);
  lines.push(`- Anexos detectados: ${markdownValue(stats.anexos_detectados)}`);
  lines.push(`- Fragmentos de anexo: ${markdownValue(stats.fragmentos_anexo)}`);
  lines.push(`- Disposiciones detectadas: ${markdownValue(stats.disposiciones_detectadas)}`);
  lines.push(`- Fragmento mas largo: ${markdownValue(stats.fragmento_mas_largo)} caracteres`);
  lines.push("");
  lines.push("## 3. Warnings generales");
  lines.push("");
  if (warnings.length === 0) {
    lines.push("- Ninguno");
  } else {
    warnings.forEach((warning) => lines.push(`- ${markdownValue(warning)}`));
  }
  lines.push("");
  lines.push("## 4. Lista de bloques detectados");
  lines.push("");
  lines.push("| # | Tipo | Source label | Longitud | Avisos |");
  lines.push("|---:|---|---|---:|---|");
  fragments.forEach((fragment, index) => {
    const blockWarnings = fragmentSimpleWarnings(fragment);
    const safeLabel = markdownValue(fragment.source_label).replace(/\|/g, "\\|");
    lines.push(`| ${index + 1} | ${markdownValue(fragment.tipo)} | ${safeLabel} | ${String(fragment.texto || "").length} | ${blockWarnings.length ? blockWarnings.length : "OK"} |`);
  });
  lines.push("");
  lines.push("## 5. Detalle de bloques");
  lines.push("");

  fragments.forEach((fragment, index) => {
    const blockWarnings = fragmentSimpleWarnings(fragment);
    lines.push(`### Bloque ${index + 1}`);
    lines.push("");
    lines.push(`- source_label: ${markdownValue(fragment.source_label)}`);
    lines.push(`- tipo: ${markdownValue(fragment.tipo)}`);
    lines.push(`- seccion: ${markdownValue(fragment.seccion)}`);
    lines.push(`- article_number: ${markdownValue(fragment.article_number)}`);
    lines.push(`- longitud_texto: ${String(fragment.texto || "").length}`);
    lines.push(`- fuente_bloque_id: ${markdownValue(fragment.fuente_bloque_id)}`);
    lines.push("");
    lines.push("Avisos:");
    if (blockWarnings.length === 0) {
      lines.push("- Ninguno");
    } else {
      blockWarnings.forEach((warning) => lines.push(`- ${warning}`));
    }
    lines.push("");
    lines.push("Texto inicial:");
    lines.push("");
    lines.push(`> ${markdownSnippet(fragment.texto).replace(/\n/g, "\n> ")}`);
    lines.push("");
  });

  const integritySection = buildMarkdownIntegritySection(preview.integrity);
  if (integritySection) {
    lines.push(integritySection);
  }

  return `${lines.join("\n")}\n`;
}

function buildMarkdownIntegritySection(integrity) {
  if (!integrity || !integrity.checks) return "";

  const checks = integrity.checks;
  const ok = (value) => value ? "OK" : "NO";
  const nonLiteralCount = Number(checks.nonLiteralCount || 0);
  const previewJsonHasInstructions = Boolean(checks.previewJsonHasInstructions);
  const instructionFragmentsCount = Number(checks.instructionFragmentsCount || 0);
  const emptyOrDecorativeCount = Number(checks.emptyOrDecorativeCount || 0);
  const inventedOrAddedTextCount = nonLiteralCount;
  const rewrittenLegalTextCount = nonLiteralCount;

  const lines = [];
  lines.push("## VERIFICACIÓN DE INTEGRIDAD");
  lines.push("");
  lines.push(`- Resultado: ${integrity.apto ? "APTO PARA REVISIÓN" : "NO APTO"}`);
  lines.push(`- Texto jurídico procedente de BOE/XML: ${ok(nonLiteralCount === 0)}`);
  lines.push(`- Preview JSON sin instrucciones: ${ok(!previewJsonHasInstructions)}`);
  lines.push(`- Fragmentos con instrucciones del preview: ${instructionFragmentsCount}`);
  lines.push(`- Fragmentos vacíos/decorativos: ${emptyOrDecorativeCount}`);
  lines.push(`- Fragmentos no literales/contiguos detectados: ${nonLiteralCount}`);
  lines.push(`- Texto añadido o inventado: ${inventedOrAddedTextCount}`);
  lines.push(`- Texto jurídico reescrito: ${rewrittenLegalTextCount}`);
  lines.push("- Supabase no tocado: OK");
  lines.push("- Embeddings no generados: OK");
  lines.push("- Subida real no ejecutada: OK");
  lines.push("");
  lines.push(integrity.apto
    ? "Conclusión recomendada: El preview conserva el texto jurídico literal detectado desde BOE/XML y está listo para revisión externa."
    : "Conclusión recomendada: El preview no está listo para revisión externa hasta resolver los problemas técnicos de integridad detectados.");

  const detailSection = buildMarkdownIntegrityDetailsSection(integrity);
  if (detailSection) {
    lines.push("");
    lines.push(detailSection);
  }

  return lines.join("\n");
}

function markdownCodeBlock(value) {
  const text = String(value || "").trim();
  return text ? `\`\`\`text\n${text}\n\`\`\`` : "_No disponible_";
}

function buildMarkdownIntegrityDetailsSection(integrity) {
  const problems = Array.isArray(integrity?.problems) ? integrity.problems : [];
  if (problems.length === 0) return "";

  const lines = [];
  lines.push("## DETALLE DE FALLOS DE INTEGRIDAD");
  lines.push("");
  lines.push("Esta seccion es tecnica: ayuda a revisar el preview sin inventar ni adivinar. Si el validador no puede localizar una comparacion exacta en BOE/XML, lo indica como candidato comparable.");

  problems.forEach((problem, index) => {
    lines.push("");
    lines.push(`### Fallo ${index + 1}`);
    lines.push("");
    lines.push(`- Tipo de fallo: ${markdownValue(problem.kind)}`);
    lines.push(`- Bloque: ${markdownValue(problem.block_number ?? problem.orden)}`);
    lines.push(`- source_label: ${markdownValue(problem.source_label)}`);
    lines.push(`- fuente_bloque_id: ${markdownValue(problem.fuente_bloque_id)}`);
    lines.push(`- Motivo: ${markdownValue(problem.message)}`);
    lines.push(`- Frase exacta donde empieza la discrepancia: ${markdownValue(problem.discrepancy_phrase)}`);
    lines.push(`- Fallo confirmado o aviso tecnico: ${markdownValue(problem.confirmation || "fallo confirmado por validador tecnico")}`);
    lines.push("");
    lines.push("Texto generado en preview:");
    lines.push("");
    lines.push(markdownCodeBlock(problem.generated_text));
    lines.push("");
    lines.push("Texto esperado BOE/XML o fragmento comparable:");
    lines.push("");
    lines.push(markdownCodeBlock(problem.official_comparable_text));
    lines.push("");
    lines.push(`Explicacion breve: ${markdownValue(problem.explanation || "El texto normalizado del fragmento no aparece como una secuencia literal y contigua dentro del BOE/XML oficial.")}`);

    if (Array.isArray(problem.related_candidates) && problem.related_candidates.length > 0) {
      lines.push("");
      lines.push("Candidatos relacionados:");
      problem.related_candidates.forEach((candidate) => {
        lines.push(`- Bloque ${markdownValue(candidate.block_number)} | ${markdownValue(candidate.source_label)} | ${markdownValue(candidate.fuente_bloque_id)}`);
      });
    }
  });

  return lines.join("\n");
}

async function writeReviewPreviewFiles({ boeId, preview }) {
  const previewDir = path.join(OUTPUT_DIR, boeId);
  const jsonPath = path.join(previewDir, "preview.json");
  const markdownPath = path.join(previewDir, "preview.md");

  await fs.mkdir(previewDir, { recursive: true });
  await fs.writeFile(jsonPath, JSON.stringify(preview, null, 2), "utf8");
  await fs.writeFile(markdownPath, buildMarkdownPreview(preview), "utf8");

  return { previewDir, jsonPath, markdownPath };
}

function normalizeIntegrityText(value) {
  return String(value || "")
    .replace(/[«»]/g, "\"")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPreviewInstructionsText(value) {
  return /INSTRUCCIONES PARA REVISI|INSTRUCCIONES PARA CHATGPT|PROMPT PARA CODEX|VEREDICTO:|RESUMEN FINAL:/i.test(String(value || ""));
}

function isDecorativeOnlyFragmentText(text) {
  const value = normalizeIntegrityText(text);
  if (!value || value.length < 20) return true;
  return /^(anexo|secci(?:Ã³|o)n|cap(?:Ã­|i)tulo|tabla|reglamento|ap(?:Ã©|e)ndice)(\s+[ivxlcdm\dªº.:-]+)?$/i.test(value);
}

function truncateIntegrityText(text, maxLength = 2200) {
  const value = normalizeIntegrityText(text);
  if (value.length <= maxLength) return value;
  const half = Math.floor((maxLength - 80) / 2);
  return `${value.slice(0, half)}\n\n[... texto recortado para preview ...]\n\n${value.slice(-half)}`;
}

function findOfficialComparableText(officialText, generatedText) {
  const generated = normalizeIntegrityText(generatedText);
  if (!generated) {
    return {
      phrase: null,
      officialComparableText: null,
      explanation: "El fragmento generado esta vacio tras normalizacion.",
    };
  }

  for (const length of [220, 180, 140, 100, 70, 45]) {
    const phrase = generated.slice(0, Math.min(length, generated.length)).trim();
    if (phrase.length < 20) continue;
    const index = officialText.indexOf(phrase);
    if (index !== -1) {
      const start = Math.max(0, index - 1200);
      const end = Math.min(officialText.length, index + phrase.length + 1200);
      return {
        phrase,
        officialComparableText: officialText.slice(start, end),
        explanation: "El inicio del fragmento existe en BOE/XML, pero el fragmento completo no aparece como una secuencia literal y contigua.",
      };
    }
  }

  const words = generated.split(/\s+/).filter(Boolean);
  for (let offset = 0; offset < Math.min(words.length, 40); offset += 5) {
    const phrase = words.slice(offset, offset + 12).join(" ").trim();
    if (phrase.length < 30) continue;
    const index = officialText.indexOf(phrase);
    if (index !== -1) {
      const start = Math.max(0, index - 1200);
      const end = Math.min(officialText.length, index + phrase.length + 1200);
      return {
        phrase,
        officialComparableText: officialText.slice(start, end),
        explanation: "Se localizo un tramo comparable en BOE/XML, pero no todo el fragmento generado aparece contiguo.",
      };
    }
  }

  return {
    phrase: generated.slice(0, 180),
    officialComparableText: null,
    explanation: "No se ha podido localizar ni siquiera el inicio del fragmento en el texto BOE/XML normalizado; revisar si hay texto alterado, recolocado o un problema de normalizacion.",
  };
}

function relatedIntegrityCandidates(fragments, index) {
  return [index - 1, index + 1]
    .filter((candidateIndex) => candidateIndex >= 0 && candidateIndex < fragments.length)
    .map((candidateIndex) => {
      const fragment = fragments[candidateIndex] || {};
      return {
        block_number: candidateIndex + 1,
        orden: fragment.orden ?? null,
        source_label: fragment.source_label ?? null,
        fuente_bloque_id: fragment.fuente_bloque_id ?? null,
      };
    });
}

function validateDryRunIntegrity({ preview, xml }) {
  const fragments = Array.isArray(preview?.fragments) ? preview.fragments : [];
  const officialText = normalizeIntegrityText(stripTags(xml));
  const previewJson = JSON.stringify(preview);
  const previewMarkdown = buildMarkdownPreview(preview);
  const problems = [];
  const nonLiteralFragments = [];

  const pushProblem = (kind, message, fragment = null, index = null, details = {}) => {
    problems.push({
      kind,
      message,
      block_number: Number.isInteger(index) ? index + 1 : null,
      orden: fragment?.orden ?? null,
      source_label: fragment?.source_label ?? null,
      fuente_bloque_id: fragment?.fuente_bloque_id ?? null,
      generated_text: details.generated_text ?? null,
      official_comparable_text: details.official_comparable_text ?? null,
      discrepancy_phrase: details.discrepancy_phrase ?? null,
      explanation: details.explanation ?? null,
      confirmation: details.confirmation ?? null,
      related_candidates: details.related_candidates ?? [],
    });
  };

  fragments.forEach((fragment, index) => {
    const text = normalizeIntegrityText(fragment?.texto || "");
    const sourceLabel = String(fragment?.source_label || "");
    const seccion = String(fragment?.seccion || "");

    if (containsPreviewInstructionsText(text) || containsPreviewInstructionsText(sourceLabel) || containsPreviewInstructionsText(seccion)) {
      pushProblem("preview_instructions_in_fragment", "Las instrucciones del preview aparecen en un fragmento subible.", fragment, index, {
        generated_text: truncateIntegrityText(fragment?.texto || ""),
        discrepancy_phrase: "INSTRUCCIONES PARA REVISION CON IA",
        explanation: "El fragmento contiene texto operativo del preview que no debe subirse ni embeberse.",
        confirmation: "fallo confirmado por validador tecnico",
        related_candidates: relatedIntegrityCandidates(fragments, index),
      });
    }

    if (isDecorativeOnlyFragmentText(text)) {
      pushProblem("empty_or_decorative_fragment", "Fragmento vacio o solo decorativo.", fragment, index, {
        generated_text: truncateIntegrityText(fragment?.texto || ""),
        discrepancy_phrase: text,
        explanation: "El fragmento no contiene contenido juridico util tras normalizacion.",
        confirmation: "fallo confirmado por validador tecnico",
        related_candidates: relatedIntegrityCandidates(fragments, index),
      });
    }

    if (!officialText.includes(text)) {
      const comparable = findOfficialComparableText(officialText, text);
      nonLiteralFragments.push({
        block_number: index + 1,
        orden: fragment.orden,
        source_label: sourceLabel,
        fuente_bloque_id: fragment.fuente_bloque_id ?? null,
        length: text.length,
        preview: text.slice(0, 180),
        discrepancy_phrase: comparable.phrase,
        official_comparable_text: comparable.officialComparableText,
      });
      pushProblem("non_literal_text", "El texto del fragmento no aparece como texto literal y contiguo en el BOE/XML oficial.", fragment, index, {
        generated_text: truncateIntegrityText(fragment?.texto || ""),
        official_comparable_text: truncateIntegrityText(comparable.officialComparableText || ""),
        discrepancy_phrase: comparable.phrase,
        explanation: comparable.explanation,
        confirmation: "fallo confirmado por validador tecnico",
        related_candidates: relatedIntegrityCandidates(fragments, index),
      });
    }

    if (/\bANEXO\s+II\b/i.test(sourceLabel)) {
      const lowerText = text.toLowerCase();
      if (/\s\/\s/.test(sourceLabel)) {
        pushProblem("mixed_source_label", "source_label contiene '/' con espacios, posible fusion artificial de sistemas.", fragment, index, {
          generated_text: truncateIntegrityText(fragment?.texto || ""),
          discrepancy_phrase: sourceLabel,
          explanation: "La etiqueta parece combinar sistemas distintos.",
          confirmation: "aviso tecnico del validador",
          related_candidates: relatedIntegrityCandidates(fragments, index),
        });
      }
      if (/-\s+Tabla\s+(?:I|II)\s+-/i.test(sourceLabel) && /^Tabla\s+(?:I|II)\./i.test(text)) {
        pushProblem("table_context_in_text", "Fragmento operativo de ANEXO II conserva encabezado de tabla dentro del campo texto.", fragment, index, {
          generated_text: truncateIntegrityText(fragment?.texto || ""),
          discrepancy_phrase: text.slice(0, 180),
          explanation: "El contexto de tabla debe estar en metadata/source_label si no es contiguo al texto operativo.",
          confirmation: "fallo confirmado por validador tecnico",
          related_candidates: relatedIntegrityCandidates(fragments, index),
        });
      }
      if (/hidrantes/.test(lowerText) && /sistemas de columna seca/.test(lowerText)) {
        pushProblem("mixed_anexo_ii_systems", "Fragmento de ANEXO II mezcla Hidrantes y Sistemas de columna seca.", fragment, index, {
          generated_text: truncateIntegrityText(fragment?.texto || ""),
          discrepancy_phrase: "Hidrantes / Sistemas de columna seca",
          explanation: "El fragmento contiene dos sistemas tecnicos que deben revisarse como posible mezcla.",
          confirmation: "aviso tecnico del validador",
          related_candidates: relatedIntegrityCandidates(fragments, index),
        });
      }
      if (/extintores de incendio/.test(lowerText) && /bocas de incendio/.test(lowerText)) {
        pushProblem("mixed_anexo_ii_systems", "Fragmento de ANEXO II mezcla Extintores y BIE.", fragment, index, {
          generated_text: truncateIntegrityText(fragment?.texto || ""),
          discrepancy_phrase: "Extintores de incendio / Bocas de incendio",
          explanation: "El fragmento contiene dos sistemas tecnicos que deben revisarse como posible mezcla.",
          confirmation: "aviso tecnico del validador",
          related_candidates: relatedIntegrityCandidates(fragments, index),
        });
      }
    }
  });

  if (!containsPreviewInstructionsText(previewMarkdown)) {
    pushProblem("preview_markdown_missing_instructions", "preview.md no contiene las instrucciones fijas para revisiÃ³n con IA.");
  }
  if (containsPreviewInstructionsText(previewJson)) {
    pushProblem("preview_json_contains_instructions", "preview.json contiene instrucciones del preview.md.");
  }

  return {
    apto: problems.length === 0,
    problems,
    nonLiteralFragments,
    checks: {
      previewMarkdownHasInstructions: containsPreviewInstructionsText(previewMarkdown),
      previewJsonHasInstructions: containsPreviewInstructionsText(previewJson),
      instructionFragmentsCount: problems.filter((problem) => problem.kind === "preview_instructions_in_fragment").length,
      emptyOrDecorativeCount: problems.filter((problem) => problem.kind === "empty_or_decorative_fragment").length,
      mixedAnexoIICount: problems.filter((problem) => problem.kind === "mixed_anexo_ii_systems").length,
      artificialSlashLabelCount: problems.filter((problem) => problem.kind === "mixed_source_label").length,
      tableContextInTextCount: problems.filter((problem) => problem.kind === "table_context_in_text").length,
      nonLiteralCount: nonLiteralFragments.length,
    },
  };
}

function printDryRunIntegrity(result) {
  console.log("\n[BOE][DRY_RUN][INTEGRIDAD]");
  console.log(`Resultado: ${result.apto ? "APTO PARA SUBIR" : "NO APTO PARA SUBIR"}`);
  console.log(`preview.md contiene instrucciones: ${result.checks.previewMarkdownHasInstructions ? "sÃ­" : "no"}`);
  console.log(`preview.json contiene instrucciones: ${result.checks.previewJsonHasInstructions ? "sÃ­" : "no"}`);
  console.log(`Fragmentos con instrucciones del preview: ${result.checks.instructionFragmentsCount}`);
  console.log(`Fragmentos vacÃ­os/decorativos: ${result.checks.emptyOrDecorativeCount}`);
  console.log(`Mezclas evidentes en ANEXO II: ${result.checks.mixedAnexoIICount}`);
  console.log(`source_label con '/' de fusiÃ³n artificial: ${result.checks.artificialSlashLabelCount}`);
  console.log(`Contexto de tabla dentro de texto operativo ANEXO II: ${result.checks.tableContextInTextCount}`);
  console.log(`Fragmentos no literales/contiguos detectados: ${result.checks.nonLiteralCount}`);

  if (result.problems.length > 0) {
    console.log("Problemas detectados:");
    result.problems.slice(0, 12).forEach((problem) => {
      const fragmentInfo = problem.orden ? ` Fragmento ${problem.orden} (${problem.source_label})` : "";
      console.log(`- [${problem.kind}]${fragmentInfo}: ${problem.message}`);
    });
    if (result.problems.length > 12) {
      console.log(`- ... ${result.problems.length - 12} problema(s) adicional(es).`);
    }
  }
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

  if (preview?.integrity && preview.integrity.apto === false) {
    errors.push("El preview indica que el dry-run no fue APTO PARA SUBIR (fallos de integridad).");
  }

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

function previewDocumentHash(preview) {
  const hashPayload = {
    boeId: preview?.metadata?.boeId || null,
    identificador: preview?.metadata?.identificador || null,
    source_url: preview?.metadata?.source_url || null,
    titulo: preview?.metadata?.titulo || null,
    fecha: preview?.metadata?.fecha || null,
    fragments: Array.isArray(preview?.fragments)
      ? preview.fragments.map((fragment) => ({
          tipo: fragment.tipo || null,
          seccion: fragment.seccion || null,
          orden: fragment.orden || null,
          texto: fragment.texto || "",
          source_label: fragment.source_label || null,
          fuente_bloque_id: fragment.fuente_bloque_id || null,
          fuente_version_fecha: fragment.fuente_version_fecha || null,
        }))
      : [],
  };

  return crypto.createHash("sha256").update(JSON.stringify(hashPayload)).digest("hex");
}

async function fetchDuplicateNormas({ supabase, codigo, sourceUrl, documentHash }) {
  const duplicateGroups = [];

  const queries = [
    {
      label: "codigo",
      enabled: Boolean(codigo),
      query: () => supabase
        .from("normas")
        .select("id,codigo,titulo,estado_ingesta,num_fragmentos,document_hash,url_fuente")
        .eq("codigo", codigo)
        .is("owner_user_id", null),
    },
    {
      label: "url_fuente",
      enabled: Boolean(sourceUrl),
      query: () => supabase
        .from("normas")
        .select("id,codigo,titulo,estado_ingesta,num_fragmentos,document_hash,url_fuente")
        .eq("url_fuente", sourceUrl)
        .is("owner_user_id", null),
    },
    {
      label: "document_hash",
      enabled: Boolean(documentHash),
      query: () => supabase
        .from("normas")
        .select("id,codigo,titulo,estado_ingesta,num_fragmentos,document_hash,url_fuente")
        .eq("document_hash", documentHash)
        .is("owner_user_id", null),
    },
  ];

  for (const item of queries) {
    if (!item.enabled) continue;
    const { data, error } = await item.query();
    if (error) throw new Error(`Error consultando duplicados por ${item.label}: ${error.message}`);
    if (data && data.length > 0) {
      duplicateGroups.push({ label: item.label, rows: data });
    }
  }

  return duplicateGroups;
}

function printDuplicateSummary(duplicateGroups) {
  if (duplicateGroups.length === 0) {
    console.log("Duplicados: ninguno");
    return;
  }

  console.log("Duplicados encontrados:");
  duplicateGroups.forEach((group) => {
    console.log(`- Por ${group.label}:`);
    group.rows.forEach((row) => {
      console.log(`  id=${row.id} | codigo=${row.codigo || "N/D"} | estado_ingesta=${row.estado_ingesta || "N/D"} | fragmentos=${row.num_fragmentos ?? "N/D"}`);
      console.log(`  titulo=${row.titulo || "N/D"}`);
    });
  });
}

function yearFromPreviewMetadata(metadata) {
  const match = String(metadata?.fecha || metadata?.fecha_publicacion || "").match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function buildNormaPayload({ preview, codigo, documentHash }) {
  const metadata = preview.metadata;
  const tituloArg = (getArg("titulo") || "").trim();
  const jurisdiccion = (getArg("jurisdiccion") || "ES").trim();
  const materia = (getArg("materia") || "").trim();
  const submateria = (getArg("submateria") || "").trim();
  const keywords = parseKeywordsArg(getArg("keywords"));

  return {
    codigo,
    titulo: tituloArg || metadata.titulo,
    rango: metadata.rango,
    fecha_publicacion: metadata.fecha,
    estado: "vigente",
    estado_ingesta: "procesando",
    document_hash: documentHash,
    url_fuente: metadata.source_url,
    nombre_archivo: `boe-preview-${metadata.boeId}.json`,
    mime_type: "application/xml",
    fecha_ingesta: new Date().toISOString(),
    owner_user_id: null,
    jurisdiccion,
    materia: materia || null,
    submateria: submateria || null,
    keywords,
  };
}

function buildNormasPartesPayloads({ preview, normaPayload }) {
  const metadata = preview.metadata;
  const year = yearFromPreviewMetadata(metadata);
  const normType = metadata.rango || "Norma Jurídica";

  return preview.fragments.map((fragment, index) => ({
    tipo: fragment.tipo || null,
    seccion: fragment.seccion,
    numero: fragment.numero ?? null,
    texto: fragment.texto,
    orden: Number.isInteger(fragment.orden) ? fragment.orden : index + 1,
    huella: crypto.createHash("sha256").update(fragment.texto).digest("hex"),
    articulo: fragment.articulo ?? null,
    rango: metadata.rango || null,
    es_indice: false,
    jurisdiction: normaPayload.jurisdiccion || null,
    norm_type: normType,
    year,
    article_number: fragment.article_number ?? null,
    apartado: fragment.apartado ?? null,
    embedding: "[PENDING_EMBEDDING]",
  }));
}

function buildEmbeddingInput(fragment) {
  const context = [
    fragment.seccion,
    fragment.articulo,
    fragment.tipo,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join("\n");

  return context ? `${context}\n${fragment.texto}` : fragment.texto;
}

function countPreparedFragments(partesPayloads) {
  return {
    total: partesPayloads.length,
    articulos: partesPayloads.filter((item) => String(item.tipo || "").toLowerCase().includes("art")).length,
    anexos: partesPayloads.filter((item) => String(item.tipo || "").toLowerCase().includes("anex")).length,
    disposiciones: partesPayloads.filter((item) => String(item.tipo || "").toLowerCase().includes("dispos")).length,
  };
}

function summarizeFragmentPayload(fragment) {
  if (!fragment) return null;
  return {
    tipo: fragment.tipo,
    seccion: fragment.seccion,
    numero: fragment.numero,
    orden: fragment.orden,
    texto_chars: fragment.texto.length,
    huella: fragment.huella,
    articulo: fragment.articulo,
    rango: fragment.rango,
    es_indice: fragment.es_indice,
    jurisdiction: fragment.jurisdiction,
    norm_type: fragment.norm_type,
    year: fragment.year,
    article_number: fragment.article_number,
    apartado: fragment.apartado,
    embedding: fragment.embedding,
    texto_preview: fragment.texto.slice(0, 220).replace(/\s+/g, " "),
  };
}

function printWritePlan({ normaPayload, partesPayloads, documentHash }) {
  const counters = countPreparedFragments(partesPayloads);

  console.log("\n[BOE][WRITE_PLAN] Payload de futura fila en normas:");
  console.log(JSON.stringify(normaPayload, null, 2));

  console.log("\n[BOE][WRITE_PLAN] Primer fragmento preparado:");
  console.log(JSON.stringify(summarizeFragmentPayload(partesPayloads[0]), null, 2));

  console.log("\n[BOE][WRITE_PLAN] Último fragmento preparado:");
  console.log(JSON.stringify(summarizeFragmentPayload(partesPayloads[partesPayloads.length - 1]), null, 2));

  console.log("\n[BOE][WRITE_PLAN] Contadores finales:");
  console.log(`Total fragmentos preparados: ${counters.total}`);
  console.log(`Artículos: ${counters.articulos}`);
  console.log(`Anexos: ${counters.anexos}`);
  console.log(`Disposiciones: ${counters.disposiciones}`);
  console.log(`Document hash: ${documentHash}`);
  console.log("Acción: READY_FOR_EXECUTE_UPLOAD");
  console.log("[BOE][WRITE_PLAN] No se ha insertado, borrado ni generado embeddings.");
}

async function updateNormaIngestError(supabase, normaId, error) {
  if (!normaId) return;
  const message = String(error?.message || error || "Error desconocido").slice(0, 4000);
  const { error: updateError } = await supabase
    .from("normas")
    .update({
      estado_ingesta: "error",
      error_ingesta: message,
    })
    .eq("id", normaId);

  if (updateError) {
    console.error(`[BOE][EXECUTE_UPLOAD] No se pudo marcar estado_ingesta=error: ${updateError.message}`);
  }
}

async function executeUploadMode({ supabase, openai, preview, validation, normaPayload, partesPayloads, documentHash }) {
  let normaId = null;
  let insertedCount = 0;
  let numEmbeddingsGenerados = 0;

  console.log("\n[BOE][EXECUTE_UPLOAD] Iniciando subida real controlada");
  console.log(`CÃ³digo: ${normaPayload.codigo}`);
  console.log(`Document hash: ${documentHash}`);
  console.log(`Fragmentos preparados: ${partesPayloads.length}`);

  try {
    const { data: insertedNorma, error: insertNormaError } = await supabase
      .from("normas")
      .insert(normaPayload)
      .select("id")
      .single();

    if (insertNormaError) throw new Error(`Error insertando norma: ${insertNormaError.message}`);
    if (!insertedNorma?.id) throw new Error("Supabase no devolviÃ³ id al insertar norma.");

    normaId = insertedNorma.id;
    console.log(`[BOE][EXECUTE_UPLOAD] Norma creada con id=${normaId}`);

    for (let i = 0; i < partesPayloads.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = partesPayloads.slice(i, i + EMBEDDING_BATCH_SIZE);
      const textsToVectorize = batch.map((fragment) => (
        !fragment.es_indice && fragment.texto.length >= 20 ? buildEmbeddingInput(fragment) : null
      ));
      const validTexts = textsToVectorize.filter((text) => text !== null);
      let batchEmbeddings = [];
      let embeddingIndex = 0;

      if (validTexts.length > 0) {
        console.log(`[BOE][EXECUTE_UPLOAD] Generando embeddings batch ${Math.floor(i / EMBEDDING_BATCH_SIZE) + 1} (${validTexts.length} textos)`);
        const embeddingResponse = await openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: validTexts,
          dimensions: 1536,
        });
        batchEmbeddings = embeddingResponse.data.map((item) => item.embedding);
      }

      const rowsToInsert = batch.map((fragment, index) => {
        let embedding = null;
        if (textsToVectorize[index] !== null && embeddingIndex < batchEmbeddings.length) {
          embedding = batchEmbeddings[embeddingIndex++];
          numEmbeddingsGenerados++;
        }

        return {
          ...fragment,
          norma_id: normaId,
          orden: i + index + 1,
          embedding,
        };
      });

      const { error: insertPartesError } = await supabase
        .from("normas_partes")
        .insert(rowsToInsert);

      if (insertPartesError) {
        throw new Error(`Error insertando fragmentos desde ${i + 1}: ${insertPartesError.message}`);
      }

      insertedCount += rowsToInsert.length;
    }

    const stats = preview.stats || {};
    const { error: updateError } = await supabase
      .from("normas")
      .update({
        estado_ingesta: "lista",
        num_fragmentos: insertedCount,
        num_articulos_detectados: stats.articulos_detectados ?? validation.stats.articulos,
        num_anexos_detectados: stats.anexos_detectados ?? validation.stats.anexos,
        num_embeddings_generados: numEmbeddingsGenerados,
        error_ingesta: null,
      })
      .eq("id", normaId);

    if (updateError) throw new Error(`Error actualizando norma final: ${updateError.message}`);

    console.log(`[BOE][EXECUTE_UPLOAD] Subida completada: norma_id=${normaId}, fragmentos=${insertedCount}, embeddings=${numEmbeddingsGenerados}`);
  } catch (error) {
    await updateNormaIngestError(supabase, normaId, error);
    throw error;
  }
}

async function confirmUploadPreflightMode(boeId) {
  const writePlan = hasFlag("write-plan");
  const executeUpload = hasFlag("execute-upload");
  const replaceExisting = hasFlag("replace-existing");

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!supabaseUrl) throw new Error("Falta variable SUPABASE_URL.");
  if (!supabaseKey) throw new Error("Falta variable SUPABASE_SERVICE_ROLE_KEY.");
  if (executeUpload && !openaiKey) throw new Error("Falta variable OPENAI_API_KEY para --execute-upload.");

  const { outputPath, preview } = await readPreviewJson(boeId);
  const validation = validatePreviewShape(preview, boeId);
  if (validation.errors.length > 0) {
    console.log("\n[BOE][PRE_FLIGHT] Preview NO VALIDADO. Abortando antes de consultar Supabase.");
    validation.errors.forEach((error) => console.log(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  const metadata = preview.metadata;
  const codigo = (getArg("codigo") || metadata.codigo_sugerido || boeId).trim();
  const stats = preview.stats || {};
  const documentHash = previewDocumentHash(preview);
  const supabase = createClient(supabaseUrl, supabaseKey);

  const duplicateGroups = await fetchDuplicateNormas({
    supabase,
    codigo,
    sourceUrl: metadata.source_url,
    documentHash,
  });

  const hasDuplicates = duplicateGroups.length > 0;
  
  const allDuplicateRows = new Map();
  if (hasDuplicates) {
    for (const group of duplicateGroups) {
      for (const row of group.rows) {
        allDuplicateRows.set(row.id, row);
      }
    }
  }

  let action = hasDuplicates ? "ABORTAR_DUPLICADO" : "CREAR_NUEVA_NORMA";
  if (hasDuplicates && replaceExisting) {
    if (allDuplicateRows.size === 1) {
      action = "REEMPLAZAR_EXISTENTE";
    } else {
      action = "ABORTAR_MULTIPLES_EXISTENTES";
    }
  }

  const targetDuplicateId = action === "REEMPLAZAR_EXISTENTE" ? Array.from(allDuplicateRows.keys())[0] : null;

  console.log("\n[BOE][PRE_FLIGHT] Plan de publicación controlada");
  console.log(`Archivo preview: ${outputPath}`);
  console.log(`BOE ID: ${metadata.boeId}`);
  console.log(`Código: ${codigo}`);
  console.log(`Título: ${metadata.titulo}`);
  console.log(`Fecha: ${metadata.fecha}`);
  console.log(`Source URL: ${metadata.source_url}`);
  console.log(`Document hash preview: ${documentHash}`);
  console.log(`Fragmentos: ${preview.fragments.length}`);
  console.log(`Artículos: ${stats.articulos_detectados ?? validation.stats.articulos}`);
  console.log(`Anexos: ${stats.anexos_detectados ?? validation.stats.anexos}`);
  console.log(`Fragmento máximo: ${stats.fragmento_mas_largo ?? validation.stats.maxLength} caracteres`);
  printDuplicateSummary(duplicateGroups);
  console.log(`Acción futura recomendada: ${action}`);
  if (action === "REEMPLAZAR_EXISTENTE") {
    console.log(`- Se reemplazará la norma_id: ${targetDuplicateId}`);
  }
  if (executeUpload) {
    console.log("[BOE][PRE_FLIGHT] Validado para ejecuciÃ³n real solicitada con --confirm-upload --execute-upload.");
  } else {
    console.log("[BOE][PRE_FLIGHT] Solo lectura. No se ha insertado, borrado ni generado embeddings.");
  }

  if (action.startsWith("ABORTAR")) {
    console.log(`Acción: ${action}`);
    process.exitCode = 1;
    return;
  }

  if (executeUpload) {
    if (action === "REEMPLAZAR_EXISTENTE" && targetDuplicateId) {
      console.log(`\n[BOE][REPLACE] Borrando fragmentos de norma_id=${targetDuplicateId}`);
      const { error: delPartesError } = await supabase
        .from("normas_partes")
        .delete()
        .eq("norma_id", targetDuplicateId);
      if (delPartesError) throw new Error(`Error borrando partes antiguas: ${delPartesError.message}`);
      
      console.log(`[BOE][REPLACE] Borrando norma_id=${targetDuplicateId}`);
      const { error: delNormaError } = await supabase
        .from("normas")
        .delete()
        .eq("id", targetDuplicateId);
      if (delNormaError) throw new Error(`Error borrando norma antigua: ${delNormaError.message}`);
    }

    const normaPayload = buildNormaPayload({ preview, codigo, documentHash });
    const partesPayloads = buildNormasPartesPayloads({ preview, normaPayload });
    await executeUploadMode({
      supabase,
      openai: new OpenAI({ apiKey: openaiKey }),
      preview,
      validation,
      normaPayload,
      partesPayloads,
      documentHash,
    });
    return;
  }

  if (writePlan) {
    const normaPayload = buildNormaPayload({ preview, codigo, documentHash });
    const partesPayloads = buildNormasPartesPayloads({ preview, normaPayload });
    printWritePlan({ normaPayload, partesPayloads, documentHash });
  }
}

async function main() {
  const { boeId, validatePreview, confirmUpload } = requireArgs();
  const warnings = [];

  if (validatePreview) {
    await validatePreviewMode(boeId);
    return;
  }

  if (confirmUpload) {
    await confirmUploadPreflightMode(boeId);
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
  const integrity = validateDryRunIntegrity({ preview, xml });
  preview.integrity = integrity;

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, `boe-preview-${boeId}.json`);
  await fs.writeFile(outputPath, JSON.stringify(preview, null, 2), "utf8");
  const { markdownPath } = await writeReviewPreviewFiles({ boeId, preview });

  printSummary({ metadata, stats, warnings, fragments });
  printDryRunIntegrity(integrity);
  console.log(`\n[BOE][DRY_RUN] JSON guardado en ${outputPath}`);
  console.log(`Preview Markdown guardado en: ${markdownPath}`);
  console.log("[BOE][DRY_RUN] No se ha tocado Supabase ni se han generado embeddings.");
  if (!integrity.apto) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[BOE][ERROR] ${error.message}`);
  process.exit(1);
});
