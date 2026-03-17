# FOTO FIJA — PROYECTO NORMATIVAS IA

Última actualización: 2026-03-16  
Estado: referencia oficial vigente del proyecto

Este documento describe el **estado real del proyecto Normativas IA**.  
Debe usarse como **referencia principal cuando se abra una nueva conversación o ventana de trabajo**.

Las nuevas tareas deben partir siempre de esta foto fija.

---

# 1. Objetivo del proyecto

Construir un **buscador jurídico con IA orientado a normativa técnica**.

Usuarios objetivo:

- arquitectos
- ingenieros
- técnicos de prevención
- consultores
- técnicos de administraciones públicas

El sistema debe permitir:

- consultar normativa mediante lenguaje natural
- recuperar fragmentos jurídicos relevantes
- responder con base en normas cargadas
- mostrar fuentes jurídicas exactas
- filtrar resultados por norma concreta
- soportar normas globales y privadas

El proyecto está orientado a evolucionar hacia:

**SaaS de normativa técnica con IA.**

---

# 2. Stack actual (cerrado salvo petición expresa)

Frontend  
- Next.js (App Router)

Backend/API  
- Next.js API Routes

Base de datos  
- Supabase Postgres

Vector search  
- pgvector

Embeddings  
- OpenAI `text-embedding-3-small`

LLM de respuesta  
- modelo usado en `/api/ask`

Auth  
- Supabase Auth

Despliegue  
- Vercel

Repositorio  
- GitHub

Asistente de desarrollo  
- Antigravity

---

# 3. Estado actual del buscador

El buscador jurídico **ya funciona en producción**.

Capacidades actuales:

✔ búsqueda semántica vectorial  
✔ búsqueda directa por artículo  
✔ recuperación de fragmentos jurídicos  
✔ generación de respuesta con RAG  
✔ visualización de fuentes exactas  
✔ filtro por norma seleccionada  
✔ exclusión de fragmentos basura (`es_indice`)  
✔ control de visibilidad por usuario  

---

# 4. Mejoras ya implementadas

## Corrección de filtrado por artículo

Antes el sistema descartaba resultados válidos si no existía `article_number`.

Ahora acepta fragmentos válidos aunque no tengan número.

---

## Detección directa de artículos

Ejemplo:

qué dice el artículo 3 del RD 393/2007

El sistema detecta automáticamente:

artículo 3

y prioriza ese fragmento.

---

## Mejora de contexto RAG

Antes:

3 fragmentos

Ahora:

12 fragmentos

Código actual:

validData.slice(0,12)

---

## Filtro real por norma seleccionada

Antes el selector de norma no afectaba a la búsqueda.

Ahora se aplica filtro:

WHERE norma_id = X

Esto evita mezclar normativa distinta.

---

## Priorización de coincidencia exacta por artículo

Cuando el usuario menciona explícitamente un artículo en la consulta
(por ejemplo, “artículo 5”, “art. 17”), el backend reordena los resultados
para subir al principio los fragmentos cuyo campo `seccion` coincide con ese artículo.

Esto no sustituye la búsqueda vectorial, pero añade una priorización nominal jurídica
cuando el usuario consulta por artículo concreto.

---

## Reconstrucción de artículos completos antes del LLM

Antes el modelo recibía fragmentos sueltos de artículos largos,
a veces empezando en mitad del contenido.

Ahora el backend agrupa los fragmentos por artículo
(usando `seccion` sin el sufijo `[Bloque X]`),
ordena los bloques por `id`
y concatena sus textos para formar artículos completos
antes de enviarlos al LLM.

Esto mejora la coherencia jurídica del contexto.

---

## Inclusión del encabezado del artículo en cada fragmento

Durante la ingestión, el parser ahora añade el encabezado del artículo
al inicio del campo `texto` de cada bloque.

Ejemplo conceptual:

Antes:
un bloque podía empezar directamente por el contenido interno del apartado.

Ahora:
cada bloque empieza con el encabezado del artículo correspondiente.

Esto mejora:

- la recuperación vectorial
- la lectura del contexto por el modelo
- la reconstrucción posterior del artículo

Este cambio afecta a normas reingestadas con el parser nuevo.

---

## Bypass del control de evidencia para consultas por artículo

Antes, preguntas tipo:

“¿qué dice el artículo 5 del RIPCI?”

podían devolver:

“No consta en las normas consultadas.”

aunque el artículo estuviera presente en los fragmentos,
porque el embedding semántico daba poca similitud.

Ahora, si el artículo solicitado aparece realmente en los fragmentos recuperados,
el sistema permite continuar y responder.

---

## Estructura jurídica fija de la respuesta

El prompt del sistema se reforzó para que el modelo responda siempre con esta estructura:

1. respuesta breve
2. fundamento normativo
3. cita

Además:

- se mantiene la regla de no inventar
- se mantiene la regla de no mezclar normas
- se mantiene la salida “No consta en las normas consultadas.” cuando falta soporte
- `max_tokens` aumentó de 300 a 500 para evitar truncamientos

---

# 5. Normas cargadas actualmente

id	código	norma  
15	RSCIEI	Reglamento de seguridad contra incendios en establecimientos industriales  
17	CTE-DB-SI	Código Técnico de la Edificación — Documento Básico SI Seguridad en caso de incendio  
18	RIPCI	Real Decreto 513/2017 — Reglamento de instalaciones de protección contra incendios  
19	CTE-DB-SUA	Código Técnico de la Edificación — Documento Básico SUA Seguridad de utilización y accesibilidad
---

# 6. Estructura de tablas

## Tabla `normas`

Columnas relevantes actuales:

id  
titulo  
codigo  
ambito  
rango  
fecha_publicacion  
estado  
url_fuente  
prioridad  
jurisdiccion  
fecha_vigencia  
fecha_derogacion  
jerarquia  
owner_user_id  
estado_ingesta  
error_ingesta  
nombre_archivo  
mime_type  
num_fragmentos  
num_articulos_detectados  
num_anexos_detectados  
num_embeddings_generados  
document_hash  
version_of  
fecha_ingesta  

Regla de acceso:

owner_user_id = NULL → norma global  
owner_user_id = UUID → norma privada  

---

## Tabla `normas_partes`

Fragmentos jurídicos de cada norma.

Columnas relevantes actuales:

id  
norma_id  
tipo  
seccion  
numero  
texto  
orden  
huella  
embedding  
articulo  
rango  
es_indice  
jurisdiccion  
norm_type  
year  
article_number  
apartado  

---

# 7. Regla profesional de fragmentación jurídica

Fragmentación actual:

1. dividir por unidad jurídica real:
   - artículo
   - disposición adicional
   - disposición final
   - disposición transitoria
   - anexo
   - preámbulo

2. si la unidad es corta → una fila

3. si el artículo es largo → dividir por apartados

4. evitar cortes arbitrarios

5. marcar contenido basura con `es_indice = true`

---

# 8. Pipeline actual de ingestión

Pipeline completo actual:

PDF  
↓  
extractTextFromUploadedFile  
↓  
normalizeText  
↓  
parseNormaJuridica  
↓  
fragmentos jurídicos  
↓  
processNormaPipeline  
↓  
generación embeddings  
↓  
insert normas_partes  
↓  
estado_ingesta = lista  

---

# 9. Subida de normas desde web

Página:

/subir-norma

Archivo:

src/app/subir-norma/page.tsx

API:

src/app/api/upload-norma/route.ts

---

## Qué hace actualmente

✔ subir PDF/TXT  
✔ crear registro en `normas`  
✔ extraer texto  
✔ parsear estructura jurídica  
✔ generar fragmentos  
✔ generar embeddings  
✔ insertar en `normas_partes`  
✔ actualizar estado_ingesta  
✔ detectar duplicado por `codigo`  
✔ detectar duplicado por `document_hash`  
✔ mostrar advertencia de normas similares  

---

# 10. Estados de ingestión

procesando  
lista  
error  

Campos relevantes:

estado_ingesta  
error_ingesta  
num_fragmentos  

---

# 11. RPC principal de búsqueda

Función:

buscar_norma_partes

Estado actual real:

la RPC responde y devuelve resultados

el ranking híbrido sigue necesitando ajuste fino para priorizar correctamente CTE-DB-SI frente a otras normas en consultas generales.

---

# 12. Modelo actual de acceso a normas

Usuario anónimo:

solo normas globales

Usuario autenticado:

normas globales + normas propias

Nunca mostrar:

normas privadas de otros usuarios

---

# 13. Flujo actual de desarrollo

1. pedir cambios a Antigravity  
2. revisar diff  
3. aplicar cambios  
4. ejecutar:

git add .  
git commit -m "..."  
git push  

5. Vercel despliega automáticamente  
6. probar en producción  

---

# 14. Decisiones cerradas del proyecto

Estas decisiones **no deben reabrirse salvo motivo técnico grave**.

- El stack actual queda fijado.
- La ingestión vive en web/app.
- No usar scripts locales improvisados.
- La RPC `buscar_norma_partes` no debe rehacerse.
- El motor RAG actual es válido.
- Antigravity se usa para modificar el repositorio.

---

# 15. Problemas históricos ya resueltos

✔ errores de `pdf-parse`  
✔ colisiones de embeddings  
✔ columna `jurisdiccion` incorrecta  
✔ errores de tipo en `numero`  
✔ normas duplicadas  
✔ selector de norma no filtraba  
✔ contexto RAG demasiado pequeño  
✔ conflicto de firmas duplicadas de la RPC  
✔ envío incorrecto de `q_norma_id = ""` desde `/api/ask`  
✔ citas internas con `[Bloque X]` visibles al usuario  
✔ bloqueo indebido de consultas tipo “qué dice el artículo X” por umbral de evidencia  
✔ recuperación de fragmentos que empezaban en mitad del artículo  

---

# 16. Problemas conocidos aún pendientes

afinar ranking híbrido entre normas cargadas

priorizar mejor CTE-DB-SI cuando se menciona explícitamente

revisar por qué algunas consultas del CTE devuelven otras normas como fuente principal

subida automática desde BOE

gestión avanzada de versiones de normas

normalización futura de algunos metadatos (`ambito`, etc.) para filtros estrictos

---

# 17. Próxima fase de desarrollo

AMPLIAR LA PRIORIZACIÓN POR MATERIA

El buscador ya usa el siguiente orden de prioridad:

1. selector de norma del usuario  
2. norma detectada en la pregunta  
3. priorización por materia  
4. búsqueda global  

Actualmente la priorización por materia funciona de forma dinámica
a partir de los campos metadata de la tabla `normas`.

---

# 18. Estado del motor de búsqueda

Se ha añadido una capa de priorización previa al motor vectorial.

Orden actual:

1️⃣ Selector de norma del usuario  
2️⃣ Detección automática de norma en la pregunta  
3️⃣ Priorización por materia  
4️⃣ Búsqueda global  

Además, si la consulta menciona un artículo explícito,
ese artículo se prioriza dentro del conjunto recuperado.

---

# 19. Prioridad por materia basada en metadata (IMPLEMENTADO)

Se ha eliminado completamente la lógica hardcodeada de materias en el backend.

Antes el archivo `/api/ask` contenía bloques manuales como:

- energía → RD 390/2021  
- incendios → ZAR-PPCI  
- accesibilidad → RD 505/2007  

Estos bloques han sido eliminados.

Ahora la priorización por materia funciona de forma **dinámica leyendo metadata desde la tabla `normas`**.

Campos nuevos en la tabla `normas`:

- `materia`
- `submateria`
- `keywords` (TEXT[])

Funcionamiento actual:

1. Cuando llega una pregunta, el backend consulta todas las normas con `keywords IS NOT NULL`.
2. Para cada norma se construye una lista de términos:

materia  
submateria  
keywords

3. Si la pregunta contiene alguno de esos términos, el sistema:

- prioriza esa norma
- fuerza `parsedNormaId`
- ejecuta el RAG contra esa norma primero.

Este sistema permite que **cualquier norma nueva pueda autopriorizarse sin modificar el código**.

Para añadir priorización a una norma solo es necesario rellenar en `normas`:

- `materia`
- `submateria`
- `keywords`

Estado del sistema:

✔ priorización dinámica  
✔ sin hardcode  
✔ escalable a nuevas normas  
✔ compatible con normas privadas por usuario

---

# 20. Sistema de control estricto de alucinaciones del LLM (IMPLEMENTADO)

El prompt del sistema usado en `/api/ask` ha sido reforzado para evitar respuestas inventadas.

Reglas actuales del modelo:

1. El modelo solo puede responder con información presente en los fragmentos recuperados.
2. Si la respuesta no aparece en el contexto, debe responder exactamente:

"No consta en las normas consultadas."

3. Cuando cite contenido jurídico debe usar el formato:

[Artículo X]

4. No puede introducir normas que no estén presentes en el contexto recuperado.
5. No puede usar conocimiento externo del modelo.

Esto reduce significativamente las alucinaciones jurídicas.

---

# 21. Base estructural para relaciones jurídicas entre normas (IMPLEMENTADO)

Se ha creado la tabla:

normas_relaciones

Propósito:

permitir registrar relaciones jurídicas entre normas como:

- deroga
- modifica
- desarrolla
- remite
- sustituye

Columnas principales:

id  
norma_origen_id  
norma_destino_id  
tipo_relacion  
articulo_origen  
articulo_destino  
descripcion  
created_at  
origen_deteccion  
estado_revision  
confianza  
evidencia_texto  
metodo_deteccion  

Estados posibles de revisión:

pendiente  
confirmada  
rechazada

Esto permitirá en el futuro:

- detectar conflictos normativos
- explicar derogaciones
- mostrar jerarquía normativa
- mejorar la respuesta jurídica del buscador

---

# 22. Vista de consulta de vigencia normativa (IMPLEMENTADO)

Se ha creado la vista:

vw_normas_vigencia

Propósito:

facilitar la consulta legible de relaciones normativas incluyendo:

- norma origen
- norma destino
- tipo de relación
- efecto sobre la vigencia
- evidencia textual
- estado de revisión

Esta vista simplifica el uso futuro de:

- vigencia normativa
- derogaciones
- relaciones entre normas

sin necesidad de joins complejos en el backend.

---

# 23. Estado actual del sistema (REAL)

El sistema actual ya tiene:

✔ ingestión automática de normas  
✔ fragmentación jurídica mejorada  
✔ embeddings vectoriales  
✔ RAG funcional  
✔ filtrado por norma  
✔ priorización dinámica por materia  
✔ control de alucinaciones  
✔ estructura para relaciones normativas  
✔ estructura para control de vigencia  
✔ vista `vw_normas_vigencia` para consultas de vigencia  
✔ normas reales cargadas: RSCIEI, RIPCI, CTE-DB-SI  
✔ búsqueda por artículo funcionando  
✔ reconstrucción de artículos en contexto  
✔ respuestas con estructura jurídica clara  

Estado real del buscador:

RSCIEI: cargado  
RIPCI: validado y funcionando  
CTE-DB-SI: cargado, indexado y respondiendo, con ranking general todavía mejorable en algunas consultas

Conclusión:

El sistema puede considerarse **MVP técnico funcional estable**, pendiente de ajustes de ranking entre normas y ampliación progresiva del corpus normativo.

---

# 24. Automatización de metadata en subida de normas (IMPLEMENTADO)

El pipeline de subida de normas ha sido ampliado para detectar metadata automáticamente durante la ingestión del documento.

Ahora, al subir un PDF, el sistema ejecuta varias detecciones automáticas antes de generar los fragmentos jurídicos.

Detección automática por Regex

El sistema analiza los primeros ~2000 caracteres del documento para detectar:

tipo de norma (Real Decreto, Ley, Orden, etc.)

fecha de publicación

Esto permite rellenar automáticamente los campos:

rango  
fecha_publicacion

si el usuario no los ha introducido manualmente.

Clasificación temática automática (LLM)

El sistema envía al modelo:

el título de la norma

los primeros 2000 caracteres del texto

El modelo devuelve un JSON con:

materia  
submateria

Estos valores se guardan automáticamente en la tabla `normas`.

Esto permite que la priorización por materia funcione sin intervención manual.

Generación automática de keywords

Si el usuario no introduce keywords manualmente, el sistema genera automáticamente un array combinando:

materia  
submateria  
palabras relevantes del título

El sistema elimina duplicados y palabras irrelevantes.

Las keywords se guardan en la tabla `normas`.

Resultado del sistema

Al subir una norma ahora se generan automáticamente los siguientes metadatos:

rango  
fecha_publicacion  
materia  
submateria  
keywords

Esto permite que la norma se integre automáticamente en el sistema de priorización del buscador sin modificar el código.

---

# 25. Próximos pasos inmediatos del proyecto

afinar respuestas del CTE en búsquedas globales

mejorar priorización automática por norma mencionada

validar más consultas reales con las tres normas actuales

subir nuevas normas prioritarias una vez cerrada la estabilidad actual

---

# 26. Incidencia técnica reciente en /api/ask (RESUELTA)

Durante la estabilización del buscador híbrido se detectaron varios problemas en producción:

- conflicto de firmas duplicadas en la RPC `buscar_norma_partes`
- error por envío de `q_norma_id = ""` desde `/api/ask`
- edición accidental corrupta de `src/app/api/ask/route.ts`
- bloqueo de consultas por artículo por el umbral de evidencia
- contexto incompleto por fragmentos cortados a mitad de artículo

Estado actual de esta incidencia:

- la RPC fue limpiada y recreada en Supabase
- `route.ts` fue corregido
- el backend está estable en producción
- las consultas por artículo ya pasan correctamente al LLM cuando el artículo existe
- los artículos ya se reconstruyen antes de enviar el contexto al modelo

Regla de trabajo a partir de ahora:

no tocar SQL ni `/api/ask` sin verificar primero el error exacto en Vercel Logs.

---

Estado real actual:

- RIPCI funciona y responde bien
- CTE-DB-SI está cargado y responde, pero aún admite mejora de ranking en consultas generales
- RSCIEI está cargado
- la RPC híbrida está viva y estable
- el siguiente bloque de trabajo es mejorar precisión entre normas y ampliar progresivamente el corpus

---

# 27. BLOQUE COMPLETADO — MOTOR RAG (FINAL)

Estado: COMPLETADO

Se ha validado completamente el funcionamiento del buscador jurídico en producción.

## Validaciones realizadas

- consultas directas por norma → OK
- consultas ambiguas entre normas → OK
- nueva norma CTE-DB-SUA cargada e indexada → OK
- recuperación de fragmentos jurídicos → OK

Caso crítico resuelto:

"resbaladicidad de suelos"

Problema:
- embeddings no recuperaban correctamente fragmentos relevantes

Solución aplicada:
- mejora de metadata (keywords específicas)
- regla directa de priorización por término
- bypass del control de evidencia cuando la norma está fijada y hay fragmentos

Resultado:
- el sistema responde correctamente incluso cuando el embedding falla

## Estado del sistema tras esta fase

✔ RAG estable  
✔ priorización correcta entre normas  
✔ citas jurídicas fiables  
✔ control de “No consta” robusto  
✔ comportamiento consistente en producción  

---

# 28. ESTADO UI — INTERFAZ (IMPLEMENTADO PARCIAL)

Se ha implementado una nueva capa de interfaz profesional (UI) sobre el buscador existente.

Objetivo:
convertir el sistema en una herramienta de consulta normativa profesional (no estilo chat).

## Cambios realizados

✔ Rediseño completo de la home  
✔ Rediseño de la pantalla de resultados  
✔ Mejora del panel lateral de historial  
✔ Mejora del panel derecho de fuentes  
✔ Estructura visual profesional tipo herramienta técnica  
✔ Separación clara de bloques:
   - respuesta breve
   - fundamento normativo
   - artículos citados
   - fuentes

✔ Integración visual sin modificar lógica del sistema  

## Estado técnico de la UI

IMPORTANTE:

- Todos los cambios han sido SOLO de frontend
- NO se ha modificado:
  - backend
  - /api/ask
  - Supabase
  - RPC
  - lógica de búsqueda
  - RAG
  - estructura de datos

La UI se ha adaptado sobre los componentes existentes:

- QueryPanel
- ThreePanelLayout
- HistorySidebar
- SourcesPanel

## Estado actual

✔ UI de escritorio funcional  
✔ buscador sigue funcionando correctamente  
✔ fuentes siguen conectadas a datos reales  
✔ despliegue en producción operativo  

## Pendiente (UI)

- añadir bloque “Mapa normativo” en resultados (estructura visual)
- ajustar textos y títulos de panel derecho
- pequeños ajustes de espaciado/layout
- validación completa de UX

## Pendiente (general)

- batería de pruebas funcionales completas
- versión móvil (fase siguiente)

---

# 29. REGLA CRÍTICA DE DESARROLLO (NUEVA)

A partir de este punto:

Cualquier cambio en el proyecto debe cumplir:

1. NO romper el buscador actual
2. NO tocar backend salvo necesidad crítica
3. NO modificar /api/ask sin validación previa
4. NO alterar la lógica de búsqueda
5. NO introducir datos falsos en la UI
6. trabajar siempre con cambios mínimos y seguros

La UI puede evolucionar, pero el motor RAG se considera estable.

---

# 30. FASE ACTUAL DEL PROYECTO

Fase activa:

👉 profesionalización de interfaz + validación real del sistema

Orden de trabajo:

1. estabilizar UI escritorio  
2. pruebas funcionales reales  
3. ajustes finos  
4. implementación versión móvil  
5. ampliación de normas  

---

# FIN ACTUALIZACIÓN UI

# FIN DE FOTO FIJA