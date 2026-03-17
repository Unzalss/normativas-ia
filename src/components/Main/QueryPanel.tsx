import React, { useEffect, useState } from 'react';
import styles from './QueryPanel.module.css';
import { ChevronDown, Search } from 'lucide-react';
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



    return (
        <div className={styles.container}>
            <div className={styles.topBar}>
                <div className={styles.dropdownWrapper}>
                    <select
                        className={styles.dropdownSelect}
                        value={selectedNormaId === null ? "" : selectedNormaId}
                        onChange={(e) => {
                            const val = e.target.value;
                            if (!val) {
                                onSelectNormaId(null);
                            } else {
                                onSelectNormaId(Number(val));
                            }
                        }}
                    >
                        <option value="">Todas las normas</option>
                        {normas.map(norma => (
                            <option key={norma.id} value={norma.id}>
                                {norma.codigo || norma.titulo}
                            </option>
                        ))}
                    </select>
                    <ChevronDown size={16} className={styles.dropdownIcon} />
                </div>

                <div className={styles.userProfile}>
                    <span className={styles.userName}>Felix Perez</span>
                    <button className={styles.profileBtn}>
                        <div className={styles.avatar}>FP</div>
                        <ChevronDown size={14} className={styles.profileChevron} />
                    </button>
                    {/* Mock Dropdown could go here, visually implied by the button structure for now */}
                </div>
            </div>

            <div className={styles.scrollContent}>
                <div className={styles.inputSection}>
                    <div className={styles.inputWrapper}>
                        <textarea
                            className={styles.textarea}
                            placeholder="Escribe tu pregunta..."
                            rows={2}
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                        />
                        <div className={styles.inputActionsCompact}>
                            <button
                                className={styles.consultButton}
                                onClick={handleSend}
                                disabled={isLoading}
                            >
                                <Search size={16} />
                                <span>{isLoading ? 'Consultando...' : 'Consultar'}</span>
                            </button>
                        </div>
                    </div>
                </div>

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

                    // --- Group sources by norma for Fuentes jurídicas ---
                    const normaGroups = new Map<string, { normaTitle: string; articles: Source[] }>();
                    for (const src of sources) {
                        const key = src.normaId != null ? String(src.normaId) : src.title;
                        if (!normaGroups.has(key)) {
                            normaGroups.set(key, { normaTitle: src.title, articles: [] });
                        }
                        normaGroups.get(key)!.articles.push(src);
                    }

                    // Badge: show selected norma, OR the primary detected norma from sources
                    let displayedNormaTitle: string | null = null;
                    if (selectedNormaId !== null) {
                        const sn = normas.find(n => n.id === selectedNormaId);
                        if (sn) displayedNormaTitle = sn.codigo || sn.titulo;
                    } else if (sources.length > 0) {
                        // Global search: show the highest scoring norma
                        displayedNormaTitle = sources[0].title;
                    }

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
                            {displayedNormaTitle && (
                                <div className={styles.normaBadgeRow}>
                                    <span className={styles.normaBadge}>{displayedNormaTitle}</span>
                                </div>
                            )}

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
                            </div>

                            {/* Fuentes jurídicas */}
                            {normaGroups.size > 0 && (
                                <div className={styles.fuentesCard}>
                                    <div className={styles.fuentesTitle}>Fuentes jurídicas</div>
                                    {Array.from(normaGroups.values()).map(({ normaTitle, articles }) => (
                                        <div key={normaTitle} className={styles.fuentesGroup}>
                                            <div className={styles.fuentesNorma}>{normaTitle}</div>
                                            <ul className={styles.fuentesList}>
                                                {articles.map(src => (
                                                    <li key={src.id}>
                                                        <button
                                                            className={styles.fuentesItem}
                                                            onClick={() => onCitationClick(src.id)}
                                                        >
                                                            {src.subtitle || src.title}
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}
