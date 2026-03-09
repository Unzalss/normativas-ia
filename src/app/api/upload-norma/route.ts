import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { extractTextFromUploadedFile, parseNormaJuridica } from '@/lib/normativas/parser';
import { processNormaPipeline } from '@/lib/normativas/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Timeout de Vercel extendido (min 60s)

export async function POST(req: Request) {
    try {
        const supabaseUrl = process.env.SUPABASE_URL!;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        const titulo = formData.get("titulo") as string | null;
        const codigo = formData.get("codigo") as string | null;
        const ambito = formData.get("ambito") as string | null;
        const rango = formData.get("rango") as string | null;
        const jurisdiccion = formData.get("jurisdiccion") as string | null;
        const fecha_publicacion = formData.get("fecha_publicacion") as string | null;
        const version_of = formData.get("version_of") as string | null;

        if (!file || !titulo || !codigo) {
            return NextResponse.json({ error: "Faltan campos obligatorios (file, titulo, codigo)" }, { status: 400 });
        }

        // --- CÁLCULO DE HASH DEL ARCHIVO ---
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const document_hash = crypto.createHash('sha256').update(buffer).digest('hex');

        // --- COMPROBACIÓN PREVIA DE DUPLICADOS POR CÓDIGO (Solo normas globales) ---
        const { data: existingGlobalNorma, error: duplicateCheckError } = await supabase
            .from('normas')
            .select('id')
            .eq('codigo', codigo)
            .is('owner_user_id', null)
            .limit(1)
            .maybeSingle();

        if (duplicateCheckError) {
            return NextResponse.json(
                { error: "Error de base de datos al comprobar duplicados por código." },
                { status: 500 }
            );
        }

        if (existingGlobalNorma) {
            return NextResponse.json({
                status: "duplicado",
                message: "Ya existe una norma con ese código",
                norma_id: existingGlobalNorma.id
            }, { status: 409 });
        }

        // --- COMPROBACIÓN PREVIA DE DUPLICADOS POR HASH (Solo normas globales) ---
        const { data: existingHashNorma, error: hashCheckError } = await supabase
            .from('normas')
            .select('id')
            .eq('document_hash', document_hash)
            .is('owner_user_id', null)
            .limit(1)
            .maybeSingle();

        if (hashCheckError) {
            return NextResponse.json(
                { error: "Error de base de datos al comprobar el hash del documento." },
                { status: 500 }
            );
        }

        if (existingHashNorma) {
            return NextResponse.json({
                status: "duplicado_hash",
                message: "Ya existe una norma con el mismo archivo",
                norma_id: existingHashNorma.id
            }, { status: 409 });
        }

        const insertData = {
            titulo,
            codigo,
            ambito: ambito || null,
            rango: rango || null,
            jurisdiccion: jurisdiccion || null,
            fecha_publicacion: fecha_publicacion || null,
            document_hash,
            version_of: version_of || null,
            owner_user_id: null,
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
            const rawText = await extractTextFromUploadedFile(file, (file as any).name);
            const metadataProxy = {
                titulo, codigo, ambito, rango, jurisdiccion,
                fecha_publicacion: fecha_publicacion || undefined
            };
            const fragments = parseNormaJuridica(rawText, metadataProxy);

            await processNormaPipeline(insertedNorma.id, fragments, metadataProxy);

        } catch (pipelineError: any) {
            console.error("Pipeline failure:", pipelineError);
            await supabase.from('normas').update({
                estado_ingesta: 'error',
                error_ingesta: pipelineError.message || "Error desconocido en ingestión / parsing"
            }).eq('id', insertedNorma.id);
            throw pipelineError;
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
