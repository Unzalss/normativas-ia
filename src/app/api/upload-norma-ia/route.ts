import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

import { requireAdmin, AdminAuthError } from '@/lib/auth/admin';
import { extractTextFromUploadedFile } from '@/lib/normativas/parser';
import { processNormaPipeline } from '@/lib/normativas/ingest';
import { structureNormaWithOpenAI } from '@/lib/normativas/ai-parser';
import { validateAIStructure } from '@/lib/normativas/ai-validation';
import { aiStructureToParsedFragments } from '@/lib/normativas/ai-adapter';
import { logAIUsage } from '@/lib/normativas/ai-costs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
    const requestId = crypto.randomUUID();
    let normaId: number | null = null;
    let userId: string | null = null;

    try {
        // 1. Validar admin ANTES del parser FormDado (Seguridad máxima)
        const authHeader = req.headers.get("Authorization");
        const authSupabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: authHeader || "" } } }
        );

        const adminResult = await requireAdmin(req, authSupabase);
        userId = adminResult.user.id;

        // 2. Cliente global para bypass RLS de sistema (Solo después de la barrera de validación de perfiles)
        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // 3. Extracción de formData y requerimiento estricto
        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        const codigo = formData.get("codigo") as string | null;
        const titulo = formData.get("titulo") as string | null;
        const ambito = formData.get("ambito") as string | null;
        const rango = formData.get("rango") as string | null;
        const jurisdiccion = formData.get("jurisdiccion") as string | null;
        const fecha_publicacion = formData.get("fecha_publicacion") as string | null;

        if (!file || !codigo || !titulo) {
            return NextResponse.json({ error: "Faltan campos obligatorios en el FormData (file, codigo, titulo)" }, { status: 400 });
        }

        // 4. Hash algorítmico y control anti-duplicados (Hash)
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const document_hash = crypto.createHash('sha256').update(buffer).digest('hex');

        const { data: existingHash, error: errHash } = await supabase
            .from('normas')
            .select('id')
            .eq('document_hash', document_hash)
            .is('owner_user_id', null)
            .limit(1)
            .maybeSingle();

        if (errHash) {
            throw new Error(`Error BD al comprobar el valid_hash: ${errHash.message}`);
        }
        
        if (existingHash) {
            return NextResponse.json({ 
                status: "duplicado_hash", 
                message: "Archivo exacto ya procesado previamente en base de datos global", 
                normaId: existingHash.id 
            }, { status: 409 });
        }

        // 5. Control anti-duplicados (Código legal)
        const { data: existingCodigo, error: errCodigo } = await supabase
            .from('normas')
            .select('id')
            .eq('codigo', codigo)
            .is('owner_user_id', null)
            .limit(1)
            .maybeSingle();

        if (errCodigo) {
            throw new Error(`Error BD al validar duplicidad de código legal: ${errCodigo.message}`);
        }
        
        if (existingCodigo) {
            return NextResponse.json({ 
                status: "duplicado", 
                message: "El código de la norma especificado choca con una iteración global existente", 
                normaId: existingCodigo.id 
            }, { status: 409 });
        }

        // 6. Enclave inicial con metadata en estado de procesamiento
        const { data: insertedNorma, error: insertError } = await supabase
            .from('normas')
            .insert({
                titulo, 
                codigo, 
                document_hash, 
                nombre_archivo: file.name,
                mime_type: file.type || "application/pdf",
                estado: "vigente",
                estado_ingesta: "procesando",
                ambito: ambito || null,
                rango: rango || null,
                jurisdiccion: jurisdiccion || null,
                fecha_publicacion: fecha_publicacion || null
            })
            .select('id')
            .single();

        if (insertError || !insertedNorma) {
            throw new Error(`Volcado primario abortado: ${insertError?.message}`);
        }
        
        const createdNormaId = insertedNorma.id as number;
        normaId = createdNormaId;

        // 7. Parseo texto natural (Limpieza cruda de PDF/TXT)
        const rawText = await extractTextFromUploadedFile(file, file.name);

        // 8. Fase Inteligencia Artificial (Estructuración)
        const aiResult = await structureNormaWithOpenAI({ 
            rawText, 
            codigo, 
            titulo, 
            model: "gpt-4o-mini" 
        });

        // 9. Auditoría operativa de LLM Costes Log
        const usageLog = await logAIUsage({
            supabase,
            userId,
            normaId,
            requestId,
            operationType: "upload_norma_ia_structure",
            model: "gpt-4o-mini",
            inputTokens: aiResult.usage.inputTokens,
            outputTokens: aiResult.usage.outputTokens,
            route: "upload-norma-ia",
            success: true
        });

        // 10. QA - Escáner de Validaciones anti-alucinaciones
        const validation = validateAIStructure(aiResult, rawText);

        if (!validation.valid) {
            // Rollback contextual
            await supabase.from('normas').update({ estado_ingesta: 'error' }).eq('id', normaId);
            
            // Ficha forense
            await supabase.from('norma_ingest_reports').insert({
                norma_id: normaId, 
                user_id: userId, 
                request_id: requestId,
                route: "upload-norma-ia", 
                status: "error",
                num_fragmentos: validation.numFragmentos,
                errores: validation.issues.filter(i => i.severity === 'error') as unknown[],
                warnings: validation.issues.filter(i => i.severity === 'warning') as unknown[],
                modelos_usados: ["gpt-4o-mini"] as unknown[],
            });

            return NextResponse.json({ 
                error: "Validación estricta de la estructura IA fallida por errores críticos (posible alucinación masiva)",
                issues: validation.issues
            }, { status: 500 });
        }

        // 11. Conversor y Transpilador
        const fragments = aiStructureToParsedFragments(aiResult);

        // 12. Generación Vectorial y Acople DB Final
        await processNormaPipeline(createdNormaId, fragments, { 
            titulo, codigo, 
            rango: rango || null, 
            ambito: ambito || null, 
            jurisdiccion: jurisdiccion || null, 
            fecha_publicacion: fecha_publicacion || undefined 
        });

        // 13. Exito Completo o Parcial Administrativo
        const finalStatus = validation.numDudosos > 0 ? "partial" : "success";
        
        await supabase.from('norma_ingest_reports').insert({
            norma_id: normaId, 
            user_id: userId, 
            request_id: requestId,
            route: "upload-norma-ia", 
            status: finalStatus,
            num_articulos_detectados: validation.numArticulos,
            num_anexos_detectados: validation.numAnexos,
            num_tablas_detectadas: validation.numTablas,
            num_fragmentos: validation.numFragmentos,
            num_fragmentos_dudosos: validation.numDudosos,
            errores: [],
            warnings: validation.issues.filter(i => i.severity === 'warning') as unknown[],
            modelos_usados: ["gpt-4o-mini"] as unknown[],
            coste_total_estimado: usageLog ? usageLog.estimated_total_cost : 0
        });

        // 14. Terminado Correctamente
        return NextResponse.json({
            ok: true,
            normaId,
            requestId,
            numFragmentos: validation.numFragmentos,
            numArticulos: validation.numArticulos,
            numAnexos: validation.numAnexos,
            numTablas: validation.numTablas,
            numDudosos: validation.numDudosos,
            estimatedCostUsd: usageLog ? usageLog.estimated_total_cost : 0,
            warnings: validation.issues.filter(i => i.severity === 'warning')
        });

    } catch (err: unknown) {
        if (err instanceof AdminAuthError) {
            return NextResponse.json({ error: err.message }, { status: err.status });
        }
        
        const errMsg = err instanceof Error ? err.message : String(err);
        
        if (normaId) {
            const fallbackSupabase = createClient(
                process.env.SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!
            );
            
            await fallbackSupabase.from('normas').update({ 
                estado_ingesta: 'error', 
                error_ingesta: errMsg.substring(0, 500) 
            }).eq('id', normaId);
            
            await fallbackSupabase.from('norma_ingest_reports').insert({
                norma_id: normaId, 
                user_id: userId, 
                request_id: requestId,
                route: "upload-norma-ia", 
                status: "error", 
                errores: [{ message: errMsg }] as unknown[]
            });
        }
        
        console.error("[upload-norma-ia] Excepción no controlada:", err);
        return NextResponse.json({ error: errMsg }, { status: 500 });
    }
}
