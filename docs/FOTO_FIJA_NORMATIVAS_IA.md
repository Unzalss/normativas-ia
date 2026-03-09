# FOTO FIJA — PROYECTO NORMATIVAS IA

## 1. Objetivo del proyecto
- Buscador jurídico con IA sobre normativa.
- Debe permitir consultar normas con recuperación de fragmentos jurídicos relevantes y responder con base en las normas cargadas.
- Debe soportar normas globales y normas privadas por usuario.

## 2. Stack actual (cerrado salvo petición expresa)
- Frontend: Next.js
- Backend/API: Next.js App Router
- Base de datos: Supabase Postgres + pgvector
- Auth: Supabase Auth
- Despliegue: Vercel
- Embeddings: text-embedding-3-small
- LLM de respuesta: el actualmente usado en /api/ask
- Desarrollo asistido: Antigravity se usa para aplicar cambios en el código
- GitHub como repositorio
- No usar scripts locales raros como sistema definitivo de ingestión

## 3. Estado actual del buscador
- El buscador jurídico ya funciona.
- Si no hay evidencia suficiente, responde “No consta en las normas consultadas.”
- Si hay evidencia, responde y muestra fuentes.
- Ya se corrigió el problema por el que ciertos resultados válidos se descartaban por exigir article_number.
- Ya se añadió detección y búsqueda directa para consultas de artículo concreto (“artículo 3”, “art. 10”, etc.), para no depender solo del embedding.
- Ya funciona correctamente una búsqueda como: “qué dice el artículo 3 del real decreto 505/2007”.
- La API principal actual está en:
  - `src/app/api/ask/route.ts`

## 4. Normas cargadas actualmente
- Real Decreto 505/2007
- Ordenanza Municipal de Protección Contra Incendios de Zaragoza

## 5. Problema histórico detectado
- La subida de nuevas normas mediante scripts locales improvisados (Node, pdf-parse, .mjs/.cjs, Windows, Antigravity local, etc.) ha sido inestable.
- Decisión cerrada:
  - NO seguir usando scripts locales improvisados como sistema definitivo.
  - La ingestión debe hacerse desde la propia web/app.

## 6. Modelo de acceso a normas
- La tabla normas ya soporta:
  - normas globales
  - normas privadas por usuario
- Regla:
  - `owner_user_id = NULL` → norma global
  - `owner_user_id = UUID` → norma privada del usuario
- `/api/ask` ya está adaptada para:
  - usuario anónimo: solo normas globales
  - usuario autenticado: normas globales + sus normas privadas
  - nunca mostrar normas privadas de otros usuarios

## 7. Auth y perfiles
- Supabase Auth está activado.
- Existe la tabla `public.profiles`.
- Se crea automáticamente un profile al crear un usuario.
- Roles previstos:
  - `admin`
  - `user`
- El role no debe poder modificarse libremente por el propio usuario.

## 8. Estructura actual importante de tablas

### Tabla normas
Columnas relevantes actuales:
- id
- titulo
- codigo
- ambito
- rango
- fecha_publicacion
- estado
- url_fuente
- prioridad
- jurisdiccion
- fecha_vigencia
- fecha_derogacion
- jerarquia
- owner_user_id
- estado_ingesta
- error_ingesta
- nombre_archivo
- mime_type
- num_fragmentos
- fecha_ingesta

### Tabla normas_partes
Columnas relevantes actuales:
- id
- norma_id
- tipo
- seccion
- numero
- texto
- orden
- huella
- embedding
- articulo
- rango
- es_indice
- jurisdiccion
- norm_type
- year
- article_number
- apartado

## 9. Regla profesional de fragmentación jurídica
La fragmentación correcta para nuevas normas debe seguir esta regla:
1. Primero dividir por unidad jurídica real:
   - artículo
   - disposición adicional
   - disposición final
   - disposición transitoria
   - anexo
   - preámbulo
   - capítulo solo si no hay artículos
2. Si la unidad es corta, guardar una sola fila.
3. Si un artículo es largo, dividirlo por apartados.
4. No fragmentar arbitrariamente por bloques sin sentido jurídico.
5. Marcar basura, índices o contenido no útil con `es_indice = true`.

## 10. Estado actual de la ingestión desde web
Ya existe base mínima de subida desde la web:

### API creada
- `src/app/api/upload-norma/route.ts`

### Página creada
- `src/app/subir-norma/page.tsx`

### Qué hace ahora mismo
- Permite subir un archivo y metadatos básicos.
- Obtiene el token del usuario autenticado.
- Envía POST a `/api/upload-norma`.
- La API valida el usuario y crea una fila en `normas` con:
  - owner_user_id
  - estado = 'vigente'
  - estado_ingesta = 'procesando'
  - nombre_archivo
  - mime_type
  - fecha_ingesta
- Devuelve JSON con el id de la norma creada.

### Qué NO hace todavía
- No procesa todavía el PDF/TXT.
- No extrae texto.
- No divide en artículos.
- No inserta en `normas_partes`.
- No genera embeddings.
- No marca todavía la norma como lista/error al terminar.

## 11. RPC importante actual
La función clave del buscador es:
- `buscar_norma_partes`

Actualmente mezcla:
- vector search
- lexical search
- filtros de vigencia
- exclusión de es_indice

No rehacerla salvo necesidad real. La prioridad es mejorar la ingestión para alimentar bien esa RPC.

## 12. Cómo se está trabajando
- Los cambios de código se piden a Antigravity.
- Antes de cambios delicados, pedir diff o contenido exacto.
- Después:
  - `git add .`
  - `git commit -m "..."`
  - `git push`
- Verificar despliegue en Vercel.
- Ir paso a paso, sin mezclar muchas tareas en una sola respuesta.
- Mantener estabilidad y evitar cambios innecesarios de stack o estrategia.

## 13. Reglas cerradas del proyecto
- No cambiar de stack sin petición expresa.
- No volver a proponer scripts locales improvisados como solución principal de ingestión.
- La ingestión profesional definitiva debe vivir en la web/app.
- La prioridad es robustez y repetibilidad, no hacks rápidos.
- Para jurídico, preferir precisión estructural antes que atajos.

## 14. Próximo objetivo inmediato
Completar la ingestión profesional desde la web:
1. aceptar PDF/TXT
2. extraer texto
3. dividir por unidades jurídicas correctas
4. insertar en normas_partes
5. generar embeddings
6. actualizar estado_ingesta a 'lista' o 'error'
7. dejar el flujo estable para futuras normas sin scripts locales

## 15. Nota de continuidad para futuras ventanas
Cuando se abra una nueva conversación o se cambie de ventana, este archivo debe servir como referencia principal del estado del proyecto. Cualquier nueva tarea debe partir de esta foto fija salvo que se indique expresamente un cambio.
