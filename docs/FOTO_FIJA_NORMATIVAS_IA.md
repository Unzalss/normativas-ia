# FOTO FIJA — NORMATIVAS IA

Última actualización: 2026-05-15  
Estado: referencia oficial vigente tras limpieza del corpus y validación de RD-513-2017 + RD-486-1997

Este documento sustituye a la foto fija anterior.

Objetivo actual:
mantener un corpus normativo pequeño, limpio, validado y 100% fiable antes de ampliar nuevas normas.

Regla máxima:
MEJOR POCAS NORMAS 100% LIMPIAS QUE MUCHAS NORMAS DUDOSAS.

---

# 1. OBJETIVO DEL PROYECTO

Normativas IA es un buscador jurídico/técnico con IA para consultar normativa técnica.

Usuarios objetivo:
- arquitectos
- ingenieros
- técnicos de prevención
- consultores
- técnicos de administración
- profesionales que necesitan justificar normativa con fuentes

El sistema debe:
- responder preguntas en lenguaje natural
- recuperar fragmentos jurídicos reales
- mostrar fuentes exactas
- responder “No consta en las normas consultadas” cuando no haya base suficiente
- evitar inventar normativa
- permitir generar informes técnicos orientativos
- evolucionar hacia SaaS profesional de normativa técnica

---

# 2. STACK ACTUAL

Stack cerrado salvo petición expresa:

Frontend:
- Next.js App Router

Backend/API:
- Next.js API Routes

Base de datos:
- Supabase Postgres

Vector search:
- pgvector

Embeddings:
- OpenAI text-embedding-3-small

LLM:
- usado en /api/ask
- /api/report usa gpt-4o-mini actualmente

Auth:
- Supabase Auth

Deploy:
- Vercel

Repositorio:
- GitHub

Asistente de programación:
- Codex como preferencia actual
- Antigravity para terminal y apoyo

Regla:
no cambiar stack salvo decisión explícita.

---

# 3. ESTADO REAL ACTUAL DEL CORPUS

Corpus actual validado en Supabase:

1. RD-513-2017
- id: 38
- BOE ID: BOE-A-2017-6606
- fragmentos: 135
- embeddings: 135
- origen: BOE/XML oficial
- estado: validada

2. RD-486-1997
- id: 39
- BOE ID: BOE-A-1997-8669
- fragmentos: 54
- embeddings: 54
- origen: BOE/XML oficial
- estado: validada

Todas las demás normas anteriores fueron borradas voluntariamente para limpiar el corpus.

Motivo:
prioridad absoluta a que lo subido sea 100% bueno, antes de ampliar corpus.

---

# 4. LIMPIEZA REALIZADA EN SUPABASE

Fecha: 2026-05-15

Se hizo backup antes de borrar:

- backup-normas-antes-limpieza.json
- backup-normas-partes-antes-limpieza-COMPLETO.json

Backup completo de fragmentos:
- 2904 fragmentos antes de limpiar

Borrado realizado:
- se borraron 2769 fragmentos antiguos
- se borraron todas las normas excepto RD-513-2017 id=38

Después se reimportó y validó:
- RD-486-1997 id=39

Resultado:
corpus limpio y reconstruyéndose norma a norma.

---

# 5. DECISIÓN PRINCIPAL ACTUAL

A partir de ahora, el corpus se reconstruye una norma cada vez.

No importa borrar y reimportar si hay dudas.
Lo más importante es que cada norma subida esté 100% correcta.

No se aceptan normas:
- mal fragmentadas
- con índices BOE metidos como texto jurídico
- con bloques decorativos
- con textos partidos sin sentido
- con anexos mezclados
- con artículos incompletos
- con texto reescrito por IA
- con contenido inventado
- con normas duplicadas
- con normas derogadas como si fueran vigentes

---

# 6. SISTEMA CORRECTO PARA SUBIR NORMAS

El sistema correcto de subida es:

1. BOE/XML oficial
2. dry-run en terminal
3. generar preview.md / preview JSON
4. revisar preview con Gemini/ChatGPT
5. detectar fallos:
   - texto no literal
   - bloques vacíos
   - anexos mezclados
   - artículos incompletos
   - instrucciones metidas en JSON
   - fragmentos demasiado grandes
   - fragmentos decorativos
   - cortes incorrectos
   - partes A), B), C) absorbidas
   - saltos de numeración
   - tablas mal divididas
6. si hay fallo real, preparar prompt cerrado para Codex
7. corregir importador
8. repetir dry-run
9. volver a revisar preview
10. solo subir si el preview queda apto
11. subida real con confirmación
12. pruebas reales en buscador
13. guardar resultado en foto fija

Regla profesional:
el campo `normas_partes.texto` debe contener texto jurídico literal, contiguo y procedente de BOE/XML o fuente oficial.

No se puede:
- resumir
- mejorar
- reescribir
- completar con IA
- inventar
- mezclar contexto dentro del texto jurídico

El contexto útil puede ir en:
- seccion
- metadata
- source_label si existe
- materia
- submateria
- keywords

Pero no dentro del texto jurídico.

---

# 7. REGLA CRÍTICA SOBRE TEXTO JURÍDICO

Nadie puede reescribir, resumir, completar, corregir ni alterar el texto jurídico.

Solo se permite cambiar la forma en que el script segmenta texto oficial ya existente.

El texto de `normas_partes.texto` debe ser:
- literal
- contiguo
- procedente de BOE/XML/fuente oficial

No se puede cambiar el significado ni mover condiciones entre elementos.

Ejemplo conceptual:
si el texto oficial dice que una condición aplica a un elemento A y otra a un elemento B, la segmentación nunca puede provocar que esas condiciones se crucen, mezclen o parezcan aplicarse al elemento equivocado.

---

# 8. REVISIÓN CON GEMINI / CHATGPT / CODEX

Flujo actual:

1. Codex genera o corrige el importador.
2. Codex ejecuta dry-run.
3. Codex regenera preview.md.
4. El usuario puede enviar directamente preview.md a Gemini.
5. Si Gemini responde OK PARA SUBIR, se pasa a ChatGPT para confirmación final.
6. Si Gemini responde NO SUBIR TODAVIA o REVISION DUDOSA, ChatGPT prepara prompt cerrado para Codex.
7. ChatGPT no debe pedir al usuario comandos manuales de comprobación.
8. Codex debe comprobar localmente las dudas.
9. Codex solo corrige si confirma fallo real.
10. Codex no toca Supabase hasta subida real autorizada.

Regla anti-comandos manuales:
ChatGPT no debe pedir al usuario que ejecute comandos tipo Select-String, rg, cat, node o búsquedas en JSON para comprobar dudas.  
Si hace falta comprobar algo, debe incluirlo en un prompt para Codex.

---

# 9. EVIDENCIA TEXTUAL OBLIGATORIA EN REVISIONES

Si Gemini marca:

- NO SUBIR TODAVIA
- REVISION DUDOSA

debe aportar:

1. bloque afectado
2. source_label
3. problema concreto
4. texto completo si no es largo
5. si es largo, 20-40 líneas alrededor del problema
6. frase exacta donde empieza el problema
7. estructura que cree que debería separarse
8. duda concreta si existe

No debe pegar toda la norma.

Esto permite que ChatGPT prepare un prompt más concreto para Codex.

---

# 10. VERIFICACIÓN DE INTEGRIDAD EN PREVIEW.MD

El preview.md debe incluir al final una sección:

## VERIFICACIÓN DE INTEGRIDAD

Debe indicar:

- Resultado: APTO PARA REVISIÓN / NO APTO
- Texto jurídico procedente de BOE/XML: OK
- Preview JSON sin instrucciones: OK
- Fragmentos con instrucciones del preview: 0
- Fragmentos vacíos/decorativos: 0
- Fragmentos no literales/contiguos detectados: 0
- Texto añadido o inventado: 0
- Texto jurídico reescrito: 0
- Supabase no tocado: OK
- Embeddings no generados: OK
- Subida real no ejecutada: OK

No usar expresiones tipo:
- “certificado legal”
- “conforme con la normativa”

Porque no es una certificación jurídica.  
Es una verificación técnica de integridad del preview.

---

# 11. COMANDO BASE PARA LISTAR NORMAS

Comando usado para ver el estado real de Supabase:

node -e "require('dotenv').config({path:'.env.local'}); const {createClient}=require('@supabase/supabase-js'); const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY); s.from('normas').select('id,codigo,titulo,estado_ingesta,num_fragmentos,url_fuente,document_hash').order('id',{ascending:true}).then(r=>console.log(JSON.stringify(r.data,null,2), r.error))"

Estado esperado ahora:
deben aparecer RD-513-2017 id=38 y RD-486-1997 id=39.

---

# 12. IMPORTADOR BOE

Archivo principal:

tools/import-boe-norma.mjs

Estado:
- validado como vía principal de ingesta
- usa BOE/XML oficial
- genera preview
- permite dry-run
- permite validate-preview
- permite write-plan
- permite execute-upload con confirmación
- no debe escribir sin confirmación
- genera preview.md con instrucciones de revisión
- genera preview.md con verificación de integridad
- mantiene BOE ID dinámico
- evita referencias fijas incorrectas

Último commit relevante antes de esta fase:
9a2b818 Improve BOE import codes and Anexo II ranking

Cambios pendientes de commit:
- mejoras de instrucciones de preview
- flujo Gemini/ChatGPT/Codex
- regla anti-comandos manuales
- evidencia textual obligatoria
- verificación de integridad
- mejoras de segmentación detectadas durante RD-486

No hacer commit sin permiso.

---

# 13. FLUJO OBLIGATORIO PARA CADA NORMA NUEVA

Para cada norma:

FASE 1 — Preparar preview

Primer paso para cualquier norma BOE:

Ejecutar directamente en terminal de Antigravity:

node tools/import-boe-norma.mjs --boe-id BOE-A-XXXX-YYYY --dry-run

Ejemplo RD-505-2007:

node tools/import-boe-norma.mjs --boe-id BOE-A-2007-9607 --dry-run

No hace falta pedir a Codex para generar un preview normal.

Codex solo se usa si:
- Gemini detecta fallos;
- ChatGPT detecta fallos;
- hay que modificar el importador;
- hay que verificar una duda técnica en archivos locales.

Durante esta fase:
- no tocar Supabase
- no generar embeddings
- no hacer subida real
- no hacer commit

FASE 2 — Revisar preview
Revisar con Gemini/ChatGPT:
- si los artículos están completos
- si el texto es literal
- si hay bloques vacíos
- si los anexos están bien separados
- si hay índices o decoración
- si faltan artículos
- si los fragmentos tienen sentido
- si partes A), B), C) están bien separadas
- si hay tablas mal divididas
- si la norma está vigente o derogada

FASE 3 — Corregir si hace falta
Si hay fallo:
- no subir
- preparar prompt para Codex
- corregir importador
- repetir dry-run
- regenerar preview.md
- volver a revisar

FASE 4 — Subida real controlada

Solo si está apta y ChatGPT da OK final.

La subida real debe hacerse preferentemente con prompt corto a Codex, no como simple comando manual sin verificación posterior.

Codex debe:
- localizar o usar el comando correcto del importador
- ejecutar la subida real con confirmación
- no subir el preview.md
- subir norma, fragmentos, metadatos y embeddings
- comprobar id Supabase creado
- comprobar fragmentos insertados
- comprobar embeddings generados
- comprobar que no haya duplicados
- comprobar artículos especiales si existen: bis, ter, quater
- ejecutar pruebas reales en /api/ask
- no modificar código salvo fallo confirmado y autorizado
- no hacer commit

Comando base de subida real BOE:

node tools/import-boe-norma.mjs --boe-id BOE-A-XXXX-YYYY --confirm-upload --execute-upload --codigo CODIGO-NORMA

Ejemplo Ley 31/1995:

node tools/import-boe-norma.mjs --boe-id BOE-A-1995-24292 --confirm-upload --execute-upload --codigo LEY-31-1995

Regla:
el comando puede ejecutarlo Codex o Antigravity, pero la norma no queda VALIDADA hasta superar las pruebas reales posteriores.

FASE 5 — Pruebas reales obligatorias

Después de subir, hacer como mínimo:

1. artículo exacto normal
2. artículo especial si existe: bis / ter / quater
3. pregunta práctica
4. pregunta “No consta”
5. comprobación de fuentes visibles

Si una prueba falla:
- no tocar corpus automáticamente
- diagnosticar si el fallo es de ingesta, Supabase, /api/ask o frontend
- preparar prompt cerrado para Codex
- no dar la norma como VALIDADA hasta resolverlo
FASE 6 — Guardar foto fija
Registrar:
- norma
- BOE ID
- id Supabase
- fragmentos
- embeddings
- pruebas realizadas
- resultado
- incidencias
- correcciones hechas si las hubo

---

# 14. ORDEN RECOMENDADO PARA REIMPORTAR NORMAS

Normas BOE/estatales prioritarias:

1. RD-505-2007
   - accesibilidad
   - BOE-A-2007-9607

2. RD-164-2025
   - nuevo RSCIEI vigente
   - BOE-A-2025-7190

3. Ley 31/1995
   - prevención de riesgos laborales
   - BOE-A-1995-24292

4. RD 39/1997
   - Reglamento de Servicios de Prevención
   - BOE-A-1997-1853

5. RD 1627/1997
   - seguridad y salud en obras
   - BOE-A-1997-22614

6. RD 105/2008
   - residuos de construcción y demolición
   - BOE-A-2008-2486

7. RITE
   - Reglamento de Instalaciones Térmicas en los Edificios
   - BOE-A-2007-15820

8. REBT
   - Reglamento Electrotécnico para Baja Tensión
   - BOE-A-2002-18099

9. Código Estructural
   - BOE-A-2021-13681

10. CTE completo / DB-SI / DB-SUA
   - requiere especial cuidado por estructura técnica, DBs, tablas y documentos separados

No subir muchas normas de golpe.

---

# 15. NORMAS NO BOE / FASE POSTERIOR

Dejar para después de las BOE estatales:

- PGOU Zaragoza
- Ordenanza municipal de edificación Zaragoza
- Ordenanza municipal de protección medio ambiente Zaragoza
- Ordenanza municipal ruido Zaragoza
- Ordenanza municipal garajes Zaragoza
- Ley de protección ambiental de Aragón
- Reglamento de accesibilidad DGA
- normativa autonómica o municipal adicional

Motivo:
conviene cerrar primero el flujo BOE/XML estatal y después adaptar ingesta para BOA, Zaragoza, ordenanzas o PDFs no BOE.

---

# 16. NORMAS DEROGADAS

No subir como vigentes normas derogadas.

Caso importante:

RD-2267-2004
- antiguo RSCIEI
- derogado desde 2025-05-10
- sustituido por RD-164-2025
- no debe subirse como norma vigente principal

Podría subirse en el futuro solo si existe gestión explícita de histórico/vigencia, pero no ahora.

---

# 17. ESTADO DEL BUSCADOR

El buscador sigue funcionando.

Capacidades actuales:
- búsqueda semántica
- recuperación por artículo exacto
- RAG
- fuentes exactas
- panel de fuentes
- mapa normativo basado en sources
- respuesta “No consta”
- generación de informe técnico
- admin de normas cargadas

Regla:
no tocar /api/ask salvo fallo claro.

---

# 18. /api/ask

Estado:
estable.

No tocar salvo necesidad real.

Antes de tocar /api/ask:
- comprobar Vercel Logs
- reproducir error
- confirmar que no es problema de corpus
- confirmar que no es problema de ingesta
- preparar cambio mínimo con Codex

Regla:
el corpus limpio va antes que modificar búsqueda.

---

# 19. FRONTEND

Estado:
funcional.

Incluye:
- pantalla de consulta
- respuesta estructurada
- criterio práctico
- fundamento normativo
- fuentes citadas
- panel derecho de fuentes
- mapa normativo visual
- botón de informe técnico

No tocar frontend en esta fase salvo fallo claro.

## Incidencia cerrada — duplicación visual de respuestas

Fecha: 2026-05-16

Problema:
Algunas consultas literales, por ejemplo:
“Dime literalmente qué dice el artículo 1 del RD-164-2025”

mostraban el mismo contenido dos veces en pantalla.

Diagnóstico:
- /api/ask devolvía una sola respuesta correcta.
- Supabase, corpus, embeddings, ranking e ingesta estaban bien.
- El fallo estaba en el frontend, en `src/components/Main/QueryPanel.tsx`.
- En respuestas no estructuradas, el bloque “Criterio práctico” podía repetir exactamente el mismo texto que la respuesta completa.

Corrección:
- Se ajustó `QueryPanel.tsx` para no mostrar “Criterio práctico” cuando sea idéntico a la respuesta completa.
- También se evita mostrar “Respuesta breve” si duplica el criterio en respuestas estructuradas.

Validación:
- `npx.cmd tsc --noEmit` → OK
- `npx.cmd eslint src/components/Main/QueryPanel.tsx` → OK
- Prueba en pantalla con RD-164-2025 artículo 1 → OK
- Fuentes siguen visibles correctamente.

Estado:
CERRADO

---

# 20. ADMIN DE NORMAS

Existe zona admin:

/admin/normas-cargadas

Permite ver normas cargadas.

Estado:
funcional.

Pendiente futuro:
- campo de validación manual
- estado tipo “validada”
- notas admin
- fecha de revisión
- botón o flujo de reimportación controlada
- mostrar fuente BOE y vigencia de forma más clara

---

# 21. INFORME TÉCNICO CON IA

Existe API:

/api/report

Estado:
implementado y validado previamente.

Sirve para generar informe técnico orientativo desde una respuesta.

Estructura:
- Objeto
- Antecedentes / consulta
- Normativa utilizada
- Análisis técnico
- Criterio aplicable
- Puntos a comprobar
- Conclusión práctica
- Limitaciones
- Advertencia profesional

Regla:
el informe depende de buenas fuentes.
Primero corpus limpio, después informes mejores.

---

# 22. IA BARATA — FASE FUTURA NECESARIA

Queda pendiente implementar una capa de IA barata.

No hacerlo todavía.
Primero terminar de reconstruir el corpus base.

Objetivo futuro:
mejorar lectura de preguntas complicadas y mejorar la respuesta final sin tocar el texto jurídico.

Posibles usos de IA barata:

1. Antes de buscar:
- corregir faltas de la pregunta
- entender preguntas mal escritas
- detectar si hay varias preguntas en una
- separar preguntas múltiples
- detectar norma mencionada
- detectar materia
- detectar ciudad/ámbito
- detectar si pide artículo exacto
- detectar si pide comparativa
- detectar si pregunta algo que no está en corpus

2. Durante recuperación:
- preparar mejor la consulta
- generar sinónimos controlados
- identificar términos técnicos relacionados
- ayudar a elegir filtros
- mejorar ranking previo sin inventar contenido

3. Después de recuperar fuentes:
- redactar respuesta clara
- resumir con lenguaje profesional
- mantener citas
- decir “No consta” si las fuentes no soportan la respuesta
- preparar informe técnico
- preparar checklist

Regla:
la IA barata no debe inventar normativa.
La respuesta final siempre debe depender de fuentes recuperadas.

Modelo secundario previsto:
- MiniMax M2.7 como opción secundaria
- Qwen como opción a probar para costes
- OpenAI barato/nano para preprocesado si interesa

Pero ahora:
NO implementar esto hasta tener varias normas BOE limpias y validadas.

---

# 23. TABLAS PRINCIPALES

Tabla normas:

Campos importantes:
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
- num_articulos_detectados
- num_anexos_detectados
- num_embeddings_generados
- document_hash
- version_of
- fecha_ingesta
- materia
- submateria
- keywords

Tabla normas_partes:

Campos importantes:
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

Dato importante:
los embeddings están dentro de normas_partes.embedding.
No hay tabla separada de embeddings en el flujo actual.

---

# 24. REGLAS DE FRAGMENTACIÓN

La fragmentación debe respetar unidades jurídicas reales:

- artículo
- disposición adicional
- disposición transitoria
- disposición derogatoria
- disposición final
- anexo
- parte A), B), C)
- capítulo/sección si aporta estructura real
- apartados numerados
- tablas si son importantes

Evitar:
- partir frases por la mitad
- crear fragmentos con solo títulos si no aportan nada
- meter índices
- mezclar anexos distintos
- fragmentos enormes sin necesidad
- fragmentos minúsculos sin contenido útil
- texto de navegación BOE
- pies de página
- cabeceras repetidas
- que una parte B quede pegada al último apartado de la parte A
- que un apartado desaparezca absorbido por otro

---

# 25. CRITERIO PARA BORRAR Y REIMPORTAR

Si una norma:
- viene de sistema antiguo
- está duplicada
- tiene cortes malos
- no tiene fuente BOE clara
- tiene texto contaminado
- mezcla índice con contenido
- tiene anexos mal partidos
- genera dudas serias

Entonces:
borrar y reimportar desde BOE/XML si existe fuente oficial.

Preferencia:
borrar/reimportar limpio antes que hacer apaños.

---

# 26. FORMA DE TRABAJAR CON CODEX

Para cambios de código:

1. Primero diagnosticar.
2. No pedir código todavía si no está claro.
3. Cuando esté claro, preparar prompt cerrado para Codex.
4. Codex modifica.
5. Codex ejecuta dry-run o prueba obligatoria.
6. Codex regenera preview.md si aplica.
7. Revisar resultado.
8. Subir a Supabase solo con confirmación.
9. Commit solo con permiso.

No hacer commits sin permiso.

---

# 27. FORMA DE TRABAJAR EN TERMINAL

El terminal se usa en Antigravity.

El usuario prefiere:
- respuestas cortas
- sin tecnicismos
- una fase clara por respuesta
- un solo paso por respuesta
- comandos listos para copiar

---

# 28. PROBLEMAS HISTÓRICOS IMPORTANTES

Problemas ya vistos:

- PDFs BOE generan cortes malos si se parsean mal
- índices BOE pueden colarse como texto
- anexos técnicos son difíciles
- partes B pueden quedar absorbidas por la parte A
- apartados numerados pueden desaparecer si el patrón de corte falla
- normas antiguas pueden contaminar resultados
- duplicados hacen que el buscador mezcle fuentes
- algunas consultas temáticas dependen mucho de la calidad del corpus
- OpenAI no debe copiar texto jurídico completo
- Vercel puede dar timeout con PDFs grandes
- la subida libre de usuarios no es adecuada para MVP

Conclusión:
el MVP debe ser biblioteca jurídica administrada.

---

# 29. DECISIÓN DE PRODUCTO

Normativas IA no debe ser un “ChatGPT genérico”.

Debe ser:

asistente técnico normativo con fuentes oficiales, informes y checklist de cumplimiento.

Diferenciadores:
- fuentes oficiales
- artículos exactos
- “No consta” cuando no hay soporte
- informes técnicos
- checklists de cumplimiento
- expedientes futuros
- normativa estatal/autonómica/local
- control admin de normas
- vigencia y derogaciones
- corpus curado

---

# 30. FASE ACTUAL

Fase activa:

RECONSTRUIR CORPUS LIMPIO NORMA A NORMA

Estado actual:
- corpus limpiado
- RD-513-2017 validado
- RD-486-1997 validado
- siguiente paso: reimportar RD-505-2007 desde BOE/XML con revisión previa

No hacer ahora:
- no implementar IA barata todavía
- no tocar frontend
- no tocar /api/ask
- no subir muchas normas de golpe
- no cambiar stack
- no hacer commits sin permiso

---

# 31. SIGUIENTE PASO RECOMENDADO

Siguiente norma recomendada:

RD-505-2007  
BOE-A-2007-9607

Pruebas mínimas:
1. ¿Qué dice el artículo 1 del RD-505-2007?
2. ¿Qué condiciones básicas de accesibilidad establece el RD-505-2007?
3. ¿Qué dice el RD-505-2007 sobre extintores?

---

# 32. RESUMEN FINAL

Estado real actual:

- MVP técnico sigue funcionando
- buscador funciona
- fuentes funcionan
- informe técnico existe
- admin existe
- corpus fue limpiado por completo
- RD-513-2017 id=38 validado
- RD-486-1997 id=39 validado
- siguiente trabajo: reimportar RD-505-2007 desde BOE/XML con preview y revisión previa
- más adelante faltará implementar IA barata para leer preguntas complejas y mejorar respuestas

---

# 33. NORMAS VALIDADAS

## RD-513-2017 — VALIDADA

Fecha validación: 2026-05-15  
BOE ID: BOE-A-2017-6606  
Supabase id: 38  
Fragmentos: 135  
Embeddings: 135  
Origen: BOE/XML oficial  

Pruebas producción:
1. ¿Qué dice el artículo 22 del RD-513-2017? → OK
2. ¿Qué dice el Anexo II sobre hidrantes según el RD-513-2017? → OK
3. ¿Qué dice el RD-513-2017 sobre piscinas públicas? → No consta → OK

Estado:
VALIDADA

---

## RD-486-1997 — VALIDADA

Fecha validación: 2026-05-15  
BOE ID: BOE-A-1997-8669  
Supabase id: 39  
Fragmentos: 54  
Embeddings: 54  
Origen: BOE/XML oficial  

Proceso:
- dry-run BOE ejecutado
- preview.md revisado con Gemini
- correcciones de segmentación hechas con Codex
- añadido bloque de verificación de integridad al preview.md
- Gemini dio OK PARA SUBIR
- ChatGPT hizo revisión final
- subida real ejecutada correctamente

Correcciones realizadas durante validación:
- recuperado apartado 9 del Anexo I
- separada Parte B del Anexo I
- separado Anexo V Parte B
- dividido Anexo VI en cabecera, Parte A, apartados internos y Parte B
- limpiado source_label largo del apartado 9
- mantenido texto jurídico literal y contiguo

Pruebas producción:
1. ¿Qué dice el artículo 7 del RD-486-1997? → OK
2. ¿Qué temperatura deben tener los locales de trabajo cerrados según el RD-486-1997? → OK, fuente principal ANEXO III
3. ¿Qué dice el RD-486-1997 sobre piscinas públicas? → No consta → OK

Estado:
VALIDADA

## RD-505-2007 — VALIDADA

Fecha validación: 2026-05-16
BOE ID: BOE-A-2007-9607
Supabase id: 40
Fragmentos: 33
Embeddings: 33
Origen: BOE/XML oficial

Proceso:
- dry-run BOE ejecutado
- preview.md revisado con Gemini
- Gemini dio OK PARA SUBIR
- revisión final realizada
- subida real ejecutada correctamente
- sin duplicados detectados

Pruebas producción:
1. ¿Qué dice el artículo 1 del RD-505-2007? → OK
2. ¿Qué condiciones básicas de accesibilidad establece el RD-505-2007? → OK
3. ¿Qué dice el RD-505-2007 sobre extintores? → No consta → OK

Estado:
VALIDADA


## RD-164-2025 — VALIDADA

Fecha validación: 2026-05-16
BOE ID: BOE-A-2025-7190
Supabase id: 41
Fragmentos: 202
Embeddings: 202
Origen: BOE/XML oficial

Proceso:
- dry-run BOE ejecutado
- preview.md revisado con Gemini
- detectados títulos huérfanos y corregida la segmentación
- instrucciones del preview reforzadas para exigir evidencia completa
- nuevo preview generado correctamente
- Gemini dio OK PARA SUBIR
- subida real ejecutada correctamente
- sin duplicados detectados

Pruebas producción:
1. ¿Qué dice el artículo 1 del RD-164-2025? → OK
2. ¿Qué medidas contra incendios exige el RD-164-2025 para establecimientos industriales? → OK
3. ¿Qué dice el RD-164-2025 sobre piscinas públicas? → No consta → OK
4. ¿Qué dice el Anexo III del RD-164-2025 sobre extintores de incendio? → OK

Incidencia observada:
- La consulta sobre accesibilidad para personas con discapacidad recuperó contenido real sobre acceso de bomberos/SEIS, no texto inventado, pero muestra que más adelante conviene mejorar la interpretación de preguntas ambiguas.

Estado:
VALIDADA

## Ley 31/1995 — VALIDADA

Fecha validación: 2026-05-17  
BOE ID: BOE-A-1995-24292  
Supabase id: 42  
Código: LEY-31-1995  
Fragmentos: 91  
Embeddings: 91  
Artículos detectados: 55  
Anexos detectados: 0  
Origen: BOE/XML oficial  

Proceso:
- dry-run BOE ejecutado
- preview.md revisado con Gemini
- detectado fallo de metadatos en Artículo 32 bis
- corregido importador para conservar sufijos de artículo como bis / ter / quater
- nuevo preview generado correctamente
- Gemini dio OK PARA SUBIR
- subida real ejecutada correctamente
- no se subió preview.md
- norma, fragmentos, metadatos y embeddings insertados correctamente

Incidencia corregida:
- El Artículo 32 bis estaba bien subido en Supabase, pero /api/ask detectaba “32” en vez de “32 bis”.
- Se corrigió `src/app/api/ask/route.ts` para reconocer artículos con sufijos bis / ter / quater.
- No se tocó corpus, Supabase, ingesta, embeddings, frontend ni SQL.

Pruebas producción:
1. ¿Qué dice el artículo 14 de la Ley 31/1995? → OK, fuente Artículo 14
2. ¿Qué dice el artículo 32 de la Ley 31/1995? → OK, fuente Artículo 32
3. ¿Qué dice el artículo 32 bis de la Ley 31/1995? → OK, fuente Artículo 32 bis
Auditoría posterior:
- Se revisaron las normas ya cargadas:
  - RD-513-2017 id=38
  - RD-486-1997 id=39
  - RD-505-2007 id=40
  - RD-164-2025 id=41
  - LEY-31-1995 id=42
- Solo se detectó un artículo especial con sufijo:
  - LEY-31-1995 — Artículo 32 bis
- No existen artículos ter ni quater en las normas auditadas.
- /api/ask responde correctamente a artículos normales y al Artículo 32 bis.
- No se detectaron mezclas entre Artículo 32 y Artículo 32 bis.
- No se detectó ningún “No consta” incorrecto.

Resultado:
AUDITORÍA OK

Estado:
VALIDADA

## RD-39-1997 — VALIDADA

Fecha validación: 2026-05-17  
BOE ID: BOE-A-1997-1853  
Supabase id: 43  
Código: RD-39-1997  
Fragmentos: 92  
Embeddings: 92  
Artículos detectados: 45  
Anexos detectados: 8  
Origen: BOE/XML oficial  

Proceso:
- dry-run BOE ejecutado
- preview.md revisado con Gemini
- detectados fallos iniciales de integridad en SECCION 1 y SECCION 2
- corregido importador para evitar etiquetas técnicas dentro del campo texto
- detectada hiperfragmentación asimétrica en ANEXO VI
- corregido importador para mantener compacta la parte “II. Especialización optativa”
- reforzadas instrucciones del preview.md para hacerlo autosuficiente
- nuevo preview generado correctamente
- Gemini dio OK PARA SUBIR
- subida real ejecutada correctamente
- no se subió preview.md
- norma, fragmentos, metadatos y embeddings insertados correctamente

Pruebas producción:
1. ¿Qué dice el artículo 1 del RD-39-1997? → OK, fuente Artículo 1
2. ¿Cuándo debe una empresa tener servicio de prevención propio según el RD-39-1997? → OK, fuente principal Artículo 14
3. ¿Qué dice el RD-39-1997 sobre piscinas públicas? → No consta → OK

Estado:
VALIDADA

---

# FIN DE FOTO FIJA