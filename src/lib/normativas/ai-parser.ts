import OpenAI from "openai";

export interface AIStructuredPart {
  tipo: string;
  numero: string | null;
  titulo: string | null;
  texto_literal: string;
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
  const CHUNK_SIZE = 25000;
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

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    
    const systemPrompt = `
Eres un experto analista jurídico especializado en estructurar textos legales y normativos.
Tu única tarea es extraer la estructura de este documento legal en formato JSON estricto.

Reglas INQUEBRANTABLES:
1. NO inventes texto. NO resumas. NO reescribas. Debes preservar la LITERALIDAD EXACTA del fragmento.
2. Extrae las piezas en el orden secuencial en el que aparecen.
3. Tipos válidos (usar exclusivamente): articulo, anexo, disposicion, capitulo, seccion, tabla, preambulo, otro.
4. "texto_literal" debe contener la copia exacta y completa del texto perteneciente a esa pieza.
5. NO omitas contenido. Cada palabra del documento debe estar cubierta por alguna pieza extraída.

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
      "texto_literal": "Artículo 3. Disposiciones generales... [texto copiado íntegro]",
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
          result.parts.push({
            tipo: String(p.tipo || "otro"),
            numero: p.numero ? String(p.numero) : null,
            titulo: p.titulo ? String(p.titulo) : null,
            texto_literal: String(p.texto_literal || ""),
            orden: ++globalOrder,
            confidence: Number(p.confidence) || 1,
            warnings: Array.isArray(p.warnings) ? p.warnings : []
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
