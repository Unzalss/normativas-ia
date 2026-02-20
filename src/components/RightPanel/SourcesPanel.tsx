"use client";

import React from 'react';
import styles from './SourcesPanel.module.css';
import { FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { Source } from '@/lib/types';
import { clsx } from 'clsx';

interface SourcesPanelProps {
    sources: Source[];
    selectedSourceId: string | null;
    onSelectSource: (id: string) => void;
    onCloseSource?: () => void;
}

export default function SourcesPanel({ sources, selectedSourceId, onSelectSource, onCloseSource }: SourcesPanelProps) {
    const selectedSource = sources.find(s => s.id === selectedSourceId);

    // Logic to show list or detail. 
    // Requirement: "Al seleccionar una fuente, debajo se muestra el texto literal completo del artículo/trozo en un panel con scroll"
    // It implies the detail shows *below* the item or in a separate area?
    // "en un panel con scroll" sounds like the whole right panel creates a detail view or it expands.
    // Given "below shows text", let's implement an accordion-like or split view if space allows, 
    // OR just a detail view that replaces the list (common in mobile, but on desktop right panel is fixed).
    // Let's implement a List -> Detail flow within the right panel.

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2 className={styles.title}>Fuentes exactas</h2>
            </div>

            <div className={styles.content}>
                <div className={styles.sourceList}>
                    {sources.map(source => (
                        <div
                            key={source.id}
                            className={clsx(
                                styles.sourceCard,
                                selectedSourceId === source.id && styles.activeSource
                            )}
                            onClick={() => {
                                if (selectedSourceId === source.id) {
                                    onSelectSource(''); // Toggle off (assuming parent handles empty string as null/none)
                                } else {
                                    onSelectSource(source.id);
                                }
                            }}
                        >
                            <div className={styles.cardHeader}>
                                <div className={styles.iconWrapper}>
                                    <FileText size={18} />
                                </div>
                                <div className={styles.sourceInfo}>
                                    <div className={styles.sourceTitle}>{source.title}</div>
                                    {source.subtitle && (
                                        <div className={styles.sourceSubtitle}>{source.subtitle}</div>
                                    )}
                                    <div className={styles.sourceMeta}>
                                        <span className={styles.score}>{(source.score * 100).toFixed(0)}% relevant</span>
                                    </div>
                                </div>
                                <div className={styles.chevronWrapper}>
                                    {selectedSourceId === source.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </div>
                            </div>

                            {/* Show content inline if selected, as per "debajo se muestra" */}
                            {selectedSourceId === source.id && (
                                <div className={styles.sourceDetail}>
                                    <div className={styles.detailContent}>
                                        {source.content}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
