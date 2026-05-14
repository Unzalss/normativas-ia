import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { AdminAuthError, requireAdmin } from "@/lib/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    try {
        const authHeader = req.headers.get("Authorization");
        const authSupabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: authHeader || "" } } }
        );

        await requireAdmin(req, authSupabase);

        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data, error } = await supabase
            .from("normas")
            .select(`
                id,
                titulo,
                codigo,
                estado_ingesta,
                num_fragmentos,
                num_articulos_detectados,
                num_anexos_detectados,
                fecha_ingesta,
                fecha_publicacion,
                estado,
                materia,
                ambito,
                jurisdiccion,
                error_ingesta
            `)
            .order("fecha_ingesta", { ascending: false, nullsFirst: false })
            .order("id", { ascending: false });

        if (error) throw error;

        return NextResponse.json({ ok: true, data });
    } catch (err: unknown) {
        if (err instanceof AdminAuthError) {
            return NextResponse.json(
                { ok: false, error: err.message },
                { status: err.status }
            );
        }

        const message = err instanceof Error ? err.message : "Error interno del servidor";
        return NextResponse.json(
            { ok: false, error: message },
            { status: 500 }
        );
    }
}
