"use client";

import React, { useState } from 'react';
import styles from './ThreePanelLayout.module.css';
import { clsx } from 'clsx';
import { Menu, MessageSquare, List } from 'lucide-react';

interface ThreePanelLayoutProps {
  leftPanel: React.ReactNode;
  mainPanel: React.ReactNode;
  rightPanel: React.ReactNode;
}

type Tab = 'query' | 'response' | 'sources';

export default function ThreePanelLayout({
  leftPanel,
  mainPanel,
  rightPanel,
}: ThreePanelLayoutProps) {
  const [activeTab, setActiveTab] = useState<Tab>('query');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className={styles.container}>
      {/* Mobile Header */}
      <div className={styles.mobileHeader}>
        <button
          className={styles.menuButton}
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        >
          <Menu size={24} />
        </button>
        <span className={styles.mobileTitle}>Normativas IA</span>
      </div>

      {/* Sidebar (History) */}
      <aside className={clsx(styles.leftPanel, isSidebarOpen && styles.leftPanelOpen)}>
        {leftPanel}
      </aside>

      {/* Main Content Area */}
      <main className={styles.contentArea}>
        {/* Desktop: Show Main and Right Panels side-by-side */}
        <div className={styles.desktopLayout}>
          <div className={styles.mainPanel}>{mainPanel}</div>
          <div className={styles.rightPanel}>{rightPanel}</div>
        </div>

        {/* Mobile: Tabs and Conditional Rendering */}
        <div className={styles.mobileLayout}>
          <div className={styles.mobileContent}>
            <div className={clsx(styles.tabContent, activeTab === 'sources' ? styles.hidden : '')}>
              {mainPanel}
            </div>
            <div className={clsx(styles.tabContent, activeTab !== 'sources' ? styles.hidden : '')}>
              {rightPanel}
            </div>
          </div>

          <div className={styles.mobileTabBar}>
            <button
              className={clsx(styles.tabButton, activeTab !== 'sources' && styles.activeTab)}
              onClick={() => setActiveTab('query')}
            >
              <MessageSquare size={20} />
              <span>Consulta</span>
            </button>
            <button
              className={clsx(styles.tabButton, activeTab === 'sources' && styles.activeTab)}
              onClick={() => setActiveTab('sources')}
            >
              <List size={20} />
              <span>Fuentes</span>
            </button>
          </div>
        </div>

        {/* Overlay for sidebar on mobile */}
        {isSidebarOpen && (
          <div
            className={styles.overlay}
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
      </main>
    </div>
  );
}
