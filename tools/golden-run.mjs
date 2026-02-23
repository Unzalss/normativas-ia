import { createClient } from '@supabase/supabase-js';

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ASK_URL = process.env.ASK_URL || 'http://localhost:3000/api/ask';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Error: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorios.');
    process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function getSources(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.sources)) return data.sources;
    if (Array.isArray(data.data)) return data.data; // Common in our API
    if (data.data && Array.isArray(data.data.sources)) return data.data.sources;
    if (Array.isArray(data.fuentes)) return data.fuentes;
    if (Array.isArray(data.evidence)) return data.evidence;
    if (Array.isArray(data.results)) return data.results;
    return [];
}

function getScore(item) {
    if (typeof item.score === 'number') return item.score;
    if (typeof item.similarity === 'number') return item.similarity;
    if (typeof item.relevance === 'number') return item.relevance;
    if (item.meta && typeof item.meta.score === 'number') return item.meta.score;
    return 0;
}

function getCodigo(item) {
    if (item.codigo) return item.codigo;
    if (item.norma_codigo) return item.norma_codigo;
    if (item.norma && item.norma.codigo) return item.norma.codigo;
    return null;
}

async function runGoldenTests() {
    console.log('Iniciando Golden Tests Runner...');
    console.log(`Endpoint destino: ${ASK_URL}`);

    // Fetch tests
    const { data: tests, error: fetchError } = await supabase
        .from('golden_tests')
        .select('*')
        .order('id', { ascending: true });

    if (fetchError) {
        console.error('Error obteniendo golden_tests:', fetchError);
        process.exit(1);
    }

    if (!tests || tests.length === 0) {
        console.log('No se encontraron tests en la tabla golden_tests.');
        return;
    }

    console.log(`Se encontraron ${tests.length} tests. Ejecutando...`);

    let passCount = 0;
    const failList = [];

    for (const test of tests) {
        // console.log(`Ejecutando Test #${test.id}: "${test.pregunta}"`);

        let rawResponse = {};
        let isGroundedFailure = false;

        // Call API
        try {
            const resp = await fetch(ASK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: test.pregunta,
                    normaId: test.norma_id || null
                })
            });

            rawResponse = await resp.json();

            // Determine if 'No consta' triggered
            if (rawResponse.message && rawResponse.message.toLowerCase().includes('no consta')) {
                isGroundedFailure = true;
            } else if (rawResponse.answer && rawResponse.answer.toLowerCase().includes('no consta')) {
                isGroundedFailure = true;
            } else if (rawResponse.text && rawResponse.text.toLowerCase().includes('no consta')) {
                isGroundedFailure = true;
            } else if (rawResponse.respuesta && rawResponse.respuesta.toLowerCase().includes('no consta')) {
                isGroundedFailure = true;
            }
        } catch (e) {
            console.error(`Error llamando a la API para Test #${test.id}:`, e);
            rawResponse = { error: e.message };
        }

        // Extract metrics
        const sources = getSources(rawResponse);
        let topScore = 0;
        let countGe070 = 0;
        let countGe060 = 0;
        const returnedNormasSet = new Set();

        for (const source of sources) {
            const score = getScore(source);
            if (score > topScore) topScore = score;
            if (score >= 0.70) countGe070++;
            if (score >= 0.60) countGe060++;

            const codigo = getCodigo(source);
            if (codigo) returnedNormasSet.add(codigo);
        }

        const returnedNormas = Array.from(returnedNormasSet);

        // Evaluate Pass/Fail
        let pass = false;

        if (test.must_ground === false) {
            pass = isGroundedFailure; // Pass SI falla en el grounding (devuelve "No consta...")
        } else {
            // must_ground true
            const hasMinTopScore = topScore >= (test.expected_min_top_score || 0);
            const hasMinFragments = countGe060 >= (test.expected_min_fragments_over_060 || 0);
            const hasExpectedNorma = !test.expected_norma_codigo || returnedNormas.includes(test.expected_norma_codigo);

            pass = !isGroundedFailure && hasMinTopScore && hasMinFragments && hasExpectedNorma;
        }

        if (pass) {
            passCount++;
            process.stdout.write('✅ ');
        } else {
            process.stdout.write('❌ ');
            failList.push({
                id: test.id,
                pregunta: test.pregunta,
                must_ground: test.must_ground,
                expected: {
                    min_top_score: test.expected_min_top_score,
                    min_frag_060: test.expected_min_fragments_over_060,
                    norma: test.expected_norma_codigo
                },
                actual: {
                    isGroundedFailure,
                    topScore,
                    countGe060,
                    returnedNormas
                }
            });
        }

        // Insert into golden_runs
        const { error: insertError } = await supabase
            .from('golden_runs')
            .insert({
                test_id: test.id,
                pass: pass,
                top_score: topScore,
                count_ge_070: countGe070,
                count_ge_060: countGe060,
                returned_normas: returnedNormas,
                raw_response: rawResponse
            });

        if (insertError) {
            console.error(`\nError insertando el run para Test #${test.id}:`, insertError.message);
        }
    }

    // Summary
    console.log(`\n\n=== RESUMEN GOLDEN TESTS ===`);
    console.log(`Total: ${tests.length}`);
    console.log(`✅ PASS: ${passCount}`);
    console.log(`❌ FAIL: ${tests.length - passCount}`);

    if (failList.length > 0) {
        console.log(`\nDetalle de Fallos:`);
        failList.forEach(fail => {
            console.log(`- Test #${fail.id}: "${fail.pregunta}"`);
            if (fail.must_ground === false) {
                console.log(`   Razón: Se esperaba fallo de grounding ("No consta..."), pero dio respuesta afirmativa.`);
            } else {
                if (fail.actual.isGroundedFailure) {
                    console.log(`   Razón: Devolvió "No consta..." pero se esperaba respuesta fundamentada.`);
                } else {
                    console.log(`   Razón: No alcanzó umbrales. TopScore: ${fail.actual.topScore.toFixed(3)} (esperado >= ${fail.expected.min_top_score}), Frag >=0.60: ${fail.actual.countGe060} (esperado >= ${fail.expected.min_frag_060}), Norma esperada: ${fail.expected.norma || 'N/A'}`);
                }
            }
        });
    }
}

runGoldenTests().catch(console.error);
