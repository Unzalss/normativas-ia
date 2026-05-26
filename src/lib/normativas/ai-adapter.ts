import { AIStructureResult, AIStructuredPart } from "./ai-parser";
import { ParsedFragment } from "./parser";

export function aiPartToParsedFragment(part: AIStructuredPart): ParsedFragment {
  const isArticulo = part.tipo === "articulo";

  // Capitalize tipo (e.g. 'articulo' -> 'Artículo', 'capitulo' -> 'Capítulo')
  // We handle specific accents dynamically or just capitalize the first letter.
  let capitalizedTipo: string | null = null;
  if (part.tipo) {
    if (part.tipo === "articulo") capitalizedTipo = "Artículo";
    else if (part.tipo === "disposicion") capitalizedTipo = "Disposición";
    else if (part.tipo === "capitulo") capitalizedTipo = "Capítulo";
    else if (part.tipo === "seccion") capitalizedTipo = "Sección";
    else capitalizedTipo = part.tipo.charAt(0).toUpperCase() + part.tipo.slice(1);
  }

  // Calculate seccion
  let fallbackSeccion = "Fragmento normativo";
  if (capitalizedTipo && part.numero) {
    fallbackSeccion = `${capitalizedTipo} ${part.numero}`;
  } else if (capitalizedTipo) {
    fallbackSeccion = capitalizedTipo;
  }
  const seccion = part.titulo || fallbackSeccion;

  // Calculate articulo string
  const articulo = isArticulo && part.numero ? `Artículo ${part.numero}` : null;

  let article_number: string | null = null;
  if (part.numero) {
    const numMatch = part.numero.match(/(\d+)(?:\s+(bis|ter|quater))?/i);
    if (numMatch) {
      article_number = `${numMatch[1]}${numMatch[2] ? ` ${numMatch[2].toLowerCase()}` : ""}`;
    }
  }
  const safeNumero = article_number;

  return {
    tipo: capitalizedTipo,
    numero: safeNumero,
    seccion: seccion,
    texto: part.texto_literal,
    articulo: articulo,
    article_number: article_number,
    apartado: null,
    es_indice: false
  };
}

export function aiStructureToParsedFragments(result: AIStructureResult): ParsedFragment[] {
  if (!result || !Array.isArray(result.parts)) {
    return [];
  }

  // Copiamos el array para no mutar el referencial y ordenamos por orden ascendente
  const sortedParts = [...result.parts].sort((a, b) => a.orden - b.orden);

  return sortedParts
    .filter(part => part.texto_literal && part.texto_literal.trim() !== "")
    .map(part => aiPartToParsedFragment(part));
}
