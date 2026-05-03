import dotenv from "dotenv";
import fs from "node:fs/promises";

dotenv.config({ path: ".env.local" });

console.log("[ENV] SUPABASE_URL loaded:", Boolean(process.env.SUPABASE_URL));
console.log("[ENV] SERVICE_ROLE loaded:", Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY));
console.log("[ENV] OPENAI loaded:", Boolean(process.env.OPENAI_API_KEY));
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// ==========================================
// CONFIGURACIÓN DE EJECUCIÓN
// ==========================================
const DRY_RUN = false; // Si es true, NO inserta en base de datos ni genera embeddings

const cliArgs = process.argv.slice(2);

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

const FILE_PATH = requiredCliArg("file");
const CODIGO = requiredCliArg("codigo");
const TITULO = requiredCliArg("titulo");
const CONFIRM_UPLOAD = cliArgs.includes("--confirm-upload");
const MODEL = "gpt-4o-mini";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_BATCH_SIZE = 20;

let supabase;
let openai;
const requestId = crypto.randomUUID();

function initUploadClients() {
  const requiredEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY"];
  for (const key of requiredEnv) {
    if (!process.env[key]) throw new Error(`Falta variable: ${key}`);
  }
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function normalizeText(text) {
  return text
    .replace(/BOLET[I\u00CD]N OFICIAL DEL ESTADO/gi, "")
    .replace(/LEGISLACI[O\u00D3]N CONSOLIDADA/gi, "")
    .replace(/P[a\u00E1]gina\s+\d+/gi, "")
    .replace(/-\s*\n\s*/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getCodigoSignals(codigo) {
  const match = codigo.match(/(\d+)[/-](\d{4})/);
  if (!match) throw new Error(`No se puede validar el c\u00F3digo esperado: ${codigo}`);

  const [, number, year] = match;
  return [`${number}/${year}`, `${number}-${year}`];
}

function validateExtractedTextMatchesCodigo(text, codigo) {
  const normalizedText = text.toLowerCase();
  const signals = getCodigoSignals(codigo).map(signal => signal.toLowerCase());
  const foundSignal = signals.find(signal => normalizedText.includes(signal));

  if (!foundSignal) {
    throw new Error(
      `El PDF no parece corresponder a ${codigo}. ` +
      `No se encontr\u00F3 ninguna se\u00F1al esperada: ${signals.join(", ")}`
    );
  }

  console.log(`[VALIDACION] C\u00F3digo esperado encontrado en PDF: ${foundSignal}`);
}

async function extractTextFromPdfBuffer(buffer) {
  const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = pdfParseModule.default || pdfParseModule;
  const parsed = await pdfParse(buffer);
  const text = normalizeText(parsed.text || "");
  if (text.length < 100) throw new Error("PDF sin texto suficiente.");
  return text;
}

function extractMetadataFromTitle(title) {
  const res = { tipo: null, numero: null, article_number: null };
  const tLower = title.toLowerCase();

  const safeNumericCast = (rawText) => {
    const numMatch = rawText.match(/\d+/);
    return numMatch ? numMatch[0] : null;
  };

  if (tLower.startsWith('art') || tLower.startsWith('art.')) {
    res.tipo = 'Art\u00EDculo';
    const rawNum = title.replace(/art[i\u00ED]culo\s+/i, '').replace(/art\.\s*/i, '').trim();
    res.numero = safeNumericCast(rawNum);
    res.article_number = res.numero ? parseInt(res.numero) : null;
  } else if (tLower.includes('disposici\u00F3n')) {
    res.tipo = 'Disposici\u00F3n';
    const rawNum = title.replace(/disposici[o\u00F3]n\s+\w+\s+/i, '').trim();
    res.numero = safeNumericCast(rawNum);
  } else if (tLower.startsWith('anexo')) {
    res.tipo = 'Anexo';
    const rawNum = title.replace(/anexo\s+/i, '').trim();
    res.numero = safeNumericCast(rawNum);
  } else if (tLower.startsWith('cap\u00EDtulo')) {
    res.tipo = 'Cap\u00EDtulo';
    const rawNum = title.replace(/cap[i\u00ED]tulo\s+/i, '').trim();
    res.numero = safeNumericCast(rawNum);
  } else if (tLower.startsWith('secci\u00F3n')) {
    res.tipo = 'Secci\u00F3n';
    const rawNum = title.replace(/secci[o\u00F3]n\s+/i, '').trim();
    res.numero = safeNumericCast(rawNum);
  }

  return res;
}

function getLineAtIndex(text, index) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const lineEnd = text.indexOf("\n", index);
  return text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
}

function isInternalReferenceLine(line, heading) {
  if (/^anexo\b/i.test(heading)) {
    return !/^ANEXO\s+(?:[IVX]+|\u00DANICO)\.?$/i.test(line);
  }

  const rest = line.slice(heading.length).trim();
  return /^(?:de|del|en|seg[u\u00FA]n|conforme|previsto)\b/i.test(rest)
    || /^(?:\.\d+|\d+\.)/.test(rest);
}

function isRealAnexoHeading(line, heading) {
  return /^anexo\b/i.test(heading) && /^ANEXO\s+(?:[IVX]+|\u00DANICO)\.?$/i.test(line);
}

function parseNormaDeterminista(text) {
  const fragments = [];
  // Aseguramos que el encabezado empiece a principio de línea o tras un salto de línea
  const splitterRegex = /(?:\n|^)\s*(?:(?:Art[i\u00ED]culo|Art\.)\s+(?:\d+|[ivxlcdm]+|primero|segundo|tercero|cuarto|quinto|sexto|s[e\u00E9]ptimo|octavo|noveno|d[e\u00E9]cimo)\.?|Disposici[o\u00F3]n\s+(?:adicional|transitoria|final|derogatoria|[u\u00FA]nica)\s*(?:\d+|[ivxlcdm]+|primera|segunda|tercera|cuarta|quinta|sexta|s[e\u00E9]ptima|octava|novena|d[e\u00E9]cima|[u\u00FA]nico|[u\u00FA]nica)?|Anexo\s*(?:\d+|[ivxlcdm]+|[u\u00FA]nico)?|Cap[i\u00ED]tulo\s+(?:\d+|[ivxlcdm]+)|Secci[o\u00F3]n\s+(?:\d+|[ivxlcdm]+))/gi;

  const matches = [];
  let match;
  let insideAnexo = false;
  while ((match = splitterRegex.exec(text)) !== null) {
    const matchedStr = match[0];
    const trimmedStr = matchedStr.trim();
    const realIndex = match.index + matchedStr.indexOf(trimmedStr);
    const headingLine = getLineAtIndex(text, realIndex);
    if (isInternalReferenceLine(headingLine, trimmedStr)) continue;
    const isAnexo = isRealAnexoHeading(headingLine, trimmedStr);
    if (insideAnexo && !isAnexo) continue;
    if (isAnexo) insideAnexo = true;
    matches.push({ title: trimmedStr, index: realIndex });
  }

  if (matches.length === 0) {
    if (text.trim().length > 0) {
      fragments.push({ tipo: 'Texto General', numero: null, seccion: 'Texto \u00CDntegro', texto: text.trim(), es_indice: false, articulo: null, article_number: null });
    }
    return fragments;
  }

  const preambleText = text.substring(0, matches[0].index).trim();
  if (preambleText.length > 50) {
    const isIndice = preambleText.toLowerCase().includes('\u00EDndice') && preambleText.length < 1500;
    fragments.push({ tipo: 'Pre\u00E1mbulo', numero: null, seccion: 'Pre\u00E1mbulo', texto: preambleText, es_indice: isIndice, articulo: null, article_number: null });
  }

  for (let i = 0; i < matches.length; i++) {
    const currentTitle = matches[i].title.trim().replace(/\.$/, '');
    const startIndex = matches[i].index; // Desde el inicio del título
    const endIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;

    let blockText = text.substring(startIndex, endIndex).trim();

    if (blockText.length < 20) continue;
    if (DRY_RUN && blockText.length > 20000) {
      console.warn(`[DRY_RUN][WARN] Fragmento muy grande: ${currentTitle} (${blockText.length} caracteres).`);
    }

    const ext = extractMetadataFromTitle(currentTitle);
    const esIndice = blockText.toLowerCase().includes('\u00EDndice') && blockText.length < 500;

    fragments.push({
      tipo: ext.tipo,
      numero: ext.numero,
      seccion: currentTitle,
      texto: blockText, // Texto íntegro y literal, sin depender de cortes IA
      es_indice: esIndice,
      articulo: ext.tipo === 'Art\u00EDculo' ? currentTitle : null,
      article_number: ext.article_number
    });
  }

  const cleanedFragments = discardInitialIndexFragments(fragments);
  const sortedFragments = sortLegalFragments(cleanedFragments);
  const splitAnexoFragments = splitLargeAnexoFragments(sortedFragments);
  return splitOversizedFragments(splitAnexoFragments);
}

function fragmentKey(fragment) {
  if (!fragment.tipo || fragment.numero === null || fragment.tipo === 'Pre\u00E1mbulo') return null;
  return `${fragment.tipo}:${fragment.numero}`;
}

function hasDuplicateLater(fragments, index, key) {
  return fragments.slice(index + 1).some(other => fragmentKey(other) === key);
}

function discardInitialIndexFragments(fragments) {
  const scanLimit = Math.min(fragments.length, 40);
  const initialDuplicateIndexes = [];
  let startedSequence = false;

  for (let i = 0; i < scanLimit; i++) {
    const key = fragmentKey(fragments[i]);
    const isInitialDuplicate = key && hasDuplicateLater(fragments, i, key);
    const looksLikeIndexEntry = /(?:\.\s*){2,}\d+\s*$/m.test(fragments[i].texto);

    if (isInitialDuplicate || looksLikeIndexEntry) {
      initialDuplicateIndexes.push(i);
      startedSequence = true;
      continue;
    }

    if (startedSequence) break;
  }

  if (initialDuplicateIndexes.length < 3) return fragments;

  const discardedIndexes = new Set(initialDuplicateIndexes);
  const validFragments = fragments.filter((_, index) => !discardedIndexes.has(index));

  if (DRY_RUN) {
    console.log(`[DRY_RUN][INDICE] Descartados ${initialDuplicateIndexes.length} fragmentos iniciales duplicados como índice.`);
  }

  return validFragments;
}

function getLegalTypeRank(fragment) {
  const tipo = fragment.tipo || '';
  const seccion = (fragment.seccion || '').toLowerCase();

  if (tipo === 'Pre\u00E1mbulo' || tipo === 'Texto General') return 1;
  if (tipo === 'Cap\u00EDtulo') return 2;
  if (tipo === 'Secci\u00F3n') return 3;
  if (tipo === 'Art\u00EDculo') return 4;
  if (tipo === 'Disposici\u00F3n' && seccion.includes('adicional')) return 5;
  if (tipo === 'Disposici\u00F3n' && seccion.includes('transitoria')) return 6;
  if (tipo === 'Disposici\u00F3n' && seccion.includes('derogatoria')) return 7;
  if (tipo === 'Disposici\u00F3n' && seccion.includes('final')) return 8;
  if (tipo === 'Anexo') return 9;
  return 10;
}

function getLegalNumber(fragment) {
  if (fragment.article_number !== null && fragment.article_number !== undefined) return fragment.article_number;
  const numMatch = String(fragment.numero || '').match(/\d+/);
  return numMatch ? parseInt(numMatch[0]) : Number.MAX_SAFE_INTEGER;
}

function sortLegalFragments(fragments) {
  const sortedFragments = fragments
    .map((fragment, originalIndex) => ({ fragment, originalIndex }))
    .sort((a, b) => {
      const rankDiff = getLegalTypeRank(a.fragment) - getLegalTypeRank(b.fragment);
      if (rankDiff !== 0) return rankDiff;

      const numberDiff = getLegalNumber(a.fragment) - getLegalNumber(b.fragment);
      if (numberDiff !== 0) return numberDiff;

      return a.originalIndex - b.originalIndex;
    })
    .map(item => item.fragment);

  if (DRY_RUN) {
    console.log('[DRY_RUN][ORDEN] Fragmentos jur\u00EDdicos reordenados conservando texto literal.');
  }

  return sortedFragments;
}

function findInternalAnexoHeadings(text) {
  const headingRegex = /(?:^|\n)\s*((?:Secci[o\u00F3]n\s+\d+\.?\s*\u00AA?\.?\s+[^\n]{3,120})|(?:Tabla\s+[IVX]+\.?))\s*(?=\n|$)/gi;
  const headings = [];
  let match;

  while ((match = headingRegex.exec(text)) !== null) {
    const title = match[1].trim().replace(/\.$/, '');
    const index = match.index + match[0].indexOf(match[1]);
    headings.push({ title, index });
  }

  return headings;
}

function findTechnicalAnexoHeadings(text) {
  const headingRegex = /(?:^|\n)\s*(\d{1,2}\.\s+[A-Z\u00C1\u00C9\u00CD\u00D3\u00DA\u00D1][^\n]{5,140})\s*(?=\n|$)/g;
  const headings = [];
  let match;

  while ((match = headingRegex.exec(text)) !== null) {
    const title = match[1].trim().replace(/\.$/, '');
    const titleText = title.replace(/^\d{1,2}\.\s+/, '');
    if (/^(?:El|La|Los|Las|En|Para|Estos|Estas|Tanto|A falta|Cada|Cuando)\b/i.test(titleText)) continue;
    const index = match.index + match[0].indexOf(match[1]);
    headings.push({ title, index });
  }

  return headings;
}

function splitAnexoByTechnicalHeadings(fragment) {
  if (fragment.tipo !== 'Anexo' || fragment.texto.length <= 20000) return [fragment];

  const headings = findTechnicalAnexoHeadings(fragment.texto);
  if (headings.length < 2) return [fragment];

  const splitFragments = [];
  const prefixText = fragment.texto.substring(0, headings[0].index).trim();
  if (prefixText.length >= 20) {
    splitFragments.push({ ...fragment, texto: prefixText });
  }

  for (let i = 0; i < headings.length; i++) {
    const startIndex = headings[i].index;
    const endIndex = i + 1 < headings.length ? headings[i + 1].index : fragment.texto.length;
    const blockText = fragment.texto.substring(startIndex, endIndex).trim();
    if (blockText.length < 20) continue;

    splitFragments.push({
      ...fragment,
      seccion: `${fragment.seccion} - ${headings[i].title}`,
      texto: blockText,
      articulo: null,
      article_number: null
    });
  }

  return splitFragments;
}

function splitLargeAnexoFragments(fragments) {
  const splitFragments = [];

  for (const fragment of fragments) {
    if (fragment.tipo !== 'Anexo' || fragment.texto.length <= 20000) {
      splitFragments.push(fragment);
      continue;
    }

    const headings = findInternalAnexoHeadings(fragment.texto);
    if (headings.length < 2) {
      splitFragments.push(...splitAnexoByTechnicalHeadings(fragment));
      continue;
    }

    const prefixText = fragment.texto.substring(0, headings[0].index).trim();
    if (prefixText.length >= 20) {
      splitFragments.push({ ...fragment, texto: prefixText });
    }

    for (let i = 0; i < headings.length; i++) {
      const startIndex = headings[i].index;
      const endIndex = i + 1 < headings.length ? headings[i + 1].index : fragment.texto.length;
      const blockText = fragment.texto.substring(startIndex, endIndex).trim();
      if (blockText.length < 20) continue;

      const anexoFragment = {
        ...fragment,
        seccion: `${fragment.seccion} - ${headings[i].title}`,
        texto: blockText,
        articulo: null,
        article_number: null
      };
      splitFragments.push(...splitAnexoByTechnicalHeadings(anexoFragment));
    }
  }

  return splitFragments;
}

function findSafeSplitIndex(text, startIndex, maxLength) {
  const hardLimit = Math.min(startIndex + maxLength, text.length);
  const minSplitIndex = startIndex + Math.floor(maxLength * 0.6);
  const searchText = text.slice(startIndex, hardLimit);
  const splitPatterns = [/\n\n/g, /\n/g, /\.\s/g];

  for (const pattern of splitPatterns) {
    let bestIndex = -1;
    let match;
    while ((match = pattern.exec(searchText)) !== null) {
      const candidate = startIndex + match.index + match[0].length;
      if (candidate >= minSplitIndex) bestIndex = candidate;
    }
    if (bestIndex !== -1) return bestIndex;
  }

  return hardLimit;
}

function splitOversizedFragment(fragment, maxLength = 12000, targetLength = 10000) {
  if (!fragment.texto || fragment.texto.length <= maxLength) return [fragment];

  const parts = [];
  let startIndex = 0;

  while (startIndex < fragment.texto.length) {
    const endIndex = findSafeSplitIndex(fragment.texto, startIndex, targetLength);
    const partText = fragment.texto.slice(startIndex, endIndex).trim();
    if (partText.length > 0) {
      parts.push({
        ...fragment,
        seccion: `${fragment.seccion} - Parte ${parts.length + 1}`,
        texto: partText
      });
    }
    startIndex = endIndex;
  }

  return parts;
}

function splitOversizedFragments(fragments) {
  return fragments.flatMap(fragment => splitOversizedFragment(fragment));
}

function validateFinalFragmentSizes(fragments) {
  const maxLength = fragments.reduce((max, fragment) => Math.max(max, fragment.texto?.length || 0), 0);
  console.log(`[VALIDACION] Fragmento m\u00E1ximo final: ${maxLength} caracteres`);

  if (maxLength > 12000) {
    throw new Error(`Fragmento demasiado grande tras división final: ${maxLength} caracteres.`);
  }
}

function extractJsonObject(text) {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) throw new Error("JSON no encontrado en respuesta IA.");
  return JSON.parse(text.slice(first, last + 1));
}

function capitalizedTipo(tipo) {
  if (!tipo) return null;
  const t = tipo.toLowerCase();
  if (t === "articulo") return "Art\u00EDculo";
  if (t === "disposicion") return "Disposici\u00F3n";
  if (t === "capitulo") return "Cap\u00EDtulo";
  if (t === "seccion") return "Secci\u00F3n";
  if (t === "anexo") return "Anexo";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

async function enhanceMetadataWithOpenAI(fragments) {
  const BATCH_SIZE = 10;
  let enhancedFragments = [];

  for (let i = 0; i < fragments.length; i += BATCH_SIZE) {
    const batch = fragments.slice(i, i + BATCH_SIZE);
    
    // Extraemos solo el inicio para no agotar tokens, es suficiente para metadata
    const batchInput = batch.map((f, idx) => ({
      id: idx,
      texto_inicio: f.texto.substring(0, 500)
    }));

    const systemPrompt = `
Eres un analista jurídico. Te paso un array de fragmentos (solo el inicio del texto).
Extrae la metadata precisa para cada fragmento en un array JSON.
Reglas:
1. "tipo": articulo, anexo, disposicion, capitulo, seccion, tabla, preambulo, otro.
2. "numero": extraer número o letra si tiene (ej. "1", "I", "única"). Nulo si no.
3. "titulo": el título semántico de la sección (suele ir en la primera línea tras el "Artículo X."). Si no hay título claro, nulo.
4. "es_indice": true si parece un sumario o índice (por los puntos suspensivos o números de página), false en caso contrario.

JSON obligatorio:
{
  "partes": [ { "id": 0, "tipo": "articulo", "numero": "1", "titulo": "Objeto y ámbito de aplicación", "es_indice": false } ]
}
`.trim();

    console.log(`[IA] Revisando metadata (Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(fragments.length/BATCH_SIZE)})...`);
    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(batchInput) }
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      });

      const parsed = extractJsonObject(response.choices[0]?.message?.content || "");
      const partesArray = Array.isArray(parsed.partes) ? parsed.partes : [];

      for (let j = 0; j < batch.length; j++) {
        const iaData = partesArray.find(p => p.id === j) || {};
        const frag = batch[j];
        
        let safeNumero = iaData.numero !== undefined && iaData.numero !== null ? String(iaData.numero) : frag.numero;
        if (safeNumero) {
          const numMatch = safeNumero.match(/\d+/);
          if (numMatch) safeNumero = numMatch[0];
          else safeNumero = null; // Filtra la "I" de los anexos para que sea null en DB (evita error int)
        }

        enhancedFragments.push({
          ...frag,
          tipo: iaData.tipo ? capitalizedTipo(iaData.tipo) : frag.tipo,
          numero: safeNumero,
          seccion: iaData.titulo ? `${frag.seccion} - ${iaData.titulo}` : frag.seccion,
          es_indice: iaData.es_indice !== undefined ? iaData.es_indice : frag.es_indice
        });
      }
    } catch (error) {
      console.warn(`[WARN] Falló validación IA batch ${i}: ${error.message}. Se usarán datos deterministas puros.`);
      enhancedFragments.push(...batch);
    }
  }

  return enhancedFragments;
}

async function main() {
  console.log(`[START] Ingesta Híbrida (DRY_RUN=${DRY_RUN})`);
  const buffer = await fs.readFile(FILE_PATH);
  let rawText = await extractTextFromPdfBuffer(buffer);
  console.log(`[TEXT] PDF extraído original: ${rawText.length} caracteres`);
  validateExtractedTextMatchesCodigo(rawText, CODIGO);

  const dispongoIndex = rawText.indexOf("DISPONGO:");
  if (dispongoIndex !== -1) {
    console.log(`[TEXT] Índice descartado. Cortando texto desde "DISPONGO:".`);
    rawText = rawText.substring(dispongoIndex);
  }

  console.log(`[TEXT] PDF a procesar: ${rawText.length} caracteres`);

  console.log(`[DETERMINISTA] Dividiendo por estructura legal...`);
  const baseFragments = parseNormaDeterminista(rawText);
  console.log(`[DETERMINISTA] ${baseFragments.length} fragmentos base extraídos.`);

  // Revisión de OpenAI desactivada temporalmente por petición del usuario
  let finalFragments = baseFragments;
  console.log(`[FORZADO] Omitiendo mejora de metadata con OpenAI para subida directa.`);

  const numArticulos = finalFragments.filter(f => (f.tipo || "").toLowerCase().includes("art")).length;
  const numAnexos = finalFragments.filter(f => f.tipo === "Anexo").length;

  console.log(`\n======================================`);
  console.log(`=== RESULTADOS DE INGESTA HÍBRIDA ===`);
  console.log(`======================================`);
  console.log(`Fragmentos totales detectados: ${finalFragments.length}`);
  console.log(`Artículos detectados: ${numArticulos}`);
  console.log(`Anexos detectados: ${numAnexos}`);
  console.log(`\n--- TODOS LOS FRAGMENTOS DETECTADOS ---`);
  
  finalFragments.forEach((f, idx) => {
    const cleanSeccion = f.seccion ? f.seccion.replace(/\n/g, ' ') : 'N/A';
    const cleanTexto = f.texto ? f.texto.replace(/\n/g, ' ') : '';
    const startText = cleanTexto.substring(0, 150);
    const endText = cleanTexto.length > 150 ? cleanTexto.substring(cleanTexto.length - 150) : "";

    console.log(`\n[${idx + 1}] Tipo: ${f.tipo || 'N/A'} | Número: ${f.numero || 'N/A'} | Longitud: ${f.texto.length} chars`);
    console.log(`    Sección: ${cleanSeccion}`);
    console.log(`    Inicio: "${startText}..."`);
    if (endText) {
      console.log(`    Fin:    "...${endText}"`);
    }
  });

  if (DRY_RUN) {
    console.log(`\n[DRY RUN ACTIVO] Terminando simulación sin insertar en la base de datos.`);
    return;
  }

  if (!CONFIRM_UPLOAD) {
    throw new Error("Falta --confirm-upload. Abortando antes de tocar Supabase.");
  }

  initUploadClients();

  console.log(`\n[DB] Iniciando subida a Supabase...`);
  
  const hashNorma = crypto.createHash("sha256").update(rawText).digest("hex");
  let { data: existingNorma } = await supabase.from("normas").select("id").eq("codigo", CODIGO).single();
  let normaId;

  console.log(`\n[CONFIRMACION] Subida local validada antes de borrar partes:`);
  console.log(`  PDF usado: ${FILE_PATH}`);
  console.log(`  CODIGO: ${CODIGO}`);
  console.log(`  TITULO: ${TITULO}`);
  console.log(`  norma_id existente: ${existingNorma?.id || "ninguna"}`);
  console.log(`  fragmentos detectados: ${finalFragments.length}`);
  validateFinalFragmentSizes(finalFragments);
  
  if (existingNorma) {
    normaId = existingNorma.id;
    console.log(`[DB] Norma existente detectada: normaId=${normaId}`);
  } else {
    const { data: insertNorma, error: insertError } = await supabase.from("normas").insert({
      codigo: CODIGO,
      titulo: TITULO,
      estado_ingesta: "procesando",
      document_hash: hashNorma,
    }).select("id").single();
    if (insertError) throw new Error("Fallo al crear norma: " + insertError.message);
    normaId = insertNorma.id;
    console.log(`[DB] Norma creada: normaId=${normaId}`);
  }

  // 1. Borrar partes previas
  await supabase.from('normas_partes').delete().eq('norma_id', normaId);

  let insertedCount = 0;
  let numArticulosDetectados = 0;
  let numAnexosDetectados = 0;
  let numEmbeddingsGenerados = 0;
  let totalInputTokens = 0;

  for (let i = 0; i < finalFragments.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = finalFragments.slice(i, i + EMBEDDING_BATCH_SIZE);
    const textsToVectorize = batch.map(f => (!f.es_indice && f.texto.length >= 20) ? f.texto : null);
    const validStrs = textsToVectorize.filter(t => t !== null);
    
    let batchEmbeddings = [];
    let embIndex = 0;

    if (validStrs.length > 0) {
      console.log(`[IA] Generando embeddings para batch ${Math.floor(i/EMBEDDING_BATCH_SIZE) + 1} (${validStrs.length} textos)...`);
      const embRes = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: validStrs,
        dimensions: 1536,
      });
      batchEmbeddings = embRes.data.map(e => e.embedding);
      totalInputTokens += embRes.usage?.prompt_tokens || 0;
    }

    const rowsToInsert = batch.map((frag, idx) => {
      let embeddingArray = null;
      if (textsToVectorize[idx] !== null && embIndex < batchEmbeddings.length) {
        embeddingArray = batchEmbeddings[embIndex++];
        numEmbeddingsGenerados++;
      }

      const tipoStr = (frag.tipo || "").toLowerCase();
      if (tipoStr.includes("art")) numArticulosDetectados++;
      if (tipoStr.includes("anex")) numAnexosDetectados++;

      return {
        norma_id: normaId,
        tipo: frag.tipo,
        seccion: frag.seccion,
        numero: frag.numero,
        texto: frag.texto,
        orden: i + idx + 1,
        huella: crypto.createHash('sha256').update(frag.texto).digest('hex'),
        embedding: embeddingArray,
        articulo: frag.articulo,
        rango: "Real Decreto",
        es_indice: frag.es_indice,
        norm_type: "Norma Jur\u00EDdica",
        year: 1997,
        article_number: frag.article_number,
      };
    });

    if (rowsToInsert.length > 0) {
      const { error: insErr } = await supabase.from('normas_partes').insert(rowsToInsert);
      if (insErr) throw new Error(`Error en base de datos al insertar batch ${i}: ${insErr.message}`);
      insertedCount += rowsToInsert.length;
    }
  }

  console.log(`[DB] Insertados ${insertedCount} fragmentos con ${numEmbeddingsGenerados} embeddings.`);

  // Actualizar metadata de norma
  await supabase.from('normas').update({
    estado_ingesta: 'lista',
    num_fragmentos: insertedCount,
    num_articulos_detectados: numArticulosDetectados,
    num_anexos_detectados: numAnexosDetectados,
    num_embeddings_generados: numEmbeddingsGenerados,
    error_ingesta: null
  }).eq('id', normaId);

  // Guardar log AI
  if (totalInputTokens > 0) {
    await supabase.from('ai_usage_logs').insert({
      norma_id: normaId,
      operation_type: "upload_norma_ia_local_embeddings",
      model: EMBEDDING_MODEL,
      input_tokens: totalInputTokens,
      output_tokens: 0,
      metadata: { texts_vectorized: numEmbeddingsGenerados }
    });
  }

  // Guardar Reporte de Ingesta
  await supabase.from("norma_ingest_reports").insert({
    norma_id: normaId,
    request_id: requestId,
    route: "tools/upload-norma-ia-local",
    status: "success",
    num_articulos_detectados: numArticulosDetectados,
    num_anexos_detectados: numAnexosDetectados,
    num_fragmentos: insertedCount,
    errores: [],
    warnings: [],
    resumen: `Ingesta determinista local para ${CODIGO}.`,
    metadata: { filePath: FILE_PATH }
  });

  console.log(`[OK] Subida local finalizada con éxito.`);
}

await main();
