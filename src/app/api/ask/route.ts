import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    try {
        const { question, normaId, k = 8 } = await req.json();

        if (!question) {
            return NextResponse.json({ error: "Falta question" }, { status: 400 });
        }

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
        let { data: rawData, error } = await supabase.rpc("buscar_norma_partes", {
            q_embedding,
            q_norma_id: normaId,
            k,
        });

        if (error) throw error;

        let validData = (rawData || []).filter((item: any) => isValidFragment(item.content || item.texto || ""));

        // If not enough valid results, try fetching more
        if (validData.length < k) {
            const kRetry = k * 3;
            // console.log(`Not enough valid fragments (${validData.length}/${k}). Retrying with k=${kRetry}...`);

            const { data: retryData, error: retryError } = await supabase.rpc("buscar_norma_partes", {
                q_embedding,
                q_norma_id: normaId,
                k: kRetry,
            });

            if (!retryError && retryData) {
                validData = retryData.filter((item: any) => isValidFragment(item.content || item.texto || ""));
            }
        }

        // 1. Relevance Gate: Keyword Match
        const q = question.toLowerCase();

        // Advanced Tokenization
        const stopwords = new Set(["el", "la", "los", "las", "de", "del", "y", "o", "a", "en", "un", "una", "que", "qué", "como", "cómo", "cuál", "cual", "cuanto", "cuánto", "es", "son", "para", "por", "con", "sin", "sobre", "entre", "al", "se", "si", "su", "sus", "lo"]);

        const keywords = q.split(/\s+/)
            .map((w: string) => w.replace(/[.,;?!¿¡"()]/g, '')) // clean punctuation
            .filter((w: string) =>
                w.length >= 4 &&             // length >= 4
                !stopwords.has(w) &&         // not a stopword
                isNaN(Number(w))             // not a number
            );

        // Only enforce keyword match if we successfully extracted significant keywords
        if (keywords.length > 0) {
            // Create a blob of all valid fragment texts to search against
            const blob = validData.map((x: any) => (x.content || x.texto || "").toLowerCase()).join("\n");

            const hasKeywordMatch = keywords.some((k: string) => blob.includes(k));

            if (!hasKeywordMatch) {
                return NextResponse.json({
                    ok: true,
                    data: [],
                    message: "La pregunta no corresponde a la normativa cargada."
                });
            }
        }

        // 2. Relevance Gate: Check Score
        // Get max score from valid items
        const bestScore = validData.reduce((max: number, item: any) => {
            const score = typeof item.score === 'number' ? item.score : (item.similarity || 0);
            return score > max ? score : max;
        }, 0);

        if (bestScore < 0.60) {
            return NextResponse.json({
                ok: true,
                data: [],
                message: "La pregunta no corresponde a la normativa cargada."
            });
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
        } catch (openaiError) {
            console.error("OpenAI RAG error:", openaiError);
            // Fallback: first fragment trimmed
            const first = validData[0];
            answer = (first.content || first.texto || "").substring(0, 500) + "...";
        }

        // Return answer and data
        return NextResponse.json({
            ok: true,
            answer: answer,
            data: validData.slice(0, k)
        });

    } catch (err: any) {
        return NextResponse.json(
            { error: err.message },
            { status: 500 }
        );
    }
}
