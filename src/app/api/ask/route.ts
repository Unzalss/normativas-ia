/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const K_GLOBAL = 12;
const MAX_NORMAS = 50;

type AskDebugTiming = {
    authMs: number;
    normaDetectionMs: number;
    embeddingMs: number;
    directFetchMs: number;
    rpcMs: number;
    filterRankMs: number;
    contextMs: number;
    openaiMs: number;
    highlightsMs: number;
    totalMs: number;
    contextChars: number;
    contextGroupsCount: number;
    validDataCount: number;
    sourcesCount: number;
};

const nowMs = () => Date.now();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    try {
        const startedAt = nowMs();
        const debugTiming: AskDebugTiming = {
            authMs: 0,
            normaDetectionMs: 0,
            embeddingMs: 0,
            directFetchMs: 0,
            rpcMs: 0,
            filterRankMs: 0,
            contextMs: 0,
            openaiMs: 0,
            highlightsMs: 0,
            totalMs: 0,
            contextChars: 0,
            contextGroupsCount: 0,
            validDataCount: 0,
            sourcesCount: 0,
        };
        const finalizeDebugTiming = () => {
            debugTiming.totalMs = nowMs() - startedAt;
            return debugTiming;
        };
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
            const authStartedAt = nowMs();
            const token = authHeader.replace("Bearer ", "");
            const {
                data: { user },
            } = await supabase.auth.getUser(token);
            if (user) userId = user.id;
            debugTiming.authMs = nowMs() - authStartedAt;
        }

        const normaDetectionStartedAt = nowMs();
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
            const match = question.match(/\b(RD|RDL|Ley)[\s-]*(\d{1,4})[\/\-](\d{4})\b/i);

            if (match) {
                const flexibleCodePattern = `%${match[1].toUpperCase()}%${match[2]}%${match[3]}%`;

                let normQuery = supabase
                    .from("normas")
                    .select("id, codigo, owner_user_id")
                    .ilike("codigo", flexibleCodePattern)
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
                let bestMatchScore = 0;
                let bestNormaCandidate = null;

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

                    let normMatchScore = 0;

                    for (const kw of termsToMatch) {
                        if (kw === "pci" && /\bpci\b/i.test(questionLower)) {
                            normMatchScore++;
                        } else {
                            // Uso de regex con límites de palabra (\b) para atrapar coincidencias exactas
                            const safeKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const regex = new RegExp(`\\b${safeKw}\\b`, "i");
                            if (regex.test(questionNormalized)) {
                                normMatchScore++;
                            }
                        }
                    }

                    if (normMatchScore > bestMatchScore) {
                        bestMatchScore = normMatchScore;
                        bestNormaCandidate = norma;
                    }
                }

                if (bestNormaCandidate && bestMatchScore > 0) {
                    parsedNormaId = bestNormaCandidate.id;
                    detectedMateria = bestNormaCandidate.materia || "detectada";
                    detectedNormaPorMateria = bestNormaCandidate.codigo;
                    detectedNormaIdPorMateria = bestNormaCandidate.id;
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
                    keywords: ["ripci", "instalaciones de proteccion contra incendios", "proteccion contra incendios"],
                    codigo: "RD-513-2017",
                },
                {
                    keywords: ["resbaladicidad", "resbalamiento", "resbalen", "resbal"],
                    codigo: "CTE-DB-SUA",
                },
            ];

            for (const rule of buildingTypeRules) {
                const matched = rule.keywords.some((kw) => qLower.includes(kw));
                if (matched) {
                    const flexibleCodePattern = `%${rule.codigo.replace(/-/g, '%')}%`;
                    let btQuery = supabase
                        .from("normas")
                        .select("id, owner_user_id")
                        .ilike("codigo", flexibleCodePattern)
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
        debugTiming.normaDetectionMs = nowMs() - normaDetectionStartedAt;

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

        const embeddingStartedAt = nowMs();
        const embeddingRes = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: question,
            dimensions: 1536,
        });
        debugTiming.embeddingMs = nowMs() - embeddingStartedAt;

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

        const normalizeForSearch = (value: any) =>
            String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

        const buildSourceLabel = (item: any) => {
            const tipo = normalizeForSearch(item.tipo);
            if (tipo.includes("anexo") && item.seccion) return String(item.seccion).trim();
            if (tipo.includes("art")) {
                const rawNumber = item.article_number || item.numero || String(item.articulo || item.seccion || "").match(/\d+/)?.[0];
                return rawNumber ? `Artículo ${rawNumber}` : String(item.articulo || item.seccion || "Artículo").trim();
            }
            return String(item.seccion || item.articulo || item.tipo || "Fragmento normativo").trim();
        };

        const refineSourceLabel = (item: any, baseLabel: string) => {
            const sectionText = normalizeForSearch(item.seccion);
            const typeText = normalizeForSearch(item.tipo);
            const baseLabelText = normalizeForSearch(baseLabel);
            const fragmentText = normalizeForSearch(item.texto || item.content);
            const hasAnexoII =
                /\banexo\s+ii(?:\b|[\s-])/.test(sectionText) ||
                /\banexo\s+ii(?:\b|[\s-])/.test(baseLabelText);
            const hasAnexoI =
                /\banexo\s+i(?:\b|[\s-])/.test(sectionText) ||
                /\banexo\s+i(?:\b|[\s-])/.test(baseLabelText);
            const hasForbiddenStructure =
                hasAnexoI ||
                sectionText.includes("apendice") ||
                baseLabelText.includes("apendice") ||
                typeText.includes("art") ||
                typeText.includes("capitulo") ||
                typeText.includes("disposicion") ||
                sectionText.includes("articulo") ||
                sectionText.includes("capitulo") ||
                sectionText.includes("disposicion") ||
                baseLabelText.includes("articulo") ||
                baseLabelText.includes("capitulo") ||
                baseLabelText.includes("disposicion");
            const hasExtintoresHeading = fragmentText.includes("extintores de incendio");
            const hasMaintenanceCue =
                fragmentText.includes("programa de mantenimiento trimestral") ||
                fragmentText.includes("programa de mantenimiento anual") ||
                fragmentText.includes("mantenimiento trimestral") ||
                fragmentText.includes("mantenimiento anual") ||
                fragmentText.includes("retimbrado") ||
                fragmentText.includes("timbrado");

            if (isExtintorQuery && hasAnexoII && !hasForbiddenStructure && hasExtintoresHeading && hasMaintenanceCue) {
                return "ANEXO II - Extintores de incendio";
            }

            return baseLabel;
        };

        // --- Debug: full detection trace ---
        console.log(`[ASK] Pregunta: "${question}"`);
        console.log(`[ASK] parsedNormaId FINAL antes de RPC: ${parsedNormaId ?? "null (búsqueda global)"}`);
        console.log(`[ASK] detectedNormaCodigo=${detectedNormaCodigo ?? "null"} | detectedMateria=${detectedMateria ?? "null"}`);
        console.log(`[HYBRID SEARCH] Filtro norma: ${parsedNormaId ?? "TODAS"} | Pregunta: ${question.substring(0, 60)}...`);

        const qNormalized = normalizeForSearch(question);
        const anexoTopicTerms = [
            "mantenimiento", "revision", "revisiones", "trimestral", "anual", "cinco anos",
            "deteccion", "alarma", "extintores", "extintor", "bie", "bocas de incendio", "hidrantes"
        ];
        const isAnexoIIQuery = /\banexo\s+ii\b/.test(qNormalized);
        const isTechnicalAnexoQuery = isAnexoIIQuery || anexoTopicTerms.some(term => qNormalized.includes(term));
        const isExtintorQuery = qNormalized.includes("extintor");
        const isHidrantesQuery = qNormalized.includes("hidrante");
        const isDetectionMaintenanceQuery =
            (qNormalized.includes("mantenimiento") || qNormalized.includes("revision") || qNormalized.includes("revisiones")) &&
            (qNormalized.includes("deteccion") || qNormalized.includes("alarma"));
        const safeKBase = Number.isInteger(Number(k)) && Number(k) > 0 ? Number(k) : K_GLOBAL;
        const safeK = isTechnicalAnexoQuery ? Math.max(safeKBase, 20) : safeKBase;

        // Limpieza absoluta para Postgres: sólo null o integer, nunca string vacío
        const validNormaId = typeof parsedNormaId === "number" && Number.isInteger(parsedNormaId) ? parsedNormaId : null;

        // --- Article-number detection (hoisted BEFORE RPC) ---
        const questionForArticleDetection = String(question || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
        const articuloMencionadoMatch = questionForArticleDetection.match(
            /\bart\D{0,12}(\d+)(?:[\s.-]+(bis|ter|quater))?\b/i
        );
        const articuloMencionado = articuloMencionadoMatch
            ? `${articuloMencionadoMatch[1]}${articuloMencionadoMatch[2] ? ` ${articuloMencionadoMatch[2]}` : ""}`.trim()
            : null;

        let rawData: any[] = [];
        let rpcError: any = null;
        let usedDirectFetch = false;

        const articuloRegex: RegExp | null = articuloMencionado
            ? new RegExp(`art(?:[íi]culo|iculo|\\.?)?\\s*${articuloMencionado.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")
            : null;

        const shouldUseDirectFetch = Boolean(validNormaId !== null && articuloMencionado);
        console.log("\\n[DIAG-DIRECT-FETCH] precheck", {
            validNormaId,
            articleNumber: articuloMencionado,
            shouldUseDirectFetch
        });

        const normalizeArticleNumber = (value: any) => {
            const raw = String(value || "")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
                .trim();
            const withoutArticlePrefix = raw.replace(/^art(?:iculo)?\.?\s*/i, "").trim();
            const match = withoutArticlePrefix.match(/^(\d+)(?:\s+(bis|ter|quater))?/i);
            return (match ? `${match[1]}${match[2] ? ` ${match[2]}` : ""}` : withoutArticlePrefix)
                .replace(/\.+$/g, "")
                .trim();
        };

        const assembleExactArticleFragments = (fragments: any[], requestedArticleNumber: string | null) => {
            if (!requestedArticleNumber || !Array.isArray(fragments) || fragments.length === 0) return null;

            const requested = normalizeArticleNumber(requestedArticleNumber);
            const exactFragments = fragments.filter((fragment: any) =>
                normalizeArticleNumber(fragment.article_number) === requested
            );

            if (exactFragments.length === 0) return null;

            const numericValue = (value: any) => {
                const n = Number(value);
                return Number.isFinite(n) ? n : null;
            };

            exactFragments.sort((a: any, b: any) => {
                const ordenA = numericValue(a.orden);
                const ordenB = numericValue(b.orden);

                if (ordenA !== null && ordenB !== null && ordenA !== ordenB) return ordenA - ordenB;
                if (ordenA !== null && ordenB === null) return -1;
                if (ordenA === null && ordenB !== null) return 1;

                const idA = numericValue(a.id);
                const idB = numericValue(b.id);

                if (idA !== null && idB !== null) return idA - idB;
                if (idA !== null && idB === null) return -1;
                if (idA === null && idB !== null) return 1;

                return 0;
            });

            const contiguousGroups: any[][] = [];
            for (const fragment of exactFragments) {
                const lastGroup = contiguousGroups[contiguousGroups.length - 1];
                const previous = lastGroup?.[lastGroup.length - 1];
                const currentOrder = numericValue(fragment.orden);
                const previousOrder = numericValue(previous?.orden);
                const isContiguous = previous && currentOrder !== null && previousOrder !== null
                    ? currentOrder - previousOrder <= 1
                    : Boolean(previous);

                if (!lastGroup || !isContiguous) {
                    contiguousGroups.push([fragment]);
                } else {
                    lastGroup.push(fragment);
                }
            }

            const hasArticlePartMarker = (fragment: any) =>
                /-\s*Ap\./i.test(String(fragment.seccion || "")) ||
                /-\s*Ap\./i.test(String(fragment.articulo || "")) ||
                /-\s*Ap\./i.test(String(fragment.texto || fragment.content || ""));

            const isExactArticleHeader = (value: any) => {
                const normalized = String(value || "")
                    .replace(/\s*\[Bloque\s+\d+\]/gi, "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toLowerCase();

                return normalized === `artículo ${requested}` || normalized === `articulo ${requested}`;
            };

            const exactHeaderGroup = contiguousGroups.find((group) =>
                group.some((fragment: any) =>
                    isExactArticleHeader(fragment.seccion) || isExactArticleHeader(fragment.articulo)
                )
            );

            const selectedGroup = contiguousGroups.length === 1
                ? contiguousGroups[0]
                : contiguousGroups.find((group) => group.length > 1 && group.some(hasArticlePartMarker)) || exactHeaderGroup;

            if (!selectedGroup || selectedGroup.length === 0) return null;

            const seen = new Set<string>();
            const cleanedTexts = selectedGroup
                .map((fragment: any) => String(fragment.texto || fragment.content || "").replace(/\s+/g, " ").trim())
                .filter((text: string) => {
                    if (!text || seen.has(text)) return false;
                    seen.add(text);
                    return true;
                });

            if (cleanedTexts.length === 0) return null;

            const assembledText = cleanedTexts.join("\n\n");

            return {
                ...selectedGroup[0],
                texto: assembledText,
                content: assembledText,
            };
        };

        if (shouldUseDirectFetch) {
            console.log("[DIAG-DIRECT-FETCH] entered", { validNormaId, articleNumber: articuloMencionado });
            const artNum = normalizeArticleNumber(articuloMencionado);
            const safeArtNum = artNum.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
            const explicitArtRegex = new RegExp(`\\\\bart(?:[íi]culo|iculo|icul|ic|\\\\.?)?\\\\s*${safeArtNum}\\\\b`, 'i');

            // Búsqueda nominal directa estricta en base de datos.
            const directFetchStartedAt = nowMs();
            const { data: exactData, error: exactError } = await supabase
                .from("normas_partes")
                .select("id, norma_id, seccion, articulo, article_number, texto, tipo, orden")
                .eq("norma_id", validNormaId)
                .eq("article_number", artNum)
                .order('orden', { ascending: true })
                .limit(50);
            debugTiming.directFetchMs += nowMs() - directFetchStartedAt;

            console.log(`\\n[DIAG-DIRECT-FETCH] Buscando artículo ${artNum} en norma ${validNormaId}`);
            if (exactError) console.error(`[DIAG-DIRECT-FETCH] Error DB:`, exactError.message);

            if (exactData && exactData.length > 0) {
                console.log(`[DIAG-DIRECT-FETCH] Filas devueltas por consulta directa: ${exactData.length}`);
                if (xDebug) {
                    exactData.forEach(r => {
                        console.log(`  -> id: ${r.id}, article_number: "${r.article_number}", articulo: "${r.articulo}", seccion: "${r.seccion}"`);
                    });
                }

                const isArticleStrictMatch = (f: any) => {
                    const sec = String(f.seccion || "");
                    const ar = String(f.articulo || "");
                    const an = String(f.article_number || "");
                    if (explicitArtRegex.test(sec)) return true;
                    if (explicitArtRegex.test(ar)) return true;
                    if (an.toLowerCase().trim() === artNum) return true;
                    if (ar.toLowerCase().trim() === artNum) return true;
                    const numRegex = new RegExp(`\\\\b${safeArtNum}\\\\b`, 'i');
                    if (numRegex.test(sec) || numRegex.test(ar)) return true;
                    return false;
                };

                const isArticleFallbackMatch = (f: any) => {
                    const text = String(f.texto || f.content || "");
                    const looseArtRegex = new RegExp(`\\\\bart(?:[íi]c(?:ulo)?)?\\\\.?\\\\s*${safeArtNum}\\\\b`, 'i');
                    return looseArtRegex.test(text);
                };

                let matchedExact = exactData.filter(isArticleStrictMatch);
                
                if (matchedExact.length === 0) {
                    matchedExact = exactData.filter(isArticleFallbackMatch);
                }

                if (matchedExact.length > 0) {
                    matchedExact.sort((a: any, b: any) => (a.id ?? 0) - (b.id ?? 0));
                    const assembledExactArticle = assembleExactArticleFragments(matchedExact, artNum);
                    rawData = assembledExactArticle
                        ? [{ ...assembledExactArticle, similarity: 1.0, score: 1.0 }]
                        : matchedExact.map(f => ({ ...f, similarity: 1.0, score: 1.0 }));
                    usedDirectFetch = true;
                    console.log(`[ASK] Búsqueda nominal directa exitosa para artículo ${artNum}: recuperados ${matchedExact.length} fragmentos. RPC OMITIDA.`);
                }
            }
        }

        if (!usedDirectFetch) {
            const rpcStartedAt = nowMs();
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
            rawData = data || [];
            rpcError = error;
            debugTiming.rpcMs = nowMs() - rpcStartedAt;
            console.log(`[ASK] Filas brutas de RPC: ${rawData.length}`);
            
            if (xDebug && articuloMencionado) {
                console.log("\n[DIAG-ARTICLE] ==== INICIO DE DIAGNÓSTICO DE ARTÍCULO ====");
                console.log(`[DIAG-ARTICLE] Pregunta Original: "${question}"`);
                console.log(`[DIAG-ARTICLE] Norma (detectedNormaCodigo: ${detectedNormaCodigo}, parsedNormaId: ${parsedNormaId}, validNormaId: ${validNormaId})`);
                console.log(`[DIAG-ARTICLE] Artículo detectado crudo: "${articuloMencionado}", Numero limpio: "${articuloMencionado.toLowerCase().trim()}"`);
                console.log(`[DIAG-ARTICLE] Filas traídas de RPC (total): ${rawData.length}`);
                console.log(`[DIAG-ARTICLE] Muestra de las primeras 10 filas devueltas:`);
                rawData.slice(0, 10).forEach((row: any, i: number) => {
                    const textoShort = String(row.texto || row.content || "").substring(0, 120).replace(/\n/g, '\\n');
                    console.log(`  [Fila ${i}] id: ${row.id}, norma_id: ${row.norma_id}, seccion: "${row.seccion}", articulo: "${row.articulo}", article_number: "${row.article_number}", snippet: "${textoShort}"`);
                });
            }
        }

        if (usedDirectFetch) {
            debugTiming.rpcMs = 0;
        }

        console.log("=== RESULT LOG ===");
        console.log("query:", question);
        console.log("parsedNormaId:", parsedNormaId);
        console.log("result_count:", rawData.length);
        console.log("usedDirectFetch:", usedDirectFetch);

        if (rpcError) {
            console.error("Error RPC vectorial/híbrido:", rpcError.message, rpcError.details);
            debugInfo.rpcParamErrors = rpcError;
            debugInfo.debugTiming = finalizeDebugTiming();
            return NextResponse.json(
                {
                    error: `Supabase RPC Error: ${rpcError.message} - ${rpcError.details}`,
                    debug: xDebug ? debugInfo : undefined,
                },
                { status: 500 }
            );
        }

        debugInfo.rowsLength = rawData.length;

        const filterRankStartedAt = nowMs();
        const validData = rawData.filter((item: any) =>
            isValidFragment(item.content || item.texto || "")
        );
        validData.forEach((item: any) => {
            item.source_label = refineSourceLabel(item, buildSourceLabel(item));
        });

        if (xDebug) {
            console.log("=== DEBUG VALID DATA ===");
            console.log("validData_count:", validData?.length);
            console.log("validData_first_3:", validData?.slice(0,3));
            console.log(`[ASK] Fragmentos válidos tras filtro: ${validData.length}`);
        }

        if (isTechnicalAnexoQuery && !articuloMencionado) {
            const scoreAnexoKeyword = (item: any) => {
                const seccion = normalizeForSearch(item.seccion);
                const sourceLabel = normalizeForSearch(item.source_label || buildSourceLabel(item));
                const texto = normalizeForSearch(item.texto || item.content);
                const tipo = normalizeForSearch(item.tipo);
                const labelText = `${seccion} ${sourceLabel}`;
                let boost = 0;

                if (tipo.includes("anexo")) boost += 0.25;
                if (tipo.includes("art")) boost -= 0.35;
                if (/^anexo(?:\s+[ivx]+)?$/i.test(String(item.seccion || "").trim())) boost -= 0.45;
                if (/\bap\.\s*\d+/i.test(String(item.seccion || ""))) boost -= 0.60;
                if (String(item.texto || item.content || "").length < 500) boost -= 0.30;
                if ((isExtintorQuery || isDetectionMaintenanceQuery) && (seccion.includes("anexo iii") || seccion.includes("anexo iv"))) boost -= 0.90;

                if (isAnexoIIQuery) {
                    if (labelText.includes("anexo ii")) boost += 2.40;
                    if (labelText.includes("anexo i") && !labelText.includes("anexo ii")) boost -= 1.40;
                    if (labelText.includes("apendice")) boost -= 0.80;
                }
                if (isAnexoIIQuery && isHidrantesQuery) {
                    if (labelText.includes("anexo ii") && labelText.includes("hidrante")) boost += 2.20;
                    if (texto.includes("hidrante")) boost += 0.35;
                    if (!labelText.includes("hidrante")) boost -= 0.45;
                }

                if (isExtintorQuery && seccion.includes("anexo i") && seccion.includes("extintores de incendio")) boost += 2.50;
                if (isExtintorQuery && texto.includes("extintores de incendio")) boost += 0.55;
                if ((qNormalized.includes("bie") || qNormalized.includes("bocas de incendio")) && seccion.includes("bocas de incendio equipadas")) boost += 1.40;

                if (isDetectionMaintenanceQuery && seccion.includes("anexo ii")) boost += 2.20;
                if (isDetectionMaintenanceQuery && (seccion.includes("deteccion") || texto.includes("deteccion"))) boost += 0.45;
                if (isDetectionMaintenanceQuery && (seccion.includes("alarma") || texto.includes("alarma"))) boost += 0.45;
                if (isDetectionMaintenanceQuery && (seccion.includes("mantenimiento") || texto.includes("mantenimiento"))) boost += 0.35;
                if (isDetectionMaintenanceQuery && (texto.includes("trimestral") || texto.includes("anual") || texto.includes("cinco anos"))) boost += 0.35;

                for (const term of anexoTopicTerms) {
                    if (qNormalized.includes(term) && seccion.includes(term)) boost += 0.20;
                    if (qNormalized.includes(term) && texto.includes(term)) boost += 0.08;
                }

                return getScore(item) + boost;
            };

            validData.sort((a: any, b: any) => scoreAnexoKeyword(b) - scoreAnexoKeyword(a));
        }

        console.log("[ASK][VALIDDATA] top fragments:");
        validData.slice(0, 10).forEach((item: any, i: number) => {
            const snippet = String(item.texto || item.content || "").substring(0, 180).replace(/\n/g, " ");
            console.log(`[ASK][VALIDDATA][${i + 1}] id=${item.id ?? "N/A"} | tipo=${item.tipo || "N/A"} | seccion="${item.seccion || ""}" | source_label="${item.source_label || ""}" | score=${getScore(item).toFixed(3)} | texto="${snippet}"`);
        });

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
        debugTiming.validDataCount = validData.length;

        const articuloFoundInFragments = (articuloRegex instanceof RegExp)
            ? validData.some((f: any) => articuloRegex.test(String(f.seccion || "")))
            : false;

        // Bypass also when a keyword rule already pinned the norma and the RPC
        // returned fragments — embedding similarity is low for keyword-based queries,
        // not because the content is absent.
        const keywordRulePinned = parsedNormaId !== null && validData.length >= 1;
        const hasSingleHighConfidenceEvidence =
            validData.length === 1 &&
            bestScore >= 0.85 &&
            String(validData[0]?.texto || validData[0]?.content || "").length >= 300;

        const bypassEvidence =
            (articuloFoundInFragments && validData.length >= 1) ||
            keywordRulePinned ||
            hasSingleHighConfidenceEvidence;

        debugInfo.articuloMencionado = articuloMencionado;
        debugInfo.articuloFoundInFragments = articuloFoundInFragments;
        debugInfo.keywordRulePinned = keywordRulePinned;
        debugInfo.hasSingleHighConfidenceEvidence = hasSingleHighConfidenceEvidence;
        debugInfo.bypassEvidence = bypassEvidence;
        console.log(`[ASK] hasEnoughEvidence=${hasEnoughEvidence} | keywordRulePinned=${keywordRulePinned} | bypassEvidence=${bypassEvidence}`);

        if (!validData.length || (!hasEnoughEvidence && !bypassEvidence)) {
            console.log(`[ASK] → Devolviendo "No consta" (validData.length=${validData.length})`);
            debugTiming.filterRankMs = nowMs() - filterRankStartedAt;
            debugInfo.debugTiming = finalizeDebugTiming();
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
        // Re-sort or strictly filter so fragments matching the mentioned article float to the top
        if (articuloMencionado && !usedDirectFetch) {
            const artNum = articuloMencionado.toLowerCase().trim();
            const safeArtNum = artNum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            // Regex explícito para detectar "artículo 3", "art. 3", "art 3" (tolerante)
            const explicitArtRegex = new RegExp(`\\bart(?:[íi]culo|iculo|icul|ic|\\.?)?\\s*${safeArtNum}\\b`, 'i');

            const isArticleStrictMatch = (f: any) => {
                const sec = String(f.seccion || "");
                const ar = String(f.articulo || "");
                const an = String(f.article_number || "");
                
                // 1) Match explícito con la regex tolerante
                if (explicitArtRegex.test(sec)) return true;
                if (explicitArtRegex.test(ar)) return true;
                
                // 2) Match estricto directamente con article_number o articulo aislado
                if (an.toLowerCase().trim() === artNum) return true;
                if (ar.toLowerCase().trim() === artNum) return true;
                
                // 3) Fallback permisivo de contención del número aislado en seccion o articulo
                const numRegex = new RegExp(`\\b${safeArtNum}\\b`, 'i');
                if (numRegex.test(sec) || numRegex.test(ar)) return true;
                
                return false;
            };

            const isArticleFallbackMatch = (f: any) => {
                const text = String(f.texto || f.content || "");
                // Regex muy relajado para el interior del texto: /art[íi]?c?\.?\s*3/i etc.
                const looseArtRegex = new RegExp(`\\bart(?:[íi]c(?:ulo)?)?\\.?\\s*${safeArtNum}\\b`, 'i');
                return looseArtRegex.test(text);
            };

            const strictMatchedFrags = validData.filter(isArticleStrictMatch);
            const fallbackMatchedFrags = validData.filter(isArticleFallbackMatch);

            console.log(`[DIAG-ARTICLE] Total filas antes de filtrar (validData.length): ${validData.length}`);
            console.log(`[DIAG-ARTICLE] Filas que pasan match ESTRICTO: ${strictMatchedFrags.length}`);
            console.log(`[DIAG-ARTICLE] Filas que pasan match FALLBACK (texto): ${fallbackMatchedFrags.length}`);

            if (strictMatchedFrags.length > 0) {
                validData.splice(0, validData.length, ...strictMatchedFrags);
                console.log(`[BOOST] Artículo mencionado: ${artNum} → aislados ${strictMatchedFrags.length} fragmentos ESTRICTOS. Resto ignorados.`);
            } else {
                // Fallback: buscamos el artículo dentro del texto del fragmento
                const fallbackMatchedFrags = validData.filter(isArticleFallbackMatch);

                if (fallbackMatchedFrags.length > 0) {
                    validData.splice(0, validData.length, ...fallbackMatchedFrags);
                    console.log(`[BOOST] Artículo mencionado: ${artNum} → aislados ${fallbackMatchedFrags.length} fragmentos por FALLBACK (en texto). Resto ignorados.`);
                } else {
                    if (validNormaId !== null) {
                        // Cortafuegos estricto: norma clara y no se encontró el artículo en ningún lado -> vaciamos resultados
                        validData.splice(0, validData.length);
                        console.log(`[BOOST] Artículo ${artNum} NO encontrado y norma fija. Vaciando resultados (cortafuegos total).`);
                    } else {
                        // Norma ambigua: ordenamos para no destruir la búsqueda fallback
                        validData.sort((a: any, b: any) => getScore(b) - getScore(a));
                        console.log(`[BOOST] Artículo no encontrado pero norma=null, ordenando por defecto.`);
                    }
                }
            }
        }
        // --------------------------------------------------------------------------
        debugTiming.filterRankMs = nowMs() - filterRankStartedAt;

        const isLiteralMatch =
            /(qué\s+dice|texto\s+literal|transcribe|copia)\s+.*(art(?:í|i)culo|art\.)\s*\d+/i.test(
                question
            ) || /(art(?:í|i)culo|art\.)\s*\d+/i.test(question);

        if (xDebug) debugInfo.isLiteralMatch = isLiteralMatch;

        let answer = "";

        if (!isLiteralMatch) {
            try {
                const contextStartedAt = nowMs();
                // --- Reconstruct complete articles from fragments -------------------
                // seccion values look like "Artículo 5 [Bloque 3]".
                // Strip the internal block marker to get the base article reference.
                const baseArticle = (frag: any) =>
                    buildSourceLabel(frag).replace(/\s*\[Bloque\s+\d+\]/gi, "").trim();
                const displayArticle = (frag: any) =>
                    String(frag.source_label || buildSourceLabel(frag)).replace(/\s*\[Bloque\s+\d+\]/gi, "").trim();

                // Group all fragments (not just the top slice) by their base article key
                const articleMap = new Map<string, { label: string; frags: any[] }>();
                for (const frag of validData) {
                    const key = baseArticle(frag) || `__frag_${frag.id}`;
                    if (!articleMap.has(key)) articleMap.set(key, { label: displayArticle(frag) || key, frags: [] });
                    articleMap.get(key)!.frags.push(frag);
                }

                // Sort each group by id (ascending) so text reads in document order
                for (const group of articleMap.values()) {
                    group.frags.sort((a: any, b: any) => (a.id ?? 0) - (b.id ?? 0));
                }

                // Build context from reconstructed articles without changing retrieval/sources.
                const broadOrComparativeQuery = [
                    "obligaciones",
                    "requisitos",
                    "diferencias",
                    "comparar",
                    "comparacion",
                    "aplica",
                    "normativa aplicable",
                    "que establece",
                ].some((term) => qNormalized.includes(term));
                const maxContextGroups = broadOrComparativeQuery ? 10 : 8;
                const maxContextChars = broadOrComparativeQuery ? 18000 : 14000;
                const candidateContextGroups = Array.from(articleMap.values()).map((group) => [group.label, group.frags] as [string, any[]]);
                const contextGroups: Array<[string, any[]]> = [];
                let contextCharsBudget = 0;
                const buildContextBlock = (label: string, frags: any[], index: number) => {
                    const first = frags[0] || {};
                    const normaCodigo = first.codigo || (first.norma_id ? `Norma ID ${first.norma_id}` : "Norma ID no disponible");
                    const normaTitulo = first.norma_titulo || "Titulo no disponible";
                    const fullText = frags
                        .map((f: any) => f.texto || f.content || "")
                        .join("\n");

                    return `[${index}]\nNorma: ${normaCodigo} - ${normaTitulo}\nArticulo/seccion: ${label}\nTexto:\n${fullText}`;
                };

                for (const [label, frags] of candidateContextGroups) {
                    if (contextGroups.length >= maxContextGroups) break;

                    const nextBlock = buildContextBlock(label, frags, contextGroups.length + 1);
                    const nextChars = nextBlock.length + (contextGroups.length > 0 ? 2 : 0);

                    if (contextGroups.length > 0 && contextCharsBudget + nextChars > maxContextChars) {
                        break;
                    }

                    contextGroups.push([label, frags]);
                    contextCharsBudget += nextChars;
                }
                if (xDebug) {
                    console.log("[ASK][CONTEXT] Fragmentos/grupos enviados al modelo:");
                    contextGroups.slice(0, 10).forEach(([label, frags], i) => {
                        const first = frags[0] || {};
                        const snippet = String(first.texto || first.content || "").substring(0, 180).replace(/\n/g, " ");
                        console.log(`[ASK][CONTEXT][${i + 1}] id=${first.id ?? "N/A"} | tipo=${first.tipo || "N/A"} | seccion="${first.seccion || label}" | source_label="${first.source_label || label}" | score=${getScore(first).toFixed(3)} | texto="${snippet}"`);
                    });
                }

                const reconstructedArticles = contextGroups
                    .map(([label, frags], i) => {
                        return buildContextBlock(label, frags, i + 1);
                    });

                const context = reconstructedArticles.join("\n\n");
                debugTiming.contextChars = context.length;
                debugTiming.contextGroupsCount = contextGroups.length;
                debugTiming.contextMs = nowMs() - contextStartedAt;

                const isPeriodicityOrMaintenanceQuery = [
                    "cada cuanto",
                    "periodicidad",
                    "revisar",
                    "revisarse",
                    "revision",
                    "mantenimiento",
                    "inspeccion",
                    "trimestral",
                    "anual",
                    "quinquenal",
                    "timbrado",
                    "retimbrado",
                ].some((term) => qNormalized.includes(term));
                const periodicityInstruction = isPeriodicityOrMaintenanceQuery
                    ? `\n\nSi en las fuentes aparecen varias periodicidades distintas, debes mencionarlas todas. No reduzcas la respuesta a una sola periodicidad. Distingue claramente entre verificaciones/revisiones trimestrales, mantenimiento anual, inspecciones, timbrado y retimbrado cuando aparezcan en las fuentes. Si una periodicidad corresponde a otro equipo o sistema distinto, no la mezcles.`
                    : "";

                const openaiStartedAt = nowMs();
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
<Indica la fuente exacta usando la Norma y el Articulo/seccion que aparecen en el CONTEXTO. Para articulos usa [Norma - Articulo X]. Para anexos usa [Norma - seccion completa recibida], por ejemplo [RD-513-2017 - ANEXO II - Sistemas de bocas de incendio equipadas]. Prohibido inventar "Ap." si no aparece exactamente en esa etiqueta.>

Reglas adicionales:
- Responde ÚNICAMENTE con información contenida en los fragmentos. No uses conocimiento externo ni inventes datos.
- No mezcles normas que no figuren en los fragmentos recuperados.
- Si la información no aparece en los fragmentos, responde exactamente: "No consta en las normas consultadas."

Antes de responder, clasifica internamente la pregunta:
- Si pregunta qué norma aplica o qué normativa regula algo, responde identificando la norma principal y, si procede, normas secundarias.
- Si compara obligaciones, plazos o condiciones, separa claramente cada caso.
- Si varios artículos aparecen en el contexto, prioriza el que responda directamente y evita citar artículos irrelevantes.
- Responde con criterio técnico concreto; no des respuestas genéricas si el contexto permite concretar.

Cuando el contexto contenga información normativa concreta (valores, medidas, condiciones, frecuencias o requisitos técnicos), debes responder con ese dato exacto y no con una explicación general.

Si el contexto incluye varias condiciones diferenciadas (por ejemplo, distintos tipos de mantenimiento), debes enumerarlas claramente en lugar de resumirlas.

Cuando la pregunta implique comparar dos o más casos (por ejemplo, mantenimiento trimestral vs anual), debes estructurar la respuesta claramente separando cada caso, usando formato tipo:

- Mantenimiento trimestral:
  ...

- Mantenimiento anual:
  ...

No mezclar ambos en un mismo párrafo.${periodicityInstruction}`,
                        },
                        { role: "user", content: `PREGUNTA: ${question}\n\nCONTEXTO:\n${context}` },
                    ],
                    max_tokens: 500,
                    temperature: 0,
                });
                debugTiming.openaiMs = nowMs() - openaiStartedAt;

                answer = completion.choices[0].message.content || "";
            } catch (openaiError: any) {
                console.error("OpenAI RAG error:", openaiError);
                debugInfo.openaiError = openaiError?.message;
                debugInfo.debugTiming = finalizeDebugTiming();

                const respPayload: any = {
                    ok: true,
                    data: [],
                    message: "No consta en la normativa cargada (o no hay evidencia suficiente en los fragmentos recuperados).",
                };

                if (xDebug) respPayload.debug = debugInfo;
                return NextResponse.json(respPayload);
            }
        }

        const topKData = isAnexoIIQuery && !articuloMencionado
            ? [
                ...validData.filter((item: any) => {
                    const labelText = normalizeForSearch(`${item.seccion || ""} ${item.source_label || buildSourceLabel(item)}`);
                    return labelText.includes("anexo ii");
                }).slice(0, 8),
                ...validData.filter((item: any) => {
                    const labelText = normalizeForSearch(`${item.seccion || ""} ${item.source_label || buildSourceLabel(item)}`);
                    return !labelText.includes("anexo ii");
                }).slice(0, 3),
            ]
            : validData.slice(0, safeK);

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
            const highlightsStartedAt = nowMs();
            try {
                await Promise.all(topKData.slice(0, 4).map(async (item) => {
                    const textBase = item.texto || item.content || "";
                    if (!textBase) return;

                    const sentences = textBase
                        .split(/(?:\.|\n)+/)
                        .map((s: string) => s.trim())
                        .filter((s: string) => s.length > 20)
                        .slice(0, 8);

                    if (sentences.length === 0) return;

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
                }));
            } catch (highlightErr) {
                console.error("Highlight calculation error:", highlightErr);
            } finally {
                debugTiming.highlightsMs = nowMs() - highlightsStartedAt;
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

        let finalAnswer = isNoInfo ? "No consta en las normas consultadas." : answer;
        let finalDataArr = isNoInfo ? [] : processedData;
        finalDataArr = finalDataArr.map((item: any) => ({
            ...item,
            source_label: item.source_label || buildSourceLabel(item),
        }));

        // Última comprobación de seguridad estructural exigida por la foto fija
        if (!finalAnswer || finalAnswer.trim() === "" || finalDataArr.length === 0) {
            finalAnswer = "No consta en las normas consultadas.";
            finalDataArr = [];
        }

        const okPayload: any = {
            ok: true,
            answer: finalAnswer,
            data: finalDataArr,
            sources: finalDataArr,
        };

        if (finalDataArr.length === 0) {
            okPayload.highlights = [];
        }

        if (xDebug && articuloMencionado) {
            console.log(`\n[DIAG-ARTICLE] ==== RESULTADO FINAL ====`);
            console.log(`[DIAG-ARTICLE] validData final length: ${validData.length}`);
            console.log(`[DIAG-ARTICLE] processedData final length: ${processedData.length}`);
            console.log(`[DIAG-ARTICLE] answer length: ${finalAnswer.length}, snippet: "${finalAnswer.substring(0, 50)}..."`);
        }

        debugTiming.sourcesCount = finalDataArr?.length ?? 0;
        debugInfo.debugTiming = finalizeDebugTiming();

        if (xDebug) {
            console.log("=== DEBUG SOURCES ===");
            console.log("sources_count:", finalDataArr?.length);
            console.log("sources:", finalDataArr);
        }

        if (xDebug) okPayload.debug = debugInfo;

        if (xDebug) {
            console.log("=== DEBUG FINAL RESPONSE FIXED ===");
            console.log("final_response_keys:", Object.keys(okPayload || {}));
            console.log("final_response_sources_count:", okPayload?.sources?.length ?? null);
            console.log("final_response_sources:", okPayload?.sources ?? null);
        }

        return NextResponse.json(okPayload);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
