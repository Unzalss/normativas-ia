import { AIStructureResult } from "./ai-parser";

export interface AIValidationIssue {
  severity: "info" | "warning" | "error";
  kind: string;
  section_ref: string | null;
  message: string;
  payload?: Record<string, unknown>;
}

export interface AIValidationResult {
  valid: boolean;
  issues: AIValidationIssue[];
  numArticulos: number;
  numAnexos: number;
  numTablas: number;
  numFragmentos: number;
  numDudosos: number;
}

export function validateAIStructure(result: AIStructureResult, rawText: string): AIValidationResult {
  const validTypes = [
    "articulo", "anexo", "disposicion", "capitulo", 
    "seccion", "tabla", "preambulo", "otro"
  ];
  
  const validation: AIValidationResult = {
    valid: true,
    issues: [],
    numArticulos: 0,
    numAnexos: 0,
    numTablas: 0,
    numFragmentos: 0,
    numDudosos: 0
  };

  if (!result || !Array.isArray(result.parts)) {
    validation.valid = false;
    validation.issues.push({
      severity: "error",
      kind: "invalid_parts",
      section_ref: null,
      message: "El resultado no contiene el array de partes o es de un formato inválido."
    });
    return validation;
  }

  validation.numFragmentos = result.parts.length;
  
  // Normalizar el texto fuente para mayor tolerancia en la conciliación de espacios
  const normalizedRaw = rawText.replace(/\s+/g, ' ').trim();
  const articleNumbers: number[] = [];

  for (let i = 0; i < result.parts.length; i++) {
    const part = result.parts[i];
    const sectionRef = part.numero ? `${part.tipo} ${part.numero}` : `Fragmento_secuencial_${i + 1}`;
    let isDudoso = false;

    if (!part.texto_literal || part.texto_literal.trim() === "") {
      validation.issues.push({
        severity: "error",
        kind: "empty_text_literal",
        section_ref: sectionRef,
        message: "El campo de texto_literal no puede estar vacío."
      });
      isDudoso = true;
    } else {
      // Validar literalidad en origen
      const normalizedPartText = part.texto_literal.replace(/\s+/g, ' ').trim();
      if (!normalizedRaw.includes(normalizedPartText)) {
        validation.issues.push({
          severity: "warning",
          kind: "literal_not_found",
          section_ref: sectionRef,
          message: "texto_literal modificado: Alguna palabra ha sufrido desajuste respecto al documento original.",
          payload: { literalTextLength: part.texto_literal.length }
        });
        isDudoso = true;
      }
    }

    if (!part.frase_inicio || part.frase_inicio.trim() === "" || !part.frase_fin || part.frase_fin.trim() === "") {
      validation.issues.push({
        severity: "warning",
        kind: "missing_phrases",
        section_ref: sectionRef,
        message: "Falta frase_inicio o frase_fin."
      });
      isDudoso = true;
    }

    if (!validTypes.includes(part.tipo)) {
      validation.issues.push({
        severity: "error",
        kind: "invalid_type",
        section_ref: sectionRef,
        message: `El tipo provisto no es reconocido por el ecosistema: ${part.tipo}`
      });
      isDudoso = true;
    } else {
      if (part.tipo === "articulo") validation.numArticulos++;
      if (part.tipo === "anexo") validation.numAnexos++;
      if (part.tipo === "tabla") validation.numTablas++;
    }

    if (part.confidence < 0.75) {
      validation.issues.push({
        severity: "warning",
        kind: "low_confidence",
        section_ref: sectionRef,
        message: "Índice de confianza de IA marginalmente bajo.",
        payload: { confidence: part.confidence }
      });
      isDudoso = true;
    }

    // Análisis de duplicación de artículos numéricos
    if (part.tipo === "articulo" && part.numero) {
      const artNum = parseInt(part.numero, 10);
      if (!isNaN(artNum)) {
        if (articleNumbers.includes(artNum)) {
          validation.issues.push({
            severity: "warning",
            kind: "duplicate_article",
            section_ref: sectionRef,
            message: `El artículo numérico ${artNum} aparece reportado múltiples veces. Posible solapamiento de chunking.`
          });
        }
        articleNumbers.push(artNum);
      }
    }

    if (isDudoso) {
      validation.numDudosos++;
    }
  }

  // Análisis de saltos heurísticos ascendentes
  articleNumbers.sort((a, b) => a - b);
  for (let j = 0; j < articleNumbers.length - 1; j++) {
    const current = articleNumbers[j];
    const next = articleNumbers[j + 1];
    if (current === next) continue; // La duplicación ya se notifica arriba
    if (next > current + 1) {
      validation.issues.push({
        severity: "warning",
        kind: "missing_article_gap",
        section_ref: null,
        message: `Se detecta un salto/ausencia temporal en los artículos entre el nº${current} y el nº${next}.`,
        payload: { prior: current, nextValue: next }
      });
    }
  }

  // Dictamen final (solo se rechaza por barreras insalvables -errors-)
  validation.valid = !validation.issues.some(issue => issue.severity === "error");

  return validation;
}
