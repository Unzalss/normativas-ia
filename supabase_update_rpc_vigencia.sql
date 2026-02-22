-- Migración para incluir campos de título y código de norma en el RPC

CREATE OR REPLACE FUNCTION public.buscar_norma_partes(
  q_embedding vector(1536),
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
BEGIN
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
      -- Si se especifica una norma (q_norma_id != null), no bloquear si no está vigente
      (q_norma_id IS NOT NULL AND np.norma_id = q_norma_id)
      OR
      -- Si se busca en global (q_norma_id IS NULL), entonces debe estar 'vigente'
      (
        q_norma_id IS NULL
        AND n.estado = 'vigente'
        AND (n.fecha_vigencia IS NULL OR n.fecha_vigencia <= current_date)
        AND (n.fecha_derogacion IS NULL OR n.fecha_derogacion > current_date)
      )
    )
  ORDER BY np.embedding <=> q_embedding
  LIMIT k;
END;
$$;
