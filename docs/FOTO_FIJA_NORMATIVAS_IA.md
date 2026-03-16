# FOTO FIJA — PROYECTO NORMATIVAS IA

Última actualización: 2026-03-10  
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

# 5. Normas cargadas actualmente

id	código	norma
15	RSCIEI	Reglamento de seguridad contra incendios en establecimientos industriales
16	RIPCI	Reglamento de instalaciones de protección contra incendios
17	CTE-DB-SI	Código Técnico de la Edificación — Documento Básico SI Seguridad en caso de incendio

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

se probó una versión híbrida con ajustes SQL en Supabase

hubo conflictos por sobrecarga de firmas de la RPC

se eliminaron funciones duplicadas y se recreó una versión única

la RPC responde y devuelve resultados

el ranking todavía necesita ajuste fino para priorizar correctamente CTE-DB-SI frente a RSCIEI en algunos casos

Conclusión:

La RPC sigue siendo la función principal, pero su ranking híbrido no se considera cerrado todavía.
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

---

# 16. Problemas conocidos aún pendientes

afinar ranking híbrido entre normas cargadas

priorizar mejor CTE-DB-SI cuando se menciona explícitamente

revisar por qué algunas consultas del CTE devuelven RSCIEI como fuente principal

estabilizar definitivamente /api/ask tras cambios recientes

ampliar priorización por materia

mejorar citas jurídicas en respuestas

revisión manual de ingestión

subida automática desde BOE

gestión avanzada de versiones de normas

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

Las normas que tienen rellenos:

materia  
submateria  
keywords

pueden ser priorizadas automáticamente sin modificar el código.

La siguiente fase consiste en ampliar este sistema a más bloques normativos.

---

# 18. Estado del motor de búsqueda

Se ha añadido una capa de priorización previa al motor vectorial.

Orden actual:

1️⃣ Selector de norma del usuario  
2️⃣ Detección automática de norma en la pregunta  
3️⃣ Priorización por materia  
4️⃣ Búsqueda global


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

Ejemplo actual:

RD 390/2021  
materia = energia  
keywords = ["energia","certificación energética","eficiencia energética"]

ZAR-PPCI  
materia = incendios  
keywords = ["incendios","protección contra incendios","pci","evacuación"]

RD 505/2007  
materia = accesibilidad  
keywords = ["accesibilidad","itinerario accesible","rampa accesible"]

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
✔ vista vw_normas_vigencia para consultas de vigencia
✔ normas reales cargadas: RSCIEI, RIPCI, CTE-DB-SI

Estado real del buscador:

RSCIEI: validado y funcionando

RIPCI: validado y funcionando

CTE-DB-SI: cargado e indexado, pero con priorización todavía inestable en búsqueda global

Conclusión:

El sistema puede considerarse MVP técnico funcional parcial, pendiente de cerrar la estabilidad del ranking híbrido en consultas cruzadas.
---


24. Automatización de metadata en subida de normas (IMPLEMENTADO)

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

Estos valores se guardan automáticamente en la tabla normas.

Esto permite que la priorización por materia funcione sin intervención manual.

Generación automática de keywords

Si el usuario no introduce keywords manualmente, el sistema genera automáticamente un array combinando:

materia
submateria
palabras relevantes del titulo

El sistema elimina duplicados y palabras irrelevantes.

Las keywords se guardan en la tabla normas.

Resultado del sistema

Al subir una norma ahora se generan automáticamente los siguientes metadatos:

rango
fecha_publicacion
materia
submateria
keywords

Esto permite que la norma se integre automáticamente en el sistema de priorización del buscador sin modificar el código.

25. Próximos pasos inmediatos del proyecto

Cerrar estabilidad del buscador híbrido

corregir priorización entre RSCIEI / RIPCI / CTE-DB-SI

asegurar que menciones explícitas a una norma prioricen esa norma

Validar búsquedas reales mínimas

ocupación en CTE-DB-SI

salidas en CTE-DB-SI

detección en CTE-DB-SI

mantenimiento/extintores en RIPCI

inspecciones en RSCIEI

26. Incidencia técnica reciente en /api/ask (NUEVO)

Durante la estabilización del buscador híbrido se detectaron varios problemas en producción:

conflicto de firmas duplicadas en la RPC buscar_norma_partes

error por envío de q_norma_id = "" desde /api/ask

edición accidental corrupta de src/app/api/ask/route.ts

necesidad de dejar una única versión limpia del endpoint

Estado actual de esta incidencia:

la RPC fue limpiada y recreada en Supabase

route.ts fue corregido manualmente

el backend sigue necesitando validación final de estabilidad en producción

Regla de trabajo a partir de ahora:

no tocar más SQL ni /api/ask sin verificar primero el error exacto en Vercel Logs.



Estado real actual:
- RSCIEI funciona
- RIPCI funciona
- CTE-DB-SI está cargado pero no siempre se prioriza bien
- la RPC híbrida sigue viva pero no está cerrada del todo
- el siguiente bloque de trabajo es estabilizar la priorización del CTE-DB-SI y validar 3 consultas clave antes de seguir

# FIN DE FOTO FIJA