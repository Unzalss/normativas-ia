import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import crypto from 'crypto';
import { ParsedFragment, NormaMetadataBase } from './parser';

export async function processNormaPipeline(
    normaId: number,
    fragments: ParsedFragment[],
    metadata: NormaMetadataBase & { fecha_publicacion?: string }
) {
    const supabaseUrls = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrls, supabaseKey);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 1. Borrar partes previas si falla un intento previo
    await supabase.from('normas_partes').delete().eq('norma_id', normaId);

    let calculatedYear: number | null = null;
    if (metadata.fecha_publicacion) {
        calculatedYear = parseInt(metadata.fecha_publicacion.substring(0, 4));
    } else {
        const yearMatch = metadata.codigo?.match(/\d{4}/) || metadata.titulo?.match(/\d{4}/);
        if (yearMatch) calculatedYear = parseInt(yearMatch[0]);
    }

    const calculatedNormType = metadata.rango || "Norma Jurídica";
    let insertedCount = 0;
    let num_articulos_detectados = 0;
    let num_anexos_detectados = 0;
    let num_embeddings_generados = 0;

    // 2. Vectorización Batch optimizada de OpenAI
    const BATCH_SIZE = 50;

    for (let i = 0; i < fragments.length; i += BATCH_SIZE) {
        const batch = fragments.slice(i, i + BATCH_SIZE);

        // Aislar textos válidos para vectorizar en orden posicional
        const textsToVectorize = batch.map(f => {
            if (!f.es_indice && f.texto.length >= 20) return f.texto;
            return null;
        });

        // Extraer los strings crudos a vectorizar
        const validStrs = textsToVectorize.filter(t => t !== null) as string[];

        let batchEmbeddings: number[][] = [];
        let embIndex = 0; // Puntero de índice posicional, blindado contra choques de texto idéntico

        if (validStrs.length > 0) {
            try {
                const embRes = await openai.embeddings.create({
                    model: "text-embedding-3-small",
                    input: validStrs,
                    dimensions: 1536,
                });

                batchEmbeddings = embRes.data.map(e => e.embedding);
            } catch (embErr) {
                console.error(`Error generando embeddings en batch ${i}:`, embErr);
                throw new Error(`Fallo en OpenAI: ${(embErr as Error).message}`);
            }
        }

        const rowsToInsert = batch.map((frag, idx) => {
            const globalIndex = i + idx;
            const hash = crypto.createHash('sha256').update(frag.texto).digest('hex');

            // Asignar el embedding según índice posicional correlativo
            let embeddingArray = null;
            if (textsToVectorize[idx] !== null && embIndex < batchEmbeddings.length) {
                embeddingArray = batchEmbeddings[embIndex++];
                num_embeddings_generados++;
            }

            const tipo = (frag.tipo || "").toLowerCase();
            if (tipo.includes("art")) num_articulos_detectados++;
            if (tipo.includes("anex")) num_anexos_detectados++;

            return {
                norma_id: normaId,
                tipo: frag.tipo,
                seccion: frag.seccion,
                numero: frag.numero,
                texto: frag.texto,
                orden: globalIndex + 1,
                huella: hash,
                embedding: embeddingArray,
                articulo: frag.articulo,
                rango: metadata.rango,
                es_indice: frag.es_indice,
                jurisdiction: metadata.jurisdiccion,
                norm_type: calculatedNormType,
                year: calculatedYear,
                article_number: frag.article_number,
                apartado: frag.apartado
            };
        });

        if (rowsToInsert.length > 0) {
            const { error: insErr } = await supabase.from('normas_partes').insert(rowsToInsert);
            if (insErr) throw new Error(`Database insert error at batch ${i}: ${insErr.message}`);
            insertedCount += rowsToInsert.length;
        }
    }

    // 3. Actualizar metadata de éxito
    await supabase.from('normas').update({
        estado_ingesta: 'lista',
        num_fragmentos: insertedCount,
        num_articulos_detectados,
        num_anexos_detectados,
        num_embeddings_generados,
        error_ingesta: null
    }).eq('id', normaId);
}
