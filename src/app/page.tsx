"use client";

import React, { useState } from 'react';
import ThreePanelLayout from '@/components/Layout/ThreePanelLayout';
import HistorySidebar from '@/components/Sidebar/HistorySidebar';
import QueryPanel from '@/components/Main/QueryPanel';
import SourcesPanel from '@/components/RightPanel/SourcesPanel';
import { HISTORY_ITEMS, ResponseData } from '@/lib/mockData';

export default function Home() {
    const [selectedHistoryId, setSelectedHistoryId] = useState<string>('1');
    const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

    // Initial state based on first history item for this mock
    const [currentQuery, setCurrentQuery] = useState<string>(HISTORY_ITEMS[0].query);
    const [response, setResponse] = useState<ResponseData | undefined>(HISTORY_ITEMS[0].response);
    const [sources, setSources] = useState(HISTORY_ITEMS[0].sources);

    // Load full state from history
    const handleSelectHistory = (id: string) => {
        setSelectedHistoryId(id);
        const item = HISTORY_ITEMS.find(i => i.id === id);
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

    const handleQuery = (text: string) => {
        // Mocking a new query response
        setCurrentQuery(text);

        // Simulating search/response (using item 1 as default response for new queries in mock)
        const defaultMock = HISTORY_ITEMS[0];
        setResponse({
            ...defaultMock.response,
            text: `Respuesta simulada para: "${text}"\n\n${defaultMock.response.text}`
        });
        setSources(defaultMock.sources);
    };

    const handleCitationClick = (sourceId: string) => {
        // Expand the source in the right panel
        setSelectedSourceId(sourceId);
    };

    return (
        <ThreePanelLayout
            leftPanel={
                <HistorySidebar
                    items={HISTORY_ITEMS}
                    selectedId={selectedHistoryId}
                    onSelect={handleSelectHistory}
                    onNewChat={handleNewChat}
                />
            }
            mainPanel={
                <QueryPanel
                    query={currentQuery}
                    response={response}
                    isLoading={false}
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
