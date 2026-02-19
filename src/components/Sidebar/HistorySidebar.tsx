"use client";

import React from 'react';
import styles from './HistorySidebar.module.css';
import { Plus, MessageSquare } from 'lucide-react';
import { HistoryItem } from '@/lib/mockData';
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
                <h1 className={styles.title}>Normativas IA</h1>
                <span className={styles.subtitle}>Responde solo con normativa cargada</span>
            </div>

            <div className={styles.actionArea}>
                <button className={styles.newChatButton} onClick={onNewChat}>
                    <Plus size={18} />
                    <span>Nueva consulta</span>
                </button>
            </div>

            <div className={styles.historyList}>
                <div className={styles.sectionTitle}>Historial</div>
                {items.map((item) => (
                    <button
                        key={item.id}
                        className={clsx(styles.historyItem, item.id === selectedId && styles.selected)}
                        onClick={() => onSelect(item.id)}
                    >
                        <MessageSquare size={16} className={styles.icon} />
                        <div className={styles.textContainer}>
                            <span className={styles.queryText}>{item.query}</span>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}
