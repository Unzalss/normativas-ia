import OpenAI from "openai";

export interface AIStructuredPart {
  tipo: string;
  numero: string | null;
  titulo: string | null;
  texto_literal: string;
  frase_inicio: string;
  frase_fin: string;
  orden: number;
  confidence: number;
  warnings: string[];
}

export interface AIStructureResult {
  parts: AIStructuredPart[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  model: string;
  warnings: string[];
}

export function splitTextForAI(rawText: string): string[] {
  const CHUNK_SIZE = 8000;
  const OVERLAP = 500;
  const chunks: string[] = [];
  
  if (!rawText) return chunks;

  let currentIndex = 0;

  while (currentIndex < rawText.length) {
    let endIndex = currentIndex + CHUNK_SIZE;
    
    // Safety check to avoid slicing words if possible, targeting a newline
    if (endIndex < rawText.length) {
      const nextNewline = rawText.indexOf('\n', endIndex - 1500);
      if (nextNewline !== -1 && nextNewline < endIndex + 1500) {
        endIndex = nextNewline;
      }
    } else {
      endIndex = rawText.length;
    }

    chunks.push(rawText.substring(currentIndex, endIndex));
    
    // Step forward, applying overlap
    currentIndex = endIndex - OVERLAP;
    if (currentIndex < 0) currentIndex = 0;
    
    if (endIndex >= rawText.length) break;
  }

  return chunks;
}

export function reconstructLiteralText(rawText: string, fraseInicio: string, fraseFin: string, searchFromIndex: number): string {
  if (!fraseInicio || !fraseFin) return "";
  
  let startIdx = rawText.indexOf(fraseInicio, searchFromIndex);
  if (startIdx === -1) {
    startIdx = rawText.indexOf(fraseInicio); // Fallback
    if (startIdx === -1) return "";
  }

  const endIdx = rawText.indexOf(fraseFin, startIdx);
  if (endIdx === -1) return "";

  return rawText.substring(startIdx, endIdx + fraseFin.length);
}

export interface StructureNormaParams {
  rawText: string;
  codigo?: string;
  titulo?: string;
  model?: string;
}

export async function structureNormaWithOpenAI(params: StructureNormaParams): Promise<AIStructureResult> {
  const modelToUse = params.model || "gpt-4o-mini";
  
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured in the environment.");
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const chunks = splitTextForAI(params.rawText);
  
  const result: AIStructureResult = {
    parts: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    model: modelToUse,
    warnings: []
  };

  let globalOrder = 0;
  let globalSearchIndex = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    
    const systemPrompt = `
Eres un experto analista jurídico especializado en estructurar textos legales y normativos.
Tu única tarea es extraer la estructura de este documento legal en formato JSON estricto.

Reglas INQUEBRANTABLES:
1. NO inventes texto. NO resumas. NO reescribas. Debes extraer frases EXACTAS del fragmento.
2. Extrae las piezas en el orden secuencial en el que aparecen.
3. Tipos válidos (usar exclusivamente): articulo, anexo, disposicion, capitulo, seccion, tabla, preambulo, otro.
4. ESTÁ TOTALMENTE PROHIBIDO copiar el texto completo para no exceder el límite de tokens. Solo debes extraer una frase de inicio ("frase_inicio") y una frase final ("frase_fin") que delimiten el contenido de esa pieza de forma unívoca.
5. "frase_inicio" y "frase_fin" deben ser copias EXACTAS y LITERALES del texto original, sin añadir puntos suspensivos ("..."), de entre 5 y 15 palabras cada una.
6. NO omitas contenido. Toda la estructura relevante del documento debe estar cubierta.

Metadatos de la norma de contexto:
Código: ${params.codigo || 'Desconocido'}
Título: ${params.titulo || 'Desconocido'}

Formato de salida JSON ESPERADO OBLIGATORIO:
{
  "partes": [
    {
      "tipo": "articulo",
      "numero": "3",
      "titulo": "Disposiciones generales",
      "frase_inicio": "Artículo 3. Disposiciones generales. El objeto",
      "frase_fin": "normativas europeas aplicables en esta materia.",
      "confidence": 0.99,
      "warnings": []
    }
  ]
}
`.trim();

    const response = await openai.chat.completions.create({
      model: modelToUse,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analiza y extrae el JSON estructural para este fragmento (${i + 1} de ${chunks.length}):\n\n${chunkText}` }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    if (response.usage) {
      result.usage.inputTokens += response.usage.prompt_tokens;
      result.usage.outputTokens += response.usage.completion_tokens;
      result.usage.totalTokens += response.usage.total_tokens;
    }

    const messageContent = response.choices[0]?.message?.content;
    if (!messageContent) {
      result.warnings.push(`Fragmento OpenAI ${i + 1} devolvió contenido nulo.`);
      continue;
    }

    try {
      const parsed = JSON.parse(messageContent);
      if (parsed.partes && Array.isArray(parsed.partes)) {
        for (const p of parsed.partes) {
          const frase_inicio = String(p.frase_inicio || "").trim();
          const frase_fin = String(p.frase_fin || "").trim();
          
          const texto_literal = reconstructLiteralText(params.rawText, frase_inicio, frase_fin, globalSearchIndex);
          const warnings = Array.isArray(p.warnings) ? p.warnings : [];
          
          if (!texto_literal) {
            warnings.push("No se pudo reconstruir texto_literal a partir de frase_inicio y frase_fin.");
          } else {
            const foundIdx = params.rawText.indexOf(texto_literal, globalSearchIndex);
            if (foundIdx !== -1) {
              globalSearchIndex = foundIdx + texto_literal.length;
            }
          }

          result.parts.push({
            tipo: String(p.tipo || "otro"),
            numero: p.numero ? String(p.numero) : null,
            titulo: p.titulo ? String(p.titulo) : null,
            texto_literal,
            frase_inicio,
            frase_fin,
            orden: ++globalOrder,
            confidence: Number(p.confidence) || 1,
            warnings
          });
        }
      } else {
        throw new Error("El JSON no contenía el root key 'partes'.");
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new Error(`OpenAI devolvió un JSON inválido o incumplió la estructura en el chunk ${i + 1}: ${errorMessage}`);
    }
  }

  return result;
}
