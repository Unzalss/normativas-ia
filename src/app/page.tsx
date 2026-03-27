"use client";

// Strips internal fragmentation markers (e.g. "[Bloque 6]", "[Bloque 12]") that
// must never be shown to end-users. The legal reference itself is preserved.
function cleanCitation(text: string): string {
    if (!text) return text;
    // Remove " [Bloque N]" patterns (space + bracket), trimming any trailing space
    return text.replace(/\s*\[Bloque\s+\d+\]/gi, '').trim();
}

import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import ThreePanelLayout from '@/components/Layout/ThreePanelLayout';
import HistorySidebar from '@/components/Sidebar/HistorySidebar';
import QueryPanel from '@/components/Main/QueryPanel';
import SourcesPanel from '@/components/RightPanel/SourcesPanel';
import { HistoryItem, ResponseData, Source, MapNode } from '@/lib/types';

// Creamos un cliente público ligero apuntando al proyecto actual
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Home() {
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string>('');
    const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
    const [selectedMapNode, setSelectedMapNode] = useState<{ type: 'norma' | 'articulo', normaKey: string, articuloId?: string } | null>(null);

    // Initial state empty
    const [currentQuery, setCurrentQuery] = useState<string>('');
    const [response, setResponse] = useState<ResponseData | undefined>(undefined);
    const [sources, setSources] = useState<Source[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [normas, setNormas] = useState<{ id: number, titulo: string, codigo: string }[]>([]);
    const [selectedNormaId, setSelectedNormaId] = useState<number | null>(null);

    useEffect(() => {
        async function fetchNormas() {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const token = session?.access_token;

                const headers: HeadersInit = {};
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const res = await fetch('/api/normas', { headers });
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
            setSelectedMapNode(null); // Reset map selection
        }
    };

    const handleNewChat = () => {
        setSelectedHistoryId('');
        setCurrentQuery('');
        setResponse(undefined);
        setSources([]);
        setSelectedSourceId(null);
        setSelectedMapNode(null);
        setError(null);
        // NO resetear: selectedNormaId
    };

    const handleQuery = async (text: string) => {
        setCurrentQuery(text);
        setIsLoading(true);
        setResponse(undefined);
        setSources([]);
        setSelectedSourceId(null);
        setSelectedMapNode(null);
        setError(null);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const headers: HeadersInit = {
                'Content-Type': 'application/json',
            };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            if (typeof window !== 'undefined' && window.location.search.includes('debug=1')) {
                headers['x-debug'] = '1';
            }

            const res = await fetch('/api/ask', {
                method: 'POST',
                headers,
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

                if (json.answer || (Array.isArray(json.data) && json.data.length > 0)) {
                    // Consolidate fragments into text
                    const cleanedFragments = (json.data || [])
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
                    // Also strip any internal [Bloque N] references the LLM may have echoed
                    const rawText = json.answer ? json.answer : cleanedFragments.slice(0, 1).join("\n\n");
                    const combinedText = cleanCitation(rawText);

                    // Create citations (strip internal block markers)
                    const citations = (json.data || []).map((item: any, index: number) => ({
                        id: item.id ? String(item.id) : `cit-${index}`,
                        sourceId: item.id ? String(item.id) : `src-${index}`,
                        text: cleanCitation(item.seccion || `Fragmento ${index + 1}`)
                    }));

                    newResponse = {
                        id: crypto.randomUUID(),
                        text: combinedText,
                        citations: citations
                    };

                    // Trust the backend's sources array if available, otherwise fallback to data.
                    const backendSources = Array.isArray(json.sources) && json.sources.length > 0
                        ? json.sources
                        : (json.data || []);

                    // Deduplicate unique sources for the right panel
                    const uniqueData: any[] = [];
                    const seenSignatures = new Set<string>();
                    const seenIds = new Set<string>();

                    for (const item of backendSources) {
                        const idStr = item.id ? String(item.id) : null;
                        // Strict deduplication by norma and completely cleaned section (article), 
                        // so we don't show multiple fragments from the same article.
                        const cleanedSec = cleanCitation(item.seccion || '');
                        const sig = `${item.norma_id || ''}-${cleanedSec}`;

                        // Avoid duplicates
                        if (idStr && seenIds.has(idStr)) continue;
                        if (seenSignatures.has(sig)) continue;

                        if (idStr) seenIds.add(idStr);
                        seenSignatures.add(sig);

                        uniqueData.push(item);
                    }

                    newSources = uniqueData.map((item: any, index: number) => {
                        // 1) Title logic: lookup in our preloaded `normas` state
                        let sourceTitle = `Documento ${index + 1}`;
                        if (item.norma_id) {
                            const preloadedNorma = normas.find(Math => Math.id === item.norma_id);
                            if (preloadedNorma) {
                                sourceTitle = preloadedNorma.codigo || preloadedNorma.titulo;
                            } else if (item.codigo) {
                                sourceTitle = item.codigo;
                            } else if (item.norma_titulo) {
                                sourceTitle = item.norma_titulo;
                            }
                        }

                        // 2) Subtitle logic (Artículo or Sección) — strip internal block markers
                        let sourceSubtitle = "";
                        if (item.articulo) {
                            sourceSubtitle = cleanCitation(item.articulo);
                        } else if (item.seccion) {
                            sourceSubtitle = cleanCitation(item.seccion);
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
                            content: item.texto || item.content || "",
                            articulo_detectado: item.articulo_detectado,
                            capitulo_detectado: item.capitulo_detectado,
                            titulo_articulo: item.titulo_articulo,
                            highlight: item.highlight
                        };
                    });

                    // Sort newSources by norma_id, then numerically by article number
                    newSources.sort((a, b) => {
                        const normaA = typeof a.normaId === 'number' ? a.normaId : 0;
                        const normaB = typeof b.normaId === 'number' ? b.normaId : 0;
                        if (normaA !== normaB) return normaA - normaB;
                        
                        const getNum = (str: string) => {
                            const match = str.match(/\d+/);
                            return match ? parseInt(match[0], 10) : 0;
                        };
                        return getNum(a.subtitle || '') - getNum(b.subtitle || '');
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
        } catch (err: any) {
            console.error("Error asking API:", err);
            setError(err.message || "Ocurrió un error en la consulta.");
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
                    error={error}
                    onQuery={handleQuery}
                    onCitationClick={handleCitationClick}
                    normas={normas}
                    selectedNormaId={selectedNormaId}
                    onSelectNormaId={setSelectedNormaId}
                    sources={sources}
                    selectedMapNode={selectedMapNode}
                    onMapNodeSelect={setSelectedMapNode}
                />
            }
            rightPanel={
                <SourcesPanel
                    query={currentQuery}
                    sources={sources}
                    selectedSourceId={selectedSourceId}
                    onSelectSource={setSelectedSourceId}
                    selectedMapNode={selectedMapNode}
                />
            }
        />
    );
}
