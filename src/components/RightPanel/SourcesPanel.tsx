"use client";

import React, { useState } from 'react';
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
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };

    // Grouping by Norma with professional rules
    const groupedSources = React.useMemo(() => {
        if (!sources || sources.length === 0) return [];

        const groupsMap: Record<string, { key: string, title: string, items: Source[] }> = {};

        sources.forEach(source => {
            const key = source.normaId ? String(source.normaId) : source.title;
            if (!groupsMap[key]) {
                groupsMap[key] = {
                    key,
                    title: source.title,
                    items: []
                };
            }
            groupsMap[key].items.push(source);
        });

        const allGroups = Object.values(groupsMap);

        // Find best global score
        const topScore = sources[0].score;
        const isHighConfidence = topScore >= 0.70;

        let visibleGroups = allGroups;

        // 1) "mostrar SOLO esa norma"
        if (isHighConfidence) {
            const topKey = sources[0].normaId ? String(sources[0].normaId) : sources[0].title;
            visibleGroups = allGroups.filter(g => g.key === topKey);
        }

        const result = [];
        let totalItemsAdded = 0;

        for (const group of visibleGroups) {
            const isExpanded = !!expandedGroups[group.key];
            const totalInGroup = group.items.length;
            let visibleInGroup = [];

            if (isExpanded) {
                // If expanded, show all inside this group
                visibleInGroup = group.items;
                // Don't count expanded against the strict default 4-limit to prevent bugs, 
                // but increment to block subsequent unexpanded groups from adding if it goes over.
                totalItemsAdded += group.items.length;
            } else {
                if (isHighConfidence) {
                    // "sus 2 mejores fragmentos"
                    visibleInGroup = group.items.slice(0, 2);
                    totalItemsAdded += visibleInGroup.length;
                } else {
                    // "mostrar hasta 2 fragmentos por norma y máximo 4 fragmentos totales"
                    const spaceLeft = Math.max(0, 4 - totalItemsAdded);
                    const allowedForGroup = Math.min(2, spaceLeft);
                    visibleInGroup = group.items.slice(0, allowedForGroup);
                    totalItemsAdded += visibleInGroup.length;
                }
            }

            // Only push groups that actually have visible items
            if (visibleInGroup.length > 0) {
                result.push({
                    ...group,
                    visibleItems: visibleInGroup,
                    totalItems: totalInGroup,
                    isExpanded
                });
            }
        }

        return result;
    }, [sources, expandedGroups]);

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2 className={styles.title}>Fuentes exactas</h2>
            </div>

            <div className={styles.content}>
                <div className={styles.sourceList}>
                    {groupedSources.map((group, groupIndex) => (
                        <div key={`group-${group.key}`} className={styles.normaGroup}>

                            {/* Titulo Cabecera Norma */}
                            <div className={styles.normaHeader}>
                                <div className={styles.iconWrapper}>
                                    <FileText size={18} />
                                </div>
                                <div className={styles.sourceInfo}>
                                    <div className={styles.sourceTitle}>{group.title}</div>
                                    <div className={styles.sourceMeta}>
                                        <span className={styles.score}>
                                            {group.isExpanded || group.visibleItems.length === group.totalItems
                                                ? `${group.totalItems} fragmento${group.totalItems > 1 ? 's' : ''}`
                                                : `${group.visibleItems.length} de ${group.totalItems} fragmentos`
                                            }
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Sub Fragmentos (Artículos) */}
                            <div className={styles.fragmentsContainer}>
                                {group.visibleItems.map((source) => {
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

                            {/* Botón Ver Más de esta Norma, si hay ocultos */}
                            {group.totalItems > group.visibleItems.length || group.isExpanded ? (
                                <button
                                    className={styles.expandGroupButton}
                                    onClick={() => toggleGroup(group.key)}
                                >
                                    {group.isExpanded ? "Ocultar fragmentos" : `Ver ${group.totalItems - group.visibleItems.length} fragmentos más`}
                                </button>
                            ) : null}

                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
