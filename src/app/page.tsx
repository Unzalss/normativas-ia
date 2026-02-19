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

            if (json.ok && Array.isArray(json.data)) {
                // consolidate fragments into text
                const combinedText = json.data.map((item: any) => item.content).join('\n\n');

                // create citations
                const citations = json.data.map((item: any, index: number) => ({
                    id: item.id ? String(item.id) : `cit-${index}`,
                    sourceId: item.source_id ? String(item.source_id) : 'unknown',
                    text: `Fragmento ${index + 1}`
                }));

                const newResponse: ResponseData = {
                    id: crypto.randomUUID(),
                    text: combinedText,
                    citations: citations
                };

                // Extract unique sources for the right panel
                // This logic might need refinement depending on what "source" means in the API vs UI
                // For now, we treat each fragment as a "source" entry or group by document?
                // The API returns fragments. Let's map fragments to Sources.
                // Assuming `item` has title? If not, we use generic title.
                const newSources: Source[] = json.data.map((item: any, index: number) => ({
                    id: item.source_id ? String(item.source_id) : `src-${index}`,
                    title: item.metadata?.filename || `Documento ${index + 1}`, // Fallback title
                    type: 'PDF', // Default type
                    score: item.similarity || 0,
                    content: item.content
                }));

                setResponse(newResponse);
                setSources(newSources);

                // Add to history
                const newHistoryItem: HistoryItem = {
                    id: crypto.randomUUID(),
                    query: text,
                    preview: combinedText.substring(0, 50) + '...',
                    response: newResponse,
                    sources: newSources
                };

                setHistory(prev => [newHistoryItem, ...prev]);
                setSelectedHistoryId(newHistoryItem.id);
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
