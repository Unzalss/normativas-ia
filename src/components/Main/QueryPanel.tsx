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
}

export default function QueryPanel({ query, response, isLoading, onQuery, onCitationClick }: QueryPanelProps) {
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
                <button className={styles.dropdownBtn}>
                    Todas las normas
                    <ChevronDown size={16} />
                </button>

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
                                <span>{isLoading ? 'CONSULTANDO v2...' : 'CONSULTAR v2'}</span>
                            </button>
                        </div>
                    </div>
                </div>

                {response && (
                    <div className={styles.responseSection}>
                        <div className={styles.responseCard}>
                            <h2 className={styles.responseTitle}>Respuesta</h2>
                            <div className={styles.responseText}>
                                {response.text.split('\n\n').map((paragraph, i) => (
                                    <p key={i}>{paragraph}</p>
                                ))}
                            </div>

                            <div className={styles.separator} />

                            <div className={styles.citationsSection}>
                                <h3 className={styles.citationTitle}>Citas / Fragmentos</h3>
                                <div className={styles.citationList}>
                                    {response.citations.map((cite) => (
                                        <button
                                            key={cite.id}
                                            className={styles.citationChip}
                                            onClick={() => onCitationClick(cite.sourceId)}
                                        >
                                            {cite.text}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
