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

        const { data, error } = await supabase.rpc("buscar_norma_partes", {
            q_embedding,
            q_norma_id: normaId,
            k,
        });

        if (error) throw error;

        return NextResponse.json({ ok: true, data });

    } catch (err: any) {
        return NextResponse.json(
            { error: err.message },
            { status: 500 }
        );
    }
}
