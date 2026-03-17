"use client";

import React, { useState } from 'react';
import styles from './SourcesPanel.module.css';
import { FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { Source } from '@/lib/types';
import { clsx } from 'clsx';

interface SourcesPanelProps {
    query?: string;
    sources: Source[];
    selectedSourceId: string | null;
    onSelectSource: (id: string) => void;
    onCloseSource?: () => void;
}

export default function SourcesPanel({ query = '', sources, selectedSourceId, onSelectSource, onCloseSource }: SourcesPanelProps) {
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

    // --- Highlight search terms in text ---
    const highlightString = (textStr: string, queryStr: string) => {
        if (!queryStr || !textStr) return <>{textStr}</>;
        const stopwords = new Set([
            'para', 'como', 'sobre', 'entre', 'hasta', 'desde', 'este', 'esta', 'estos', 'estas',
            'esos', 'esas', 'aquel', 'aquella', 'pero', 'sino', 'porque', 'cuando', 'donde', 'quien',
            'cual', 'cuales', 'tiene', 'tienen', 'debe', 'deben', 'puede', 'pueden', 'ser', 'estar'
        ]);
        // Extract valid words from query
        const words = queryStr.toLowerCase()
            .split(/[^a-záéíóúñü]+/i)
            .filter(w => w.length > 3 && !stopwords.has(w));
        
        if (words.length === 0) return <>{textStr}</>;

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
        <div className={styles.container}>
            <div className={styles.header}>
                <h2 className={styles.title}>Fuentes exactas</h2>
            </div>

            <div className={styles.content}>
                {sources.length > 0 && (
                    <div className={styles.contextCard}>
                        <h3 className={styles.contextCardTitle}>Relevancia de Fuentes</h3>
                        <div className={styles.contextCardBody}>
                            <div className={styles.contextRow}>
                                <span className={styles.contextLabel}>Grado de coincidencia principal</span>
                                {sources[0]?.score ? (
                                    <span className={clsx(styles.contextBadge, sources[0].score >= 0.70 ? styles.badgeHigh : styles.badgeMedium)}>
                                        {sources[0].score >= 0.70 ? 'Alta confianza' : 'Media confianza'} ({(sources[0].score * 100).toFixed(0)}%)
                                    </span>
                                ) : (
                                    <span className={clsx(styles.contextBadge, styles.badgeNeutral)}>
                                        Estándar
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {sources.length > 0 && (
                    <div className={styles.sourceListTitle}>
                        Desglose de fuentes principales
                    </div>
                )}

                <div className={styles.sourceList}>
                    {groupedSources.map((group, groupIndex) => (
                        <div key={`group-${group.key}`} className={styles.normaGroup}>
                            {/* Titulo Cabecera Norma */}
                            <div className={styles.normaHeader}>
                                <div className={styles.iconWrapper}>
                                    <FileText size={16} />
                                </div>
                                <div className={styles.sourceInfo}>
                                    <div className={styles.sourceTitle}>{group.title}</div>
                                    <div className={styles.sourceMeta}>
                                        <span className={styles.groupOverviewCount}>
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
                                                    <div className={styles.fragmentTitle}>
                                                        {source.subtitle || "Fragmento normativo"}
                                                    </div>
                                                    {!isSelected && (
                                                        <div className={styles.fragmentSnippet}>
                                                            {source.content.substring(0, 90)}...
                                                        </div>
                                                    )}
                                                    <div className={styles.sourceMeta} style={{ marginTop: '6px' }}>
                                                        <span className={styles.scoreBadge}>
                                                            <span className={styles.scoreDot} />
                                                            {source.score ? `${(source.score * 100).toFixed(0)}% de similitud` : 'Fragmento base'}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className={styles.chevronWrapper}>
                                                    {isSelected ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                </div>
                                            </div>

                                            {/* Texto del artículo si está seleccionado */}
                                            {isSelected && (
                                                <div className={styles.sourceDetail}>
                                                    {source.highlight && (
                                                        <div className={styles.highlightQuote}>
                                                            "{source.highlight}"
                                                        </div>
                                                    )}
                                                    <div className={styles.detailContent}>
                                                        {highlightString(source.content, query)}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Botón Ver Más de esta Norma, si hay ocultos */}
                            {(group.totalItems > group.visibleItems.length || group.isExpanded) && (
                                <button
                                    className={styles.expandGroupButton}
                                    onClick={() => toggleGroup(group.key)}
                                >
                                    {group.isExpanded ? "Ocultar fragmentos adicionales" : `Ver ${group.totalItems - group.visibleItems.length} fragmentos adicionales en esta norma`}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
