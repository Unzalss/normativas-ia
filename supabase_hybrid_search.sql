-- Migración para implementar Búsqueda Híbrida (Vectorial + FTS) y Boosting Semántico Nativo

CREATE OR REPLACE FUNCTION public.buscar_norma_partes(
  q_embedding vector(1536),
  q_text text DEFAULT NULL,
  q_norma_id bigint DEFAULT NULL,
  k integer DEFAULT 8
)
RETURNS TABLE (
  id bigint,
  norma_id bigint,
  tipo text,
  seccion text,
  texto text,
  score float,
  norma_titulo text,
  codigo text
)
LANGUAGE plpgsql
AS $$
DECLARE
  norma_codigo_upper text := '';
BEGIN
  -- Si no nos pasan texto de búsqueda, aplicamos directamente la búsqueda puramente vectorial clásica
  IF q_text IS NULL OR trim(q_text) = '' THEN
    RETURN QUERY
    SELECT
      np.id,
      np.norma_id,
      np.tipo,
      np.seccion,
      np.texto,
      1 - (np.embedding <=> q_embedding) AS score,
      n.titulo AS norma_titulo,
      n.codigo AS codigo
    FROM normas_partes np
    JOIN normas n ON np.norma_id = n.id
    WHERE 
      (np.es_indice IS NULL OR np.es_indice = false)
      AND (
        (q_norma_id IS NOT NULL AND np.norma_id = q_norma_id)
        OR
        (
          q_norma_id IS NULL
          AND n.estado = 'vigente'
          AND (n.fecha_vigencia IS NULL OR n.fecha_vigencia <= current_date)
          AND (n.fecha_derogacion IS NULL OR n.fecha_derogacion > current_date)
        )
      )
    ORDER BY np.embedding <=> q_embedding
    LIMIT k;
    RETURN;
  END IF;

  -- BÚSQUEDA HÍBRIDA
  
  -- Preprocesar la query para TS y BOOSTING (asegurando minúsculas donde corresponda)
  -- Buscamos si el usuario cita explícitamente una norma (ej. CTE, RSCIEI, RIPCI)
  norma_codigo_upper := upper(q_text);

  RETURN QUERY
  WITH search_scores AS (
    SELECT
      np.id,
      np.norma_id,
      np.tipo,
      np.seccion,
      np.texto,
      n.titulo AS norma_titulo,
      n.codigo,
      -- 1. Puntuación Vectorial Base (Coseno inverso, rango general 0 a 1)
      (1 - (np.embedding <=> q_embedding)) AS vector_score,
      -- 2. Puntuación FTS (Full Text Search) con ts_rank (suele ser menor de 1, pero ayuda al cruce)
      ts_rank(to_tsvector('spanish', np.texto || ' ' || COALESCE(np.seccion, '')), websearch_to_tsquery('spanish', q_text)) AS fts_score,
      -- 3. Boosting por coincidencia de Código de Norma en la pregunta (Direct query intent)
      CASE WHEN norma_codigo_upper LIKE '%' || upper(n.codigo) || '%' THEN 0.25 ELSE 0 END AS boost_codigo,
      -- 4. Boosting estructural (si pregunta explícitamente el artículo, sección o tipo)
      CASE 
        WHEN lower(q_text) LIKE '%' || lower(np.tipo) || ' ' || lower(COALESCE(np.numero, '')) || '%' AND np.numero IS NOT NULL THEN 0.15
        WHEN lower(q_text) LIKE '%' || lower(COALESCE(np.seccion, 'SIN_SECCION')) || '%' THEN 0.10
        ELSE 0 
      END AS boost_estructural
    FROM normas_partes np
    JOIN normas n ON np.norma_id = n.id
    WHERE 
      (np.es_indice IS NULL OR np.es_indice = false)
      AND (
        (q_norma_id IS NOT NULL AND np.norma_id = q_norma_id)
        OR
        (
          q_norma_id IS NULL
          AND n.estado = 'vigente'
          AND (n.fecha_vigencia IS NULL OR n.fecha_vigencia <= current_date)
          AND (n.fecha_derogacion IS NULL OR n.fecha_derogacion > current_date)
        )
      )
      -- Optimización límite inicial vectorial para no calcular TS sobre toda la base de datos completa
      AND (1 - (np.embedding <=> q_embedding)) > 0.40
  )
  SELECT 
    s.id,
    s.norma_id,
    s.tipo,
    s.seccion,
    s.texto,
    -- Puntuación Final = Vector (70%) + FTS (30%) + Boostings
    ((s.vector_score * 0.70) + (s.fts_score * 0.30) + s.boost_codigo + s.boost_estructural)::float AS score,
    s.norma_titulo,
    s.codigo
  FROM search_scores s
  -- Ordenamos por el cálculo híbrido final
  ORDER BY score DESC
  LIMIT k;

END;
$$;
