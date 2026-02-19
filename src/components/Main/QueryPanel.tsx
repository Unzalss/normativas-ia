import React, { useEffect, useState } from 'react';
import styles from './QueryPanel.module.css';
import { ChevronDown, Search } from 'lucide-react';
import { clsx } from 'clsx';

interface Citation {
    id: string;
    sourceId: string;
    text: string;
}

interface ResponseData {
    id: string;
    text: string;
    citations: Citation[];
}

interface QueryPanelProps {
    query: string;
    response?: ResponseData;
    isLoading: boolean;
    onQuery: (text: string) => void;
    onCitationClick: (sourceId: string) => void;
}

export default function QueryPanel({ query, response, isLoading, onQuery, onCitationClick }: QueryPanelProps) {
    const [text, setText] = useState(query);
    const [localResponse, setLocalResponse] = useState<ResponseData | null>(null);
    const [isLocalLoading, setIsLocalLoading] = useState(false);

    // Sync local state when prop changes (restoring history)
    useEffect(() => {
        setText(query);
        // If query changes from props (history), reset local response to allow prop response to show
        if (query !== text) {
            setLocalResponse(null);
        }
    }, [query]);

    const handleSend = async () => {
        if (!text.trim()) return;

        setIsLocalLoading(true);
        try {
            const res = await fetch('/api/ask', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    question: text,
                    normaId: 1,
                    k: 8
                }),
            });

            if (!res.ok) throw new Error('API request failed');

            const json = await res.json();

            // Transform API data to ResponseData structure
            // Assuming json.data is an array of fragments
            if (json.ok && Array.isArray(json.data)) {
                const combinedText = json.data.map((item: any) => item.content).join('\n\n');
                const citations = json.data.map((item: any, index: number) => ({
                    id: item.id || `cit-${index}`,
                    sourceId: item.source_id ? String(item.source_id) : 'unknown',
                    text: `Fragmento ${index + 1}` // Fallback as we don't know exact title structure
                }));

                setLocalResponse({
                    id: 'api-response',
                    text: combinedText,
                    citations: citations
                });

                // Optionally notify parent that a query happened (though we handle response locally)
                // onQuery(text); 
            }

        } catch (error) {
            console.error("Error fetching answer:", error);
            setLocalResponse({
                id: 'error',
                text: "Error al consultar la normativa. Por favor intente nuevamente.",
                citations: []
            });
        } finally {
            setIsLocalLoading(false);
        }
    };

    const displayResponse = localResponse || response;
    const isBusy = isLocalLoading || isLoading;

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
                                disabled={isBusy}
                            >
                                <Search size={16} />
                                <span>{isBusy ? '...' : 'Consultar'}</span>
                            </button>
                        </div>
                    </div>
                </div>

                {displayResponse && (
                    <div className={styles.responseSection}>
                        <div className={styles.responseCard}>
                            <h2 className={styles.responseTitle}>Respuesta</h2>
                            <div className={styles.responseText}>
                                {displayResponse.text.split('\n\n').map((paragraph, i) => (
                                    <p key={i}>{paragraph}</p>
                                ))}
                            </div>

                            <div className={styles.separator} />

                            <div className={styles.citationsSection}>
                                <h3 className={styles.citationTitle}>Citas / Fragmentos</h3>
                                <div className={styles.citationList}>
                                    {displayResponse.citations.map((cite) => (
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
