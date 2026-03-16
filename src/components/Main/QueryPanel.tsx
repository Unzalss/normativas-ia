import React, { useEffect, useState } from 'react';
import styles from './QueryPanel.module.css';
import { ChevronDown, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { ResponseData } from '@/lib/types';



interface QueryPanelProps {
    query: string;
    response?: ResponseData;
    isLoading: boolean;
    onQuery: (text: string) => void;
    onCitationClick: (sourceId: string) => void;
    normas: Array<{ id: number, titulo: string }>;
    selectedNormaId: number | null;
    onSelectNormaId: (id: number | null) => void;
    error?: string | null;
}

export default function QueryPanel({ query, response, isLoading, error, onQuery, onCitationClick, normas, selectedNormaId, onSelectNormaId }: QueryPanelProps) {
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
                                {norma.titulo}
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

                    // Extract each labelled section from the LLM output
                    const extract = (label: string) => {
                        const regex = new RegExp(
                            `${label}:\\s*\\n?([\\s\\S]*?)(?=\\n(?:Respuesta breve|Fundamento normativo|Cita):|$)`,
                            'i'
                        );
                        return text.match(regex)?.[1]?.trim() ?? '';
                    };

                    const respuestaBreve     = extract('Respuesta breve');
                    const fundamentoNormativo = extract('Fundamento normativo');
                    const cita               = extract('Cita');
                    const isStructured       = !!(respuestaBreve || fundamentoNormativo || cita);

                    // Badge: show selected norma code if one is pinned
                    const selectedNorma = selectedNormaId !== null
                        ? normas.find(n => n.id === selectedNormaId)
                        : null;

                    // Render a [Artículo X] / [Bloque…] citation as a styled chip
                    const renderCitations = (raw: string) =>
                        raw.split('\n').filter(l => l.trim()).map((line, i) => (
                            <div key={i} className={styles.citaLine}>
                                <strong>{line.trim()}</strong>
                            </div>
                        ));

                    return (
                        <div className={styles.responseSection}>
                            {/* Norma badge */}
                            {selectedNorma && (
                                <div className={styles.normaBadgeRow}>
                                    <span className={styles.normaBadge}>
                                        {selectedNorma.titulo}
                                    </span>
                                </div>
                            )}

                            <div className={styles.responseCard}>
                                <h2 className={styles.responseTitle}>Respuesta</h2>

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
                                                <p className={styles.blockText}>{fundamentoNormativo}</p>
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
                                    // Fallback: plain paragraphs for unstructured text
                                    <div className={styles.responseText}>
                                        {text.split('\n\n').map((paragraph, i) => (
                                            <p key={i}>{paragraph}</p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}
