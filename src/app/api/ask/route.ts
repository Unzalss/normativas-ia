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
        const payload = await req.json();
        const { question, normaId, norma_id, normaCodigo = null, k = 12 } = payload;
        const incomingNormaId = norma_id !== undefined ? norma_id : normaId;

        if (!question) {
            return NextResponse.json({ error: "Falta question" }, { status: 400 });
        }

        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const authHeader = req.headers.get("Authorization");
        let userId: string | null = null;
        if (authHeader) {
            const token = authHeader.replace("Bearer ", "");
            const { data: { user } } = await supabase.auth.getUser(token);
            if (user) userId = user.id;
        }

        // Parse normaId explicitly to ensure global searches
        let parsedNormaId: number | null = null;

        if (normaCodigo) {
            const codigoNormalizado = (normaCodigo ?? "")
                .trim()
                .replace(/\s+/g, " ");

            const { data: normaRow, error: normaError } = await supabase
                .from("normas")
                .select("id, owner_user_id")
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

            if (normaRow.owner_user_id && normaRow.owner_user_id !== userId) {
                return NextResponse.json(
                    { error: "No tienes permiso para consultar esta norma privada." },
                    { status: 403 }
                );
            }

            parsedNormaId = normaRow.id;
        } else if (incomingNormaId !== null && incomingNormaId !== undefined && incomingNormaId !== "" && String(incomingNormaId) !== "all") {
            const num = Number(incomingNormaId);
            if (!isNaN(num)) {
                parsedNormaId = num;

                const { data: normaAuthCheck } = await supabase
                    .from("normas")
                    .select("owner_user_id")
                    .eq("id", parsedNormaId)
                    .single();

                if (normaAuthCheck?.owner_user_id && normaAuthCheck.owner_user_id !== userId) {
                    return NextResponse.json(
                        { error: "No tienes permiso para consultar esta norma privada." },
                        { status: 403 }
                    );
                }
            }
        }

        let detectedNormaCodigo = null;
        let detectedNormaId = null;

        // Detección automática de norma en la pregunta si no hay norma seleccionada
        if (!parsedNormaId) {
            const match = question.match(/\b(RD|RDL|Ley)\s*(\d{1,4}\/\d{4})\b/i);
            if (match) {
                const detectedCodigo = `${match[1].toUpperCase()} ${match[2]}`;

                let normQuery = supabase
                    .from("normas")
                    .select("id, codigo, owner_user_id")
                    .ilike("codigo", detectedCodigo)
                    .limit(1);

                if (userId) {
                    normQuery = normQuery.or(`owner_user_id.is.null,owner_user_id.eq.${userId}`);
                } else {
                    normQuery = normQuery.is("owner_user_id", null);
                }

                const { data: detectedNorma } = await normQuery.maybeSingle();

                if (detectedNorma) {
                    parsedNormaId = detectedNorma.id;
                    detectedNormaCodigo = detectedNorma.codigo;
                    detectedNormaId = detectedNorma.id;
                }
            }
        }

        let detectedMateria = null;
        let detectedNormaPorMateria = null;
        let detectedNormaIdPorMateria = null;

        // Detección automática por materia si no hay norma preseleccionada ni detectada
        if (!parsedNormaId) {
            const questionLower = question.toLowerCase();
            let normMateriaQuery = supabase
                .from("normas")
                .select("id, codigo, materia, submateria, keywords")
                .not("keywords", "is", null);

            if (userId) {
                normMateriaQuery = normMateriaQuery.or(`owner_user_id.is.null,owner_user_id.eq.${userId}`);
            } else {
                normMateriaQuery = normMateriaQuery.is("owner_user_id", null);
            }

            const { data: candidateNormas } = await normMateriaQuery;

            if (candidateNormas && candidateNormas.length > 0) {
                for (const norma of candidateNormas) {
                    let keywordsArray: string[] = [];
                    if (typeof norma.keywords === "string") {
                        keywordsArray = norma.keywords.split(",");
                    } else if (Array.isArray(norma.keywords)) {
                        keywordsArray = norma.keywords;
                    }

                    const termsToMatch = [
                        norma.materia,
                        norma.submateria,
                        ...keywordsArray
                    ].filter(Boolean).map(t => String(t).toLowerCase().trim()).filter(t => t.length > 2);

                    const hasMatch = termsToMatch.some(kw => {
                        if (kw === "pci") return /\bpci\b/i.test(questionLower);
                        return questionLower.includes(kw);
                    });

                    if (hasMatch) {
                        parsedNormaId = norma.id;
                        detectedMateria = norma.materia || "detectada";
                        detectedNormaPorMateria = norma.codigo;
                        detectedNormaIdPorMateria = norma.id;
                        break;
                    }
                }
            }
        }

        const debugInfo: any = {
            normaCodigoRecibido: normaCodigo,
            normaIdResuelto: parsedNormaId,
            detectedNormaCodigo,
            detectedNormaId,
            detectedMateria,
            detectedNormaPorMateria,
            detectedNormaIdPorMateria,
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

        // Vector Search parameters
        // Ya resuelto arriba como incomingNormaId, y parseado seguro.

        // --- 1. NATIVE HYBRID SEARCH (Vector + FTS + SQL Boosting) ---
        console.log(`[HYBRID SEARCH] Ejecutando búsqueda híbrida. Filtro norma: ${parsedNormaId || 'TODAS'} | Pregunta: ${question.substring(0, 50)}...`);

        let rpcQuery = supabase.rpc("buscar_norma_partes", {
            q_embedding,
            q_text: question,
            q_norma_id: parsedNormaId || null,
            k: parsedNormaId ? k : K_GLOBAL
        });

        // Aplicamos el filtro en la consulta pgvector si el usuario selecciona una norma
        if (parsedNormaId) {
            rpcQuery = rpcQuery.eq("norma_id", parsedNormaId);
        } else {
            // BÚSQUEDA GLOBAL: Prevenir fuga de datos (normas privadas de otros)
            let allowedNormaIds: number[] = [];
            let normQuery = supabase.from("normas").select("id").limit(MAX_NORMAS);
            if (userId) {
                normQuery = normQuery.or(`owner_user_id.is.null,owner_user_id.eq.${userId}`);
            } else {
                normQuery = normQuery.is("owner_user_id", null);
            }
            const { data: ns } = await normQuery;
            if (ns && ns.length > 0) {
                allowedNormaIds = ns.map(n => n.id);
                rpcQuery = rpcQuery.in("norma_id", allowedNormaIds);
            } else {
                rpcQuery = rpcQuery.eq("norma_id", -1); // Forzar vacío si no hay normas permitidas
            }
        }

        const { data, error } = await rpcQuery;

        if (error) {
            console.error("Error RPC vectorial/híbrido:", error.message, error.details);
            debugInfo.rpcParamErrors = error;
            return NextResponse.json({ error: `Supabase RPC Error: ${error.message} - ${error.details}`, debug: xDebug ? debugInfo : undefined }, { status: 500 });
        }

        let rawData = data || [];
        debugInfo.rowsLength = rawData.length;
        console.log(`Filas devueltas por Hybrid Search: ${rawData.length}`);

        // Limpieza básica de fragmentos basuras devueltos por la BD
        let validData = rawData.filter((item: any) => isValidFragment(item.content || item.texto || ""));

        // 1. Relevance Gate: Grounding & Threshold check
        let bestScore = 0;
        let strongCount = 0;
        let mediumCount = 0;

        for (const item of validData) {
            const score = getScore(item);
            if (score > bestScore) bestScore = score;
            if (score >= 0.70) strongCount++;
            if (score >= 0.50) mediumCount++;
        }

        debugInfo.bestScore = bestScore;
        debugInfo.strongCount = strongCount;
        debugInfo.mediumCount = mediumCount;

        // Condición para permitir OpenAI
        const hasEnoughEvidence = validData.length >= 2 && bestScore >= 0.55 && (strongCount >= 1 || mediumCount >= 2);
        debugInfo.hasEnoughEvidence = hasEnoughEvidence;

        if (!validData.length || !hasEnoughEvidence) {
            return NextResponse.json({
                ok: true,
                answer: "No consta en las normas consultadas.",
                sources: [],
                highlights: [],
                ...(xDebug && { debug: debugInfo })
            });
        }

        // 2.5 Literal Mode Detection
        const isLiteralMatch = /(qué\s+dice|texto\s+literal|transcribe|copia)\s+.*(art(?:í|i)culo|art\.)\s*\d+/i.test(question) || /(art(?:í|i)culo|art\.)\s*\d+/i.test(question);
        if (xDebug) debugInfo.isLiteralMatch = isLiteralMatch;

        // 3. RAG Generation
        let answer = "";

        if (!isLiteralMatch) {
            try {
                const context = validData.slice(0, 12).map((x: any, i: number) => {
                    let header = x.seccion || 'Fragmento';
                    if (x.articulo_detectado) {
                        header += ` (articulo_detectado: ${x.articulo_detectado})`;
                    }
                    return `[${i + 1}] ${header}: ${x.texto || x.content}`;
                }).join("\n\n");

                const completion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: `Eres un asistente jurídico especializado en normativa técnica.
Reglas obligatorias:
1. Responde SOLO con base en los fragmentos jurídicos proporcionados, sin inventar información ni usar conocimiento externo.
2. Si la respuesta no está en los fragmentos, responde exactamente: "No consta en las normas consultadas."
3. Si citas una norma, extrae o indica el artículo correspondiente (p.ej. [Artículo X]).
4. Explica la respuesta de forma clara, sintetizando sin inventar contenido extra, y evitando interpretaciones jurídicas amplias.
5. No mezcles normas que no figuren en los fragmentos recuperados.`
                        },
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

        if (!isLiteralMatch) {
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
        }

        // 5. Grouping by articulo_detectado
        const groupedMap = new Map();
        const finalData: any[] = [];

        for (const item of topKData) {
            if (!item.articulo_detectado) {
                finalData.push(item);
                continue;
            }

            const key = item.norma_id ? `${item.norma_id}-${item.articulo_detectado}` : item.articulo_detectado;

            if (groupedMap.has(key)) {
                groupedMap.get(key).push(item);
            } else {
                const group = [item];
                groupedMap.set(key, group);
                finalData.push(group); // En vez de pushear el item, pusheamos la referencia al array del grupo para mantener el orden de inserción (el del mayor score)
            }
        }

        const processedData = finalData.map(group => {
            if (!Array.isArray(group)) return group; // Item sin articulo_detectado

            if (group.length === 1) return group[0];

            // El de mayor score es el primero según entraron (porque topKData ya viene ordenado por score)
            const bestFragment = group[0];
            const maxScore = bestFragment.score;
            const bestHighlight = bestFragment.highlight;

            // Ordenamos internamente por el 'orden' original del documento para que tengan sentido al leerse juntos
            group.sort((a: any, b: any) => (a.orden || 0) - (b.orden || 0));

            const combinedText = group.map((f: any) => f.texto || f.content || "").join("\n\n[...]\n\n");

            const capitulo_detectado = group.find((f: any) => f.capitulo_detectado)?.capitulo_detectado || bestFragment.capitulo_detectado;
            const titulo_articulo = group.find((f: any) => f.titulo_articulo)?.titulo_articulo || bestFragment.titulo_articulo;

            return {
                ...bestFragment,
                texto: combinedText,
                content: combinedText,
                score: maxScore,
                highlight: bestHighlight,
                capitulo_detectado,
                titulo_articulo
            };
        });

        // 6. Overwrite Answer with Literal Text
        if (isLiteralMatch && processedData.length > 0) {
            answer = processedData[0].texto || processedData[0].content || "Fragmento literal no encontrado.";
        }

        // Return answer and data
        const answerLower = answer.toLowerCase();
        const negativePatterns = [
            "no consta",
            "no se menciona",
            "no menciona",
            "no contiene información",
            "no hay información",
            "no puedo responder",
            "no se encuentra información"
        ];
        const isNoInfo = negativePatterns.some(p => answerLower.includes(p));

        const okPayload: any = {
            ok: true,
            answer: isNoInfo ? "No consta en las normas consultadas." : answer,
            data: isNoInfo ? [] : processedData,
        };

        if (isNoInfo) {
            okPayload.sources = [];
            okPayload.highlights = [];
        }

        if (xDebug) okPayload.debug = debugInfo;

        return NextResponse.json(okPayload);

    } catch (err: any) {
        return NextResponse.json(
            { error: err.message },
            { status: 500 }
        );
    }
}
