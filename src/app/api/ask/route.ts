import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const K_GLOBAL = 12;
const K_PER_NORMA = 6;
const MAX_NORMAS = 50;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    try {
        const xDebug = req.headers.get("x-debug") === "1";
        const { question, normaId, normaCodigo = null, k = 12 } = await req.json();

        if (!question) {
            return NextResponse.json({ error: "Falta question" }, { status: 400 });
        }

        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Parse normaId explicitly to ensure global searches
        let parsedNormaId: number | null = null;

        if (normaCodigo) {
            const codigoNormalizado = (normaCodigo ?? "")
                .trim()
                .replace(/\s+/g, " ");

            const { data: normaRow, error: normaError } = await supabase
                .from("normas")
                .select("id")
                .ilike("codigo", codigoNormalizado)
                .limit(1)
                .maybeSingle();

            if (normaError) {
                return NextResponse.json(
                    { ok: false, error: "Error consultando tabla normas", detalle: normaError.message },
                    { status: 500 }
                );
            }

            if (!normaRow?.id) {
                return NextResponse.json(
                    { ok: false, error: "normaCodigo no encontrado en tabla normas", normaCodigo: codigoNormalizado },
                    { status: 400 }
                );
            }

            parsedNormaId = normaRow.id;
        } else if (normaId !== null && normaId !== undefined && normaId !== "" && String(normaId) !== "all") {
            const num = Number(normaId);
            if (!isNaN(num)) parsedNormaId = num;
        }

        const debugInfo: any = {
            normaCodigoRecibido: normaCodigo,
            normaIdResuelto: parsedNormaId,
            rpcLlamado: "buscar_norma_partes",
            rowsLength: 0,
            rpcParamErrors: null
        };

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const embeddingRes = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: question,
            dimensions: 1536,
        });

        const q_embedding = embeddingRes.data[0].embedding;

        const isValidFragment = (text: string) => {
            if (text.length < 80) return false;
            if (/\.{5,}/.test(text)) return false; // Sequence of dots (index)
            if (/\s\d{1,3}\s*$/.test(text)) return false; // Ends in page number
            return true;
        };

        const getScore = (row: any) => {
            if (typeof row.score === 'number') return row.score;
            if (typeof row.similarity === 'number') return row.similarity;
            if (typeof row.distance === 'number') return -row.distance;
            return 0;
        };

        const busquedaGlobal = async (qEmbedding: number[]) => {
            const { data: normas } = await supabase.from("normas").select("id,codigo").limit(MAX_NORMAS);
            if (!normas || normas.length === 0) return [];
            console.log(`[GLOBAL] Buscando en ${normas.length} normas...`);

            const promises = normas.map(norma =>
                supabase.rpc("buscar_norma_partes", {
                    q_embedding: qEmbedding,
                    q_norma_id: norma.id,
                    k: K_PER_NORMA
                }).then(res => res.data || [])
            );

            const resultsArray = await Promise.all(promises);
            const flatResults = resultsArray.flat();

            const deduplicated = new Map();
            for (const row of flatResults) {
                const key = row.parte_id || row.id;
                if (!deduplicated.has(key)) {
                    deduplicated.set(key, row);
                }
            }

            const sorted = Array.from(deduplicated.values()).sort((a, b) => getScore(b) - getScore(a));
            return sorted.slice(0, K_GLOBAL);
        };

        let rawData: any[] = [];

        if (parsedNormaId !== null) {
            console.log(`[NORMA] Búsqueda en norma ${parsedNormaId}`);
            // First attempt with requested k
            // The RPC "buscar_norma_partes" accepts: q_embedding, q_norma_id, k.
            const rpcPayload = {
                q_embedding,
                q_norma_id: parsedNormaId,
                k
            };

            const { data, error } = await supabase.rpc("buscar_norma_partes", rpcPayload);

            console.log("--- Búsqueda en Supabase 1 ---");
            console.log(`norma_id: ${parsedNormaId}, limit(k): ${k}`);
            if (error) {
                console.error("Error RPC 1:", error.message, error.details);
                debugInfo.rpcParamErrors = error;
                return NextResponse.json({ error: `Supabase RPC Error: ${error.message} - ${error.details}`, debug: xDebug ? debugInfo : undefined }, { status: 500 });
            }

            rawData = data || [];
            debugInfo.rowsLength = rawData.length;
            console.log(`Filas devueltas 1: ${rawData.length}`);
        } else {
            console.log(`[GLOBAL] Iniciando búsqueda global...`);
            rawData = await busquedaGlobal(q_embedding);
            debugInfo.rowsLength = rawData.length;
            console.log(`Filas devueltas (Global al final): ${rawData.length}`);
        }

        let validData = (rawData || []).filter((item: any) => isValidFragment(item.content || item.texto || ""));

        // If not enough valid results, try fetching more (sólo para búsquedas de una norma)
        if (validData.length < k && parsedNormaId !== null) {
            const kRetry = k * 3;
            debugInfo.limitRetry = kRetry;

            const { data: retryData, error: retryError } = await supabase.rpc("buscar_norma_partes", {
                q_embedding,
                q_norma_id: parsedNormaId,
                k: kRetry
            });

            console.log("--- Búsqueda en Supabase 2 (Retry) ---");
            console.log(`norma_id: ${parsedNormaId}, limit(kRetry): ${kRetry}`);
            if (retryError) {
                console.error("Error RPC 2:", retryError.message, retryError.details);
                debugInfo.rpcParamErrorsRetry = retryError;
                return NextResponse.json({ error: `Supabase RPC Retry Error: ${retryError.message} - ${retryError.details}`, debug: xDebug ? debugInfo : undefined }, { status: 500 });
            }

            debugInfo.filasDevueltas2 = retryData?.length || 0;
            console.log(`Filas devueltas 2: ${retryData?.length || 0}`);

            if (!retryError && retryData) {
                validData = retryData.filter((item: any) => isValidFragment(item.content || item.texto || ""));
            }
        }

        // HYBRID SEARCH: Text exact match
        let textResults: any[] = [];
        let searchTerm = null;
        const quoteMatch = question.match(/"([^"]+)"/);
        if (quoteMatch) {
            searchTerm = quoteMatch[1];
        } else {
            const keywordMatch = question.match(/(art(?:í|i)culo\s+\d+|art\.\s*\d+|disposici(?:ó|o)n\s+[\w]+|anexo\s+[\w]+|cap(?:í|i)tulo\s+[\w]+)/i);
            if (keywordMatch) {
                searchTerm = keywordMatch[0];
            }
        }

        if (searchTerm) {
            console.log(`[TEXT SEARCH] Búsqueda exacta para: ${searchTerm}`);
            let textQuery = supabase
                .from('normas_partes')
                .select('id, norma_id, tipo, seccion, texto, normas!inner(codigo, titulo)')
                .or(`texto.ilike.%${searchTerm}%,seccion.ilike.%${searchTerm}%`)
                .limit(k * 2);

            if (parsedNormaId !== null) {
                textQuery = textQuery.eq('norma_id', parsedNormaId);
            }

            const { data: txtData, error: txtError } = await textQuery;
            if (txtError) {
                console.error("Text search error:", txtError);
            } else if (txtData) {
                textResults = txtData.map((row: any) => ({
                    ...row,
                    codigo: row.normas?.codigo,
                    norma_titulo: row.normas?.titulo,
                    score: 0.99 // Alta puntuación para priorizar exact matches
                })).filter((item: any) => isValidFragment(item.texto || item.content || ""));
            }
        }

        if (textResults.length > 0) {
            const combinedMap = new Map();
            // Vector results
            for (const row of validData) {
                const key = row.parte_id || row.id;
                combinedMap.set(key, { ...row, score: getScore(row) });
            }
            // Text results over vector results
            for (const row of textResults) {
                const key = row.parte_id || row.id;
                if (combinedMap.has(key)) {
                    combinedMap.get(key).score = Math.max(combinedMap.get(key).score, 0.99);
                } else {
                    combinedMap.set(key, row);
                }
            }
            validData = Array.from(combinedMap.values()).sort((a, b) => b.score - a.score);
            debugInfo.textSearchResults = textResults.length;
        }

        validData = validData.map((item: any) => {
            const match = (item.texto || item.content || "").match(/art(í|i)culo\s+\d+/i);
            if (match) {
                return { ...item, articulo_detectado: match[0] };
            }
            return item;
        });

        validData = validData.map((x: any) => ({
            ...x,
            score: typeof x.score === 'number' ? x.score : getScore(x)
        })).sort((a: any, b: any) => b.score - a.score);

        // 1. Relevance Gate: Grounding & Threshold check
        let bestScore = 0;
        let strongCount = 0;
        let mediumCount = 0;

        for (const item of validData) {
            const score = getScore(item);
            if (score > bestScore) bestScore = score;
            if (score >= 0.65) strongCount++;
            if (score >= 0.50) mediumCount++;
        }

        debugInfo.bestScore = bestScore;
        debugInfo.strongCount = strongCount;
        debugInfo.mediumCount = mediumCount;

        // Condición para permitir OpenAI
        const hasEnoughEvidence = bestScore >= 0.55 && (strongCount >= 1 || mediumCount >= 2);
        debugInfo.hasEnoughEvidence = hasEnoughEvidence;

        if (!validData.length || !hasEnoughEvidence) {
            const respPayload: any = {
                ok: true,
                data: [], // Se devuelve un array vacío porque no hay evidencia suficiente
                message: "No consta en la normativa cargada (o no hay evidencia suficiente en los fragmentos recuperados)."
            };
            if (xDebug) respPayload.debug = debugInfo;
            return NextResponse.json(respPayload);
        }

        // 3. RAG Generation
        let answer = "";
        try {
            const context = validData.slice(0, 3).map((x: any, i: number) => {
                let header = x.seccion || 'Fragmento';
                if (x.articulo_detectado) {
                    header += ` (articulo_detectado: ${x.articulo_detectado})`;
                }
                return `[${i + 1}] ${header}: ${x.texto || x.content}`;
            }).join("\n\n");

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "Eres un asistente técnico-jurídico. Responde únicamente usando la información del contexto. Si la respuesta no aparece en el contexto, indícalo. Cuando respondas debes citar el artículo usando el formato [Artículo X] si aparece en el contexto. No inventar artículos. Si el contexto contiene un fragmento con articulo_detectado, usar esa referencia." },
                    { role: "user", content: `PREGUNTA: ${question}\n\nCONTEXTO:\n${context}` }
                ],
                max_tokens: 300, // Limit to ~1200 chars roughly
                temperature: 0,
            });

            answer = completion.choices[0].message.content || "";
        } catch (openaiError: any) {
            console.error("OpenAI RAG error:", openaiError);
            debugInfo.openaiError = openaiError?.message;

            // Si falla OpenAI, devolvemos lo mismo que si no hubiera evidencia
            const respPayload: any = {
                ok: true,
                data: [],
                message: "No consta en la normativa cargada (o no hay evidencia suficiente en los fragmentos recuperados)."
            };
            if (xDebug) respPayload.debug = debugInfo;
            return NextResponse.json(respPayload);
        }

        // 4. Highlight Generation
        const topKData = validData.slice(0, k);
        const cosineSimilarity = (vecA: number[], vecB: number[]) => {
            let dotProduct = 0, normA = 0, normB = 0;
            for (let i = 0; i < vecA.length; i++) {
                dotProduct += vecA[i] * vecB[i];
                normA += vecA[i] * vecA[i];
                normB += vecB[i] * vecB[i];
            }
            if (normA === 0 || normB === 0) return 0;
            return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        };

        try {
            for (const item of topKData) {
                const textBase = item.texto || item.content || "";
                if (!textBase) continue;

                // Split into sentences (by dot or newline), filter empty, max 8
                const sentences = textBase
                    .split(/(?:\.|\n)+/)
                    .map((s: string) => s.trim())
                    .filter((s: string) => s.length > 20)
                    .slice(0, 8);

                if (sentences.length === 0) continue;

                const embRes = await openai.embeddings.create({
                    model: "text-embedding-3-small",
                    input: sentences,
                    dimensions: 1536,
                });

                let bestSentence = "";
                let bestSim = -1;

                for (let i = 0; i < sentences.length; i++) {
                    const sentenceEmb = embRes.data[i].embedding;
                    const sim = cosineSimilarity(q_embedding, sentenceEmb);
                    if (sim > bestSim) {
                        bestSim = sim;
                        bestSentence = sentences[i];
                    }
                }

                if (bestSentence) {
                    item.highlight = bestSentence + (bestSentence.endsWith('.') ? '' : '...');
                }
            }
        } catch (highlightErr) {
            console.error("Highlight calculation error:", highlightErr);
        }

        // Return answer and data
        const okPayload: any = {
            ok: true,
            answer: answer,
            data: topKData
        };
        if (xDebug) okPayload.debug = debugInfo;

        return NextResponse.json(okPayload);

    } catch (err: any) {
        return NextResponse.json(
            { error: err.message },
            { status: 500 }
        );
    }
}
