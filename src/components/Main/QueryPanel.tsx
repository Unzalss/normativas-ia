import React, { useEffect, useState } from 'react';
import styles from './QueryPanel.module.css';
import { ChevronDown, Search, ChevronRight, FileText, Download, Share, X } from 'lucide-react';
import { clsx } from 'clsx';
import { ResponseData, Source } from '@/lib/types';



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
}

export default function QueryPanel({ query, response, isLoading, error, onQuery, onCitationClick, normas, selectedNormaId, onSelectNormaId, sources = [] }: QueryPanelProps) {
    const [text, setText] = useState(query);

    // Sync local state when prop changes (restoring history)
    useEffect(() => {
        setText(query);
    }, [query]);

    const handleSend = () => {
        if (!text.trim()) return;
        console.log("SEND", text);
        onQuery(text.trim());
    };



    // State to determine if we are in the initial fully empty dashboard view
    const isHome = !query && !response && !isLoading && !error;

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
                            <h2 className={styles.heroTitle}>Buscador Normativo Profesional</h2>
                            <p className={styles.heroSubtitle}>Localice requisitos específicos en el articulado consolidado del CTE, Eurocódigos y normativa industrial.</p>
                        </div>

                        <div className={styles.homeSearchWrapper}>
                            <div className={styles.homeSearchInner}>
                                <Search className={styles.searchIconLarge} size={24} />
                                <textarea
                                    className={styles.homeTextarea}
                                    placeholder="Describa el requisito técnico o artículo a consultar..."
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
                                <button className={styles.exampleCard} onClick={() => onQuery("Resistencia al fuego en vigas de acero")}>
                                    <FileText size={18} className={styles.exampleIcon} />
                                    <span>Resistencia al fuego en vigas de acero (DB-SI)</span>
                                </button>
                                <button className={styles.exampleCard} onClick={() => onQuery("Pendiente máxima en rampas de garaje")}>
                                    <FileText size={18} className={styles.exampleIcon} />
                                    <span>Pendiente máxima en rampas de garaje (DB-SUA)</span>
                                </button>
                                <button className={styles.exampleCard} onClick={() => onQuery("Transmitancia térmica muros sótano")}>
                                    <FileText size={18} className={styles.exampleIcon} />
                                    <span>Transmitancia térmica muros sótano (DB-HE)</span>
                                </button>
                                <button className={styles.exampleCard} onClick={() => onQuery("Ventilación mínima en cocinas industriales")}>
                                    <FileText size={18} className={styles.exampleIcon} />
                                    <span>Ventilación mínima en cocinas industriales (RITE)</span>
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
                            `${label}:\\s*\\n?([\\s\\S]*?)(?=\\n(?:Respuesta breve|Fundamento normativo|Cita):|$)`,
                            'i'
                        );
                        return text.match(regex)?.[1]?.trim() ?? '';
                    };

                    const respuestaBreve      = extract('Respuesta breve');
                    const fundamentoNormativo = extract('Fundamento normativo');
                    const cita               = extract('Cita');
                    const isStructured       = !!(respuestaBreve || fundamentoNormativo || cita);



                    const renderCitations = (raw: string) =>
                        raw.split('\n').filter(l => l.trim()).map((line, i) => (
                            <div key={i} className={styles.citaLine}>
                                <strong>{line.trim()}</strong>
                            </div>
                        ));

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
                            <div className={styles.userQueryCard}>
                                <span className={styles.queryLabel}>Consulta realizada:</span>
                                <span className={styles.queryTextVal}>{query}</span>
                            </div>

                            <div className={styles.responseCard}>
                                {isStructured ? (
                                    <div className={styles.structuredBlocks}>
                                        {respuestaBreve && (
                                            <div className={styles.responseBlock}>
                                                <div className={styles.blockLabel}>Respuesta breve</div>
                                                <p className={styles.blockText}>{respuestaBreve}</p>
                                            </div>
                                        )}
                                        {fundamentoNormativo && (
                                            <div className={styles.responseBlock}>
                                                <div className={styles.blockLabel}>Fundamento normativo</div>
                                                <p className={styles.blockText}>{highlightString(fundamentoNormativo, query)}</p>
                                            </div>
                                        )}
                                        {cita && (
                                            <div className={`${styles.responseBlock} ${styles.citaBlock}`}>
                                                <div className={styles.blockLabel}>Artículos citados</div>
                                                <div className={styles.citaList}>
                                                    {renderCitations(cita)}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className={styles.responseText}>
                                        {text.split('\n\n').map((paragraph, i) => (
                                            <p key={i}>{paragraph}</p>
                                        ))}
                                    </div>
                                )}

                                {/* Esqueleto visual de Mapa Normativo */}
                                <div className={styles.mapaNormativoBlock}>
                                    <div className={styles.blockLabel}>Mapa Normativo</div>
                                    <div className={styles.mapaItem}>
                                        <span className={styles.mapaBadge}>ESTRUCTURA VISUAL</span>
                                        <span className={styles.mapaText}>Estructura normativa asociada a la respuesta.</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </div>
        </>
    )}
</div>
    );
}
