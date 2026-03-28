import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const K_GLOBAL = 12;
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
            const {
                data: { user },
            } = await supabase.auth.getUser(token);
            if (user) userId = user.id;
        }

        const normalizeNormaId = (value: any): number | null => {
            if (value === null || value === undefined) return null;
            const s = String(value).trim();
            if (!s || s.toLowerCase() === "all") return null;
            const n = Number(s);
            return Number.isInteger(n) ? n : null;
        };

        let parsedNormaId: number | null = null;

        if (normaCodigo) {
            const codigoNormalizado = String(normaCodigo).trim().replace(/\s+/g, " ");

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
        } else {
            parsedNormaId = normalizeNormaId(incomingNormaId);

            if (parsedNormaId !== null) {
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

                    const normalizeText = (text: string) => 
                        text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

                    const questionNormalized = normalizeText(question);

                    const termsToMatch = [
                        norma.materia,
                        norma.submateria,
                        ...keywordsArray,
                    ]
                        .filter(Boolean)
                        .map(normalizeText)
                        .filter((t) => t.length > 2);

                    const hasMatch = termsToMatch.some((kw) => {
                        if (kw === "pci") return /\bpci\b/i.test(questionLower);
                        
                        // Uso de regex con límites de palabra (\b) para atrapar coincidencias exactas y evitar falsos positivos
                        // Se han escapado caracteres especiales por si la keyword los incluyera
                        const safeKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(`\\b${safeKw}\\b`, "i");
                        return regex.test(questionNormalized);
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

        // --- Priorización por tipo de edificio ------------------------------------
        // Solo si ninguna detección previa ha fijado ya parsedNormaId
        if (!parsedNormaId) {
            const qLower = question.toLowerCase();

            // Palabras clave → código de norma a buscar
            const buildingTypeRules: Array<{ keywords: string[]; codigo: string }> = [
                {
                    keywords: ["edificio", "edificios", "vivienda", "residencial"],
                    codigo: "CTE-DB-SI",
                },
                {
                    keywords: ["industrial", "industria", "establecimiento industrial"],
                    codigo: "RSCIEI",
                },
                {
                    keywords: ["resbaladicidad", "resbalamiento", "resbalen", "resbal"],
                    codigo: "CTE-DB-SUA",
                },
            ];

            for (const rule of buildingTypeRules) {
                const matched = rule.keywords.some((kw) => qLower.includes(kw));
                if (matched) {
                    let btQuery = supabase
                        .from("normas")
                        .select("id, owner_user_id")
                        .ilike("codigo", rule.codigo)
                        .limit(1);

                    if (userId) {
                        btQuery = btQuery.or(`owner_user_id.is.null,owner_user_id.eq.${userId}`);
                    } else {
                        btQuery = btQuery.is("owner_user_id", null);
                    }

                    const { data: btNorma } = await btQuery.maybeSingle();

                    if (btNorma?.id) {
                        parsedNormaId = btNorma.id;
                        console.log(`[BUILDING-TYPE] "${rule.codigo}" priorizado por keyword en pregunta`);
                        break;
                    }
                }
            }
        }
        // --------------------------------------------------------------------------

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
            rpcParamErrors: null,
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
            if (/\.{5,}/.test(text)) return false;
            if (/\s\d{1,3}\s*$/.test(text)) return false;
            return true;
        };

        const getScore = (row: any) => {
            if (typeof row.score === "number") return row.score;
            if (typeof row.similarity === "number") return row.similarity;
            if (typeof row.distance === "number") return -row.distance;
            return 0;
        };

        // --- Debug: full detection trace ---
        console.log(`[ASK] Pregunta: "${question}"`);
        console.log(`[ASK] parsedNormaId FINAL antes de RPC: ${parsedNormaId ?? "null (búsqueda global)"}`);
        console.log(`[ASK] detectedNormaCodigo=${detectedNormaCodigo ?? "null"} | detectedMateria=${detectedMateria ?? "null"}`);
        console.log(`[HYBRID SEARCH] Filtro norma: ${parsedNormaId ?? "TODAS"} | Pregunta: ${question.substring(0, 60)}...`);

        const safeK = Number.isInteger(Number(k)) && Number(k) > 0 ? Number(k) : K_GLOBAL;

        // Limpieza absoluta para Postgres: sólo null o integer, nunca string vacío
        const validNormaId = typeof parsedNormaId === "number" && Number.isInteger(parsedNormaId) ? parsedNormaId : null;

        const rpcParams: any = {
            q_embedding,
            q_text: question,
            k: safeK,
        };

        if (validNormaId !== null) {
            rpcParams.q_norma_id = validNormaId;
        }

        let rpcQuery = supabase.rpc("buscar_norma_partes", rpcParams);

        if (parsedNormaId === null) {
            let allowedNormaIds: number[] = [];
            let normQuery = supabase.from("normas").select("id").limit(MAX_NORMAS);

            if (userId) {
                normQuery = normQuery.or(`owner_user_id.is.null,owner_user_id.eq.${userId}`);
            } else {
                normQuery = normQuery.is("owner_user_id", null);
            }

            const { data: ns } = await normQuery;

            if (ns && ns.length > 0) {
                allowedNormaIds = ns.map((n: any) => n.id);
                rpcQuery = rpcQuery.in("norma_id", allowedNormaIds);
            } else {
                rpcQuery = rpcQuery.eq("norma_id", -1);
            }
        }

        const { data, error } = await rpcQuery;

        console.log("=== DEBUG RPC RESULT ===");
        console.log("query:", question);
        console.log("parsedNormaId:", parsedNormaId);
        console.log("rpc_result_count:", data?.length);
        console.log("rpc_first_3:", data?.slice(0,3));

        if (error) {
            console.error("Error RPC vectorial/híbrido:", error.message, error.details);
            debugInfo.rpcParamErrors = error;
            return NextResponse.json(
                {
                    error: `Supabase RPC Error: ${error.message} - ${error.details}`,
                    debug: xDebug ? debugInfo : undefined,
                },
                { status: 500 }
            );
        }

        const rawData = data || [];
        debugInfo.rowsLength = rawData.length;
        console.log(`[ASK] Filas brutas de RPC: ${rawData.length}`);

        const validData = rawData.filter((item: any) =>
            isValidFragment(item.content || item.texto || "")
        );

        console.log("=== DEBUG VALID DATA ===");
        console.log("validData_count:", validData?.length);
        console.log("validData_first_3:", validData?.slice(0,3));
        console.log(`[ASK] Fragmentos válidos tras filtro: ${validData.length}`);

        let bestScore = 0;
        let strongCount = 0;
        let mediumCount = 0;

        for (const item of validData) {
            const score = getScore(item);
            if (score > bestScore) bestScore = score;
            if (score >= 0.7) strongCount++;
            if (score >= 0.5) mediumCount++;
        }

        debugInfo.bestScore = bestScore;
        debugInfo.strongCount = strongCount;
        debugInfo.mediumCount = mediumCount;
        console.log(`[ASK] Scores → best=${bestScore.toFixed(3)} | strong(≥0.7)=${strongCount} | medium(≥0.5)=${mediumCount}`);

        const hasEnoughEvidence =
            validData.length >= 2 && bestScore >= 0.55 && (strongCount >= 1 || mediumCount >= 2);

        debugInfo.hasEnoughEvidence = hasEnoughEvidence;

        // --- Article-number detection (hoisted before evidence gate) ---------------
        const articuloMencionadoMatch = question.match(
            /art(?:í|i)culo\s+(\d+[\w.-]*)|art\.\s*(\d+[\w.-]*)|art\s+(\d+[\w.-]*)/i
        );
        const articuloMencionado = articuloMencionadoMatch
            ? (articuloMencionadoMatch[1] || articuloMencionadoMatch[2] || articuloMencionadoMatch[3]).trim()
            : null;

        const articuloRegex = articuloMencionado
            ? new RegExp(`\\b${articuloMencionado}\\b`)
            : null;
        const articuloFoundInFragments = articuloRegex
            ? validData.some((f: any) => articuloRegex.test(String(f.seccion || "")))
            : false;

        // Bypass also when a keyword rule already pinned the norma and the RPC
        // returned fragments — embedding similarity is low for keyword-based queries,
        // not because the content is absent.
        const keywordRulePinned = parsedNormaId !== null && validData.length >= 1;

        const bypassEvidence =
            (articuloFoundInFragments && validData.length >= 1) ||
            keywordRulePinned;

        debugInfo.articuloMencionado = articuloMencionado;
        debugInfo.articuloFoundInFragments = articuloFoundInFragments;
        debugInfo.keywordRulePinned = keywordRulePinned;
        debugInfo.bypassEvidence = bypassEvidence;
        console.log(`[ASK] hasEnoughEvidence=${hasEnoughEvidence} | keywordRulePinned=${keywordRulePinned} | bypassEvidence=${bypassEvidence}`);

        if (!validData.length || (!hasEnoughEvidence && !bypassEvidence)) {
            console.log(`[ASK] → Devolviendo "No consta" (validData.length=${validData.length})`);
            return NextResponse.json({
                ok: true,
                answer: "No consta en las normas consultadas.",
                sources: [],
                highlights: [],
                ...(xDebug && { debug: debugInfo }),
            });
        }
        console.log(`[ASK] → Continuando con ${validData.length} fragmentos (bypass=${bypassEvidence})`);

        // --- Article-number boost -------------------------------------------------
        // Re-sort so fragments matching the mentioned article float to the top
        if (articuloMencionado && articuloRegex) {
            if (articuloFoundInFragments) {
                // Si encontramos el artículo exacto, podamos la lista para retener *solo* esos fragmentos 
                // y evitar que se cuelen otros artículos irrelevantes (ej. sale art 12 cuando piden art 5).
                const matchedFrags = validData.filter((f: any) => articuloRegex.test(String(f.seccion || "")));
                validData.splice(0, validData.length, ...matchedFrags);
            } else {
                validData.sort((a: any, b: any) => {
                    const matchA = articuloRegex.test(String(a.seccion || ""));
                    const matchB = articuloRegex.test(String(b.seccion || ""));
                    if (matchA && !matchB) return -1;
                    if (!matchA && matchB) return 1;
                    return getScore(b) - getScore(a); // fallback: score descending
                });
            }
            console.log(`[BOOST] Artículo mencionado: ${articuloMencionado} → filtrados/reordenados ${validData.length} fragmentos (found=${articuloFoundInFragments})`);
        }
        // --------------------------------------------------------------------------

        const isLiteralMatch =
            /(qué\s+dice|texto\s+literal|transcribe|copia)\s+.*(art(?:í|i)culo|art\.)\s*\d+/i.test(
                question
            ) || /(art(?:í|i)culo|art\.)\s*\d+/i.test(question);

        if (xDebug) debugInfo.isLiteralMatch = isLiteralMatch;

        let answer = "";

        if (!isLiteralMatch) {
            try {
                // --- Reconstruct complete articles from fragments -------------------
                // seccion values look like "Artículo 5 [Bloque 3]".
                // Strip the internal block marker to get the base article reference.
                const baseArticle = (sec: string) =>
                    sec ? sec.replace(/\s*\[Bloque\s+\d+\]/gi, "").trim() : "";

                // Group all fragments (not just the top slice) by their base article key
                const articleMap = new Map<string, any[]>();
                for (const frag of validData) {
                    const key = baseArticle(frag.seccion || "") || `__frag_${frag.id}`;
                    if (!articleMap.has(key)) articleMap.set(key, []);
                    articleMap.get(key)!.push(frag);
                }

                // Sort each group by id (ascending) so text reads in document order
                for (const frags of articleMap.values()) {
                    frags.sort((a: any, b: any) => (a.id ?? 0) - (b.id ?? 0));
                }

                // Build context from reconstructed articles, capped at 12 entries
                // Each entry = one logical article (possibly multiple fragments joined)
                const reconstructedArticles = Array.from(articleMap.entries())
                    .slice(0, 12)
                    .map(([label, frags], i) => {
                        const fullText = frags
                            .map((f: any) => f.texto || f.content || "")
                            .join("\n");
                        return `[${i + 1}] ${label}:\n${fullText}`;
                    });

                const context = reconstructedArticles.join("\n\n");

                const completion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: `Eres un asistente jurídico especializado en normativa técnica.

Responde SIEMPRE con esta estructura exacta, sin añadir secciones extra:

Respuesta breve:
<Una sola frase clara y directa que responda la pregunta.>

Fundamento normativo:
<Explicación jurídica basada estrictamente en los fragmentos proporcionados. No simplifiques. Si hay varias condiciones o requisitos, menciónalos todos.>

Cita:
<Indica el artículo o apartado correspondiente con el formato [Artículo X] o [Anexo X - Ap. Y].>

Reglas adicionales:
- Responde ÚNICAMENTE con información contenida en los fragmentos. No uses conocimiento externo ni inventes datos.
- No mezcles normas que no figuren en los fragmentos recuperados.
- Si la información no aparece en los fragmentos, responde exactamente: "No consta en las normas consultadas."`,
                        },
                        { role: "user", content: `PREGUNTA: ${question}\n\nCONTEXTO:\n${context}` },
                    ],
                    max_tokens: 500,
                    temperature: 0,
                });

                answer = completion.choices[0].message.content || "";
            } catch (openaiError: any) {
                console.error("OpenAI RAG error:", openaiError);
                debugInfo.openaiError = openaiError?.message;

                const respPayload: any = {
                    ok: true,
                    data: [],
                    message: "No consta en la normativa cargada (o no hay evidencia suficiente en los fragmentos recuperados).",
                };

                if (xDebug) respPayload.debug = debugInfo;
                return NextResponse.json(respPayload);
            }
        }

        const topKData = validData.slice(0, safeK);

        const cosineSimilarity = (vecA: number[], vecB: number[]) => {
            let dotProduct = 0,
                normA = 0,
                normB = 0;

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
                        item.highlight = bestSentence + (bestSentence.endsWith(".") ? "" : "...");
                    }
                }
            } catch (highlightErr) {
                console.error("Highlight calculation error:", highlightErr);
            }
        }

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
                finalData.push(group);
            }
        }

        const processedData = finalData.map((group) => {
            if (!Array.isArray(group)) return group;
            if (group.length === 1) return group[0];

            const bestFragment = group[0];
            const maxScore = bestFragment.score;
            const bestHighlight = bestFragment.highlight;

            group.sort((a: any, b: any) => (a.orden || 0) - (b.orden || 0));

            const combinedText = group.map((f: any) => f.texto || f.content || "").join("\n\n[...]\n\n");

            const capitulo_detectado =
                group.find((f: any) => f.capitulo_detectado)?.capitulo_detectado ||
                bestFragment.capitulo_detectado;

            const titulo_articulo =
                group.find((f: any) => f.titulo_articulo)?.titulo_articulo ||
                bestFragment.titulo_articulo;

            return {
                ...bestFragment,
                texto: combinedText,
                content: combinedText,
                score: maxScore,
                highlight: bestHighlight,
                capitulo_detectado,
                titulo_articulo,
            };
        });

        if (isLiteralMatch && processedData.length > 0) {
            answer = processedData[0].texto || processedData[0].content || "Fragmento literal no encontrado.";
        }

        const answerLower = answer.toLowerCase();
        const negativePatterns = [
            "no consta",
            "no se menciona",
            "no menciona",
            "no contiene información",
            "no hay información",
            "no puedo responder",
            "no se encuentra información",
        ];

        const isNoInfo = negativePatterns.some((p) => answerLower.includes(p));

        const okPayload: any = {
            ok: true,
            answer: isNoInfo ? "No consta en las normas consultadas." : answer,
            data: isNoInfo ? [] : processedData,
            sources: isNoInfo ? [] : processedData,
        };

        if (isNoInfo) {
            okPayload.sources = [];
            okPayload.highlights = [];
        }

        console.log("=== DEBUG SOURCES ===");
        console.log("sources_count:", processedData?.length);
        console.log("sources:", processedData);

        if (xDebug) okPayload.debug = debugInfo;

        console.log("=== DEBUG FINAL RESPONSE FIXED ===");
        console.log("final_response_keys:", Object.keys(okPayload || {}));
        console.log("final_response_sources_count:", okPayload?.sources?.length ?? null);
        console.log("final_response_sources:", okPayload?.sources ?? null);

        return NextResponse.json(okPayload);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
