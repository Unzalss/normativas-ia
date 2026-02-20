-- 1. Asegurar campos de vigencia en la tabla normas (fecha_derogacion)
ALTER TABLE normas ADD COLUMN IF NOT EXISTS fecha_derogacion date;

-- 2. Modificar el RPC para aplicar el filtro de vigencia solo al buscar en global
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
  score float
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
    1 - (np.embedding <=> q_embedding) AS score
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

/*
--- QUICK SQL TEST SNIPPET ---

-- 1. Test global (todas las normas): Solo debe devolver fragmentos de normas vigentes
SELECT * FROM public.buscar_norma_partes(
    (SELECT embedding FROM normas_partes LIMIT 1), 
    NULL, 
    5
);

-- 2. Test norma concreta (Norma #1): Debe funcionar aunque no esté vigente
SELECT * FROM public.buscar_norma_partes(
    (SELECT embedding FROM normas_partes WHERE norma_id = 1 LIMIT 1), 
    1, 
    5
);
*/
