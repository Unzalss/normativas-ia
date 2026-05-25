import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    try {
        const authHeader = req.headers.get("Authorization");
        const token = authHeader?.startsWith("Bearer ")
            ? authHeader.replace("Bearer ", "")
            : null;

        if (!token) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const authSupabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: authHeader || "" } } }
        );

        const { data: { user }, error: authError } = await authSupabase.auth.getUser(token);

        if (authError || !user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data, error } = await supabase
            .from("normas")
            .select("id, titulo, codigo")
            .or(`owner_user_id.is.null,owner_user_id.eq.${user.id}`)
            .order("id");

        if (error) throw error;

        return NextResponse.json({ ok: true, data });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Error interno del servidor";

        return NextResponse.json(
            { error: message },
            { status: 500 }
        );
    }
}
