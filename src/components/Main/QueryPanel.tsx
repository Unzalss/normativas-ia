import React, { useEffect, useState } from 'react';
import styles from './QueryPanel.module.css';
import { ChevronDown, Search, ChevronRight, FileText, Download, Save, Share, X } from 'lucide-react';
import { clsx } from 'clsx';
import { createClient } from '@supabase/supabase-js';
import { ResponseData, Source, MapNode } from '@/lib/types';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEFAULT_REPORT_LIMITATIONS = [
    "El informe se basa únicamente en las fuentes recuperadas para esta consulta.",
    "Puede requerir revisión de otros requisitos aplicables según el tipo de actividad, local y condiciones reales.",
];



interface QueryPanelProps {
    query: string;
    response?: ResponseData;
    isLoading: boolean;
    onQuery: (text: string) => void;
    onCitationClick: (sourceId: string) => void;
    normas: Array<{ id: number, titulo: string, codigo: string }>;
    selectedNormaId: number | null;
    onSelectNormaId: (id: number | null) => void;
    error?: string | null;
    sources?: Source[];
    selectedMapNode?: MapNode | null;
    onMapNodeSelect?: (node: MapNode | null) => void;
}

type MapaArticulo = {
    key: string;
    titulo: string;
    fragmentos: Source[];
    minIdx: number;
    totalFragments: number;
};

type MapaNorma = {
    key: string;
    titulo: string;
    rango: string | null;
    articulos: Record<string, MapaArticulo>;
    minIdx: number;
    totalFragments: number;
};

type MapaNormaView = MapaNorma & {
    articulosList: MapaArticulo[];
};

type TechnicalReport = {
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

const normalizeStringArray = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim())
            .filter(Boolean);
    }

    const text = String(value || '').trim();
    return text ? [text] : [];
};

const normalizeTechnicalReport = (value: unknown): TechnicalReport => {
    const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const normativaRaw = Array.isArray(source.normativa_utilizada) ? source.normativa_utilizada : [];

    return {
        objeto: String(source.objeto || '').trim(),
        antecedentes_consulta: String(source.antecedentes_consulta || '').trim(),
        normativa_utilizada: normativaRaw
            .map((item) => {
                if (!item || typeof item !== 'object') return null;
                const normaItem = item as Record<string, unknown>;
                const norma = String(normaItem.norma || '').trim();
                if (!norma) return null;
                return {
                    norma,
                    referencias: normalizeStringArray(normaItem.referencias),
                };
            })
            .filter((item): item is { norma: string; referencias: string[] } => item !== null),
        analisis_tecnico: String(source.analisis_tecnico || '').trim(),
        criterio_aplicable: String(source.criterio_aplicable || '').trim(),
        puntos_a_comprobar: normalizeStringArray(source.puntos_a_comprobar),
        conclusion_practica: String(source.conclusion_practica || '').trim(),
        limitaciones: DEFAULT_REPORT_LIMITATIONS,
        advertencia_profesional: String(source.advertencia_profesional || '').trim(),
    };
};

export default function QueryPanel({ query, response, isLoading, error, onQuery, normas, selectedNormaId, onSelectNormaId, sources = [], selectedMapNode = null, onMapNodeSelect }: QueryPanelProps) {
    const [text, setText] = useState(query);
    const [showTechnicalReport, setShowTechnicalReport] = useState(false);
    const [technicalReport, setTechnicalReport] = useState<TechnicalReport | null>(null);
    const [technicalReportError, setTechnicalReportError] = useState<string | null>(null);
    const [isGeneratingTechnicalReport, setIsGeneratingTechnicalReport] = useState(false);

    // Sync local state when prop changes (restoring history)
    useEffect(() => {
        setText(query);
    }, [query]);

    useEffect(() => {
        setShowTechnicalReport(false);
        setTechnicalReport(null);
        setTechnicalReportError(null);
        setIsGeneratingTechnicalReport(false);
    }, [query, response?.id]);

    const handleSend = () => {
        if (!text.trim()) return;
        console.log("SEND", text);
        onQuery(text.trim());
    };

    const handleTechnicalReportToggle = async () => {
        if (showTechnicalReport) {
            setShowTechnicalReport(false);
            return;
        }

        setShowTechnicalReport(true);
        if (technicalReport) return;
        if (isGeneratingTechnicalReport || !response) return;

        setIsGeneratingTechnicalReport(true);
        setTechnicalReportError(null);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

            const reportSources = sources.slice(0, 5).map((source) => ({
                id: source.id,
                normaId: source.normaId ?? null,
                title: source.title,
                label: source.source_label || source.subtitle || source.articulo_detectado || source.metadata?.articulo || null,
                content: source.content || source.highlight || "",
            }));

            const res = await fetch("/api/report", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    query,
                    baseAnswer: response.text,
                    selectedNormaId,
                    sources: reportSources,
                }),
            });

            const json = await res.json();
            if (!res.ok || !json.ok || !json.report) {
                throw new Error(json?.error || "No se pudo generar el informe técnico.");
            }

            setTechnicalReport(normalizeTechnicalReport(json.report));
        } catch (reportError: unknown) {
            const message = reportError instanceof Error ? reportError.message : "No se pudo generar el informe técnico.";
            setTechnicalReportError(message);
        } finally {
            setIsGeneratingTechnicalReport(false);
        }
    };



    // State to determine if we are in the initial fully empty dashboard view
    const isHome = !query && !response && !isLoading && !error;

    const mapaNormativo = React.useMemo(() => {
        if (!sources || sources.length === 0) return [];

        // Pre-filter: strictly top 5 sources
        const finalSources = sources.slice(0, 5);

        const grupos: Record<string, MapaNorma> = {};
        
        // 1. Agrupar primero todas las fuentes del subconjunto sin cortes
        finalSources.forEach((s, index) => {
            // 2. Fallbacks elegantes si faltan IDs
            const key = s.normaId ? String(s.normaId) : (s.title || 'norma-gen');
            const tituloNorma = s.title || 'Documentación de referencia';
            
            if (!grupos[key]) {
                grupos[key] = { 
                    key, 
                    titulo: tituloNorma, 
                    rango: s.metadata?.rango || null,
                    articulos: {},
                    minIdx: index,
                    totalFragments: 0
                };
            }
            
            if (index < grupos[key].minIdx) grupos[key].minIdx = index;
            grupos[key].totalFragments++;
            
            // Fallback elegante para artículos
            const artKey = s.metadata?.articulo || s.articulo_detectado || s.subtitle || `Fragmentos generales`;
            const tituloArt = s.subtitle || artKey;
            
            if (!grupos[key].articulos[artKey]) {
                grupos[key].articulos[artKey] = {
                    key: artKey,
                    titulo: tituloArt,
                    fragmentos: [],
                    minIdx: index,
                    totalFragments: 0
                };
            }
            
            if (index < grupos[key].articulos[artKey].minIdx) grupos[key].articulos[artKey].minIdx = index;
            grupos[key].articulos[artKey].totalFragments++;
            grupos[key].articulos[artKey].fragmentos.push(s);
        });

        // 4. Ordenar después de construir toda la estructura
        let normasArray: MapaNormaView[] = Object.values(grupos).map(norma => {
            const artsArray = Object.values(norma.articulos);
            // Ordenar artículos: minIdx > totalFragments
            artsArray.sort((a, b) => {
                if (a.minIdx !== b.minIdx) return a.minIdx - b.minIdx;
                return b.totalFragments - a.totalFragments;
            });
            
            return {
                ...norma,
                articulosList: artsArray
            };
        });

        // Ordenar Normas: minIdx > totalFragments
        normasArray.sort((a, b) => {
             if (a.minIdx !== b.minIdx) return a.minIdx - b.minIdx;
             return b.totalFragments - a.totalFragments;
        });

        // 5. Solo al final truncar
        const maxNorms = 3;
        const maxArticlesPerNorm = 4;

        if (normasArray.length > maxNorms) {
            normasArray = normasArray.slice(0, maxNorms);
        }

        normasArray = normasArray.map(norma => {
            if (norma.articulosList.length > maxArticlesPerNorm) {
                 return { ...norma, articulosList: norma.articulosList.slice(0, maxArticlesPerNorm) };
            }
            return norma;
        });

        return normasArray;
    }, [sources]);

    return (
        <div className={styles.container}>
            {isHome ? (
                // ─── HOME / EMPTY STATE ──────────────────────────────────────────────────
                <div className={styles.homeLayout}>
                    <header className={styles.homeHeader}>
                        <div className={styles.headerLeft}>
                            <span className={styles.headerEyebrow}>Módulo de Consulta Técnica</span>
                        </div>
                        <div className={styles.headerRight}>
                            <div className={styles.dbBadge}>
                                <div className={styles.dbStatusDot} />
                                <span>Base de datos: BOE Feb 2024</span>
                            </div>
                        </div>
                    </header>

                    <div className={styles.homeContent}>
                        <div className={styles.heroSection}>
                            <h2 className={styles.heroTitle}>Consulta normativa técnica para arquitectura</h2>
                            <p className={styles.heroSubtitle}>Pregunta sobre CTE, incendios, accesibilidad, seguridad de uso y prevención. Obtén respuestas claras con artículos y fuentes citadas.</p>
                        </div>

                        <div className={styles.homeSearchWrapper}>
                            <div className={styles.homeSearchInner}>
                                <Search className={styles.searchIconLarge} size={24} />
                                <textarea
                                    className={styles.homeTextarea}
                                    placeholder="Ejemplo: ¿Qué anchura mínima debe tener una salida de evacuación?"
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSend();
                                        }
                                    }}
                                />
                            </div>
                            <div className={styles.homeSearchActions}>
                                <div className={styles.actionLinks}>
                                    <button className={styles.actionLinkText}>DOCUMENTO</button>
                                    <button className={styles.actionLinkText}>FILTROS</button>
                                </div>
                                <button className={styles.analyzeButton} onClick={handleSend} disabled={isLoading}>
                                    {isLoading ? 'ANALIZANDO...' : 'ANALIZAR'}
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        </div>

                        <div className={styles.homeScope}>
                            <label className={styles.scopeLabel}>Ámbito de aplicación</label>
                            <div className={styles.scopeGrid}>
                                <div className={styles.scopeSelectWrapper}>
                                    <select
                                        className={styles.scopeSelect}
                                        value={selectedNormaId === null ? "" : selectedNormaId}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            onSelectNormaId(val ? Number(val) : null);
                                        }}
                                    >
                                        <option value="">Todas las normativas (Global)</option>
                                        {normas.map(norma => (
                                            <option key={norma.id} value={norma.id}>
                                                {norma.codigo || norma.titulo}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown size={14} className={styles.scopeChevron} />
                                </div>
                                <button className={styles.scopePill}>Código Técnico (CTE)</button>
                                <button className={styles.scopePill}>Eurocódigos</button>
                                <button className={styles.scopePill}>RITE / Industrial</button>
                            </div>
                        </div>

                        <div className={styles.homeExamples}>
                            <h4 className={styles.examplesLabel}>Ejemplos de consulta técnica</h4>
                            <div className={styles.examplesGrid}>
                                <button className={styles.exampleCard} onClick={() => onQuery("¿Qué dice el artículo 7 del RD-486-1997?")}>
                                    <FileText size={18} className={styles.exampleIcon} />
                                    <span>¿Qué dice el artículo 7 del RD-486-1997?</span>
                                </button>
                                <button className={styles.exampleCard} onClick={() => onQuery("¿Qué temperatura deben tener los locales de trabajo cerrados?")}>
                                    <FileText size={18} className={styles.exampleIcon} />
                                    <span>¿Qué temperatura deben tener los locales de trabajo cerrados?</span>
                                </button>
                                <button className={styles.exampleCard} onClick={() => onQuery("¿Qué condiciones básicas de accesibilidad establece el RD-505-2007?")}>
                                    <FileText size={18} className={styles.exampleIcon} />
                                    <span>¿Qué condiciones básicas de accesibilidad establece el RD-505-2007?</span>
                                </button>
                                <button className={styles.exampleCard} onClick={() => onQuery("¿Cada cuánto deben revisarse los extintores?")}>
                                    <FileText size={18} className={styles.exampleIcon} />
                                    <span>¿Cada cuánto deben revisarse los extintores?</span>
                                </button>
                            </div>
                        </div>

                        <div className={styles.homeFooter}>
                            LexAI Técnica v4.1.0 • Información Jurídica Vinculante al BOE • 2024
                        </div>
                    </div>
                </div>
            ) : (
                // ─── SEARCH / RESULTS STATE ──────────────────────────────────────────────
                <>
                    <header className={styles.resultsHeader}>
                        <div className={styles.resultsSearchBox}>
                            <Search size={18} className={styles.resultsSearchIcon} />
                            <input
                                type="text"
                                className={styles.resultsInput}
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSend();
                                }}
                            />
                            {text && (
                                <button className={styles.clearSearchBtn} onClick={() => setText('')}>
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                        <div className={styles.resultsActions}>
                            <button className={styles.resultsActionBtn}>
                                <Download size={16} /> EXPORTAR
                            </button>
                            <button className={styles.resultsActionBtn}>
                                <Share size={16} /> COMPARTIR
                            </button>
                        </div>
                    </header>

                    <div className={styles.scrollContent}>
                        {isLoading && (
                            <div className={styles.loadingState}>
                                Analizando jurisprudencia y normativa...
                            </div>
                        )}

                        {error && (
                    <div className={styles.responseSection}>
                        <div className={styles.responseCard} style={{ borderLeftColor: '#ef4444' }}>
                            <h2 className={styles.responseTitle} style={{ color: '#ef4444' }}>Error</h2>
                            <div className={styles.responseText}>
                                <p>{error}</p>
                            </div>
                        </div>
                    </div>
                )}

                {response && !error && (() => {
                    // --- Parse structured LLM response into sections ---
                    const text = response.text || '';

                    const extract = (label: string) => {
                        const regex = new RegExp(
                            `${label}:\\s*\\n?([\\s\\S]*?)(?=\\n(?:Respuesta breve|Fundamento normativo|Cita|Puntos a comprobar|Checklist técnico|Checklist):|$)`,
                            'i'
                        );
                        return text.match(regex)?.[1]?.trim() ?? '';
                    };

                    const collapseRepeatedText = (value: string) => {
                        const trimmed = value.trim();
                        if (!trimmed) return trimmed;

                        const normalize = (part: string) => part.replace(/\s+/g, ' ').trim();
                        const midpoint = Math.floor(trimmed.length / 2);

                        for (let offset = -20; offset <= 20; offset += 1) {
                            const cut = midpoint + offset;
                            if (cut <= 0 || cut >= trimmed.length) continue;

                            const left = trimmed.slice(0, cut).trim();
                            const right = trimmed.slice(cut).trim();
                            if (left && normalize(left) === normalize(right)) return left;
                        }

                        return trimmed;
                    };

                    const respuestaBreve      = extract('Respuesta breve');
                    const fundamentoNormativo = extract('Fundamento normativo');
                    const cita               = extract('Cita');
                    const checklistText       = extract('Puntos a comprobar') || extract('Checklist técnico') || extract('Checklist');
                    const isStructured       = !!(respuestaBreve || fundamentoNormativo || cita);
                    const criterioPracticoRaw = respuestaBreve || text.split('\n\n').find((paragraph) => paragraph.trim())?.trim() || '';
                    const criterioPractico   = collapseRepeatedText(criterioPracticoRaw);
                    const shouldShowRespuestaBreve = respuestaBreve && collapseRepeatedText(respuestaBreve) !== criterioPractico;
                    const conclusionRapida = criterioPractico || respuestaBreve || text.split('\n\n').find((paragraph) => paragraph.trim())?.trim() || '';
                    const checklistItems = checklistText
                        ? checklistText
                            .split(/\n+/)
                            .map((item) => item.replace(/^\s*(?:[-*•]|\d+[\.)])\s*/, '').trim())
                            .filter(Boolean)
                        : [];



                    const realSourceCitations = sources
                        .slice(0, 5)
                        .map((source) => {
                            const norma = source.title || 'Norma';
                            const section = source.source_label || source.subtitle || source.articulo_detectado || source.metadata?.articulo || null;
                            return section ? `[${norma} - ${section}]` : `[${norma}]`;
                        })
                        .filter((line, index, lines) => lines.indexOf(line) === index);

                    const renderCitations = (lines: string[]) =>
                        lines.map((line, i) => (
                            <div key={i} className={styles.citaLine}>
                                <strong>{line}</strong>
                            </div>
                        ));

                    const renderArticleGroups = () => {
                        if (mapaNormativo.length === 0) {
                            return (
                                <div className={styles.emptyNormativeBlock}>
                                    No hay artículos estructurados asociados a esta respuesta.
                                </div>
                            );
                        }

                        return (
                            <div className={styles.applicableArticlesList}>
                                {mapaNormativo.map((norma) => (
                                    <div key={norma.key} className={styles.applicableNormaGroup}>
                                        <div className={styles.applicableNormaHeader}>
                                            {norma.rango && <span className={styles.applicableNormaBadge}>{norma.rango}</span>}
                                            <span className={styles.applicableNormaTitle}>{norma.titulo}</span>
                                        </div>
                                        <div className={styles.applicableArticleRows}>
                                            {norma.articulosList.map((art) => (
                                                <button
                                                    key={art.key}
                                                    type="button"
                                                    className={styles.applicableArticleRow}
                                                    onClick={() => onMapNodeSelect && onMapNodeSelect({ type: 'articulo', normaKey: norma.key, articuloId: art.key })}
                                                >
                                                    <span className={styles.applicableArticleLabel}>{art.titulo}</span>
                                                    <span className={styles.applicableArticleMeta}>
                                                        {art.totalFragments} fragmento{art.totalFragments === 1 ? '' : 's'}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        );
                    };

                    // --- Highlight search terms in text ---
                    const highlightString = (textStr: string, queryStr: string) => {
                        if (!queryStr || !textStr) return textStr;
                        const stopwords = new Set([
                            'para', 'como', 'sobre', 'entre', 'hasta', 'desde', 'este', 'esta', 'estos', 'estas',
                            'esos', 'esas', 'aquel', 'aquella', 'pero', 'sino', 'porque', 'cuando', 'donde', 'quien',
                            'cual', 'cuales', 'tiene', 'tienen', 'debe', 'deben', 'puede', 'pueden', 'ser', 'estar'
                        ]);
                        // Extract valid words from query
                        const words = queryStr.toLowerCase()
                            .split(/[^a-záéíóúñü]+/i)
                            .filter(w => w.length > 3 && !stopwords.has(w));
                        
                        if (words.length === 0) return textStr;

                        const regex = new RegExp(`(${words.join('|')})`, 'gi');
                        const parts = textStr.split(regex);
                        
                        return (
                            <>
                                {parts.map((part, i) => 
                                    regex.test(part) 
                                        ? <mark key={i} style={{ backgroundColor: '#fef08a', padding: '0 2px', borderRadius: '2px', color: 'inherit' }}>{part}</mark> 
                                        : <React.Fragment key={i}>{part}</React.Fragment>
                                )}
                            </>
                        );
                    };

                    return (
                        <div className={styles.responseSection}>
                            {/* Interactive Mapa Normativo (Moved to top as sticky nav) */}
                            <div className={styles.mapaNormativoBlock}>
                                <div className={styles.blockLabel}>Fuentes asociadas a la consulta</div>
                                {sources.length > 0 ? (
                                    <div className={styles.mapaTree}>
                                        {mapaNormativo.map((norma) => (
                                            <div key={norma.key} className={styles.mapaNormaNode}>
                                                <div 
                                                    className={clsx(
                                                        styles.mapaNodeHeader, 
                                                        selectedMapNode?.normaKey === norma.key && !selectedMapNode?.articuloId && styles.nodeSelected
                                                    )}
                                                    onClick={() => onMapNodeSelect && onMapNodeSelect({ type: 'norma', normaKey: norma.key })}
                                                >
                                                    {norma.rango && <span className={styles.mapaBadge}>{norma.rango}</span>}
                                                    <span className={styles.mapaContentTitle}>{norma.titulo}</span>
                                                </div>
                                                
                                                <div className={styles.mapaHijos}>
                                                    {norma.articulosList.map((art) => (
                                                        <div 
                                                            key={art.key} 
                                                            className={clsx(
                                                                styles.mapaArticuloNode, 
                                                                selectedMapNode?.articuloId === art.key && styles.nodeSelected
                                                            )}
                                                            onClick={() => onMapNodeSelect && onMapNodeSelect({ type: 'articulo', normaKey: norma.key, articuloId: art.key })}
                                                        >
                                                            <span className={styles.mapaContentSubtitle}>{art.titulo}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ padding: '0.5rem 0 0 0', color: '#64748B', fontSize: '0.9rem', fontStyle: 'italic' }}>
                                        No se han encontrado fragmentos estructurados para esta consulta.
                                    </div>
                                )}
                            </div>

                            <div className={styles.responseCard}>
                                {!selectedMapNode ? (
                                    <div className={styles.normativeSheet}>
                                        <div className={styles.sheetHeader}>
                                            <div>
                                                <div className={styles.sheetEyebrow}>Ficha de respuesta normativa</div>
                                                <h2 className={styles.sheetTitle}>Resultado de consulta técnica</h2>
                                            </div>
                                            <div className={styles.sheetSourceCount}>
                                                {sources.length} fuente{sources.length === 1 ? '' : 's'}
                                            </div>
                                        </div>

                                        <section className={styles.sheetBlock}>
                                            <div className={styles.sheetBlockHeader}>
                                                <span className={styles.sheetBlockNumber}>1</span>
                                                <h3>Conclusión rápida</h3>
                                            </div>
                                            <p className={styles.conclusionText}>{highlightString(conclusionRapida, query)}</p>
                                            {isStructured && shouldShowRespuestaBreve && (
                                                <p className={styles.secondaryConclusionText}>{respuestaBreve}</p>
                                            )}
                                        </section>

                                        <section className={styles.sheetBlock}>
                                            <div className={styles.sheetBlockHeader}>
                                                <span className={styles.sheetBlockNumber}>2</span>
                                                <h3>Artículos aplicables</h3>
                                            </div>
                                            {renderArticleGroups()}
                                        </section>

                                        <section className={styles.sheetBlock}>
                                            <div className={styles.sheetBlockHeader}>
                                                <span className={styles.sheetBlockNumber}>3</span>
                                                <h3>Checklist técnico</h3>
                                            </div>
                                            {checklistItems.length > 0 ? (
                                                <ul className={styles.checklistList}>
                                                    {checklistItems.map((item, index) => (
                                                        <li key={`${item}-${index}`}>{item}</li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <div className={styles.checklistPlaceholder}>
                                                    Checklist disponible al generar informe técnico.
                                                </div>
                                            )}
                                        </section>

                                        <section className={styles.sheetBlock}>
                                            <div className={styles.sheetBlockHeader}>
                                                <span className={styles.sheetBlockNumber}>4</span>
                                                <h3>Fuentes normativas</h3>
                                            </div>
                                            {realSourceCitations.length > 0 ? (
                                                <div className={styles.normativeSourcesList}>
                                                    {renderCitations(realSourceCitations)}
                                                </div>
                                            ) : (
                                                <div className={styles.emptyNormativeBlock}>
                                                    No hay fuentes reales asociadas a esta respuesta.
                                                </div>
                                            )}
                                        </section>

                                        {fundamentoNormativo && (
                                            <section className={styles.sheetBlock}>
                                                <div className={styles.sheetBlockHeader}>
                                                    <span className={styles.sheetBlockNumber}>5</span>
                                                    <h3>Fundamento normativo</h3>
                                                </div>
                                                <p className={styles.blockText}>{highlightString(fundamentoNormativo, query)}</p>
                                            </section>
                                        )}

                                        {!isStructured && (
                                            <section className={styles.sheetBlock}>
                                                <div className={styles.sheetBlockHeader}>
                                                    <span className={styles.sheetBlockNumber}>{fundamentoNormativo ? '6' : '5'}</span>
                                                    <h3>Respuesta completa</h3>
                                                </div>
                                                <div className={styles.responseText}>
                                                    {text.split('\n\n').map((paragraph, i) => (
                                                        <p key={i}>{paragraph}</p>
                                                    ))}
                                                </div>
                                            </section>
                                        )}

                                        <section className={`${styles.sheetBlock} ${styles.actionsBlock}`}>
                                            <div className={styles.sheetBlockHeader}>
                                                <span className={styles.sheetBlockNumber}>{fundamentoNormativo || !isStructured ? '6' : '5'}</span>
                                                <h3>Acciones</h3>
                                            </div>
                                            <div className={styles.sheetActions}>
                                                <button
                                                    type="button"
                                                    className={styles.technicalReportToggle}
                                                    onClick={handleTechnicalReportToggle}
                                                    disabled={isGeneratingTechnicalReport}
                                                >
                                                    <FileText size={16} />
                                                    {showTechnicalReport ? 'Ocultar informe técnico' : 'Informe técnico'}
                                                </button>
                                                <button type="button" className={styles.futureActionButton} disabled title="Próximamente">
                                                    <Save size={16} />
                                                    Guardar
                                                </button>
                                                <button type="button" className={styles.futureActionButton} disabled title="Próximamente">
                                                    <Download size={16} />
                                                    Exportar
                                                </button>
                                            </div>
                                        </section>
                                    </div>
                                ) : (
                                    <div className={styles.filteredRAGView}>
                                        <button 
                                            className={styles.backButton} 
                                            onClick={() => onMapNodeSelect && onMapNodeSelect(null)}
                                        >
                                            ← Volver a la respuesta completa
                                        </button>
                                        
                                        <div className={styles.filteredHeader}>
                                            <h3 className={styles.filteredTitle}>
                                                {selectedMapNode.type === 'norma' 
                                                    ? 'Fragmentos asociados a la norma' 
                                                    : 'Fragmentos asociados al artículo'}
                                            </h3>
                                            <div className={styles.filteredSubtitle}>
                                                {selectedMapNode.type === 'norma' 
                                                    ? mapaNormativo.find(n => n.key === selectedMapNode.normaKey)?.titulo 
                                                    : sources.find(s => s.id === selectedMapNode.articuloId || s.subtitle === selectedMapNode.articuloId)?.subtitle || 'Artículo seleccionado'
                                                }
                                            </div>
                                        </div>
                                        
                                        <div className={styles.filteredFragments}>
                                            {sources
                                                .filter(s => {
                                                    const key = s.normaId ? String(s.normaId) : s.title;
                                                    if (selectedMapNode.type === 'norma') return key === selectedMapNode.normaKey;
                                                    
                                                    // By article exact match
                                                    const artKey = s.metadata?.articulo || s.articulo_detectado || s.subtitle || `art-desconocido`;
                                                    return key === selectedMapNode.normaKey && artKey === selectedMapNode.articuloId;
                                                })
                                                .map(s => (
                                                    <div key={s.id} className={styles.filteredFragmentCard}>
                                                        <div className={styles.filteredFragmentTitle}>{s.subtitle || 'Fragmento base'}</div>
                                                        <div className={styles.filteredFragmentText}>{highlightString(s.content, query)}</div>
                                                    </div>
                                                ))
                                            }
                                        </div>
                                        </div>
                                )}
                            </div>
                            {!selectedMapNode && (
                                <>
                                    {showTechnicalReport && (
                                        <article className={styles.technicalReportCard}>
                                            <header className={styles.technicalReportHeader}>
                                                <div>
                                                    <div className={styles.technicalReportEyebrow}>Informe técnico</div>
                                                    <h3 className={styles.technicalReportTitle}>Informe técnico de consulta normativa</h3>
                                                </div>
                                            </header>

                                            {isGeneratingTechnicalReport && (
                                                <div className={styles.technicalReportStatus}>Generando informe técnico...</div>
                                            )}

                                            {technicalReportError && !isGeneratingTechnicalReport && (
                                                <div className={styles.technicalReportError}>{technicalReportError}</div>
                                            )}

                                            {technicalReport && !isGeneratingTechnicalReport && (
                                                <>
                                                    <section className={styles.technicalReportSection}>
                                                        <h4>1. Objeto</h4>
                                                        <p>{technicalReport.objeto || 'No disponible.'}</p>
                                                    </section>

                                                    <section className={styles.technicalReportSection}>
                                                        <h4>2. Antecedentes / consulta</h4>
                                                        <p>{technicalReport.antecedentes_consulta || query || 'No consta consulta original.'}</p>
                                                    </section>

                                                    <section className={styles.technicalReportSection}>
                                                        <h4>3. Normativa utilizada</h4>
                                                        {technicalReport.normativa_utilizada?.length > 0 ? (
                                                            <ul>
                                                                {technicalReport.normativa_utilizada.map((item, index) => (
                                                                    <li key={`${item.norma}-${index}`}>
                                                                        <strong>{item.norma}</strong>
                                                                        {item.referencias.length > 0 ? `: ${item.referencias.join(', ')}` : ' Referencias no especificadas.'}
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        ) : (
                                                            <p>No se han identificado normas concretas suficientes.</p>
                                                        )}
                                                    </section>

                                                    <section className={styles.technicalReportSection}>
                                                        <h4>4. Análisis técnico</h4>
                                                        <p>{technicalReport.analisis_tecnico || 'No hay análisis técnico disponible.'}</p>
                                                    </section>

                                                    <section className={styles.technicalReportSection}>
                                                        <h4>5. Criterio aplicable</h4>
                                                        <p>{technicalReport.criterio_aplicable || 'No hay criterio aplicable disponible.'}</p>
                                                    </section>

                                                    <section className={styles.technicalReportSection}>
                                                        <h4>6. Puntos a comprobar</h4>
                                                        {technicalReport.puntos_a_comprobar?.length > 0 ? (
                                                            <ul>
                                                                {technicalReport.puntos_a_comprobar.map((point, index) => (
                                                                    <li key={`${point}-${index}`}>{point}</li>
                                                                ))}
                                                            </ul>
                                                        ) : (
                                                            <p>No constan puntos adicionales a comprobar.</p>
                                                        )}
                                                    </section>

                                                    <section className={styles.technicalReportSection}>
                                                        <h4>7. Conclusión práctica</h4>
                                                        <p>{technicalReport.conclusion_practica || 'No hay conclusión práctica disponible.'}</p>
                                                    </section>

                                                    <section className={styles.technicalReportSection}>
                                                        <h4>8. Limitaciones</h4>
                                                        {technicalReport.limitaciones?.length > 0 ? (
                                                            <ul>
                                                                {technicalReport.limitaciones.map((limit, index) => (
                                                                    <li key={`${limit}-${index}`}>{limit}</li>
                                                                ))}
                                                            </ul>
                                                        ) : (
                                                            <p>El informe se limita a las fuentes recuperadas para esta consulta.</p>
                                                        )}
                                                    </section>

                                                    <section className={`${styles.technicalReportSection} ${styles.technicalReportWarning}`}>
                                                        <h4>9. Advertencia profesional</h4>
                                                        <p>{technicalReport.advertencia_profesional}</p>
                                                    </section>
                                                </>
                                            )}
                                        </article>
                                    )}
                                </>
                            )}
                        </div>
                    );
                })()}
            </div>
        </>
    )}
</div>
    );
}
