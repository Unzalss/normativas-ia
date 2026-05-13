"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import styles from './HistorySidebar.module.css';
import { Plus, History, Landmark, User, LogOut, ShieldCheck } from 'lucide-react';
import { HistoryItem } from '@/lib/types';
import { clsx } from 'clsx';

interface HistorySidebarProps {
    items: HistoryItem[];
    selectedId: string;
    onSelect: (id: string) => void;
    onNewChat: () => void;
}

export default function HistorySidebar({ items, selectedId, onSelect, onNewChat }: HistorySidebarProps) {
    const [authState, setAuthState] = useState<'loading' | 'anon' | 'user' | 'admin'>('loading');
    const [email, setEmail] = useState<string | null>(null);

    const supabase = useMemo(
        () =>
            createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
            ),
        []
    );

    useEffect(() => {
        let isMounted = true;

        async function loadProfile() {
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;

            if (!isMounted) return;

            if (!user) {
                setEmail(null);
                setAuthState('anon');
                return;
            }

            setEmail(user.email || null);

            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single();

            if (!isMounted) return;
            setAuthState(profile?.role === 'admin' ? 'admin' : 'user');
        }

        loadProfile();
        const { data: authListener } = supabase.auth.onAuthStateChange(() => {
            loadProfile();
        });

        return () => {
            isMounted = false;
            authListener.subscription.unsubscribe();
        };
    }, [supabase]);

    async function handleLogout() {
        await supabase.auth.signOut();
        setEmail(null);
        setAuthState('anon');
    }

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
                {authState === 'admin' && (
                    <div className={styles.adminActions}>
                        <Link href="/admin/normas-cargadas" className={styles.userCard}>
                            <div className={styles.avatar}>
                                <ShieldCheck size={16} />
                            </div>
                            <div className={styles.userInfo}>
                                <p className={styles.userName}>Normas cargadas</p>
                                <p className={styles.userPlan}>{email || 'Administrador'}</p>
                            </div>
                        </Link>
                        <button type="button" className={styles.logoutButton} onClick={handleLogout}>
                            <LogOut size={15} />
                            <span>Cerrar sesión</span>
                        </button>
                    </div>
                )}

                {authState === 'anon' && (
                    <Link href="/login" className={styles.userCard}>
                        <div className={styles.avatar}>
                            <User size={16} />
                        </div>
                        <div className={styles.userInfo}>
                            <p className={styles.userName}>Acceso admin</p>
                            <p className={styles.userPlan}>Iniciar sesión</p>
                        </div>
                    </Link>
                )}
            </div>
        </div>
    );
}
