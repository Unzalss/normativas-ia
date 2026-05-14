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
                validada,
                fecha_validacion,
                notas_admin,
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

export async function PATCH(req: Request) {
    try {
        const authHeader = req.headers.get("Authorization");
        const authSupabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: authHeader || "" } } }
        );

        await requireAdmin(req, authSupabase);

        const body = await req.json() as {
            id?: unknown;
            validada?: unknown;
            notas_admin?: unknown;
        };

        if (!Number.isInteger(body.id)) {
            return NextResponse.json(
                { ok: false, error: "id inválido" },
                { status: 400 }
            );
        }

        const updatePayload: {
            validada?: boolean;
            fecha_validacion?: string | null;
            notas_admin?: string | null;
        } = {};

        if (typeof body.validada === "boolean") {
            updatePayload.validada = body.validada;
            updatePayload.fecha_validacion = body.validada ? new Date().toISOString() : null;
        }

        if (typeof body.notas_admin === "string" || body.notas_admin === null) {
            updatePayload.notas_admin = body.notas_admin;
        }

        if (Object.keys(updatePayload).length === 0) {
            return NextResponse.json(
                { ok: false, error: "No hay campos permitidos para actualizar" },
                { status: 400 }
            );
        }

        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data, error } = await supabase
            .from("normas")
            .update(updatePayload)
            .eq("id", body.id)
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
                validada,
                fecha_validacion,
                notas_admin,
                error_ingesta
            `)
            .single();

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
