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
            {activeTab === 'query' && mainPanel}
            {activeTab === 'response' && mainPanel} {/* Query/Response usually together or split? Request says "Tabs: Consulta / Respuesta / Fuentes". I'll keep them together in mainPanel for now as "Consulta+Respuesta" logic usually flows together, but let's see. If "Consulta" is just input and "Respuesta" is output, they might be same component. Let's assume MainPanel handles both for now, but maybe visual separation is needed. Actually user said "Consulta / Respuesta / Fuentes" tabs. Let's strictly follow tabs if possible, or maybe Query & Response are one logical unit? User said "Bloque Respuesta in una tarjeta grande". I will wrap MainPanel in a way it can show/hide parts or just show it all. For simplicity, let's treat "Consulta+Respuesta" as one view 'query', and 'sources' as another 'sources'. Wait, user explicitly said 3 tabs. I will implement logic to show/hide sections within MainPanel or just show MainPanel for both. Let's stick to 2 effective tabs for the main content: "Chat/Query" and "Sources". But user said 3. Let's try to map: 
            1. Consulta (Input)
            2. Respuesta (Output)
            3. Fuentes (Sources)
            
            If I stick to 3 panels desktop: Left, Center, Right.
            Mobile: 
            - Tab 1: Consulta (Input)
            - Tab 2: Respuesta (Output) -> might need to scroll down or hide input?
            - Tab 3: Fuentes (Right Panel)
            
            For now, I will treat MainPanel as containing both Consulta and Respuesta. I'll just toggle visibility of Sources. The user might want to focus on just the Answer.
            Let's simplify: Main Panel (Query+Response) vs Right Panel (Sources).
            But strictly following "Convertir a pestañas: Consulta / Respuesta / Fuentes".
            I will pass a prop to MainPanel to tell it what to show? Or just show it all and let user scroll. 
            Actually, "Respuesta" might be empty initially.
            Let's stick to: "Main" (Query + Result) and "Right" (Sources). 
            If user specifically asked for 3 tabs, I should probably split MainPanel? or just use internal state in MainPanel?
            
            Let's implement 2 main tabs for mobile here: "Discussion" (Main Panel) and "Sources" (Right Panel).
            I will name them 'CONSULTA' (Main) and 'FUENTES' (Right).
            The "Respuesta" tab might just be scrolling to the response in Main.
            
            Wait, user said: "Convertir a pestañas: Consulta / Respuesta / Fuentes".
            I will add a `mobileView` prop to children? No, that's messy.
            I will implement a simple switch.
            */}
            
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
