import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "gpt-4o-mini";
const MAX_INPUT_SOURCES = 5;
const MAX_NORMAS = 3;
const MAX_EXPANDED_FRAGMENTS = 10;
const MAX_FRAGMENT_CHARS = 1800;
const MAX_CONTEXT_CHARS = 18000;
const PROFESSIONAL_WARNING =
    "Informe orientativo generado a partir de las normas consultadas. Debe ser revisado por técnico competente antes de su uso profesional.";
const DEFAULT_LIMITATIONS = [
    "El informe se basa únicamente en las fuentes recuperadas para esta consulta.",
    "Puede requerir revisión de otros requisitos aplicables según el tipo de actividad, local y condiciones reales.",
];

type ReportSourceInput = {
    id?: string | number | null;
    normaId?: string | number | null;
    title?: string | null;
    label?: string | null;
    content?: string | null;
};

type NormaRow = {
    id: number;
    titulo: string | null;
    codigo: string | null;
    owner_user_id?: string | null;
};

type FragmentRow = {
    id: number;
    norma_id: number;
    seccion: string | null;
    articulo: string | null;
    article_number: string | null;
    texto: string | null;
    tipo: string | null;
    orden: number | null;
};

type TechnicalReportPayload = {
    objeto: string;
    antecedentes_consulta: string;
    normativa_utilizada: Array<{
        norma: string;
        referencias: string[];
    }>;
    analisis_tecnico: string;
    criterio_aplicable: string;
    puntos_a_comprobar: string[];
    conclusion_practica: string;
    limitaciones: string[];
    advertencia_profesional: string;
};

type DebugTiming = {
    authMs: number;
    normasMs: number;
    exactFragmentsMs: number;
    expandedFragmentsMs: number;
    openaiMs: number;
    totalMs: number;
    contextChars: number;
    contextItemsCount: number;
};

type ContextItem = {
    key: string;
    title: string;
    label: string;
    text: string;
};

function nowMs(): number {
    return Date.now();
}

function asInteger(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(String(value).trim());
    return Number.isInteger(parsed) ? parsed : null;
}

function cleanText(value: unknown, maxLength = MAX_FRAGMENT_CHARS): string {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

function sourceLabel(source: ReportSourceInput, fallback: string): string {
    return cleanText(source.label || source.title || fallback, 220) || fallback;
}

function normalizedTextKey(value: unknown): string {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map((item) => cleanText(item, 500))
            .filter(Boolean);
    }

    const text = cleanText(value, 500);
    return text ? [text] : [];
}

function normalizeAllowedNormaTitle(value: string): string {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function buildAllowedNormativa(usedSources: Array<{ title: string; label: string | null }>) {
    const grouped = new Map<string, { norma: string; referencias: string[] }>();

    for (const source of usedSources) {
        const norma = cleanText(source.title, 500);
        if (!norma) continue;

        const key = normalizeAllowedNormaTitle(norma);
        const current = grouped.get(key) || { norma, referencias: [] };
        const referencias = normalizeStringArray(source.label);

        for (const referencia of referencias) {
            if (!current.referencias.includes(referencia)) {
                current.referencias.push(referencia);
            }
        }

        grouped.set(key, current);
    }

    return Array.from(grouped.values());
}

function normalizeReport(
    value: unknown,
    allowedNormaTitles: Set<string>,
    fallbackNormativa: Array<{ norma: string; referencias: string[] }>
): TechnicalReportPayload {
    const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const normativaRaw = Array.isArray(source.normativa_utilizada) ? source.normativa_utilizada : [];
    const normativaFiltrada = normativaRaw
        .map((item) => {
            if (!item || typeof item !== "object") return null;
            const normaItem = item as Record<string, unknown>;
            const norma = cleanText(normaItem.norma, 500);
            if (!norma || !allowedNormaTitles.has(normalizeAllowedNormaTitle(norma))) return null;
            return {
                norma,
                referencias: normalizeStringArray(normaItem.referencias),
            };
        })
        .filter((item): item is { norma: string; referencias: string[] } => item !== null);

    return {
        objeto: cleanText(source.objeto, 1200) || "No disponible.",
        antecedentes_consulta: cleanText(source.antecedentes_consulta, 1200) || "No consta consulta original.",
        normativa_utilizada: normativaFiltrada.length > 0 ? normativaFiltrada : fallbackNormativa,
        analisis_tecnico: cleanText(source.analisis_tecnico, 2500) || "No hay análisis técnico disponible.",
        criterio_aplicable: cleanText(source.criterio_aplicable, 1800) || "No hay criterio aplicable disponible.",
        puntos_a_comprobar: normalizeStringArray(source.puntos_a_comprobar),
        conclusion_practica: cleanText(source.conclusion_practica, 1800) || "No hay conclusión práctica disponible.",
        limitaciones: DEFAULT_LIMITATIONS,
        advertencia_profesional: PROFESSIONAL_WARNING,
    };
}

function noConstaReport(query: string, usedSources: Array<{ title: string; label: string | null }>): TechnicalReportPayload {
    return {
        objeto: "Analizar la consulta formulada a partir de las normas consultadas.",
        antecedentes_consulta: query || "No consta consulta original.",
        normativa_utilizada: usedSources.length > 0
            ? usedSources.map((source) => ({
                norma: source.title,
                referencias: source.label ? [source.label] : [],
            }))
            : [],
        analisis_tecnico: "No se ha localizado fundamento suficiente en las normas consultadas.",
        criterio_aplicable: "No se puede fijar un criterio técnico aplicable con la información recuperada.",
        puntos_a_comprobar: [
            "Revisar si la consulta debe acotarse a una norma, artículo, anexo o supuesto técnico concreto.",
            "Comprobar si existen otras normas aplicables no incluidas en la consulta realizada.",
        ],
        conclusion_practica: "No se ha localizado fundamento suficiente en las normas consultadas.",
        limitaciones: DEFAULT_LIMITATIONS,
        advertencia_profesional: PROFESSIONAL_WARNING,
    };
}

export async function POST(req: Request) {
    try {
        const startedAt = nowMs();
        const timing: Omit<DebugTiming, "totalMs" | "contextChars" | "contextItemsCount"> = {
            authMs: 0,
            normasMs: 0,
            exactFragmentsMs: 0,
            expandedFragmentsMs: 0,
            openaiMs: 0,
        };
        let contextChars = 0;
        let contextItemsCount = 0;
        const buildDebugTiming = (): DebugTiming => ({
            ...timing,
            totalMs: nowMs() - startedAt,
            contextChars,
            contextItemsCount,
        });

        const payload = await req.json();
        const query = cleanText(payload?.query, 1000);
        const baseAnswer = cleanText(payload?.baseAnswer, 5000);
        const selectedNormaId = asInteger(payload?.selectedNormaId);
        const incomingSources = Array.isArray(payload?.sources)
            ? (payload.sources as ReportSourceInput[]).slice(0, MAX_INPUT_SOURCES)
            : [];

        if (!query || !baseAnswer) {
            return NextResponse.json(
                { ok: false, error: "Faltan query o baseAnswer para generar el informe." },
                { status: 400 }
            );
        }

        const normalizedSources = incomingSources.map((source, index) => ({
            id: asInteger(source.id),
            normaId: asInteger(source.normaId),
            title: cleanText(source.title, 260) || "Norma consultada",
            label: sourceLabel(source, `Fuente ${index + 1}`),
            content: cleanText(source.content),
        }));

        const usedSources = normalizedSources.map((source) => ({
            id: source.id,
            normaId: source.normaId,
            title: source.title,
            label: source.label || null,
        }));
        const fallbackNormativa = buildAllowedNormativa(usedSources);
        const allowedNormaTitles = new Set(
            fallbackNormativa.map((source) => normalizeAllowedNormaTitle(source.norma))
        );
        const allowedNormasPrompt = fallbackNormativa.length > 0
            ? fallbackNormativa.map((source) => `- ${source.norma}`).join("\n")
            : "- No constan normas consultadas permitidas.";

        const baseNoConsta = baseAnswer.toLowerCase().includes("no consta en las normas consultadas");
        if (baseNoConsta) {
            return NextResponse.json({
                ok: true,
                report: noConstaReport(query, usedSources),
                sources: usedSources,
                meta: {
                    model: MODEL,
                    temperature: 0,
                    expandedSourcesCount: 0,
                    noConsta: true,
                    usedAi: false,
                    debugTiming: buildDebugTiming(),
                },
            });
        }

        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const authHeader = req.headers.get("Authorization");
        let userId: string | null = null;

        if (authHeader) {
            const authStartedAt = nowMs();
            const token = authHeader.replace("Bearer ", "");
            const {
                data: { user },
            } = await supabase.auth.getUser(token);
            if (user) userId = user.id;
            timing.authMs = nowMs() - authStartedAt;
        }

        const sourceNormaIds = Array.from(new Set(
            normalizedSources
                .map((source) => source.normaId)
                .filter((id): id is number => Number.isInteger(id))
        )).slice(0, MAX_NORMAS);

        const selectedNormaIsInSources = selectedNormaId !== null && sourceNormaIds.includes(selectedNormaId);
        const allowedNormaIdsInput = selectedNormaIsInSources
            ? [selectedNormaId, ...sourceNormaIds.filter((id) => id !== selectedNormaId)]
            : sourceNormaIds;

        let allowedNormas: NormaRow[] = [];
        if (allowedNormaIdsInput.length > 0) {
            const normasStartedAt = nowMs();
            const { data: normas, error: normasError } = await supabase
                .from("normas")
                .select("id, titulo, codigo, owner_user_id")
                .in("id", allowedNormaIdsInput);
            timing.normasMs = nowMs() - normasStartedAt;

            if (normasError) {
                return NextResponse.json(
                    { ok: false, error: "Error consultando normas para el informe.", detalle: normasError.message },
                    { status: 500 }
                );
            }

            allowedNormas = (normas || []).filter((norma: NormaRow) => {
                return !norma.owner_user_id || norma.owner_user_id === userId;
            });
        }

        const allowedNormaIds = new Set(allowedNormas.map((norma) => norma.id));
        const allowedExactIds = normalizedSources
            .filter((source) => source.id && source.normaId && allowedNormaIds.has(source.normaId))
            .map((source) => source.id as number)
            .slice(0, MAX_EXPANDED_FRAGMENTS);

        const fragmentSelect = "id, norma_id, seccion, articulo, article_number, texto, tipo, orden";
        let exactFragments: FragmentRow[] = [];

        if (allowedExactIds.length > 0) {
            const exactStartedAt = nowMs();
            const { data, error } = await supabase
                .from("normas_partes")
                .select(fragmentSelect)
                .in("id", allowedExactIds)
                .in("norma_id", Array.from(allowedNormaIds))
                .order("orden", { ascending: true })
                .limit(MAX_EXPANDED_FRAGMENTS);
            timing.exactFragmentsMs = nowMs() - exactStartedAt;

            if (error) {
                return NextResponse.json(
                    { ok: false, error: "Error consultando fragmentos base para el informe.", detalle: error.message },
                    { status: 500 }
                );
            }

            exactFragments = data || [];
        }

        const expandedStartedAt = nowMs();
        const expandedResults = await Promise.all(
            exactFragments.slice(0, MAX_INPUT_SOURCES).map(async (fragment) => {
                let fragmentQuery = supabase
                    .from("normas_partes")
                    .select(fragmentSelect)
                    .eq("norma_id", fragment.norma_id)
                    .order("orden", { ascending: true })
                    .limit(3);

                if (fragment.article_number) {
                    fragmentQuery = fragmentQuery.eq("article_number", fragment.article_number);
                } else if (fragment.seccion) {
                    fragmentQuery = fragmentQuery.eq("seccion", fragment.seccion);
                } else if (typeof fragment.orden === "number") {
                    fragmentQuery = fragmentQuery
                        .gte("orden", Math.max(0, fragment.orden - 1))
                        .lte("orden", fragment.orden + 1);
                }

                const { data } = await fragmentQuery;
                return data || [];
            })
        );
        const expandedFragments: FragmentRow[] = expandedResults.flat().slice(0, MAX_EXPANDED_FRAGMENTS);
        timing.expandedFragmentsMs = nowMs() - expandedStartedAt;

        const normTitleById = new Map(
            allowedNormas.map((norma) => [
                norma.id,
                cleanText(norma.codigo || norma.titulo || `Norma ${norma.id}`, 260),
            ])
        );

        const seenFragmentIds = new Set<number>();
        const seenTextKeys = new Set<string>();
        const dbFragmentIds = new Set<number>();
        const contextItems: ContextItem[] = [];

        const pushContextItem = (item: ContextItem, fragmentId?: number | null) => {
            const textKey = normalizedTextKey(item.text);
            if (!textKey) return;
            if (fragmentId !== null && fragmentId !== undefined) {
                if (seenFragmentIds.has(fragmentId)) return;
                seenFragmentIds.add(fragmentId);
            }
            if (seenTextKeys.has(textKey)) return;
            seenTextKeys.add(textKey);
            contextItems.push(item);
        };

        [...exactFragments, ...expandedFragments]
            .slice(0, MAX_EXPANDED_FRAGMENTS)
            .forEach((fragment) => {
                dbFragmentIds.add(fragment.id);
                pushContextItem({
                    key: `fragment-${fragment.id}`,
                    title: normTitleById.get(fragment.norma_id) || `Norma ${fragment.norma_id}`,
                    label: cleanText(fragment.seccion || fragment.articulo || fragment.tipo || `Fragmento ${fragment.id}`, 220),
                    text: cleanText(fragment.texto),
                }, fragment.id);
            });

        normalizedSources
            .filter((source) => source.content && (!source.id || !dbFragmentIds.has(source.id)))
            .forEach((source, index) => {
                pushContextItem({
                    key: `source-${index}`,
                    title: source.title,
                    label: source.label,
                    text: source.content,
                }, null);
            });

        let context = "";
        let includedContextItems = 0;
        for (const [index, item] of contextItems.entries()) {
            if (!item.text) continue;
            const nextBlock = `[${index + 1}] ${item.title} - ${item.label}\n${item.text}\n\n`;
            if ((context + nextBlock).length > MAX_CONTEXT_CHARS) break;
            context += nextBlock;
            includedContextItems++;
        }
        contextChars = context.length;
        contextItemsCount = includedContextItems;

        if (!context.trim()) {
            return NextResponse.json({
                ok: true,
                report: noConstaReport(query, usedSources),
                sources: usedSources,
                meta: {
                    model: MODEL,
                    temperature: 0,
                    expandedSourcesCount: 0,
                    noConsta: true,
                    usedAi: false,
                    debugTiming: buildDebugTiming(),
                },
            });
        }

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const openaiStartedAt = nowMs();
        const completion = await openai.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: `Eres un redactor de informes técnicos sobre normativa.

Devuelve únicamente JSON válido con estas claves exactas:
objeto, antecedentes_consulta, normativa_utilizada, analisis_tecnico, criterio_aplicable, puntos_a_comprobar, conclusion_practica, limitaciones, advertencia_profesional.

Reglas obligatorias:
- No contradigas la RESPUESTA BASE.
- No inventes datos, artículos, anexos, plazos, valores ni normas.
- Usa solo el CONTEXTO aportado y las normas ya presentes en las fuentes.
- Si falta fundamento suficiente, dilo de forma prudente.
- Redacta de forma profesional y concisa. Evita párrafos largos. No repitas la respuesta base salvo cuando sea necesario para justificar el criterio.
- En normativa_utilizada solo puedes incluir normas que aparezcan literalmente en NORMAS CONSULTADAS PERMITIDAS.
- No incluyas como normativa utilizada referencias internas como UNE, EN, ISO u otras normas citadas por el texto si no aparecen en la lista de normas consultadas permitidas.
- normativa_utilizada debe ser un array de objetos con norma y referencias.
- puntos_a_comprobar y limitaciones deben ser arrays de strings.
- limitaciones debe contener exactamente: ${DEFAULT_LIMITATIONS.map((item) => `"${item}"`).join(", ")}.
- advertencia_profesional debe ser exactamente: "${PROFESSIONAL_WARNING}".`,
                },
                {
                    role: "user",
                    content: `CONSULTA ORIGINAL:
${query}

NORMAS CONSULTADAS PERMITIDAS:
${allowedNormasPrompt}

RESPUESTA BASE:
${baseAnswer}

CONTEXTO AMPLIADO SOLO DE LAS MISMAS NORMAS:
${context}`,
                },
            ],
            response_format: { type: "json_object" },
            max_tokens: 1000,
            temperature: 0,
        });
        timing.openaiMs = nowMs() - openaiStartedAt;

        const rawReport = completion.choices[0].message.content || "{}";
        const report = normalizeReport(JSON.parse(rawReport), allowedNormaTitles, fallbackNormativa);

        return NextResponse.json({
            ok: true,
            report,
            sources: usedSources,
            meta: {
                model: MODEL,
                temperature: 0,
                expandedSourcesCount: contextItems.length,
                noConsta: false,
                usedAi: true,
                debugTiming: buildDebugTiming(),
            },
        });
    } catch (error: unknown) {
        console.error("Report API error:", error);
        const detail = error instanceof Error ? error.message : undefined;
        return NextResponse.json(
            { ok: false, error: "No se pudo generar el informe técnico.", detalle: detail },
            { status: 500 }
        );
    }
}

