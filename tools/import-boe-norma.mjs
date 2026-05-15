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
      article_number: fragmentTipo === "Artículo" ? articleNumberFrom(seccion) || articleNumberFrom(text) : null,
      orden: fragments.length + 1,
      texto: text,
      source_label: sourceLabel(fragmentTipo, seccion),
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

function isAnexoIIFragment(fragment) {
  return /\bANEXO\s+II\b/i.test(String(fragment?.source_label || fragment?.seccion || ""));
}

function isAnexoIITableHeading(title) {
  return /^Tabla\s+(?:I{1,3}|IV|V|\d+)\b/i.test(String(title || ""));
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

    if (fragment.tipo !== "Anexo" || (fragment.texto.length <= MAX_FRAGMENT_LENGTH && !shouldSplitAnexoIIForReview)) {
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
  return currentAnexo === "ANEXO II" && nextAnexo === "ANEXO II";
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
  const stats = preview.stats || {};
  const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
  const fragments = Array.isArray(preview.fragments) ? preview.fragments : [];
  const lines = [];

  lines.push(`# Preview BOE - ${markdownValue(metadata.boeId)}`);
  lines.push("");
  lines.push("# INSTRUCCIONES PARA REVISIÓN CON IA");
  lines.push("");
  lines.push("Este archivo es un preview tecnico de fragmentacion automatica antes de subir una norma a Supabase.");
  lines.push("");
  lines.push("La IA revisora debe seguir estas reglas:");
  lines.push("");
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
  lines.push("- Debe decir si esta OK para subir o NO subir todavia.");
  lines.push("- Si la IA revisora no esta segura, debe decir \"revision dudosa\" y no proponer cambios agresivos.");
  lines.push("- No debe preparar el prompt final para Codex.");
  lines.push("- Si detecta problemas, debe preparar INSTRUCCIONES PARA CHATGPT para que ChatGPT redacte despues el prompt bueno para Codex.");
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
  lines.push("OK PARA SUBIR / NO SUBIR TODAVIA");
  lines.push("");
  lines.push("DIAGNOSTICO:");
  lines.push("explicacion breve del problema");
  lines.push("");
  lines.push("BLOQUES CON PROBLEMAS:");
  lines.push("bloque, etiqueta actual, problema concreto");
  lines.push("");
  lines.push("INSTRUCCIONES PARA CHATGPT:");
  lines.push("- Norma revisada:");
  lines.push("- Archivo que podria tocar Codex: tools/import-boe-norma.mjs");
  lines.push("- Problema detectado:");
  lines.push("- Bloques afectados:");
  lines.push("- Cambio minimo recomendado:");
  lines.push("- Que NO debe tocar Codex:");
  lines.push("  - Supabase");
  lines.push("  - /api/ask");
  lines.push("  - frontend");
  lines.push("  - SQL");
  lines.push("  - embeddings");
  lines.push("  - subida real");
  lines.push("  - contenido juridico");
  lines.push("- Prueba obligatoria:");
  lines.push("  node tools/import-boe-norma.mjs --boe-id BOE-A-2017-6606 --dry-run");
  lines.push("- Obligacion que debe incluir el PROMPT PARA CODEX:");
  lines.push("  - Despues de modificar tools/import-boe-norma.mjs, Codex debe ejecutar siempre: node tools/import-boe-norma.mjs --boe-id BOE-A-2017-6606 --dry-run");
  lines.push("  - Codex debe dejar regenerado el archivo: tools/output/BOE-A-2017-6606/preview.md");
  lines.push("  - Codex no debe pedir al usuario que ejecute el comando.");
  lines.push("  - Codex debe hacer la prueba y devolver el resultado.");
  lines.push("- Que debe comprobar ChatGPT antes de preparar el prompt para Codex:");
  lines.push("  - ChatGPT debe preparar prompt para Codex solo si el problema sigue existiendo despues del dry-run.");
  lines.push("  - ChatGPT debe preparar prompt para Codex solo si el dry-run no devuelve APTO PARA SUBIR.");
  lines.push("  - ChatGPT debe preparar prompt para Codex solo si hay una mezcla real visible en los bloques.");
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

  return `${lines.join("\n")}\n`;
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

function validateDryRunIntegrity({ preview, xml }) {
  const fragments = Array.isArray(preview?.fragments) ? preview.fragments : [];
  const officialText = normalizeIntegrityText(stripTags(xml));
  const previewJson = JSON.stringify(preview);
  const previewMarkdown = buildMarkdownPreview(preview);
  const problems = [];
  const nonLiteralFragments = [];

  const pushProblem = (kind, message, fragment = null) => {
    problems.push({
      kind,
      message,
      orden: fragment?.orden ?? null,
      source_label: fragment?.source_label ?? null,
    });
  };

  fragments.forEach((fragment) => {
    const text = normalizeIntegrityText(fragment?.texto || "");
    const sourceLabel = String(fragment?.source_label || "");
    const seccion = String(fragment?.seccion || "");

    if (containsPreviewInstructionsText(text) || containsPreviewInstructionsText(sourceLabel) || containsPreviewInstructionsText(seccion)) {
      pushProblem("preview_instructions_in_fragment", "Las instrucciones del preview aparecen en un fragmento subible.", fragment);
    }

    if (isDecorativeOnlyFragmentText(text)) {
      pushProblem("empty_or_decorative_fragment", "Fragmento vacÃ­o o solo decorativo.", fragment);
    }

    if (!officialText.includes(text)) {
      nonLiteralFragments.push({
        orden: fragment.orden,
        source_label: sourceLabel,
        length: text.length,
        preview: text.slice(0, 180),
      });
      pushProblem("non_literal_text", "El texto del fragmento no aparece como texto literal y contiguo en el BOE/XML oficial.", fragment);
    }

    if (/\bANEXO\s+II\b/i.test(sourceLabel)) {
      const lowerText = text.toLowerCase();
      if (/\s\/\s/.test(sourceLabel)) {
        pushProblem("mixed_source_label", "source_label contiene '/' con espacios, posible fusiÃ³n artificial de sistemas.", fragment);
      }
      if (/-\s+Tabla\s+(?:I|II)\s+-/i.test(sourceLabel) && /^Tabla\s+(?:I|II)\./i.test(text)) {
        pushProblem("table_context_in_text", "Fragmento operativo de ANEXO II conserva encabezado de tabla dentro del campo texto.", fragment);
      }
      if (/hidrantes/.test(lowerText) && /sistemas de columna seca/.test(lowerText)) {
        pushProblem("mixed_anexo_ii_systems", "Fragmento de ANEXO II mezcla Hidrantes y Sistemas de columna seca.", fragment);
      }
      if (/extintores de incendio/.test(lowerText) && /bocas de incendio/.test(lowerText)) {
        pushProblem("mixed_anexo_ii_systems", "Fragmento de ANEXO II mezcla Extintores y BIE.", fragment);
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
