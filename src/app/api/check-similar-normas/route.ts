import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const { codigo, titulo } = await req.json();

        if (!codigo) {
            return NextResponse.json({ error: "Falta el campo obligatorio (codigo)" }, { status: 400 });
        }

        const supabaseUrl = process.env.SUPABASE_URL!;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        // --- COMPROBACIÓN POSTERIOR DE NORMAS PARECIDAS (Solo normas globales) ---
        // Extraemos bloques alfanuméricos relevantes del código para buscar similitudes
        const tokensMatch = codigo.match(/[A-Za-z0-9]+/g);
        const significantTokens = tokensMatch ? tokensMatch.filter((t: string) => t.length > 2) : [];

        if (significantTokens.length > 0) {
            let similarityQuery = supabase
                .from('normas')
                .select('id, codigo, titulo')
                .is('owner_user_id', null)
                .limit(5);

            // Construir filtro OR dinámico con ilike para cada token relevante
            const orConditions = significantTokens.map((token: string) => `codigo.ilike.%${token}%`).join(',');
            similarityQuery = similarityQuery.or(orConditions);

            const { data: similarNorms, error: similarError } = await similarityQuery;

            if (similarError) {
                return NextResponse.json({ error: "Error de base de datos al comprobar similitudes." }, { status: 500 });
            }

            if (similarNorms && similarNorms.length > 0) {
                return NextResponse.json({
                    status: "ok",
                    matches: similarNorms
                });
            }
        }

        return NextResponse.json({
            status: "ok",
            matches: []
        });

    } catch (error: any) {
        console.error("Check Similar API Error:", error);
        return NextResponse.json({ error: error.message || "Error interno del servidor" }, { status: 500 });
    }
}
