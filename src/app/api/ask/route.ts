import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    try {
        const xDebug = req.headers.get("x-debug") === "1";
        const { question, normaId, k = 8 } = await req.json();

        if (!question) {
            return NextResponse.json({ error: "Falta question" }, { status: 400 });
        }

        // Parse normaId explicitly to ensure global searches
        let parsedNormaId: number | null = null;
        if (normaId !== null && normaId !== undefined && normaId !== "" && String(normaId) !== "all") {
            const num = Number(normaId);
            if (!isNaN(num)) parsedNormaId = num;
        }

        const debugInfo: any = {
            normaIdRecibido: normaId,
            normaIdResuelto: parsedNormaId,
            threshold: "N/A (using order by distance limit k)",
            limit: k,
            filasDevueltas1: 0,
            filasDevueltas2: 0,
            rpcParamErrors: null
        };

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const embeddingRes = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: question,
            dimensions: 1536,
        });

        const q_embedding = embeddingRes.data[0].embedding;

        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const isValidFragment = (text: string) => {
            if (text.length < 80) return false;
            if (/\.{5,}/.test(text)) return false; // Sequence of dots (index)
            if (/\s\d{1,3}\s*$/.test(text)) return false; // Ends in page number
            return true;
        };

        // First attempt with requested k
        // The RPC "buscar_norma_partes" accepts: q_embedding, q_norma_id, k.
        const rpcPayload = {
            q_embedding,
            q_norma_id: parsedNormaId,
            k
        };

        let { data: rawData, error } = await supabase.rpc("buscar_norma_partes", rpcPayload);

        console.log("--- Búsqueda en Supabase 1 ---");
        console.log(`norma_id: ${parsedNormaId}, limit(k): ${k}`);
        if (error) {
            console.error("Error RPC 1:", error.message, error.details);
            debugInfo.rpcParamErrors = error;
            return NextResponse.json({ error: `Supabase RPC Error: ${error.message} - ${error.details}`, debug: xDebug ? debugInfo : undefined }, { status: 500 });
        }

        debugInfo.filasDevueltas1 = rawData?.length || 0;
        console.log(`Filas devueltas 1: ${rawData?.length || 0}`);

        let validData = (rawData || []).filter((item: any) => isValidFragment(item.content || item.texto || ""));

        // If not enough valid results, try fetching more
        if (validData.length < k) {
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

        debugInfo.bestScore = bestScore;
        debugInfo.strongCount = strongCount;
        debugInfo.mediumCount = mediumCount;

        // Condición para permitir OpenAI
        const hasEnoughEvidence = (strongCount >= 1 || mediumCount >= 2);
        debugInfo.hasEnoughEvidence = hasEnoughEvidence;

        if (!validData.length || !hasEnoughEvidence) {
            const respPayload: any = {
                ok: true,
                data: validData.slice(0, k), // Se devuelven las fuentes (aún insuficientes) para transparencia visual
                message: "No consta en la normativa cargada (o no hay evidencia suficiente en los fragmentos recuperados)."
            };
            if (xDebug) respPayload.debug = debugInfo;
            return NextResponse.json(respPayload);
        }

        // 3. RAG Generation
        let answer = "";
        try {
            const context = validData.slice(0, 6).map((x: any, i: number) => `[${i + 1}] ${x.seccion || 'Fragmento'}: ${x.texto || x.content}`).join("\n\n");

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "Eres un asistente técnico-jurídico. Responde únicamente usando la información del contexto. Si la respuesta no aparece en el contexto, indícalo." },
                    { role: "user", content: `PREGUNTA: ${question}\n\nCONTEXTO:\n${context}` }
                ],
                max_tokens: 300, // Limit to ~1200 chars roughly
                temperature: 0,
            });

            answer = completion.choices[0].message.content || "";
        } catch (openaiError: any) {
            console.error("OpenAI RAG error:", openaiError);
            debugInfo.openaiError = openaiError?.message;
            // Fallback: first fragment trimmed
            const first = validData[0];
            answer = (first.content || first.texto || "").substring(0, 500) + "...";
        }

        // Return answer and data
        const okPayload: any = {
            ok: true,
            answer: answer,
            data: validData.slice(0, k)
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
