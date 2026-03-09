import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { extractTextFromUploadedFile, parseNormaJuridica } from '@/lib/normativas/parser';
import { processNormaPipeline } from '@/lib/normativas/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Timeout de Vercel extendido (min 60s)

export async function POST(req: Request) {
    try {
        /* --- AUTH DESACTIVADA TEMPORALMENTE ---
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
        }
        */


        const supabaseUrl = process.env.SUPABASE_URL!;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        /* --- AUTH DESACTIVADA TEMPORALMENTE ---
        const token = authHeader.replace("Bearer ", "");
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);

        if (authError || !user) {
            return NextResponse.json({ error: "Invalid token or user not found" }, { status: 401 });
        }
        */


        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        const titulo = formData.get("titulo") as string | null;
        const codigo = formData.get("codigo") as string | null;
        const ambito = formData.get("ambito") as string | null;
        const rango = formData.get("rango") as string | null;
        const jurisdiccion = formData.get("jurisdiccion") as string | null;
        const fecha_publicacion = formData.get("fecha_publicacion") as string | null;

        if (!file || !titulo || !codigo) {
            return NextResponse.json({ error: "Faltan campos obligatorios (file, titulo, codigo)" }, { status: 400 });
        }

        const insertData = {
            titulo,
            codigo,
            ambito: ambito || null,
            rango: rango || null,
            jurisdiccion: jurisdiccion || null,
            fecha_publicacion: fecha_publicacion || null,
            owner_user_id: null, // user.id (Cambiado a null por Auth desactivada)
            estado: 'vigente',
            estado_ingesta: 'procesando',
            nombre_archivo: file.name,
            mime_type: file.type || 'application/pdf',
            fecha_ingesta: new Date().toISOString()
        };

        const { data: insertedNorma, error: insertError } = await supabase
            .from("normas")
            .insert(insertData)
            .select("id")
            .single();

        if (insertError) {
            console.error("Error inserting norma:", insertError);
            return NextResponse.json(
                { error: "Error al registrar la norma", details: insertError.message },
                { status: 500 }
            );
        }

        // --- INGESTIÓN PIPELINE ---
        try {
            // Pasamos el file del FormData (Blob/File genérico del Next Request)
            const rawText = await extractTextFromUploadedFile(file, (file as any).name);
            const metadataProxy = {
                titulo, codigo, ambito, rango, jurisdiccion,
                fecha_publicacion: fecha_publicacion || undefined
            };
            const fragments = parseNormaJuridica(rawText, metadataProxy);

            await processNormaPipeline(insertedNorma.id, fragments, metadataProxy);

        } catch (pipelineError: any) {
            console.error("Pipeline failure:", pipelineError);
            // Blindaje de estado si falla el procesado
            await supabase.from('normas').update({
                estado_ingesta: 'error',
                error_ingesta: pipelineError.message || "Error desconocido en ingestión / parsing"
            }).eq('id', insertedNorma.id);
            throw pipelineError; // Forzar que caiga en el return 500 final a nivel HTTP
        }

        return NextResponse.json({
            ok: true,
            normaId: insertedNorma.id,
            message: "Norma registrada, parseada e indexada correctamente con sus vectores."
        });

    } catch (error: any) {
        console.error("Upload API Error:", error);
        return NextResponse.json({ error: error.message || "Error interno del servidor" }, { status: 500 });
    }
}
