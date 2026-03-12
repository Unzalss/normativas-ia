import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { extractTextFromUploadedFile, parseNormaJuridica } from '@/lib/normativas/parser';
import { processNormaPipeline } from '@/lib/normativas/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Timeout de Vercel extendido (min 60s)

function parseSpanishDateToISO(text: string): string | null {
    const months: Record<string, string> = {
        'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
        'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
        'septiembre': '09', 'setiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
    };
    const match = text.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i);
    if (match) {
        const day = match[1].padStart(2, '0');
        const month = months[match[2].toLowerCase()];
        const year = match[3];
        if (day && month && year) return `${year}-${month}-${day}`;
    }
    return null;
}

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
        const materia = formData.get("materia") as string | null;
        const submateria = formData.get("submateria") as string | null;
        const keywords = formData.get("keywords") as string | null;

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
            materia: materia || null,
            submateria: submateria || null,
            keywords: keywords || null,
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

            // --- AUTO Detección Metadata Básica ---
            const textIntro = rawText.substring(0, 2000);

            let detectedRango = rango;
            if (!detectedRango) {
                const matchRango = textIntro.match(/\b(Real Decreto|Ley Orgánica|Ley|Orden|Decreto|Resolución)\b/i);
                if (matchRango) detectedRango = matchRango[1];
            }

            let detectedFecha = fecha_publicacion;
            if (!detectedFecha) {
                const matchFecha = textIntro.match(/de\s+\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4}/i);
                if (matchFecha) {
                    const parsedIso = parseSpanishDateToISO(matchFecha[0]);
                    if (parsedIso) detectedFecha = parsedIso;
                }
            }

            console.log("[METADATA AUTO-REGEX] Rango:", detectedRango, "| Fecha:", detectedFecha);

            let detectedMateria = materia;
            let detectedSubmateria = submateria;

            if (!detectedMateria || !detectedSubmateria) {
                try {
                    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                    const classificationPrompt = `CLASIFICA ESTA NORMA TÉCNICA.

Devuelve JSON con:
materia
submateria

Materias posibles:
- incendios
- accesibilidad
- energía
- urbanismo
- prevención
- seguridad industrial
- medio ambiente
- otros`;

                    const completion = await openai.chat.completions.create({
                        model: "gpt-4o-mini",
                        messages: [
                            { role: "system", content: classificationPrompt },
                            { role: "user", content: `TÍTULO: ${titulo}\n\nTEXTO INTRODUCTORIO:\n${textIntro}` }
                        ],
                        response_format: { type: "json_object" },
                        temperature: 0,
                    });

                    const result = JSON.parse(completion.choices[0].message.content || "{}");
                    if (!detectedMateria && result.materia) detectedMateria = String(result.materia).toLowerCase();
                    if (!detectedSubmateria && result.submateria) detectedSubmateria = String(result.submateria).toLowerCase();
                } catch (e) {
                    console.error("Error en clasificación IA:", e);
                }
            }

            let detectedKeywords = keywords;
            if (!detectedKeywords) {
                const generatedKeywords = [
                    detectedMateria,
                    detectedSubmateria,
                    ...(titulo ? titulo.toLowerCase().split(/[\s,.;:!?()¿¡'"\-]+/).filter(w => w.length > 4) : [])
                ].filter(Boolean);

                // Supabase is expecting a string[] for keywords? Wait, FOTO FIJA says: `keywords` (TEXT[])
                // We'll pass it as a JS array and the Supabase client will handle the PgArray serialization.
                if (generatedKeywords.length > 0) {
                    detectedKeywords = Array.from(new Set(generatedKeywords)) as any;
                }
            }

            if ((detectedRango && !rango) || (detectedFecha && !fecha_publicacion) || (detectedMateria && !materia) || (detectedSubmateria && !submateria) || (detectedKeywords && !keywords)) {

                const updatePayload = {
                    rango: detectedRango || null,
                    fecha_publicacion: detectedFecha || null,
                    materia: detectedMateria || null,
                    submateria: detectedSubmateria || null,
                    keywords: detectedKeywords || null
                };

                console.log("[METADATA AUTO-UPDATE] Payload a guardar en Supabase:", updatePayload);

                const { error: updateError } = await supabase.from('normas').update(updatePayload).eq('id', insertedNorma.id);

                if (updateError) {
                    console.error("[METADATA AUTO-UPDATE ERROR] Fallo al actualizar la tabla normas:", updateError.message, updateError.details);
                } else {
                    console.log("[METADATA AUTO-UPDATE] Fila actualizada exitosamente en DB.");
                }
            }

            const metadataProxy = {
                titulo, codigo, ambito, jurisdiccion,
                rango: detectedRango || null,
                fecha_publicacion: detectedFecha || undefined,
                materia: detectedMateria || undefined,
                submateria: detectedSubmateria || undefined,
                keywords: detectedKeywords || undefined
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
