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
            // 1. Energía (Dinámico vía metadata DB)
            const { data: normaEnergia } = await supabase
                .from("normas")
                .select("id, codigo, materia, submateria, keywords")
                .eq("codigo", "RD 390/2021")
                .limit(1)
                .maybeSingle();

            let matchedEnergy = false;
            if (normaEnergia) {
                let keywordsArray: string[] = [];
                if (typeof normaEnergia.keywords === "string") {
                    keywordsArray = normaEnergia.keywords.split(",");
                } else if (Array.isArray(normaEnergia.keywords)) {
                    keywordsArray = normaEnergia.keywords;
                }

                const termsToMatch = [
                    normaEnergia.materia,
                    normaEnergia.submateria,
                    ...keywordsArray
                ].filter(Boolean).map(t => String(t).toLowerCase().trim()).filter(t => t.length > 2);

                if (termsToMatch.some(kw => questionLower.includes(kw))) {
                    parsedNormaId = normaEnergia.id;
                    detectedMateria = normaEnergia.materia || "energia";
                    detectedNormaPorMateria = "RD 390/2021";
                    detectedNormaIdPorMateria = normaEnergia.id;
                    matchedEnergy = true;
                }
            }

            if (!matchedEnergy) {
                // 2. Incendios (Dinámico vía metadata DB)
                const { data: normaIncendios } = await supabase
                    .from("normas")
                    .select("id, codigo, materia, submateria, keywords")
                    .eq("codigo", "ZAR-PPCI")
                    .limit(1)
                    .maybeSingle();

                let matchedFire = false;
                if (normaIncendios) {
                    let keywordsArray: string[] = [];
                    if (typeof normaIncendios.keywords === "string") {
                        keywordsArray = normaIncendios.keywords.split(",");
                    } else if (Array.isArray(normaIncendios.keywords)) {
                        keywordsArray = normaIncendios.keywords;
                    }

                    const fireTermsToMatch = [
                        normaIncendios.materia,
                        normaIncendios.submateria,
                        ...keywordsArray
                    ].filter(Boolean).map(t => String(t).toLowerCase().trim()).filter(t => t.length > 2);

                    const hasFireKeyword = fireTermsToMatch.some(kw => {
                        if (kw === "pci") return /\bpci\b/i.test(questionLower);
                        return questionLower.includes(kw);
                    });

                    if (hasFireKeyword) {
                        parsedNormaId = normaIncendios.id;
                        detectedMateria = normaIncendios.materia || "incendios";
                        detectedNormaPorMateria = "ZAR-PPCI";
                        detectedNormaIdPorMateria = normaIncendios.id;
                        matchedFire = true;
                    }
                }

                if (!matchedFire) {
                    // 3. Accesibilidad (Dinámico vía metadata DB)
                    const { data: normaAccesibilidad } = await supabase
                        .from("normas")
                        .select("id, codigo, materia, submateria, keywords")
                        .eq("codigo", "RD 505/2007")
                        .limit(1)
                        .maybeSingle();

                    if (normaAccesibilidad) {
                        let keywordsArray: string[] = [];
                        if (typeof normaAccesibilidad.keywords === "string") {
                            keywordsArray = normaAccesibilidad.keywords.split(",");
                        } else if (Array.isArray(normaAccesibilidad.keywords)) {
                            keywordsArray = normaAccesibilidad.keywords;
                        }

                        const accessTermsToMatch = [
                            normaAccesibilidad.materia,
                            normaAccesibilidad.submateria,
                            ...keywordsArray
                        ].filter(Boolean).map(t => String(t).toLowerCase().trim()).filter(t => t.length > 2);

                        if (accessTermsToMatch.some(kw => questionLower.includes(kw))) {
                            parsedNormaId = normaAccesibilidad.id;
                            detectedMateria = normaAccesibilidad.materia || "accesibilidad";
                            detectedNormaPorMateria = "RD 505/2007";
                            detectedNormaIdPorMateria = normaAccesibilidad.id;
                        }
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

        // --- 1. VECTOR SEARCH ---
        console.log(`[VECTOR SEARCH] Ejecutando búsqueda vectorial. Filtro norma: ${parsedNormaId || 'TODAS'}`);

        let rpcQuery = supabase.rpc("buscar_norma_partes", {
            q_embedding,
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
            console.error("Error RPC vectorial:", error.message, error.details);
            debugInfo.rpcParamErrors = error;
            return NextResponse.json({ error: `Supabase RPC Error: ${error.message} - ${error.details}`, debug: xDebug ? debugInfo : undefined }, { status: 500 });
        }

        let rawData = data || [];
        debugInfo.rowsLength = rawData.length;
        console.log(`Filas vectoriales devueltas: ${rawData.length}`);

        if (rawData && rawData.length > 0) {
            console.log("DEBUG rawData[0]:", rawData[0]);
        }

        let validData = (rawData || []).filter((item: any) => isValidFragment(item.content || item.texto || "") && getScore(item) >= 0.65);

        // If not enough valid results, try fetching more (sólo para búsquedas de una norma)
        if (validData.length < k && parsedNormaId !== null) {
            const kRetry = k * 3;
            debugInfo.limitRetry = kRetry;

            // Reintento también con el eq explícito dictado
            let retryQuery = supabase.rpc("buscar_norma_partes", {
                q_embedding,
                q_norma_id: parsedNormaId,
                k: kRetry
            }).eq("norma_id", parsedNormaId);

            const { data: retryData, error: retryError } = await retryQuery;

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
                validData = retryData.filter((item: any) => isValidFragment(item.content || item.texto || "") && getScore(item) >= 0.65);
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

            let orCondition = `texto.ilike.%${searchTerm}%,seccion.ilike.%${searchTerm}%`;

            // Detectar si el searchTerm es explícitamente un artículo (ej: "articulo 3", "art 3", "art. 3")
            const isArticleQuery = searchTerm.match(/(?:art(?:í|i)culo|art\.?)\s+(\d+)/i);
            if (isArticleQuery) {
                const num = isArticleQuery[1];
                // Usar "_" como comodín de un solo carácter para saltarnos el problema del acento (art_culo)
                orCondition = `seccion.ilike.%art_culo ${num}%,seccion.ilike.%art_culo ${num}.%,texto.ilike.%${searchTerm}%`;
            }

            let textQuery = supabase
                .from('normas_partes')
                .select('id, norma_id, tipo, seccion, texto, normas!inner(codigo, titulo)')
                .or(orCondition)
                .limit(k * 2);

            if (parsedNormaId !== null) {
                textQuery = textQuery.eq('norma_id', parsedNormaId);
            } else {
                let allowedNormaIds: number[] = [];
                let query = supabase.from("normas").select("id").limit(MAX_NORMAS);
                if (userId) {
                    query = query.or(`owner_user_id.is.null,owner_user_id.eq.${userId}`);
                } else {
                    query = query.is("owner_user_id", null);
                }
                const { data: ns } = await query;
                if (ns && ns.length > 0) {
                    allowedNormaIds = ns.map(n => n.id);
                    textQuery = textQuery.in('norma_id', allowedNormaIds);
                } else {
                    textQuery = textQuery.eq('norma_id', -1);
                }
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

        // 2.1 Concept Reinforcement Search (if no explicit exact match)
        let conceptResults: any[] = [];
        if (!searchTerm) {
            const stopwords = new Set(['sobre', 'entre', 'hacia', 'hasta', 'desde', 'donde', 'cuando', 'porque', 'quien', 'quienes', 'cuales', 'segun', 'puede', 'pueden', 'deben', 'debe', 'tambien', 'estan', 'estos', 'estas', 'parte', 'forma', 'mismo', 'misma', 'aquel', 'aquella']);
            const normalizeText = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            const concepts = question
                .split(/[\s,.;:!?()¿¡'"\-]+/)
                .filter((w: string) => w.length >= 5)
                .map((w: string) => w.toLowerCase())
                .filter((w: string) => !stopwords.has(normalizeText(w)))
                .slice(0, 5);

            if (concepts.length > 0) {
                console.log(`[CONCEPT SEARCH] Buscando conceptos:`, concepts);
                const orConditions = concepts.map((c: string) => `texto.ilike.%${c}%,seccion.ilike.%${c}%`).join(',');

                let conceptQuery = supabase
                    .from('normas_partes')
                    .select('id, norma_id, tipo, seccion, texto, normas!inner(codigo, titulo)')
                    .or(orConditions)
                    .limit(k * 2);

                if (parsedNormaId !== null) {
                    conceptQuery = conceptQuery.eq('norma_id', parsedNormaId);
                } else {
                    let allowedNormaIds: number[] = [];
                    let query = supabase.from("normas").select("id").limit(MAX_NORMAS);
                    if (userId) {
                        query = query.or(`owner_user_id.is.null,owner_user_id.eq.${userId}`);
                    } else {
                        query = query.is("owner_user_id", null);
                    }
                    const { data: ns } = await query;
                    if (ns && ns.length > 0) {
                        allowedNormaIds = ns.map(n => n.id);
                        conceptQuery = conceptQuery.in('norma_id', allowedNormaIds);
                    } else {
                        conceptQuery = conceptQuery.eq('norma_id', -1);
                    }
                }

                const { data: cData, error: cError } = await conceptQuery;
                if (cError) {
                    console.error("Concept search error:", cError);
                } else if (cData) {
                    conceptResults = cData.map((row: any) => ({
                        ...row,
                        codigo: row.normas?.codigo,
                        norma_titulo: row.normas?.titulo,
                        score: 0.70 // Refuerzo
                    })).filter((item: any) => isValidFragment(item.texto || item.content || ""));
                }
            }
        }

        if (conceptResults.length > 0) {
            const combinedMap = new Map();
            for (const row of validData) {
                const key = row.parte_id || row.id;
                combinedMap.set(key, { ...row, score: getScore(row) });
            }
            for (const row of conceptResults) {
                const key = row.parte_id || row.id;
                if (combinedMap.has(key)) {
                    combinedMap.get(key).score = Math.max(combinedMap.get(key).score, 0.70);
                } else {
                    combinedMap.set(key, row);
                }
            }
            validData = Array.from(combinedMap.values()).sort((a, b) => b.score - a.score);
            debugInfo.conceptSearchResults = conceptResults.length;
        }

        validData = validData.map((item: any) => {
            const textToMatch = item.texto || item.content || "";
            const matchArt = textToMatch.match(/art(í|i)culo\s+\d+/i);
            const matchCap = textToMatch.match(/cap(í|i)tulo\s+[ivxlcdm]+/i);
            const matchTitle = textToMatch.match(/art(?:í|i)culo\s+\d+\.\s*([^\n.]+)/i);

            const newItem = { ...item };
            if (matchArt) {
                newItem.articulo_detectado = matchArt[0];
            }
            if (matchCap) {
                newItem.capitulo_detectado = matchCap[0];
            }
            if (matchTitle && matchTitle[1]) {
                newItem.titulo_articulo = matchTitle[1].trim();
            }
            return newItem;
        });

        const stopwordsBasicReRank = new Set(['sobre', 'entre', 'hacia', 'hasta', 'desde', 'donde', 'cuando', 'porque', 'quien', 'quienes', 'cuales', 'segun', 'puede', 'pueden', 'deben', 'debe', 'tambien', 'estan', 'estos', 'estas', 'parte', 'forma', 'mismo', 'misma', 'aquel', 'aquella']);
        const normLocalInfo = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const questionConcepts = question
            .split(/[\s,.;:!?()¿¡'"\-]+/)
            .filter((w: string) => w.length >= 5)
            .map((w: string) => w.toLowerCase())
            .filter((w: string) => !stopwordsBasicReRank.has(normLocalInfo(w)))
            .slice(0, 3);

        const questionLower = question.toLowerCase();
        const penaltyWords = ["preámbulo", "preambulo", "índice", "indice", "anexo", "tabla", "disposición", "disposicion", "exposición de motivos", "exposicion de motivos"];
        const hasPenaltyInQuestion = penaltyWords.some(w => questionLower.includes(w));

        const articulo_detectado = question.match(/(art(?:í|i)culo|art\.)\s*\d+/i)?.[0] ?? null;
        const qMatchTitle = question.match(/art(?:í|i)culo\s+\d+\.\s*([^\n.]+)/i);
        const titulo_articulo = qMatchTitle ? qMatchTitle[1].trim() : null;

        const scoreBoost = (item: any) => {
            let boost = 0;

            if (articulo_detectado) {
                const detectedNum = String(articulo_detectado).match(/\d+/)?.[0];
                const itemArt = item.articulo_num || item.articulo || item.metadata?.articulo || item.metadata?.articulo_num;
                if (detectedNum && itemArt && String(itemArt).match(/\d+/)?.[0] === detectedNum) {
                    boost += 0.25;
                }
            }

            if (titulo_articulo) {
                const titDet = String(titulo_articulo).toLowerCase();
                const itemTit = String(item.articulo_titulo || item.titulo || item.heading || item.caption || item.metadata?.articulo_titulo || "").toLowerCase();
                if (titDet && itemTit.includes(titDet)) {
                    boost += 0.12;
                }
            }

            if (!hasPenaltyInQuestion) {
                const itemPartsText = String(item.articulo_titulo || item.seccion || item.parte_titulo || item.texto || "").toLowerCase();
                const hitPenalty = penaltyWords.some(w => itemPartsText.includes(w));
                if (hitPenalty) {
                    boost -= 0.20;
                }
            }

            if (questionConcepts.length > 0) {
                const itemTextLog = String(item.texto || item.content || "").toLowerCase();
                const normItemText = normLocalInfo(itemTextLog);
                const hitConcept = questionConcepts.some((c: string) => normItemText.includes(normLocalInfo(c)));
                if (hitConcept) {
                    boost += 0.08;
                }
            }

            return boost;
        };

        validData = validData.map((x: any) => {
            const baseScore = typeof x.score === 'number' ? x.score : getScore(x);
            const boost = scoreBoost(x);
            return {
                ...x,
                score: baseScore,
                finalScore: baseScore + boost
            };
        }).sort((a: any, b: any) => b.finalScore - a.finalScore);

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
