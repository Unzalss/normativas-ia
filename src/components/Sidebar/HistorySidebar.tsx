"use client";

import React from 'react';
import styles from './HistorySidebar.module.css';
import { Plus, History, Landmark, User, Settings } from 'lucide-react';
import { HistoryItem } from '@/lib/types';
import { clsx } from 'clsx';

interface HistorySidebarProps {
    items: HistoryItem[];
    selectedId: string;
    onSelect: (id: string) => void;
    onNewChat: () => void;
}

export default function HistorySidebar({ items, selectedId, onSelect, onNewChat }: HistorySidebarProps) {
    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.logoIcon}>
                    <Landmark size={20} />
                </div>
                <div className={styles.titleStack}>
                    <h1 className={styles.title}>LexAI Técnica</h1>
                    <span className={styles.subtitle}>INGENIERÍA & NORMATIVA</span>
                </div>
            </div>

            <div className={styles.actionArea}>
                <button className={styles.newChatButton} onClick={onNewChat}>
                    <Plus size={18} strokeWidth={2.5} />
                    <span>Nueva Consulta</span>
                </button>
            </div>

            <nav className={styles.historyList}>
                <div className={styles.sectionTitle}>Historial de Consultas</div>
                {items.length === 0 && (
                    <div className={styles.emptyHistory}>No hay consultas recientes</div>
                )}
                <div className={styles.historyGroup}>
                    {items.map((item) => (
                        <button
                            key={item.id}
                            className={clsx(styles.historyItem, item.id === selectedId && styles.selected)}
                            onClick={() => onSelect(item.id)}
                        >
                            <History size={16} className={styles.icon} />
                            <div className={styles.textContainer}>
                                <span className={styles.queryText}>{item.query}</span>
                            </div>
                        </button>
                    ))}
                </div>
            </nav>

            <div className={styles.userProfile}>
                <div className={styles.userCard}>
                    <div className={styles.avatar}>
                        <User size={16} />
                    </div>
                    <div className={styles.userInfo}>
                        <p className={styles.userName}>Consultor Técnico</p>
                        <p className={styles.userPlan}>Suscripción Profesional</p>
                    </div>
                    <Settings size={16} className={styles.settingsIcon} />
                </div>
            </div>
        </div>
    );
}
