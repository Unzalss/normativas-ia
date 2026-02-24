import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    try {
        const { question, normaId, normaCodigo, k = 8 } = await req.json();

        if (!question) {
            return NextResponse.json({ error: "Falta question" }, { status: 400 });
        }

        console.log("SUPABASE_URL =", process.env.SUPABASE_URL);
        console.log("SERVICE_ROLE present =", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
        console.log("OPENAI present =", !!process.env.OPENAI_API_KEY);

        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Parse normaId explicitly to ensure global searches
        let parsedNormaId: number | null = null;

        // 1. Si nos envían normaCodigo, forzamos la búsqueda de su ID real en la BD
        if (normaCodigo) {
            const normalizeNormaCodigo = (input: string) => {
                return input.trim().replace(/\s+/g, ' ');
            };

            const aliasMap: Record<string, string> = {
                "ORD_PCI_ZARAGOZA": "ZAR-PPCI",
            };

            let normalizedInput = normalizeNormaCodigo(normaCodigo);
            let codigoFinal = aliasMap[normalizedInput.toUpperCase()] || normalizedInput;

            const { data: normaData } = await supabase
                .from('normas')
                .select('id')
                .ilike('codigo', codigoFinal)
                .single();

            if (normaData) {
                parsedNormaId = normaData.id;
            } else {
                // Return immediate empty if strict normaCodigo is asked but doesn't exist
                return NextResponse.json({
                    ok: true,
                    answer: "No consta (no se encontró la norma seleccionada)",
                    sources: [],
                    citations: []
                });
            }
        }
        // 2. Fallback al comportamiento original (normaId numérico directo)
        else if (normaId !== null && normaId !== undefined && normaId !== "" && String(normaId) !== "all") {
            const num = Number(normaId);
            if (!isNaN(num)) parsedNormaId = num;
        }

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

        console.log("--- DEBUG RPC ---");
        console.log("embedding generado (preview):", q_embedding.slice(0, 5), "...");
        console.log("norma_id usado:", parsedNormaId);

        // First attempt with requested k
        let { data: rawData, error } = await supabase.rpc("buscar_norma_partes", {
            q_embedding,
            q_norma_id: parsedNormaId,
            k,
            q_text: question
        });

        console.log("resultados crudos de la RPC:", JSON.stringify(rawData, null, 2));
        console.log("-----------------");

        if (error) throw error;

        let validData = (rawData || []).filter((item: any) => isValidFragment(item.content || item.texto || ""));

        // If not enough valid results, try fetching more
        if (validData.length < k) {
            const kRetry = k * 3;
            // console.log(`Not enough valid fragments (${validData.length}/${k}). Retrying with k=${kRetry}...`);

            const { data: retryData, error: retryError } = await supabase.rpc("buscar_norma_partes", {
                q_embedding,
                q_norma_id: parsedNormaId,
                k: kRetry,
                q_text: question
            });

            if (!retryError && retryData) {
                validData = retryData.filter((item: any) => isValidFragment(item.content || item.texto || ""));
            }
        }

        // --- INICIO RE-RANKING HÍBRIDO (HEURÍSTICAS LOCALES) ---
        const qLower = question.toLowerCase();
        const hasObjeto = qLower.includes("objeto");
        const hasAmbito = qLower.includes("ámbito") || qLower.includes("ambito") || qLower.includes("aplica");
        const hasDefinicion = qLower.includes("defin") || qLower.includes("concepto");

        validData = validData.map((item: any) => {
            let lexicalScore = 0;
            const seccion = (item.seccion || "").toLowerCase();
            const texto = (item.texto || item.content || "").toLowerCase();

            if (hasObjeto) {
                if (seccion.includes("artículo 1") || seccion.includes("articulo 1")) lexicalScore += 5;
                if (texto.includes("objeto")) lexicalScore += 3;
            }
            if (hasAmbito) {
                if (seccion.includes("ámbito") || seccion.includes("ambito")) lexicalScore += 5;
                if (texto.includes("ámbito de aplicación") || texto.includes("ambito de aplicacion") || texto.includes("aplicación")) lexicalScore += 3;
            }
            if (hasDefinicion) {
                if (seccion.includes("definicion")) lexicalScore += 5;
                if (texto.includes("a efectos de") || texto.includes("se entiende por")) lexicalScore += 5;
            }

            const vectorScore = typeof item.score === 'number' ? item.score : (item.similarity || 0);

            // Normalize lexical score roughly out of 10 to a 0-1 scale to mix with vector
            const normalizedLexical = Math.min(lexicalScore / 10, 1.0);

            // Final hybrid score weighting (70% vector, 30% lexical)
            const finalScore = (vectorScore * 0.7) + (normalizedLexical * 0.3);

            return {
                ...item,
                originalScore: vectorScore,
                lexicalScore: lexicalScore,
                score: finalScore // override score so subsequent logic uses the hybrid score
            };
        });

        // Re-ordenar por el hybrid score descendente
        validData.sort((a: any, b: any) => b.score - a.score);
        // --- FIN RE-RANKING HÍBRIDO ---

        // 1. Relevance Gate: Grounding & Threshold check
        let bestScore = 0;
        let strongCount = 0;
        let mediumCount = 0;

        for (const item of validData) {
            const score = typeof item.score === 'number' ? item.score : (item.similarity || 0);
            if (score > bestScore) bestScore = score;
            if (score >= 0.70) strongCount++;
            if (score >= 0.60) mediumCount++;
        }

        // Condición para permitir OpenAI (si es false, daremos answer fallback pero CON sources)
        // Rescue pattern: Si el re-ranking léxico encontró una certeza alta (lexicalScore >= 5), forzamos la evidencia.
        let hasEnoughEvidence = (strongCount >= 1 || mediumCount >= 2);

        if (!hasEnoughEvidence) {
            const hasLexicalRescue = validData.some((item: any) => typeof item.lexicalScore === 'number' && item.lexicalScore >= 5);
            if (hasLexicalRescue) {
                hasEnoughEvidence = true;
                console.log("--- RESCUE PATTERN ACTIVADO --- (Evidencia baja pero Lexical Score alto)");
            }
        }

        // Si realmente no hay NADITA (incluso tras reintentar)
        if (!validData.length) {
            return NextResponse.json({
                ok: true,
                answer: "No consta en la normativa cargada (no se halló absolutamente ningún fragmento).",
                citations: [],
                sources: [],
                data: []
            });
        }

        // 4. Construcción estricta de salida: sources y citations (SIEMPRE se calculan si hay data)
        const returnedData = validData.slice(0, k);

        const citations = returnedData.map((item: any, i: number) => ({
            id_fragmento: item.id || `cit-${i}`,
            normaCodigo: item.norma_codigo || item.codigo || (item.normas && item.normas.codigo) || normaCodigo || "",
            seccion: item.seccion || "Fragmento",
            tipo: item.tipo || "Fragmento",
            orden: item.orden || i
        }));

        const sources = returnedData.map((item: any, i: number) => ({
            ...item,
            id: item.id ? String(item.id) : `src-${i}` // Ensures stable ID
        }));

        // 3. RAG Generation
        let answer = "";
        try {
            const context = returnedData.slice(0, 6).map((x: any, i: number) => `[${i + 1}] ${x.seccion || 'Fragmento'}: ${x.texto || x.content}`).join("\n\n");

            let systemMsg = "Eres un asistente técnico-jurídico. Responde únicamente usando la información del contexto. Si la respuesta no aparece en el contexto, indícalo.";

            if (!hasEnoughEvidence) {
                systemMsg = "Eres un asistente técnico-jurídico. Los fragmentos provistos tienen MUY BAJA relevancia para la pregunta. Tu tarea es responder estrictamente empezando con: 'No consta en la norma cargada para esta pregunta. Lo más cercano encontrado es: ' y hacer un resumen muy breve (1 o 2 frases) de lo que sí dice el contexto, sin inventar nada.";
            }

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: systemMsg },
                    { role: "user", content: `PREGUNTA: ${question}\n\nCONTEXTO:\n${context}` }
                ],
                max_tokens: 300, // Limit to ~1200 chars roughly
                temperature: 0,
            });

            answer = completion.choices[0].message.content || "";
        } catch (openaiError) {
            console.error("OpenAI RAG error:", openaiError);
            // Fallback: first fragment trimmed
            const first = returnedData[0];
            answer = (first.content || first.texto || "").substring(0, 500) + "...";
        }

        // Return answer, explicit citations, explicit sources, and raw data for fallback
        return NextResponse.json({
            ok: true,
            answer: answer,
            citations: citations,
            sources: sources,
            data: returnedData
        });

    } catch (err: any) {
        return NextResponse.json(
            { error: err.message },
            { status: 500 }
        );
    }
}
