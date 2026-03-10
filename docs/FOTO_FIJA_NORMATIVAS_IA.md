docs/FOTO_FIJA_NORMATIVAS_IA.md
# FOTO FIJA — PROYECTO NORMATIVAS IA

Última actualización: 2026-03-09  
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
- modelo actualmente usado en `/api/ask`

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

Actualmente existen 3 normas activas:

| id | código | norma |
|---|---|---|
| 1 | RD 505/2007 | Real Decreto 505/2007 |
| 2 | ZAR-PPCI | Ordenanza Municipal de Protección Contra Incendios de Zaragoza |
| 7 | RD 393/2007 | Real Decreto 393/2007 |

Fragmentos cargados:

| norma_id | fragmentos |
|---|---|
| 1 | 62 |
| 2 | 100 |
| 7 | 96 |

Las copias duplicadas fueron eliminadas.

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

Existe interfaz funcional.

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

---

# 10. Estados de ingestión

Estados posibles:


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


Responsabilidades:

- vector search
- lexical search
- ranking híbrido
- exclusión de índices
- filtros de vigencia

Esta RPC **no debe rehacerse salvo necesidad real**.

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

Regla de trabajo:

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
- La ingestión debe vivir en web/app.
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

1. control de duplicados de normas  
2. sistema de versiones de normas  
3. validación automática de ingestión  
4. revisión manual de ingestión  
5. visibilidad avanzada de normas  
6. división avanzada de artículos  
7. subida automática desde BOE  

---

# 17. Próxima fase de desarrollo (prioridad absoluta)

Implementar **INGESTIÓN PROFESIONAL CONTROLADA**.

Objetivos:

### 1. Control de duplicados

Detectar normas existentes mediante:

- `codigo`
- hash del documento

Opciones al detectar duplicado:

- cancelar
- reemplazar
- crear nueva versión

---

### 2. Sistema de versiones de normas

Añadir campos:


version_of
estado_vigencia
fecha_vigencia
fecha_derogacion


Solo normas vigentes se consultan por defecto.

---

### 3. Validación automática de ingestión

Cada norma debe generar informe:


fragmentos generados
artículos detectados
anexos detectados
embeddings generados
errores detectados


---

### 4. Revisión manual de ingestión

Estados futuros:


procesando
pendiente_revision
lista
error


---

### 5. Preparar subida automática desde BOE

Cuando la ingestión controlada sea estable:

Pipeline:


URL BOE
↓
descarga PDF
↓
ingestión automática
↓
validación


---

# 18. Regla de continuidad

Cuando se abra una nueva conversación:

1. pegar este documento
2. tomarlo como estado real del proyecto
3. no replantear decisiones cerradas
4. avanzar solo en la siguiente prioridad


INGESTIÓN PROFESIONAL CONTROLADA


---

# 19. Estado del motor de búsqueda (marzo 2026)

Se ha añadido una capa de priorización previa al motor vectorial para mejorar la precisión jurídica.

Orden de prioridad actual:

1. **Selector de norma del usuario (máxima prioridad)**  
   Si el usuario selecciona una norma en el frontend, la búsqueda se restringe exclusivamente a esa norma.

2. **Detección automática de norma en la pregunta**  
   El sistema detecta referencias como:

   RD 390/2021  
   RD 393/2007  
   Ley 8/2015  

   Cuando detecta una referencia normativa, restringe automáticamente la búsqueda vectorial a esa norma.

3. **Priorización inicial por materia**

   Actualmente implementada para energía:

   Materia detectada:  
   - certificación energética  
   - certificado energético  
   - eficiencia energética

   Norma priorizada:

   RD 390/2021

   Esto permite que preguntas como:

   ¿Quién debe firmar el certificado energético?

   funcionen correctamente incluso cuando el selector está en **“Todas las normas”**.

4. **Búsqueda global**

   Si no se detecta norma ni materia, el sistema realiza búsqueda vectorial sobre todas las normas permitidas.

---

## Validación realizada

Se realizaron pruebas manuales que confirmaron:

- selector de norma funciona correctamente
- detección de norma en la pregunta funciona
- priorización por materia funciona
- no se mezclan normas incorrectas
- preguntas fuera de la norma devuelven  
  **“No consta en las normas consultadas.”**

Estado del sistema:

FUNCIONANDO Y VALIDADO
---

# FIN DE FOTO FIJA