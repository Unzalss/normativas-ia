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

        // Return up to k items
        return NextResponse.json({ ok: true, data: validData.slice(0, k) });

    } catch (err: any) {
        return NextResponse.json(
            { error: err.message },
            { status: 500 }
        );
    }
}
