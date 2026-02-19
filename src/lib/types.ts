export interface Citation {
    id: string;
    sourceId: string;
    text: string;
}

export interface Source {
    id: string;
    title: string;
    type: 'PDF' | 'DOC' | 'WEB';
    score: number;
    content: string;
}

export interface ResponseData {
    id: string;
    text: string;
    citations: Citation[];
}

export interface HistoryItem {
    id: string;
    query: string;
    preview: string;
    // Full state for restoration
    response: ResponseData;
    sources: Source[];
}
