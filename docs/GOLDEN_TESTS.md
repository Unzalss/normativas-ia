# Golden Tests Runner

Este repositorio incluye una suite automatizada para evaluar la precisión del endpoint `/api/ask` frente a un conjunto de pruebas predefinidas (Golden Tests) alojadas en Supabase (`golden_tests`). El resultado de cada ejecución se registra históricamente en la tabla `golden_runs` para auditar regresiones.

## Requisitos Previos

Antes de ejecutar los tests, necesitas definir las siguientes variables de entorno. 
**Importante:** Nunca expongas la `SUPABASE_SERVICE_ROLE_KEY` en el frontend público de Vercel. Úsala solo para este entorno de terminal/CI.

```bash
# Exportar credenciales en tu terminal (Ejemplo para Linux/macOS)
export SUPABASE_URL="https://tu-proyecto.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="tu-service-role-key-secreta"

# Opcional (por defecto apunta a localhost)
export ASK_URL="http://localhost:3000/api/ask"
```

En Windows (PowerShell), utiliza:
```powershell
$env:SUPABASE_URL="https://tu-proyecto.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="tu-service-role-key-secreta"
$env:ASK_URL="http://localhost:3000/api/ask"
```

## Ejecución

Para iniciar el runner:

```bash
node tools/golden-run.mjs
```

### Comportamiento

El script:
1. Lee las preguntas y expectativas desde `golden_tests`.
2. Llama al endpoint `POST /api/ask`.
3. Comprueba si la respuesta fue cortada por el **Grounding Gate** estricto (`No consta en la normativa...`).
4. Extrae métricas relevantes de los fragmentos devueltos (top score, conteo >= 0.70 y >=0.60, normativas retornadas).
5. Evalúa la condición `PASS`/`FAIL` de acuerdo al parámetro `must_ground` detallado en la base de datos.
6. Registra este intento permanentemente en la tabla `golden_runs`.
7. Imprime el resumen por consola detallando por qué han fallado los tests problemáticos.

## Consulta de Resultados

Para analizar la evolución de tus iteraciones RAG, puedes usar esta SQL en el Editor de Supabase:

```sql
SELECT 
  gr.created_at, 
  gr.pass, 
  gt.pregunta, 
  gr.top_score, 
  gr.count_ge_070, 
  gr.count_ge_060
FROM golden_runs gr
JOIN golden_tests gt ON gr.test_id = gt.id
ORDER BY gr.created_at DESC
LIMIT 50;
```
