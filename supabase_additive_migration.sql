-- Migración aditiva: Preparar base de datos para filtrado multi-normativa

-- 1. Extender tabla `normas` con campos de clasificación estables
ALTER TABLE normas 
ADD COLUMN jurisdiccion text,
ADD COLUMN ambito text,
ADD COLUMN fecha_publicacion date,
ADD COLUMN fecha_vigencia date,
ADD COLUMN estado text;

-- 2. Extender tabla `normas_partes` con metadatos críticos para RAG/búsqueda
ALTER TABLE normas_partes
ADD COLUMN articulo text,
ADD COLUMN rango text,
ADD COLUMN es_indice boolean DEFAULT false;

-- Nota: No se requiere modificar la configuración de pgvector ni los embeddings.
