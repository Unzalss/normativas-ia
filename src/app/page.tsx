"use client";

import React, { useState } from 'react';
import ThreePanelLayout from '@/components/Layout/ThreePanelLayout';
import HistorySidebar from '@/components/Sidebar/HistorySidebar';
import QueryPanel from '@/components/Main/QueryPanel';
import SourcesPanel from '@/components/RightPanel/SourcesPanel';
import { HistoryItem, ResponseData, Source } from '@/lib/types';

export default function Home() {
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string>('');
    const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

    // Initial state empty
    const [currentQuery, setCurrentQuery] = useState<string>('');
    const [response, setResponse] = useState<ResponseData | undefined>(undefined);
    const [sources, setSources] = useState<Source[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Load full state from history
    const handleSelectHistory = (id: string) => {
        setSelectedHistoryId(id);
        const item = history.find(i => i.id === id);
        if (item) {
            setCurrentQuery(item.query);
            setResponse(item.response);
            setSources(item.sources);
            setSelectedSourceId(null); // Reset source selection on interaction switch
        }
    };

    const handleNewChat = () => {
        setSelectedHistoryId('');
        setCurrentQuery('');
        setResponse(undefined);
        setSources([]);
        setSelectedSourceId(null);
    };

    const handleQuery = async (text: string) => {
        setCurrentQuery(text);
        setIsLoading(true);
        setResponse(undefined);
        setSources([]);
        setSelectedSourceId(null);

        try {
            const res = await fetch('/api/ask', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    question: text,
                    normaId: 1, // Hardcoded for now per instructions
                    k: 8
                }),
            });

            if (!res.ok) throw new Error('API request failed');

            const json = await res.json();

            if (json.ok) {
                let newResponse: ResponseData | undefined;
                let newSources: Source[] = [];
                let previewText = "";

                if (Array.isArray(json.data) && json.data.length > 0) {
                    // Consolidate fragments into text
                    const cleanedFragments = json.data
                        .map((x: any) => x.texto ?? "")
                        .filter((x: any) => typeof x === "string" && x.trim().length > 0)
                        .map((text: string) => {
                            const lines = text.split('\n');
                            const filteredLines = lines.filter(line =>
                                !line.includes('BOLETÍN OFICIAL DEL ESTADO') &&
                                !line.includes('LEGISLACIÓN CONSOLIDADA')
                            );
                            let cleanedText = filteredLines.join('\n');
                            cleanedText = cleanedText.replace(/Página\s+\d+/gi, '');
                            return cleanedText.trim();
                        })
                        .filter((text: string) => text.length > 0);

                    const combinedText = cleanedFragments.slice(0, 1).join("\n\n");

                    // Create citations
                    const citations = json.data.map((item: any, index: number) => ({
                        id: item.id ? String(item.id) : `cit-${index}`,
                        sourceId: item.id ? String(item.id) : `src-${index}`,
                        text: item.seccion || `Fragmento ${index + 1}`
                    }));

                    newResponse = {
                        id: crypto.randomUUID(),
                        text: combinedText,
                        citations: citations
                    };

                    // Extract unique sources for the right panel
                    newSources = json.data.map((item: any, index: number) => ({
                        id: item.id ? String(item.id) : `src-${index}`,
                        title: item.seccion ? `${item.tipo || 'Norma'} · ${item.seccion}` : `Documento ${index + 1}`,
                        type: 'PDF',
                        score: typeof item.score === 'number' ? item.score : (item.similarity || 0),
                        content: item.texto || item.content || ""
                    }));

                    previewText = combinedText;

                } else if (json.message) {
                    // Handle "No relevance" case
                    newResponse = {
                        id: crypto.randomUUID(),
                        text: json.message,
                        citations: []
                    };
                    previewText = json.message;
                }

                if (newResponse) {
                    setResponse(newResponse);
                    setSources(newSources);

                    // Add to history
                    const newHistoryItem: HistoryItem = {
                        id: crypto.randomUUID(),
                        query: text,
                        preview: previewText.substring(0, 50) + '...',
                        response: newResponse,
                        sources: newSources
                    };

                    setHistory(prev => [newHistoryItem, ...prev]);
                    setSelectedHistoryId(newHistoryItem.id);
                }
            }
        } catch (error) {
            console.error("Error asking API:", error);
            // Optionally set error state in UI
        } finally {
            setIsLoading(false);
        }
    };

    const handleCitationClick = (sourceId: string) => {
        // Expand the source in the right panel
        setSelectedSourceId(sourceId);
    };

    return (
        <ThreePanelLayout
            leftPanel={
                <HistorySidebar
                    items={history}
                    selectedId={selectedHistoryId}
                    onSelect={handleSelectHistory}
                    onNewChat={handleNewChat}
                />
            }
            mainPanel={
                <QueryPanel
                    query={currentQuery}
                    response={response}
                    isLoading={isLoading}
                    onQuery={handleQuery}
                    onCitationClick={handleCitationClick}
                />
            }
            rightPanel={
                <SourcesPanel
                    sources={sources}
                    selectedSourceId={selectedSourceId}
                    onSelectSource={setSelectedSourceId}
                />
            }
        />
    );
}
