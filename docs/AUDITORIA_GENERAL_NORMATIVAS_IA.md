# Auditoría general Normativas IA

## 1. Resumen ejecutivo

El proyecto **Normativas IA** presenta una base funcional sólida como Producto Mínimo Viable (MVP) para la consulta de normativas técnicas de edificación en España (como el CTE, RIPCI, etc.). Combina adecuadamente técnicas de procesamiento de lenguaje natural basadas en búsqueda híbrida (Vectorial + FTS) y capacidades RAG con grandes modelos de lenguaje (LLM). 

Sin embargo, en su estado actual, **el sistema presenta riesgos técnicos críticos y de seguridad que impiden considerarlo estable para producción o para su apertura generalizada a múltiples usuarios**. Se han identificado fugas de privacidad en las API, vulnerabilidades graves por ausencia de políticas de seguridad en la base de datos (RLS), sesgos de alucinación estructurada causados por la descontextualización de los fragmentos devueltos al LLM, y patrones rotos de codificación de caracteres (*mojibake*) que afectan silenciosamente a la ingesta automática del BOE.

Antes de ampliar el catálogo de normas o de lanzar la plataforma, **es imprescindible subsanar las vulnerabilidades de control de acceso y mejorar la inyección de contexto de los fragmentos recuperados**.

---

## 2. Fallos críticos

### Fallo Crítico 1: Fuga de privacidad en la API de obtención de normas (`/api/normas`)
*   **Qué ocurre:** El endpoint `/api/normas` consulta y devuelve todos los registros de la tabla `normas` (ID, título, código) de manera global y sin verificar la autoría del registro ni aplicar filtros basados en el usuario solicitante.
*   **Dónde ocurre:** [src/app/api/normas/route.ts](file:///c:/Users/unzal/normativa_ia/src/app/api/normas/route.ts)
*   **Por qué es peligroso:** Expone públicamente los títulos, códigos e identificadores de normas que los usuarios han subido de manera privada (con un `owner_user_id` definido). Cualquiera, incluso sin autenticación, puede listar estas normas privadas.
*   **Cómo comprobarlo:** Realizar una petición GET a `/api/normas` sin proporcionar cabeceras de autorización. Devolverá todas las normas de la base de datos, incluidas las privadas.
*   **Prioridad:** Alta.
*   **Recomendación sencilla:** Filtrar la consulta a la base de datos para que solo recupere las normas globales (`owner_user_id IS NULL`) o aquellas donde el `owner_user_id` coincida con el ID del usuario autenticado obtenido del token JWT.

---

### Fallo Crítico 2: Vulnerabilidad por Ausencia de Row Level Security (RLS) en `normas` y `normas_partes`
*   **Qué ocurre:** A diferencia de la tabla `profiles`, la base de datos no tiene habilitado RLS para las tablas principales de la aplicación (`normas` y `normas_partes`), ni cuenta con políticas de seguridad.
*   **Dónde ocurre:** Archivos de migración de base de datos en [supabase/migrations/](file:///c:/Users/unzal/normativa_ia/supabase/migrations) y la base de datos Supabase en uso.
*   **Por qué es peligroso:** Cualquier cliente malintencionado que extraiga la clave pública `NEXT_PUBLIC_SUPABASE_ANON_KEY` (expuesta por diseño en el frontend) puede interactuar directamente con Supabase saltándose los límites de las API. Sin RLS, ese cliente puede leer fragmentos privados de otros usuarios, borrar normas arbitrariamente o corromper los embeddings almacenados mediante llamadas directas.
*   **Cómo comprobarlo:** Desde la consola del navegador, ejecutar `supabase.from('normas_partes').select('*')` usando el cliente público anon. Si devuelve registros que pertenezcan a normas de ámbito privado de otros usuarios, la base de datos está desprotegida.
*   **Prioridad:** Alta.
*   **Recomendación sencilla:** Ejecutar una migración SQL en Supabase para habilitar RLS en ambas tablas y definir políticas SELECT que restrinjan la lectura a registros públicos o del propio autor.

---

### Fallo Crítico 3: Alucinación estructural por mezcla de normas y descontextualización de fragmentos
*   **Qué ocurre:** En las búsquedas globales, el RAG mezcla fragmentos de múltiples leyes distintas (ej. RD 486/1997 y el CTE). No obstante, el formateador del contexto para el LLM concatena estos textos bajo etiquetas genéricas tipo `Artículo 5` o `Anexo II` sin prefijar el nombre o código de la norma origen de cada fragmento.
*   **Dónde ocurre:** [src/app/api/ask/route.ts](file:///c:/Users/unzal/normativa_ia/src/app/api/ask/route.ts) al armar la variable de prompt `contextText`.
*   **Por qué es peligroso:** El modelo recibe múltiples cláusulas llamadas "Artículo 6" que regulan materias totalmente ajenas (ej. temperatura laboral frente a seguridad estructural) sin saber a cuál corresponde cada una. Esto hace imposible que la IA cumpla la directiva de seguridad *"No mezcles normas"* y genera alucinaciones estructuradas muy dañinas, atribuyendo requisitos de un reglamento a otro.
*   **Cómo comprobarlo:** Hacer una pregunta global sobre una materia regulada en más de una norma (ej. "¿Cómo se regulan las salidas de evacuación?") y ver cómo el LLM unifica criterios inconexos en la misma respuesta atribuyendo orígenes incorrectos.
*   **Prioridad:** Alta.
*   **Recomendación sencilla:** Modificar la inyección de contexto en la API de consulta para que cada fragmento esté precedido claramente por su identificador de norma, ej: `[Norma: CTE - Código Técnico] Artículo 5: ...`.

---

### Fallo Crítico 4: Bug de Mojibake (Caracteres corruptos en Expresiones Regulares del Ingestor)
*   **Qué ocurre:** El script de ingesta del BOE contiene expresiones regulares corruptas por codificación (mojibake), utilizando patrones como `secci(?:Ã³|o)n`, `cap(?:Ã­|i)tulo`, `ap(?:Ã©|e)ndice`, o comprobaciones estrictas como `fragment?.tipo === "ArtÃ­culo"`.
*   **Dónde ocurre:** [tools/import-boe-norma.mjs](file:///c:/Users/unzal/normativa_ia/tools/import-boe-norma.mjs)
*   **Por qué es peligroso:** En entornos UTF-8 correctos (donde el XML del BOE contiene caracteres acentuados normales como `ó`, `í`, `é`), estas expresiones no casarán. Como consecuencia, las secciones de los anexos, apéndices o secciones técnicas quedarán mal estructuradas o se interpretarán como no válidas. Además, el validador omitirá los avisos de seguridad críticos para fragmentos con numeración nula al fallar la comparación `fragment?.tipo === "ArtÃ­culo"`.
*   **Cómo comprobarlo:** Subir una norma del BOE consolidada que contenga tildes marcadas en palabras clave y revisar las advertencias de fragmentación e integridad del validador de dry-run.
*   **Prioridad:** Alta.
*   **Recomendación sencilla:** Normalizar el archivo quitando los caracteres corruptos (`Ã³`, `Ã­`, `Ã©`) y sustituyéndolos por sus caracteres correctos en UTF-8, o implementar una limpieza unicode preliminar a los textos antes de evaluar las expresiones regulares.

---

## 3. Fallos medios

### Fallo Medio 1: Descarte de coincidencias cruzadas en la búsqueda de artículo exacto
*   **Qué ocurre:** Si el detector de artículo determina que el usuario pregunta por un artículo específico (ej. "Artículo 4"), reescribe la lista de fragmentos borrando todos los demás resultados de la base de datos para pasarle exclusivamente los fragmentos de ese artículo.
*   **Dónde ocurre:** [src/app/api/ask/route.ts](file:///c:/Users/unzal/normativa_ia/src/app/api/ask/route.ts)
*   **Por qué es peligroso:** Si la consulta del usuario intenta contrastar o comparar dos artículos (ej. "¿Qué diferencia hay entre el artículo 4 y el artículo 5?"), la API detecta únicamente el primero, limpia la lista borrando los fragmentos del artículo 5, e impide al LLM responder a la comparación solicitada.
*   **Cómo comprobarlo:** Preguntar al buscador: "Compara los requisitos del artículo 5 con los del artículo 6 de la norma X". El LLM responderá que no cuenta con información sobre el artículo 6.
*   **Prioridad:** Media.
*   **Recomendación sencilla:** Permitir que el detector de artículos capture una lista o rango de números si hay conectores comparativos o conjunciones en la pregunta, evitando desechar los fragmentos válidos restantes.

---

### Fallo Medio 2: Inconsistencia en la definición de `article_number` en el pipeline de PDF/TXT
*   **Qué ocurre:** En el flujo de importación desde BOE XML, `article_number` se guarda como una cadena de texto (admitiendo valores como `"13 bis"`). Sin embargo, el pipeline automatizado por IA para PDFs/TXTs evalúa e interactúa con esta propiedad forzándola a valores de tipo numérico entero.
*   **Dónde ocurre:** [src/lib/normativas/ai-validation.ts](file:///c:/Users/unzal/normativa_ia/src/lib/normativas/ai-validation.ts) y [src/app/api/upload-norma-ia/route.ts](file:///c:/Users/unzal/normativa_ia/src/app/api/upload-norma-ia/route.ts).
*   **Por qué es peligroso:** La fragmentación automática fallará o generará duplicados inválidos cuando las leyes cuenten con artículos sufijados (como "13 bis" o "13 ter"), ya que todos intentarán castearse al entero `13` provocando colisiones. Además, las búsquedas explícitas por artículo fallarán si se intentan emparejar contra un entero en la base de datos.
*   **Cómo comprobarlo:** Procesar una norma en formato PDF con artículos intermedios "bis" y observar las salidas del validador de integridad estructural de IA.
*   **Prioridad:** Media.
*   **Recomendación sencilla:** Unificar el esquema lúdico de datos para tratar siempre `article_number` como un campo `TEXT` libre y flexible, tanto en la base de datos como en los esquemas de validación de JSON de OpenAI.

---

### Fallo Medio 3: Falsos negativos y bloqueos en el umbral de confianza ("No consta")
*   **Qué ocurre:** La API `/api/ask` exige de forma muy rígida que existan al menos 2 fragmentos válidos (`validData.length >= 2`) y que se cumplan ciertos recuentos de puntuación media/alta para considerar que hay evidencia suficiente para responder.
*   **Dónde ocurre:** [src/app/api/ask/route.ts](file:///c:/Users/unzal/normativa_ia/src/app/api/ask/route.ts)
*   **Por qué es peligroso:** Si el usuario realiza una pregunta sumamente específica que coincide perfectamente con un único párrafo de una norma (ej. con similitud vectorial excelente de 0.92), el sistema ignorará esta respuesta y devolverá "No consta en las normas consultadas" únicamente por no contar con una segunda fuente que le acompañe.
*   **Cómo comprobarlo:** Escribir una consulta con las palabras literales y exactas de un único artículo corto. El sistema devolverá "No consta".
*   **Prioridad:** Media.
*   **Recomendación sencilla:** Añadir una excepción a la regla de conteo: si el fragmento de mayor relevancia supera un umbral muy alto (ej. `bestScore >= 0.75`), omitir la exigencia de que haya más de un fragmento de soporte.

---

## 4. Mejoras recomendadas

1.  **Sincronización de Fuentes visuales en el Frontend:**
    *   *Problema:* El RAG limita y recorta el contexto real que le entrega al LLM (`maxContextChars` y `maxContextGroups`) para no sobrepasar la ventana del prompt, pero devuelve el array de fuentes completo al frontend. El usuario final observa referencias que la IA nunca llegó a leer.
    *   *Mejora:* Asegurar que la API `/api/ask` filtre la lista de `sources` que retorna para que coincida exactamente con los fragmentos de texto efectivamente integrados en el prompt final del LLM.

2.  **Registro de costes de tokens de IA en caso de error transaccional:**
    *   *Problema:* Si la base de datos rechaza la inserción de una norma en `/api/upload-norma-ia` (por ejemplo, por una restricción de clave duplicada), el flujo lanza una excepción y nunca ejecuta el registro del consumo de tokens en `ai_usage_logs`.
    *   *Mejora:* Envolver las llamadas y conteos de OpenAI en un bloque `try/finally` para garantizar que los tokens consumidos por el modelo de estructuración de IA siempre queden asentados en la tabla de control de costes.

3.  **Falta de Índices de base de datos para filtrado multi-norma:**
    *   *Problema:* Al hacer búsquedas globales, el RAG primero consulta la tabla `normas` para obtener los IDs públicos y del usuario actual. Estas consultas no disponen de índices en la columna `owner_user_id` ni en la columna `codigo`.
    *   *Mejora:* Añadir índices tradicionales en `normas(owner_user_id)` y `normas(codigo)` para agilizar el filtrado inicial.

---

## 5. Riesgos en la subida de normas

*   **Seguridad del Dry-run:** El dry-run es **totalmente seguro**. Los scripts de procesamiento de BOE local no interactúan con el cliente de Supabase para operaciones de escritura ni hacen peticiones de embeddings si solo se solicita pre-visualización. Los resultados se vuelcan estrictamente a archivos locales JSON y Markdown.
*   **Efectividad del archivo preview.md:** Permite una revisión humana y de IA muy minuciosa al incorporar una sección técnica con comparaciones literales entre el XML original y los textos fragmentados resultantes de la segmentación.
*   **Riesgo de fragmentación mal estructurada:** Es elevado en el procesamiento de PDFs estándar mediante expresiones regulares. La ingesta de IA mitiga parte de este riesgo, pero la falta de límites claros de tokens e inconsistencias de tipos numéricos en `article_number` puede provocar la pérdida o distorsión de apartados complementarios de la ley.
*   **Riesgo de duplicación de normas:** Las búsquedas por hash de documento y código previenen duplicaciones, pero **solo para normas de carácter público (global)**. Las normas subidas de manera privada por los usuarios no se comparan entre sí, permitiendo que un mismo usuario (o varios) suban la misma norma reiteradamente.

---

## 6. Riesgos en respuestas IA

*   **Recuperación de fuentes y Ranking:** La búsqueda híbrida (Vectorial + FTS) junto con la lógica SQL de boosting estructurado funciona muy bien y prioriza los artículos correctos. El único problema es que, al alimentar el contexto, estos fragmentos pierden el nombre de la norma de origen.
*   **Consultas por artículo exacto:** La extracción basada en regex simplista (`RD-XXX-YYYY`) es rígida y propensa a fallar ante ligeras variaciones de escritura del usuario (ej. sin guiones, con espacios adicionales o usando nomenclaturas alternativas).
*   **Comportamiento de "No consta":** Es excesivamente estricto frente a coincidencias exactas únicas, lo cual genera falsos negativos innecesarios.

---

## 7. Seguridad

*   **Variables de entorno:** La gestión es correcta. No hay credenciales críticas expuestas en el código fuente de los repositorios y se cargan mediante ficheros locales de entorno de Next.js.
*   **Service Role de Supabase:** Se utiliza adecuadamente para saltarse las restricciones de inserción/borrado de los endpoints de administración interna protegidos con el middleware `requireAdmin`. Sin embargo, el gran peligro reside en que las tablas públicas no tienen activado RLS en la propia base de datos, abriendo la puerta a que usuarios con la clave anónima realicen operaciones privilegiadas.
*   **Protección de APIs:** Los endpoints administrativos de carga (`/api/upload-norma-ia`, `/api/upload-norma`) comprueban adecuadamente el rol del usuario utilizando el método `requireAdmin(req, authSupabase)`.

---

## 8. Orden recomendado de corrección

1.  **Habilitar RLS en la base de datos (Supabase):**
    *   *Qué hacer:* Aplicar la sentencia `ALTER TABLE public.normas ENABLE ROW LEVEL SECURITY;` y `ALTER TABLE public.normas_partes ENABLE ROW LEVEL SECURITY;`. Crear políticas que permitan acceso de lectura global para normas públicas e individualizado para normas con `owner_user_id = auth.uid()`.
2.  **Solucionar la fuga de información en la API `/api/normas`:**
    *   *Qué hacer:* Filtrar la consulta SQL en la ruta agregando una cláusula `or` para limitar las filas a aquellas donde el `owner_user_id` sea nulo o pertenezca al usuario solicitante autenticado.
3.  **Corregir Mojibake en `tools/import-boe-norma.mjs`:**
    *   *Qué hacer:* Reemplazar los caracteres corruptos en las expresiones regulares y en las cadenas de texto del script (ej. corregir `"ArtÃ­culo"`, `"secciÃ³n"`, etc.) por sus literales correspondientes en codificación UTF-8 pura.
4.  **Inyectar nombre de norma en el contexto del RAG:**
    *   *Qué hacer:* Modificar la construcción de `contextText` en `/api/ask/route.ts` para que anteponga a cada bloque el título o código de su norma origen.
5.  **Ajustar el umbral estricto de evidencia para un solo fragmento:**
    *   *Qué hacer:* Permitir que `hasEnoughEvidence` sea verdadero si el fragmento devuelto tiene una puntuación sobresaliente (ej. >= 0.75), aunque el total de fragmentos coincidentes sea de 1.
6.  **Tratar `article_number` como tipo de texto flexible (`TEXT`):**
    *   *Qué hacer:* Eliminar las coerciones a enteros numéricos del validador de IA y del parser de PDF para evitar que se distorsionen artículos tipo "13 bis".

---

## 9. Qué NO tocar ahora

*   **Módulo de autorización y roles de perfil (`public.profiles`):** Toda la estructura de disparadores de inserción del usuario, validación del rol `admin` y la función `prevent_role_update` están bien estructuradas, son lógicamente correctas y seguras.
*   **Algoritmo híbrido de coincidencia en el RPC:** La combinación del vector de similitud del embedding con la ponderación de texto completo (FTS) es óptima y muy avanzada. La corrección se debe centrar en filtrar los accesos e identificar los orígenes, no en modificar la fórmula matemática del scoring.

---

## Conclusión

*   **¿Está el programa estable para seguir subiendo normas?** **No**. Continuar subiendo normas o permitiendo el uso del RAG sin habilitar RLS en la base de datos ni arreglar la fuga de metadatos de `/api/normas` representa un riesgo severo de seguridad y privacidad de datos.
*   **¿Qué conviene corregir antes de avanzar?** Es prioritario activar el RLS en Supabase, mitigar la mezcla de normativas del RAG agregando cabeceras a los fragmentos de contexto y corregir el bug de mojibake que puede estar truncando o clasificando erróneamente los artículos que se ingesten.
*   **El primer arreglo más fácil y rentable:** Modificar la inyección de contexto de `/api/ask/route.ts` para identificar la norma origen de cada fragmento (elimina de inmediato las respuestas mezcladas y erróneas de la IA) y filtrar la API de `/api/normas` por el ID del usuario actual. Ambos cambios requieren pocas líneas de código y aportan un valor técnico inmediato e indispensable.
