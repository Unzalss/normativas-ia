export interface Citation {
    id: string;
    sourceId: string;
    text: string;
}

export interface NormaMetadata {
    jurisdiccion?: string;
    ambito?: string;
    fecha_publicacion?: string; // ISO date string
    fecha_vigencia?: string; // ISO date string
    estado?: string;
}

export interface Norma {
    id: number;
    titulo: string;
    metadata?: NormaMetadata;
}

export interface NormaParteMetadata {
    articulo?: string;
    rango?: string;
    es_indice?: boolean;
}

export interface Source {
    id: string;
    title: string;
    type: 'PDF' | 'DOC' | 'WEB';
    score: number;
    content: string;
    metadata?: NormaParteMetadata;
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
