# FOTO FIJA — PROYECTO NORMATIVAS IA

Última actualización: 2026-04-30  
Estado: referencia oficial vigente del proyecto tras cierre del bloque de estabilización de sources, priorización y consultas por artículo exacto

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

Capacidades actuales:

✔ búsqueda semántica vectorial  
✔ búsqueda directa por artículo  
✔ recuperación de fragmentos jurídicos  
✔ generación de respuesta con RAG  
✔ visualización de fuentes exactas  
✔ devolución correcta de `sources` desde backend  
✔ consumo correcto de `sources` en frontend  
✔ mapa normativo alimentado por fuentes reales  
✔ filtro por norma seleccionada  
✔ priorización dinámica por metadata  
✔ priorización mejorada para consultas de ocupación / pública concurrencia  
✔ tolerancia a consultas con y sin tildes en detección por metadata  
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
---

## Exposición correcta de `sources` en `/api/ask`

Antes, el backend podía construir correctamente el array de fuentes,
pero no siempre lo devolvía de forma explícita en el payload final consumido por frontend.

Ahora, `/api/ask` devuelve correctamente:

- `ok`
- `answer`
- `data`
- `sources`

Esto permite que la interfaz reciba siempre las fuentes estructuradas cuando existen.

---

## Corrección del consumo de `sources` en frontend

Antes, el frontend no aprovechaba correctamente `sources`
y además aplicaba un filtrado agresivo por score que podía vaciar artificialmente la UI
aunque backend sí hubiese recuperado fuentes válidas.

Ahora:

- frontend consume correctamente `sources`
- se eliminó el filtrado duro por score en frontend
- “Fuentes asociadas a la consulta” muestra datos reales
- el panel derecho “Fuentes exactas” muestra datos reales
- el mapa normativo puede construirse correctamente cuando hay fuentes

---

## Mejora de la priorización por metadata

Se reforzó la detección previa por metadata en `/api/ask`.

Mejoras aplicadas:

- normalización a minúsculas
- normalización de tildes
- comparación más robusta que `includes()` en crudo
- mantenimiento del flujo actual sin rehacer arquitectura

Esto mejora la fijación previa de norma en consultas sensibles a variaciones ortográficas.

---

## Refuerzo de metadata en CTE-DB-SI

Se amplió la metadata de la norma **CTE-DB-SI** para mejorar su priorización en consultas clave.

Keywords añadidas:

- `ocupación`
- `pública concurrencia`
- `aforo`
- `evacuación`

Esto permite priorizar correctamente CTE-DB-SI en consultas como:

- “ocupación en locales de pública concurrencia”
- “ocupacion en locales de publica concurrencia”

---

## Aislamiento de artículo exacto en consultas nominales

Antes, en consultas como:

“qué dice el artículo 5 del RIPCI”

el sistema podía recuperar también artículos no solicitados de la misma norma por similitud semántica.

Ahora, cuando el artículo pedido existe realmente en los fragmentos recuperados,
el backend conserva prioritariamente ese artículo
y evita arrastrar artículos distintos no necesarios.

Esto reduce el ruido jurídico en consultas por artículo exacto.

# 5. Normas cargadas actualmente

Estado validado en pruebas reales recientes:

- RSCIEI → cargado y disponible
- CTE-DB-SI → validado y priorizado correctamente en consultas de ocupación / pública concurrencia
- RIPCI → validado en consultas por artículo exacto y consultas funcionales
- CTE-DB-SUA → validado en consultas de resbaladicidad y seguridad de uso
---

# 6. Estructura de tablas

## Tabla `normas`

Columnas relevantes actuales:

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
materia  
submateria  
keywords   

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

el ranking híbrido sigue necesitando ajuste fino en consultas generales complejas entre normas relacionadas, aunque ya se ha corregido la priorización de CTE-DB-SI en consultas de ocupación / pública concurrencia.

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

afinar ranking híbrido en consultas generales complejas entre normas relacionadas

seguir reduciendo ruido inter-normativo en búsquedas globales

mejorar priorización en casos aún no cubiertos por metadata estratégica

subida automática desde BOE

gestión avanzada de versiones de normas

normalización futura de algunos metadatos (`ambito`, etc.) para filtros estrictos

tests automáticos de regresión

mejor explotación de relaciones normativas y vigencia en respuesta final

---

# 17. Próxima fase de desarrollo

CONSOLIDAR EL RANKING HÍBRIDO Y AMPLIAR CORPUS NORMATIVO

El buscador ya usa el siguiente orden de prioridad:

1. selector de norma del usuario  
2. norma detectada en la pregunta  
3. priorización por metadata  
4. búsqueda global  

Tras esta fase, el sistema ya prioriza correctamente CTE-DB-SI
en consultas de ocupación / pública concurrencia
y distingue mejor consultas por artículo exacto.

La siguiente fase debe centrarse en:

- consolidar ranking híbrido en consultas generales complejas
- ampliar metadata estratégica de nuevas normas
- ampliar corpus normativo prioritario
- ampliar batería de pruebas reales

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

3. La detección previa normaliza:

- minúsculas
- tildes
- términos de metadata
- texto de la pregunta

4. Si la pregunta contiene alguno de esos términos de forma suficientemente robusta, el sistema:

- prioriza esa norma
- fuerza `parsedNormaId`
- ejecuta el RAG contra esa norma primero.

Esto permite mejorar la detección incluso cuando el usuario escribe sin tildes.

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
✔ priorización dinámica por metadata  
✔ control de alucinaciones  
✔ estructura para relaciones normativas  
✔ estructura para control de vigencia  
✔ vista `vw_normas_vigencia` para consultas de vigencia  
✔ normas reales cargadas: RSCIEI, RIPCI, CTE-DB-SI, CTE-DB-SUA  
✔ búsqueda por artículo funcionando  
✔ reconstrucción de artículos en contexto  
✔ respuestas con estructura jurídica clara  
✔ devolución estable de `sources`  
✔ paneles de fuentes funcionando con datos reales  
✔ mapa normativo funcionando con datos reales  
✔ tolerancia a consultas con y sin tildes en detección por metadata  
✔ consultas exactas por artículo sin arrastre de artículos no pedidos  

Estado real del buscador:

RSCIEI: cargado y disponible  
RIPCI: validado y funcionando  
CTE-DB-SI: validado, priorizado correctamente en consultas de ocupación / pública concurrencia y funcionando con y sin tildes en ese flujo  
CTE-DB-SUA: validado y funcionando en consultas de resbaladicidad y seguridad de uso

Conclusión:

El sistema puede considerarse **MVP técnico funcional estable y notablemente más preciso** tras la corrección de `sources`, la estabilización del consumo en frontend, la mejora de priorización por metadata y el aislamiento de consultas por artículo exacto.

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

afinar ranking híbrido en consultas generales complejas

validar más consultas reales con las cuatro normas actuales

subir nuevas normas prioritarias una vez cerrada la estabilidad actual

ampliar metadata estratégica de nuevas normas para mejorar priorización

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
- “qué dice el artículo 5 del RIPCI” → OK sin colarse artículo 12
- “resbaladicidad de suelos” → OK con fuentes
- “ocupación en locales de pública concurrencia” → OK con CTE-DB-SI priorizada
- “ocupacion en locales de publica concurrencia” → OK sin tildes
- “cada cuánto deben revisarse los extintores según el RIPCI” → OK
- “qué clase de resbaladicidad debe tener un suelo interior seco” → OK

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
✔ `sources` estable y consumido correctamente por frontend  
✔ priorización correcta en casos validados  
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

- La capa de interfaz profesional se implementó inicialmente en frontend
- En una fase posterior también se hicieron ajustes mínimos y seguros en backend para estabilizar:
  - `sources`
  - priorización por metadata
  - consultas por artículo exacto

NO se ha rehecho:
  - RPC
  - arquitectura general
  - motor vectorial
  - estructura base del proyecto

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

31. MAPA NORMATIVO (FRONTEND) — ESTADO ACTUAL

Estado: IMPLEMENTADO (Frontend) — SIN backend

Se ha implementado un sistema visual llamado Mapa Normativo en QueryPanel.

Objetivo

Mostrar de forma estructurada:

normas implicadas en la respuesta

artículos relevantes por norma

jerarquía visual de fuentes jurídicas

Funcionamiento actual

El mapa se construye exclusivamente desde:

sources[]

devuelto por /api/ask.

Lógica implementada

✔ agrupación por norma
✔ agrupación por artículos
✔ truncado final (máx 3 normas / 4 artículos)
✔ fallback visual si sources está vacío
✔ eliminación de desmontaje React (&&)
✔ render SIEMPRE visible (nunca desaparece)

Sistema de priorización visual

Orden de importancia:

artículos citados por el LLM (extraídos de "Cita:")

orden de ranking vectorial (index)

volumen de fragmentos

Se aplica un filtrado previo:

artículos citados

top N del ranking (index < 5)

Estado actual real

✔ funciona correctamente cuando sources contiene datos
✔ UI estable (sin pantallas vacías)
✔ fallback controlado

Estado actual tras estabilización de `sources`:

✔ el mapa se construye correctamente cuando backend devuelve fuentes válidas
✔ el bug principal de `sources` vacío en consultas válidas ha quedado resuelto

La calidad del mapa sigue dependiendo de la calidad real de recuperación del backend.

Interacción con el mapa (estado)

Se ha intentado:

click en chip → filtrar respuesta

Estado actual:

❌ no funcional correctamente en todos los casos

Motivo:

depende completamente de sources

no existe estado independiente del mapa

no hay recomputación de respuesta

Conclusión técnica

El mapa normativo:

✔ está correctamente implementado en frontend
✔ ya recibe y muestra fuentes reales de forma estable en los casos validados
✔ sigue dependiendo de la calidad real del backend RAG

El siguiente salto del sistema no es resolver el bug de `sources`,
sino seguir afinando calidad de recuperación en consultas más complejas.

🔥 BLOQUE CLAVE

A partir de ahora:

calidad del sistema = calidad de recuperación + calidad de sources

---

# 32. BLOQUE COMPLETADO — ESTABILIZACIÓN DE SOURCES Y PRIORIZACIÓN

Estado: COMPLETADO

Se ha cerrado un bloque técnico de estabilización del buscador en producción.

# 33. BLOQUE COMPLETADO — DIRECT FETCH POR ARTÍCULO EXACTO

Estado: COMPLETADO EN PRODUCCIÓN

Se ha corregido la vía rápida de recuperación directa cuando el usuario pregunta por un artículo concreto.

Ejemplo validado:

"artículo 3 del RSCIEI"

Problema detectado:

- la query de direct fetch usaba una columna inexistente: capitulo_detectado
- además usaba un .or(...) demasiado amplio
- esto provocaba errores SQL o falsos positivos
- el sistema acababa respondiendo "No consta en las normas consultadas."

Corrección aplicada:

- se eliminó capitulo_detectado de la query
- se sustituyó el .or(...) por filtro exacto:
  article_number = artNum
- se mantiene filtro por norma_id
- se validó con script:
  node tools/test-direct-fetch.mjs

Resultado actual:

✔ la query directa devuelve fragmentos reales
✔ producción ya no responde "No consta" para artículo 3 del RSCIEI
✔ frontend recibe sources
✔ panel de fuentes muestra datos reales
✔ direct fetch queda operativo

Pendiente detectado:

- la respuesta puede mostrar fragmentos parciales del artículo
- falta mejorar la reconstrucción completa y limpia del artículo solicitado
- este será el siguiente bloque de trabajo con Codex

# 34. BLOQUE COMPLETADO — ENSAMBLADO DE ARTÍCULOS EXACTOS CON CODEX

Estado: IMPLEMENTADO Y DESPLEGADO EN PRODUCCIÓN

Se ha mejorado el ensamblado de artículos cuando se activa el direct fetch por artículo exacto.

Cambios aplicados:

- normalización del número de artículo:
  - "5." → "5"
  - "art. 5" → "5"
  - "Artículo 5" → "5"

- agrupación de fragmentos por bloques contiguos
- selección del bloque principal con contenido
- fallback seguro si no se puede ensamblar
- mantenimiento de `sources`
- sin tocar SQL
- sin tocar RPC `buscar_norma_partes`
- sin tocar ranking general
- sin tocar frontend

Pruebas en producción:

✔ "artículo 5 del RIPCI" funciona correctamente
✔ "artículo 3 del RSCIEI" funciona, aunque el contenido depende de la calidad de ingesta actual del RSCIEI

Pendiente:

- revisar/reingestar RSCIEI más adelante si se quiere mejorar la limpieza exacta de ese artículo

## Cambios completados

✔ `/api/ask` devuelve correctamente `sources`  
✔ frontend consume correctamente `sources`  
✔ se eliminó el filtrado duro por score en frontend  
✔ paneles de fuentes muestran datos reales  
✔ mapa normativo se construye correctamente con fuentes válidas  
✔ se reforzó la priorización por metadata  
✔ se añadió normalización de tildes en detección por metadata  
✔ CTE-DB-SI queda priorizada en consultas de ocupación / pública concurrencia  
✔ el sistema responde bien con y sin tildes en ese flujo  
✔ las consultas por artículo exacto ya no arrastran artículos no pedidos  

## Pruebas finales superadas

- qué dice el artículo 5 del RIPCI  
- resbaladicidad de suelos  
- ocupación en locales de pública concurrencia  
- ocupacion en locales de publica concurrencia  
- cada cuánto deben revisarse los extintores según el RIPCI  
- qué clase de resbaladicidad debe tener un suelo interior seco  

## Conclusión

El sistema ha quedado sensiblemente más estable, más coherente y más fiable en producción tras esta fase.

# 35. BLOQUE COMPLETADO — MEJORA DE PROMPT PARA PREGUNTAS REALES

Estado: IMPLEMENTADO Y DESPLEGADO EN PRODUCCIÓN

Se han añadido reglas al system prompt de `/api/ask` para mejorar respuestas a preguntas reales no basadas en artículo exacto.

Cambios aplicados:

- clasificación interna de la pregunta
- identificación de consultas sobre normativa aplicable
- separación clara de comparativas
- prioridad al artículo que responde directamente
- respuesta con criterio técnico concreto
- uso de valores, medidas, condiciones y frecuencias cuando existan en el contexto
- formato separado para comparativas tipo trimestral vs anual

Pruebas realizadas:

✔ qué normativa regula los sistemas de protección contra incendios
✔ diferencia entre mantenimiento trimestral y anual de extintores
✔ qué normativa aplica a un taller industrial en incendios

Pendiente detectado:

❌ qué anchura mínima deben tener las salidas de evacuación

Conclusión:

El prompt ya está suficientemente ajustado.
El fallo pendiente no es de redacción, sino de recuperación / metadata / calidad de ingesta.

---

# 36. NUEVA FASE — VALIDACIÓN DE INGESTA DE NORMAS

Estado: FASE ACTIVA

Objetivo:

validar que las normas subidas al sistema se cargan correctamente de principio a fin.

Se debe comprobar:

- que el texto se extrae bien
- que los artículos salen limpios
- que la fragmentación tiene sentido
- que la metadata generada ayuda a encontrar la norma
- que las preguntas reales recuperan fuentes correctas
- que las consultas por artículo exacto funcionan tras la subida

Regla:

no mejorar código todavía.
Primero validar comportamiento real con una norma subida.

---

# 37. BLOQUE COMPLETADO — PRIMERA INGESTA REAL HÍBRIDA DE NORMA BOE

Estado: VALIDADO EN LOCAL + INSERTADO EN SUPABASE

Se ha validado una nueva estrategia de ingesta para normas reales del BOE.

Norma usada en prueba:

- RD-486-1997
- Real Decreto 486/1997, disposiciones mínimas de seguridad y salud en los lugares de trabajo
- BOE-A-1997-8669
- PDF consolidado de 16 páginas

## Problema detectado con la subida IA inicial

La ruta nueva:

`/api/upload-norma-ia`

funcionaba correctamente con TXT pequeño, pero fallaba con PDF real por timeout en Vercel.

Validaciones superadas por la ruta:

✔ admin auth funciona  
✔ token válido funciona  
✔ protección por rol admin funciona  
✔ validación de FormData funciona  
✔ TXT pequeño sube correctamente  
✔ detecta artículos y anexos  
✔ inserta en `normas_partes`  
✔ genera `ai_usage_logs`  
✔ genera `norma_ingest_reports`  

Error con PDF real:

- `FUNCTION_INVOCATION_TIMEOUT`

Conclusión:

El problema no era permisos, Supabase ni embeddings.
El problema era intentar procesar una norma real completa dentro de una sola request de Vercel.

## Estrategias probadas y descartadas

### 1. OpenAI copiando `texto_literal` completo

Resultado:

❌ demasiado lento  
❌ respuestas grandes  
❌ riesgo de timeout  
❌ riesgo de pequeñas alteraciones del texto jurídico  

### 2. OpenAI con `frase_inicio` / `frase_fin`

Resultado:

❌ `frase_fin` podía no coincidir literalmente  
❌ la reconstrucción fallaba con PDFs BOE  
❌ se detectaron frases finales inventadas o no localizables  

Conclusión:

OpenAI no debe ser responsable de cortar ni copiar el texto jurídico literal.

## Decisión técnica adoptada

La ingesta correcta debe ser híbrida:

PDF  
↓  
extracción de texto literal  
↓  
eliminación del índice inicial del BOE  
↓  
parser determinista por estructura jurídica  
↓  
fragmentos literales  
↓  
embeddings  
↓  
Supabase  

OpenAI queda reservado para fases posteriores como apoyo de metadata, validación o clasificación, pero no para copiar el texto completo ni decidir los cortes principales.

## Script local de prueba

Se creó un script local admin:

`tools/upload-norma-ia-local.mjs`

Objetivo:

probar la ingesta híbrida fuera del timeout de Vercel.

Características:

- lee `.env.local`
- usa `SUPABASE_URL`
- usa `SUPABASE_SERVICE_ROLE_KEY`
- usa `OPENAI_API_KEY`
- procesa PDF local
- extrae texto con `pdf-parse`
- elimina índice inicial cortando desde `DISPONGO:`
- divide con parser determinista
- genera embeddings
- inserta en Supabase
- marca la norma como `lista`
- permite modo `DRY_RUN`

## Resultado validado

La norma RD-486-1997 se subió correctamente con el script local.

Resultado:

✔ norma creada con `id = 26`  
✔ `codigo = RD-486-1997`  
✔ `estado_ingesta = lista`  
✔ `error_ingesta = NULL`  
✔ 26 fragmentos insertados en `normas_partes`  
✔ 26 embeddings generados  
✔ PDF real procesado sin timeout  

Fragmentación detectada:

- 26 fragmentos totales
- 12 artículos
- 7 anexos
- disposiciones adicionales / derogatorias / finales
- capítulos detectados

La ingesta ya no depende de que OpenAI copie texto ni de frases inicio/fin.

## Observaciones sobre la calidad de corte

El parser determinista ya produce cortes útiles y literales.

Ejemplos validados:

- Artículo 1 completo
- Artículo 2 completo
- Artículo 3 completo
- Disposición adicional única completa
- Anexo I completo
- Anexo II completo
- Anexo III completo
- Anexo IV completo
- Anexo V completo
- Anexo VI completo

Detalle menor detectado:

- aparece un fragmento `ANEXO` introductorio con la observación preliminar.
- no bloquea la ingesta.
- puede mejorarse más adelante clasificándolo como `Preámbulo de anexos` u `Observación preliminar`.

## Conclusión técnica

La estrategia correcta para producción es:

parser jurídico determinista primero + IA como apoyo.

No se debe volver al enfoque de pedir a OpenAI que devuelva todo el texto literal de la norma.

---

# 38. ESTADO ACTUAL DE SUBIDA DE NORMAS IA

Estado: EN TRANSICIÓN

Ya existen dos vías:

## Vía web antigua

`/subir-norma`  
`/api/upload-norma`

Estado:

✔ sigue siendo la vía estable existente  
✔ no se ha eliminado  
✔ no debe romperse  

## Vía IA nueva

`/api/upload-norma-ia`

Estado:

✔ creada  
✔ protegida por admin  
✔ validada con TXT pequeño  
✔ registra costes e informes  
❌ todavía no apta para PDFs reales grandes en una sola request por timeout de Vercel  

## Vía local híbrida

`tools/upload-norma-ia-local.mjs`

Estado:

✔ validada con PDF real BOE  
✔ RD-486-1997 subido correctamente  
✔ sirve como referencia técnica para la siguiente implementación real  

---

# 39. PRÓXIMA FASE — CONVERTIR INGESTA HÍBRIDA EN SISTEMA REAL

Estado: SIGUIENTE BLOQUE DE TRABAJO

Objetivo:

pasar lo validado en `tools/upload-norma-ia-local.mjs` al sistema real de subida.

Orden recomendado:

1. limpiar y conservar el script local como referencia
2. extraer el parser híbrido a una función reutilizable
3. reutilizarlo desde la subida IA
4. evitar que Vercel procese PDFs grandes en una sola request
5. implementar proceso por fases o jobs
6. crear pantalla admin para subida IA
7. mostrar estado, fragmentos, coste e informe final

## Decisión importante

No intentar resolver PDFs reales aumentando prompts ni haciendo que OpenAI copie la norma.

La solución debe ser:

- corte determinista
- texto literal del PDF extraído
- IA opcional solo para metadata/revisión
- embeddings sobre fragmentos ya estables
- proceso por fases si se ejecuta en Vercel

---

# 40. REGLAS NUEVAS TRAS VALIDACIÓN DE INGESTA

A partir de ahora:

1. No usar OpenAI para copiar texto jurídico completo.
2. No usar `frase_inicio/frase_fin` como base principal de fragmentación.
3. No procesar PDFs reales completos en una sola request de Vercel.
4. Para normas BOE, eliminar índice inicial antes de fragmentar.
5. El corte principal debe ser determinista por estructura jurídica.
6. La IA puede ayudar a clasificar, validar, resumir o enriquecer metadata.
7. El texto guardado en `normas_partes.texto` debe venir del texto extraído, no del texto reescrito por IA.
8. Antes de pasar a producción, probar cada nueva lógica con script local y `DRY_RUN`.

---

# 41. NORMA NUEVA CARGADA

Nueva norma cargada correctamente:

- RD-486-1997
- Real Decreto 486/1997, disposiciones mínimas de seguridad y salud en los lugares de trabajo
- `normas.id = 26`
- `estado_ingesta = lista`
- `normas_partes = 26`

Estado:

✔ cargada  
✔ fragmentada  
✔ embebida  
✔ disponible para pruebas de búsqueda  

Pendiente:

- probar consultas reales contra RD-486-1997
- validar recuperación por artículo exacto
- validar consultas funcionales:
  - temperatura en locales de trabajo
  - iluminación mínima
  - servicios higiénicos
  - material de primeros auxilios
  - condiciones de lugares de trabajo
  - anchura de vías/salidas si aplica

---

---

# 42. BLOQUE CERRADO — VALIDACIÓN FUNCIONAL DE RD-486-1997 EN BUSCADOR

Estado: COMPLETADO Y VALIDADO EN PRODUCCIÓN

Tras la ingesta híbrida local del RD-486-1997, se han realizado pruebas reales en la web de producción.

Norma validada:

- RD-486-1997
- Real Decreto 486/1997, disposiciones mínimas de seguridad y salud en los lugares de trabajo
- `normas.id = 26`
- `estado_ingesta = lista`
- `normas_partes = 26`

## Problema detectado tras la ingesta

Aunque la norma estaba correctamente subida, la consulta:

“¿Qué dice el artículo 7 del RD-486-1997?”

mezclaba inicialmente fuentes de otras normas como RSCIEI y RIPCI.

Diagnóstico:

- la ingesta estaba bien
- el artículo 7 existía en `normas_partes`
- el fallo estaba en `/api/ask`
- la detección de códigos de norma solo aceptaba formatos tipo `RD 486/1997`
- no detectaba correctamente códigos guardados como `RD-486-1997`

## Corrección aplicada

Archivo modificado:

`src/app/api/ask/route.ts`

Cambio aplicado:

- la detección de código de norma ahora acepta formatos con:
  - espacios
  - guiones
  - barras

Ejemplos soportados:

- `RD-486-1997`
- `RD 486/1997`
- `RD 486-1997`

La búsqueda de norma se hace con patrón flexible:

`%RD%486%1997%`

Esto permite asociar correctamente la pregunta con `normas.id = 26`.

## Pruebas superadas en producción

### Consulta 1

“¿Qué dice el artículo 7 del RD-486-1997?”

Resultado:

✔ detecta RD-486-1997  
✔ recupera exclusivamente Artículo 7  
✔ no mezcla RSCIEI/RIPCI  
✔ muestra fuente exacta RD-486-1997 / Artículo 7  
✔ similitud 100%  
✔ respuesta correcta sobre condiciones ambientales  

### Consulta 2

“¿Qué temperatura deben tener los locales de trabajo cerrados según el RD-486-1997?”

Resultado:

✔ recupera RD-486-1997  
✔ recupera ANEXO III  
✔ responde correctamente:
  - 17 a 27 ºC para trabajos sedentarios propios de oficinas o similares
  - 14 a 25 ºC para trabajos ligeros
✔ muestra fuente exacta ANEXO III  

### Consulta 3

“¿Qué material mínimo debe tener el botiquín según el RD-486-1997?”

Resultado:

✔ recupera RD-486-1997  
✔ recupera ANEXO VI  
✔ responde correctamente:
  - desinfectantes y antisépticos autorizados
  - gasas estériles
  - algodón hidrófilo
  - venda
  - esparadrapo
  - apósitos adhesivos
  - tijeras
  - pinzas
  - guantes desechables
✔ muestra fuente exacta ANEXO VI  

## Estado final de la fase

La fase queda cerrada.

Validado:

✔ ingesta real de PDF BOE  
✔ fragmentación híbrida útil  
✔ embeddings generados  
✔ norma disponible para búsqueda  
✔ recuperación por artículo exacto  
✔ recuperación por consulta funcional  
✔ fuentes correctas  
✔ detección flexible de códigos RD  

## Pendiente para mañana

No tocar más hoy.

Siguiente bloque recomendado:

convertir la lógica validada en `tools/upload-norma-ia-local.mjs` en una solución estable:

1. limpiar script local
2. extraer parser híbrido reutilizable
3. decidir si se integra en API por jobs/chunks
4. crear subida admin estable sin timeout
5. actualizar documentación técnica

---


# 43. BLOQUE COMPLETADO — SEGUNDA INGESTA REAL VALIDADA: RD-505-2007

Estado: COMPLETADO Y VALIDADO EN PRODUCCIÓN

Se ha validado una segunda norma real mediante el script local híbrido:

- RD-505-2007
- Real Decreto 505/2007, condiciones básicas de accesibilidad y no discriminación
- `normas.id = 27`
- 29 fragmentos insertados
- 19 artículos detectados
- 1 anexo detectado
- 29 embeddings generados

Prueba en producción superada:

“¿Qué dice el artículo 1 del RD-505-2007?”

Resultado:

✔ detecta RD-505-2007  
✔ recupera Artículo 1  
✔ fuente correcta  
✔ similitud 100%  
✔ no mezcla otras normas  

---

# 44. MEJORAS DEL SCRIPT LOCAL DE INGESTA

Archivo:

`tools/upload-norma-ia-local.mjs`

Mejoras implementadas:

✔ corrección de problemas de acentos/codificación  
✔ eliminación de índice inicial BOE  
✔ detección de entradas de índice con puntos y número de página  
✔ conservación del texto literal extraído del PDF  
✔ reordenación jurídica de fragmentos  
✔ contador correcto de artículos  
✔ argumentos obligatorios por terminal:
- `--file`
- `--codigo`
- `--titulo`

✔ validación de que el PDF contiene señales del código esperado  
✔ bloqueo de escritura si falta:
- `--confirm-upload`

Esto evita volver a pisar una norma por error.

Comandos/commits relevantes:

- `3a5220e` — Improve local legal ingestion parser
- `65e5622` — Add safe arguments to local legal ingestion
- `4788cae` — Fix local ingestion norma insert columns

---

# 45. INCIDENCIA CONTROLADA — RD-486-1997 PISADO

Durante la prueba inicial, el script todavía tenía constantes fijas:

- `CODIGO = RD-486-1997`
- `TITULO = RD-486-1997`

Se ejecutó con el PDF de RD-505-2007, por lo que se insertó contenido de RD-505 dentro de `normas.id = 26`.

Estado:

- `normas.id = 26` debe considerarse contaminado
- corresponde nominalmente a RD-486-1997
- pero sus fragmentos fueron sustituidos por contenido de RD-505 durante la prueba

Pendiente:

- reingestar RD-486-1997 correctamente cuando se descargue de nuevo su PDF
- no confiar en RD-486-1997 hasta reingestarlo

---

# 46. ESTADO ACTUAL DE INGESTA

El método local híbrido queda validado con dos normas reales:

1. RD-486-1997  
   - validado inicialmente
   - actualmente pendiente de reingesta por incidencia posterior

2. RD-505-2007  
   - subido correctamente como norma nueva
   - validado en producción

Conclusión:

La estrategia de ingesta correcta queda confirmada:

PDF BOE  
↓  
texto literal  
↓  
eliminación de índice  
↓  
parser determinista  
↓  
fragmentos jurídicos  
↓  
embeddings  
↓  
Supabase  
↓  
validación en buscador

La IA no debe copiar ni cortar el texto jurídico.
La IA podrá usarse después para metadata, revisión e informe.

---

# 47. ESTADO ACTUAL - INGESTA RIPCI Y PRUEBAS

Fecha: 2026-05-03

1. Se ha seguido trabajando con el camino actual de ingesta local desde PDF mediante `tools/upload-norma-ia-local.mjs`.

2. `RIPCI_RD_513_2017.pdf` se ha reingestado correctamente con:

- codigo: `RD-513-2017`
- titulo: `Real Decreto 513/2017, Reglamento de instalaciones de protección contra incendios`
- normaId: `28`
- 77 fragmentos insertados
- 77 embeddings generados
- fragmento máximo final: 10935 caracteres
- subida finalizada correctamente con `--confirm-upload`

3. Mejoras realizadas en el parser local:

- validación más estricta de encabezados para evitar que referencias internas tipo `anexo I, sección...` o `artículo X de...` se traten como fragmentos reales.
- al entrar en un ANEXO real, se ignoran cortes internos globales por Sección/Capítulo/Artículo.
- división posterior de anexos grandes por secciones internas reales y apartados técnicos.
- división final de fragmentos sobredimensionados para evitar superar límites de embeddings.
- validación previa de tamaño máximo antes de pedir embeddings.

4. Resultado funcional:

- Las consultas por artículo exacto funcionan muy bien. Ejemplo validado: `¿Qué dice el artículo 22 del RD-513-2017 sobre inspecciones periódicas?` recupera Artículo 22 con alta confianza / 100%.
- Las consultas temáticas sobre anexos han mejorado, pero todavía no están cerradas.
- Ejemplos probados:
  - `¿Qué exige el RIPCI sobre extintores de incendio?`
  - `¿Qué dice el RIPCI sobre mantenimiento de sistemas de detección y alarma?`
- Las respuestas generadas son razonables, pero las fuentes/citas todavía pueden mezclar fragmentos no óptimos o mostrar etiquetas tipo `ANEXO I - Ap. X` en vez de la sección completa correcta.

5. Mejoras realizadas en `/api/ask`:

- detección de consultas técnicas de anexos.
- aumento de `k` en consultas técnicas.
- reranking específico para RIPCI/anexos técnicos.
- intentos de priorizar ANEXO I para extintores/BIE y ANEXO II para mantenimiento/detección/alarma.
- `source_label` para mejorar etiquetas de fuentes.
- prompt reforzado para evitar inventar `Ap.`.
- cambios en UI para mostrar `Fuentes citadas` en vez de solo `Artículos citados`.

6. Diagnóstico actual:

- El problema principal ya no parece ser solo la ingesta.
- La vía directa por `article_number` está estable.
- El problema pendiente está en la recuperación/reranking/citado de consultas temáticas de anexos.
- El sistema aún necesita una capa más robusta de búsqueda literal + semántica + selección/validación de fuentes.

7. Decisión pendiente para próxima sesión:

- Analizar si conviene seguir con el camino actual PDF/parser o pasar a un camino más estructurado:
  a) BOE API/XML,
  b) Legalize ES,
  c) sistema donde solo el administrador sube normas curadas.
- El usuario se inclina cada vez más por que solo el administrador cargue normas, como hacen plataformas jurídicas, para reducir errores y tener una base documental controlada.
- PDF/parser local puede quedar como respaldo o herramienta auxiliar, no necesariamente como camino principal.

8. Siguiente recomendación:

- No seguir parcheando sin analizar.
- En la próxima ventana, decidir arquitectura de ingesta definitiva:
  - administrador curador,
  - fuente estructurada,
  - búsqueda literal fuerte,
  - búsqueda semántica,
  - IA final,
  - posible IA revisora barata para validar fuentes/respuesta.

---

# 48. DECISIÓN DE ARQUITECTURA — BIBLIOTECA JURÍDICA ADMINISTRADA

Fecha: 2026-05-03

Decisión tomada:

El MVP de Normativas IA pasa a orientarse como una **biblioteca jurídica administrada**, no como una plataforma donde cualquier usuario sube normas libremente.

## Decisión funcional

- Solo el administrador subirá, validará y publicará normas.
- Los usuarios finales consultarán la base normativa ya curada.
- En el MVP, los usuarios no subirán normas propias libremente.
- El sistema se parecerá más a una plataforma jurídica profesional: base documental controlada, normas validadas y fuentes fiables.

## Motivo de la decisión

Durante la validación de RIPCI se ha visto que:

- subir PDFs reales y fragmentarlos correctamente es más difícil de lo que parecía;
- los anexos técnicos generan problemas de corte, ranking y citas;
- las consultas por artículo exacto funcionan muy bien;
- las consultas temáticas dependen muchísimo de la calidad de fragmentación y recuperación;
- permitir subida libre a usuarios aumentaría errores, soporte y riesgo de respuestas malas.

Conclusión:

Para un MVP serio, es mejor que el administrador controle la calidad documental.

## Nueva prioridad de ingesta

La ingesta principal debe priorizar fuentes estructuradas:

1. BOE API/XML o legislación consolidada oficial.
2. Legalize ES como posible apoyo para Markdown/histórico de cambios, previa validación.
3. PDF/parser local solo como respaldo para normas sin fuente estructurada clara, ordenanzas municipales o documentos especiales.

## Qué se mantiene

No se tira el trabajo actual.

Se mantiene:

- Supabase
- `normas`
- `normas_partes`
- embeddings
- RAG
- `/api/ask`
- frontend actual
- panel de fuentes
- consulta por artículo exacto
- parser PDF local como herramienta auxiliar
- script `tools/upload-norma-ia-local.mjs` como respaldo técnico

## Qué cambia

Cambia principalmente el flujo de ingesta:

Antes:

PDF subido → parser local → fragmentos → embeddings

Nuevo enfoque preferente:

fuente estructurada oficial/curada → fragmentación más fiable → validación admin → embeddings → publicación

## Decisión importante

No seguir invirtiendo mucho más en parchear el parser PDF como camino principal. El PDF/parser queda como respaldo.

---

# 49. BLOQUE COMPLETADO — IMPORTADOR BOE DRY_RUN

Estado: COMPLETADO Y GUARDADO EN GITHUB

Se ha creado y validado el primer importador local desde BOE API/XML:

Archivo:
tools/import-boe-norma.mjs

Commit principal:
3376062 — Add BOE dry-run importer

Commits auxiliares:
a8b3eb4 — Ignore local PDF files
14a7b21 — Ignore local PDF test files

Funcionamiento actual:
- Ejecuta en local.
- Requiere --boe-id.
- Requiere --dry-run.
- No toca Supabase.
- No genera embeddings.
- No modifica el buscador.
- No toca /api/ask.
- No toca frontend.
- Genera preview JSON local en tools/output/.

Normas probadas:
- BOE-A-1997-8669 → RD-486-1997 → OK
- BOE-A-2007-9607 → RD-505-2007 → OK
- BOE-A-2017-6606 → RIPCI / RD-513-2017 → OK

Mejoras conseguidas:
- metadata correcta desde BOE
- título correcto
- fecha correcta
- rango correcto
- uso de bloques estructurados BOE
- versiones consolidadas antiguas descartadas con warning
- eliminación de bloques informativos no jurídicos
- limpieza de etiquetas internas tipo [preambulo]
- división de fragmentos grandes
- fragmento máximo validado por debajo de 8000 caracteres

Resultado:
El camino BOE API/XML queda validado como vía principal de ingesta para el MVP administrado.

Siguiente fase:
crear publicación controlada desde preview BOE hacia Supabase, manteniendo DRY_RUN por defecto y usando --confirm-upload para escribir.

---

# 50. BLOQUE COMPLETADO — VALIDACIÓN DE PREVIEW BOE

Estado: COMPLETADO Y GUARDADO EN GITHUB

Commit:
81f0bdb — Add BOE preview validation mode

Se ha añadido al importador BOE el modo:

node tools/import-boe-norma.mjs --boe-id BOE-A-XXXX-YYYY --validate-preview

Funcionamiento:
- Lee el JSON ya generado en tools/output/.
- No descarga BOE.
- No toca Supabase.
- No genera embeddings.
- No publica nada.
- Valida metadata, stats, warnings y fragments.
- Comprueba campos obligatorios.
- Comprueba textos vacíos.
- Comprueba source_label.
- Comprueba duplicados exactos.
- Comprueba que ningún fragmento supere 8000 caracteres.
- Devuelve VALIDADO o NO VALIDADO.
- Sale con error si hay errores críticos.

Validaciones realizadas:
- BOE-A-1997-8669 → VALIDADO
- BOE-A-2017-6606 → VALIDADO

Estado:
El flujo seguro queda así:

BOE → preview JSON → validate-preview → futura publicación controlada.

Siguiente fase:
programar publicación controlada a Supabase con --confirm-upload, sin pisar normas existentes por defecto.

---

# 51. BLOQUE COMPLETADO — PREFLIGHT DE PUBLICACIÓN BOE

Estado: COMPLETADO Y GUARDADO EN GITHUB

Commit:
7df9c48 — Add BOE upload preflight

Se ha añadido al importador BOE un modo de preflight para futura publicación a Supabase.

Comando probado:
node tools/import-boe-norma.mjs --boe-id BOE-A-1997-8669 --confirm-upload --codigo RD-486-1997

Funcionamiento actual:
- Lee el preview JSON local.
- Valida internamente el preview.
- Calcula document_hash.
- Conecta a Supabase solo en lectura.
- Busca duplicados por código.
- Muestra plan de publicación.
- Recomienda CREAR_NUEVA_NORMA o ABORTAR_DUPLICADO.
- No inserta nada.
- No borra nada.
- No genera embeddings.

Resultado probado:
- RD-486-1997 detecta duplicado por código.
- Norma existente: id=26.
- Acción recomendada: ABORTAR_DUPLICADO.
- No se tocaron datos.

Estado del flujo:
BOE → preview JSON → validate-preview → preflight Supabase → futura publicación controlada.

Siguiente fase:
activar escritura real con --confirm-upload cuando no haya duplicado, generando embeddings e insertando en normas/normas_partes.

# 52. BLOQUE COMPLETADO — WRITE PLAN DE PUBLICACIÓN BOE

Estado: COMPLETADO Y GUARDADO EN GITHUB

Commit:
702e600 — Add BOE write plan mode

Se ha añadido al importador BOE el modo:

node tools/import-boe-norma.mjs --boe-id BOE-A-XXXX-YYYY --confirm-upload --codigo CODIGO --write-plan

Funcionamiento:
- Lee el preview JSON local.
- Valida internamente el preview.
- Ejecuta preflight contra Supabase.
- Si detecta duplicado, aborta.
- Si no detecta duplicado, construye el payload exacto que se insertaría.
- Muestra la futura fila de normas.
- Muestra el primer fragmento preparado.
- Muestra el último fragmento preparado.
- Muestra contadores finales.
- No inserta nada.
- No borra nada.
- No genera embeddings.

Pruebas realizadas:
- RD-486-1997 → detecta duplicado y aborta.
- TEST-BOE-486 → muestra READY_FOR_EXECUTE_UPLOAD y payloads correctos.

Estado del flujo:
BOE → preview JSON → validate-preview → preflight Supabase → write-plan → futura ejecución real.

Siguiente fase:
activar ejecución real controlada con embeddings e inserción en Supabase.

# 53. BLOQUE COMPLETADO — PUBLICACIÓN REAL CONTROLADA DESDE BOE

Estado: COMPLETADO Y VALIDADO

Se ha activado y probado la subida real controlada desde el importador BOE.

Archivo:
tools/import-boe-norma.mjs

Nuevo modo:
--confirm-upload --execute-upload

Validado:
- no escribe sin confirmación doble
- detecta duplicados antes de subir
- inserta norma nueva
- genera embeddings
- inserta fragmentos en normas_partes
- actualiza estado_ingesta = lista
- bloquea duplicados después de subir
- funciona en el buscador de producción

Prueba realizada:
- BOE-A-1997-8669
- código temporal: TEST-BOE-486
- norma creada: id=29
- fragmentos: 38
- embeddings: 38

Consultas validadas:
- ¿Qué dice el artículo 7 del TEST-BOE-486?
- ¿Qué temperatura deben tener los locales de trabajo cerrados?

Resultado:
- recuperación correcta
- fuentes correctas
- respuesta correcta
- norma de prueba borrada correctamente después

Script auxiliar creado:
tools/delete-test-boe-486.mjs

Estado final:
El sistema BOE ya puede publicar normas reales de forma controlada.

# 54. BLOQUE COMPLETADO — REINGESTA LIMPIA DE RD-505-2007 DESDE BOE

Estado: COMPLETADO Y VALIDADO EN PRODUCCIÓN

Se ha reingestado correctamente la norma RD-505-2007 usando el sistema BOE definitivo.

Norma:
- RD-505-2007
- BOE-A-2007-9607
- Real Decreto 505/2007, condiciones básicas de accesibilidad y no discriminación

Proceso realizado:
- dry-run desde BOE correcto
- validate-preview correcto
- detección de duplicado antiguo correcta
- borrado seguro de norma antigua id=27
- reingesta limpia desde BOE
- embeddings generados correctamente
- validación en producción

Resultado:
- nueva norma creada con id=31
- 32 fragmentos insertados
- 32 embeddings generados
- estado_ingesta = lista

Consultas validadas:
- ¿Qué dice el artículo 1 del RD-505-2007?
- ¿Qué condiciones básicas de accesibilidad establece el RD-505-2007?

Resultado funcional:
- artículo exacto correcto
- consulta general correcta
- fuentes correctas
- sin mezcla de normas

Script auxiliar creado:
tools/delete-rd-505-2007.mjs

Conclusión:
RD-505-2007 queda limpia, validada y disponible en producción desde la nueva vía BOE.

# 55. BLOQUE COMPLETADO — MEJORA DE PANTALLA INICIAL DEL BUSCADOR

Estado: COMPLETADO Y VALIDADO EN PRODUCCIÓN

Se ha mejorado la pantalla inicial del buscador para orientar mejor el producto hacia arquitectura y normativa técnica.

Archivo modificado:
src/components/Main/QueryPanel.tsx

Cambios realizados:
- título principal actualizado
- subtítulo orientado a CTE, incendios, accesibilidad, seguridad de uso y prevención
- placeholder del buscador más concreto
- ejemplos de consulta actualizados con normas reales ya validadas

Ejemplos visibles:
- ¿Qué dice el artículo 7 del RD-486-1997?
- ¿Qué temperatura deben tener los locales de trabajo cerrados?
- ¿Qué condiciones básicas de accesibilidad establece el RD-505-2007?
- ¿Cada cuánto deben revisarse los extintores?

Validado en producción:
- pantalla inicial correcta
- ejemplo RD-486-1997 funciona
- ejemplo RD-505-2007 funciona

No se ha tocado:
- backend
- /api/ask
- Supabase
- SQL
- RPC
- lógica de búsqueda

Conclusión:
La home del buscador queda mejor orientada al usuario profesional de arquitectura y normativa técnica.

# 56. BLOQUE COMPLETADO — MEJORA VISUAL DE RESPUESTA CON CRITERIO PRÁCTICO

Estado: COMPLETADO Y VALIDADO EN PRODUCCIÓN

Se ha mejorado la pantalla de respuesta para que sea más útil para arquitectos y técnicos.

Archivos modificados:
- src/components/Main/QueryPanel.tsx
- src/components/Main/QueryPanel.module.css

Cambios realizados:
- añadido bloque superior "Criterio práctico"
- el criterio práctico destaca la parte accionable de la respuesta
- se mantienen los bloques:
  - Respuesta breve
  - Fundamento normativo
  - Fuentes citadas
- títulos de secciones mejorados visualmente
- presentación más profesional

Validado en producción con:
¿Qué temperatura deben tener los locales de trabajo cerrados según el RD-486-1997?

Resultado:
- respuesta más clara
- mejor orientación a decisión técnica
- fuentes siguen funcionando
- no se ha tocado backend ni lógica de búsqueda

Conclusión:
La pantalla de respuesta queda más profesional y útil para el usuario técnico.

# 57. BLOQUE COMPLETADO — MEJORA DE TEXTOS DEL PANEL DE FUENTES

Estado: COMPLETADO Y VALIDADO EN PRODUCCIÓN

Se ha mejorado el panel derecho de fuentes para que sea más claro y profesional.

Archivo modificado:
src/components/RightPanel/SourcesPanel.tsx

Cambios realizados:
- "Desglose de fuentes principales" pasa a "Fuentes normativas utilizadas"
- los contadores tipo "2 de 8 fragmentos" pasan a "2 fuentes principales mostradas"
- "Ver X fragmentos adicionales en esta norma" pasa a "Ver más fuentes de esta norma"
- estado expandido ajustado a "Ocultar fuentes adicionales"

Validado en producción con:
¿Qué temperatura deben tener los locales de trabajo cerrados según el RD-486-1997?

Resultado:
- panel más claro
- lenguaje menos técnico
- fuentes siguen funcionando correctamente
- no se ha tocado backend ni lógica de búsqueda

Conclusión:
El panel de fuentes queda más orientado a usuario profesional y menos a detalle técnico interno.

# 58. BLOQUE COMPLETADO — LIMPIEZA Y AMPLIACIÓN DE CORPUS NORMATIVO

Estado: COMPLETADO Y VALIDADO EN PRODUCCIÓN  
Fecha: 2026-05-13

Se ha realizado una fase de limpieza y ampliación de normas desde BOE, sin tocar código, backend, frontend, SQL de búsqueda ni `/api/ask`.

## Normas revisadas y validadas

### RD-486-1997 — Lugares de trabajo

Estado: LIMPIO Y VALIDADO

Resultado:
- norma existente limpia en Supabase
- `normas.id = 30`
- 38 fragmentos
- 38 embeddings

Pruebas superadas:
- ¿Qué dice el artículo 7 del RD-486-1997? → OK
- ¿Qué temperatura deben tener los locales de trabajo cerrados según el RD-486-1997? → OK, fuente ANEXO III
- ¿Qué dice el RD-486-1997 sobre piscinas públicas? → No consta correctamente

Conclusión:
RD-486-1997 queda validado como norma limpia y funcional.

---

### RD-513-2017 — RIPCI

Estado: REIMPORTADO LIMPIO DESDE BOE Y VALIDADO

Situación anterior:
- existía una versión antigua con `normas.id = 28`
- tenía 77 fragmentos
- se decidió sustituirla por versión BOE estructurada

Acción realizada:
- se borró la versión antigua:
  - `normas_partes` de `norma_id = 28`
  - `normas.id = 28`
- se reimportó desde BOE-A-2017-6606

Resultado:
- nueva norma creada con `normas.id = 32`
- 126 fragmentos
- 126 embeddings
- estado_ingesta = lista

Pruebas superadas:
- ¿Qué dice el artículo 22 del RD-513-2017 sobre inspecciones periódicas? → OK, fuente Artículo 22
- ¿Cada cuánto deben revisarse los extintores según el RD-513-2017? → OK
- ¿Qué dice el RD-513-2017 sobre piscinas públicas? → No consta correctamente

Observación:
- en la consulta de extintores recupera bien la fuente principal, pero también aparecen algunas fuentes secundarias menos relevantes.
- no bloquea el uso actual.
- queda como mejora futura de ranking/fuentes.

Conclusión:
RIPCI queda limpio, reimportado y validado desde BOE.

---

### RD-505-2007 — Accesibilidad

Estado: YA LIMPIO Y REVALIDADO

Resultado:
- `normas.id = 31`
- versión BOE limpia ya existente
- se revalidó en producción

Pruebas superadas:
- ¿Qué dice el artículo 1 del RD-505-2007? → OK
- ¿Qué condiciones básicas de accesibilidad establece el RD-505-2007? → OK
- ¿Qué dice el RD-505-2007 sobre extintores? → No consta correctamente

Conclusión:
RD-505-2007 sigue limpio y validado.

---

### RD-2267-2004 — RSCIEI antiguo

Estado: NO SUBIDO

Se generó preview desde BOE-A-2004-21216 y el propio BOE indicó:

- norma derogada con efectos desde el 10 de mayo de 2025
- derogada por Real Decreto 164/2025

Decisión:
- no subir RD-2267-2004 como norma vigente
- no usarla como base principal del buscador

Conclusión:
RD-2267-2004 queda descartado para corpus vigente principal.

---

### RD-164-2025 — Nuevo RSCIEI vigente

Estado: SUBIDO Y VALIDADO

Norma:
- Real Decreto 164/2025, de 4 de marzo
- Reglamento de seguridad contra incendios en establecimientos industriales
- BOE-A-2025-7190

Resultado:
- nueva norma creada con `normas.id = 33`
- 219 fragmentos
- 219 embeddings
- estado_ingesta = lista

Pruebas superadas:
- ¿Qué dice el artículo 1 del RD-164-2025? → OK
- ¿Qué regula el RD-164-2025 sobre establecimientos industriales? → OK
- ¿Qué dice el RD-164-2025 sobre piscinas públicas? → No consta correctamente

Conclusión:
RD-164-2025 queda incorporado como nuevo RSCIEI vigente.

---

## Revalidación tras nuevas cargas

Después de las nuevas importaciones se comprobó que siguen funcionando:

### CTE DB-SI

Consulta:
- ¿Qué dice el CTE DB-SI sobre ocupación en locales de pública concurrencia?

Resultado:
- OK
- fuente correcta CTE-DB-SI
- no se estropeó tras las nuevas normas

### CTE DB-SUA

Consulta:
- ¿Qué clase de resbaladicidad debe tener un suelo interior seco según el CTE DB-SUA?

Resultado:
- OK
- fuente correcta CTE-DB-SUA
- no se estropeó tras las nuevas normas

---

## Estado Git

No hubo cambios de código.

Se generaron previews temporales en:

- tools/output/boe-preview-BOE-A-2004-21216.json
- tools/output/boe-preview-BOE-A-2025-7190.json

Se eliminaron después.

Estado final:

- working tree clean
- nada que commitear
- nada que pushear

---

# 59. ESTADO ACTUAL DEL CORPUS VALIDADO

Normas limpias y validadas actualmente:

- RD-486-1997 — lugares de trabajo — `id=30`
- RD-505-2007 — accesibilidad — `id=31`
- RD-513-2017 — RIPCI — `id=32`
- RD-164-2025 — RSCIEI vigente — `id=33`
- CTE DB-SI — validado en consulta de ocupación / pública concurrencia
- CTE DB-SUA — validado en consulta de resbaladicidad

Norma descartada como vigente:

- RD-2267-2004 — RSCIEI antiguo — derogado desde 2025-05-10

Conclusión:
El corpus base del MVP queda más limpio, actualizado y profesional.

---

# 60. SIGUIENTE FASE RECOMENDADA

Fase activa:

AMPLIAR CORPUS NORMATIVO CON CONTROL MANUAL

Regla de trabajo:

- subir una norma cada vez
- validar preview
- comprobar duplicados
- publicar solo si procede
- hacer 3 pruebas mínimas:
  1. artículo exacto
  2. pregunta práctica real
  3. pregunta de “No consta”
- no tocar `/api/ask` salvo fallo claro
- no tocar frontend salvo necesidad
- no subir normas derogadas como vigentes

Prioridad siguiente:

1. ampliar normativa técnica útil
2. mantener corpus limpio
3. validar cada norma antes de pasar a la siguiente

# 61. BLOQUE COMPLETADO — ZONA ADMIN DE NORMAS CARGADAS

Estado: COMPLETADO Y DESPLEGADO  
Fecha: 2026-05-13

Se ha creado una zona admin para controlar las normas cargadas.

Ruta:
- /admin/normas-cargadas

Cambios realizados:
- nueva API protegida: /api/admin/normas
- nueva pantalla admin: /admin/normas-cargadas
- login admin: /login
- protección de /subir-norma
- protección de /api/upload-norma con requireAdmin
- enlace admin desde sidebar cuando el usuario es admin
- botón “Volver al buscador”
- tabla con buscador y filtros
- columnas: código, título, estado_ingesta, fragmentos, artículos, anexos, materia, ámbito, jurisdicción, fechas, estado y notas

Seguridad:
- la pantalla /admin/normas-cargadas requiere sesión admin
- la API /api/admin/normas requiere token válido y role=admin
- alguien con solo la URL no puede ver los datos
- /api/upload-norma ya no queda abierta sin control admin

Commits:
- d53e375 — Add admin normas list
- f78d4a0 — Add admin login and protect norma upload
- 8ba9bdc — Improve admin normas list

Pendiente:
- rellenar metadata materia/ámbito de normas BOE ya cargadas
- añadir campo de validación manual más adelante
- decidir si mantener login por contraseña o añadir login con Google

# 62. BLOQUE COMPLETADO — INFORME TÉCNICO CON IA

Estado: COMPLETADO, DESPLEGADO Y VALIDADO EN PRODUCCIÓN  
Commit: b2048a2 — Add AI technical report generation

Se ha creado una nueva API independiente:

- `/api/report`

Características principales:

- el informe se genera con IA usando `gpt-4o-mini`
- `/api/report` es independiente de `/api/ask`
- no se ha tocado RPC
- no se ha tocado Supabase schema
- no se ha tocado ingesta BOE
- no se ha tocado admin/login
- el frontend llama a `/api/report` desde el botón “Generar informe técnico”

Estructura del informe:

- Objeto
- Antecedentes / consulta
- Normativa utilizada
- Análisis técnico
- Criterio aplicable
- Puntos a comprobar
- Conclusión práctica
- Limitaciones
- Advertencia profesional

Validaciones realizadas:

- se validó que no vuelve a llamar a IA al ocultar/mostrar el informe
- caso normal: “¿Qué temperatura deben tener los locales de trabajo cerrados según el RD-486-1997?”
- caso PRL: “¿Cuáles son las obligaciones del empresario según la Ley 31/1995?”
- caso “No consta”: “¿Qué dice el RD-486-1997 sobre piscinas públicas?”
- se corrigió que referencias internas tipo UNE no aparezcan como normativa principal si no están en `sources.title`

Advertencia:

- el informe es orientativo y exige revisión por técnico competente

Pendiente futuro:

- afinar recuperación/fuentes en consultas temáticas complejas
- posible exportación PDF/DOCX
- posible guardado en expedientes
- posible caché de informes
- mejorar velocidad si fuese necesario

# FIN DE FOTO FIJA
