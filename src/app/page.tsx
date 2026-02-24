"use client";

import React, { useState, useEffect } from 'react';
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
    const [normas, setNormas] = useState<{ id: number, titulo: string }[]>([]);
    const [selectedNormaId, setSelectedNormaId] = useState<number | null>(null);

    useEffect(() => {
        async function fetchNormas() {
            try {
                const res = await fetch('/api/normas');
                const json = await res.json();
                if (json.ok && json.data) {
                    setNormas(json.data);
                }
            } catch (error) {
                console.error("Error fetching normas:", error);
            }
        }
        fetchNormas();
    }, []);

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
        setSelectedNormaId(null);
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
                    normaId: selectedNormaId,
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

                    // Use the RAG answer from the backend if available, fallback to first cleaned fragment
                    const combinedText = json.answer ? json.answer : cleanedFragments.slice(0, 1).join("\n\n");

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

                    // Deduplicate unique sources for the right panel
                    const uniqueData: any[] = [];
                    const seenSignatures = new Set<string>();
                    const seenIds = new Set<string>();

                    for (const item of json.data) {
                        const itemScore = typeof item.score === 'number' ? item.score : (item.similarity || 0);
                        if (itemScore < 0.55) continue; // Skip low relevance noise

                        const idStr = item.id ? String(item.id) : null;
                        const sig = `${item.norma_id || ''}-${item.seccion || ''}-${item.tipo || ''}-${(item.texto || item.content || "").substring(0, 40)}`;

                        // Avoid duplicates
                        if (idStr && seenIds.has(idStr)) continue;
                        if (seenSignatures.has(sig)) continue;

                        if (idStr) seenIds.add(idStr);
                        seenSignatures.add(sig);

                        uniqueData.push(item);
                    }

                    newSources = uniqueData.map((item: any, index: number) => {
                        // 1) Title logic: norma.titulo -> codigo -> "Documento X"
                        let sourceTitle = `Documento ${index + 1}`;
                        if (item.norma_titulo && item.codigo) {
                            sourceTitle = `${item.codigo} — ${item.norma_titulo}`;
                        } else if (item.norma_titulo) {
                            sourceTitle = item.norma_titulo;
                        } else if (item.codigo) {
                            sourceTitle = item.codigo;
                        } else if (item.normas && item.normas.titulo) {
                            sourceTitle = item.normas.titulo;
                        }

                        // 2) Subtitle logic (Artículo or Sección)
                        let sourceSubtitle = "";
                        if (item.articulo) {
                            sourceSubtitle = item.articulo;
                        } else if (item.seccion) {
                            sourceSubtitle = item.seccion;
                        } else if (item.tipo && item.numero) {
                            sourceSubtitle = `${item.tipo} ${item.numero}`;
                        } else {
                            sourceSubtitle = "Fragmento";
                        }

                        return {
                            id: item.id ? String(item.id) : `src-${index}`,
                            title: sourceTitle,
                            subtitle: sourceSubtitle, // We will add this to the type or just render it if present in the component
                            normaId: item.norma_id,
                            type: 'PDF',
                            score: typeof item.score === 'number' ? item.score : (item.similarity || 0),
                            content: item.texto || item.content || ""
                        };
                    });

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
                    normas={normas}
                    selectedNormaId={selectedNormaId}
                    onSelectNormaId={setSelectedNormaId}
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
