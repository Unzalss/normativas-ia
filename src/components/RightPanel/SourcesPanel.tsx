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

    // Grouping by Norma
    // We use normaId or title as the grouping key.
    const groupedSources = React.useMemo(() => {
        const groups: Record<string, { title: string, items: Source[] }> = {};

        sources.forEach(source => {
            // fallback key to title if normaId is missing
            const key = source.normaId ? String(source.normaId) : source.title;
            if (!groups[key]) {
                groups[key] = {
                    title: source.title, // La norma principal
                    items: [] // List of fragments
                };
            }
            groups[key].items.push(source);
        });

        return Object.values(groups);
    }, [sources]);

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2 className={styles.title}>Fuentes exactas</h2>
            </div>

            <div className={styles.content}>
                <div className={styles.sourceList}>
                    {groupedSources.map((group, groupIndex) => (
                        <div key={`group-${groupIndex}`} className={styles.normaGroup}>

                            {/* Titulo Cabecera Norma */}
                            <div className={styles.normaHeader}>
                                <div className={styles.iconWrapper}>
                                    <FileText size={18} />
                                </div>
                                <div className={styles.sourceInfo}>
                                    <div className={styles.sourceTitle}>{group.title}</div>
                                    <div className={styles.sourceMeta}>
                                        <span className={styles.score}>{group.items.length} fragmentos</span>
                                    </div>
                                </div>
                            </div>

                            {/* Sub Fragmentos (Artículos) */}
                            <div className={styles.fragmentsContainer}>
                                {group.items.map((source) => {
                                    const isSelected = selectedSourceId === source.id;
                                    return (
                                        <div
                                            key={source.id}
                                            className={clsx(
                                                styles.fragmentCard,
                                                isSelected && styles.activeSource
                                            )}
                                        >
                                            <div
                                                className={styles.fragmentHeader}
                                                onClick={() => {
                                                    if (isSelected) {
                                                        onSelectSource('');
                                                    } else {
                                                        onSelectSource(source.id);
                                                    }
                                                }}
                                            >
                                                <div className={styles.fragmentInfo}>
                                                    <div className={styles.fragmentTitle}>{source.subtitle || "Fragmento"}</div>
                                                    <div className={styles.sourceMeta}>
                                                        <span className={styles.score}>{(source.score * 100).toFixed(0)}% relevant</span>
                                                    </div>
                                                </div>
                                                <div className={styles.chevronWrapper}>
                                                    {isSelected ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                </div>
                                            </div>

                                            {/* Texto del artículo si está seleccionado */}
                                            {isSelected && (
                                                <div className={styles.sourceDetail}>
                                                    <div className={styles.detailContent}>
                                                        {source.content}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
