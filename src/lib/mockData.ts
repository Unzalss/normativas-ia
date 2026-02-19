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

// Shared sources pool
const ALL_SOURCES: Record<string, Source> = {
    's1': {
        id: 's1',
        title: 'RD 505/2007 — Reglamento de desarrollo LOPD',
        type: 'PDF',
        score: 0.98,
        content: `Artículo 5. Deber de custodia.

1. El responsable del fichero o tratamiento y, en su caso, el encargado del tratamiento deberán adoptar las medidas de índole técnica y organizativa necesarias que garanticen la seguridad de los datos de carácter personal y eviten su alteración, pérdida, tratamiento o acceso no autorizado, habida cuenta del estado de la tecnología, la naturaleza de los datos almacenados y los riesgos a que están expuestos, ya provengan de la acción humana o del medio físico o natural.

2. No se registrarán datos de carácter personal en ficheros que no reúnan las condiciones que se determinen por vía reglamentaria con respecto a su integridad y seguridad y a las de los centros de tratamiento, locales, equipos, sistemas y programas.`
    },
    's2': {
        id: 's2',
        title: 'Ley Orgánica 3/2018 (LOPDGDD)',
        type: 'DOC',
        score: 0.95,
        content: `Artículo 32. Bloqueo de los datos.

1. El responsable del tratamiento estará obligado a bloquear los datos cuando proceda a su rectificación o supresión.

2. El bloqueo de los datos consiste en la identificación y reserva de los mismos, adoptando medidas técnicas y organizativas, para impedir su tratamiento, incluyendo su visualización, excepto para la puesta a disposición de los datos a los jueces y tribunales, el Ministerio Fiscal o las Administraciones Públicas competentes, en particular de las autoridades de protección de datos, para la exigencia de posibles responsabilidades derivadas del tratamiento y solo por el plazo de prescripción de las mismas.`
    },
    's3': {
        id: 's3',
        title: 'Guía AEPD sobre Plazos de Conservación',
        type: 'WEB',
        score: 0.85,
        content: `La conservación de los datos personales se limitará al mínimo necesario. Los plazos de conservación deberán establecerse en función de la finalidad para la que se recabaron los datos.

Una vez cumplida la finalidad, los datos deben ser bloqueados, quedando a disposición exclusiva de jueces y tribunales.`
    }
};

export const HISTORY_ITEMS: HistoryItem[] = [
    {
        id: '1',
        query: 'Plazos de conservación de datos',
        preview: 'Según el articulo 5...',
        response: {
            id: 'r1',
            text: `El plazo de conservación de los datos personales varía según la finalidad del tratamiento y la normativa aplicable. En general, el RGPD establece que los datos deben mantenerse "durante no más tiempo del necesario para los fines del tratamiento".

Sin embargo, existen plazos legales específicos:
1. **Datos laborales**: 4 años (art. 21 LISOS).
2. **Datos contables y fiscales**: 6 años (art. 30 Código de Comercio).
3. **Videovigilancia**: Máximo 1 mes, salvo que sean prueba de delito.`,
            citations: [
                { id: 'c1', sourceId: 's1', text: 'RD 505/2007 — Artículo 5' },
                { id: 'c2', sourceId: 's2', text: 'Ley Orgánica 3/2018 — Artículo 32' },
            ]
        },
        sources: [ALL_SOURCES['s1'], ALL_SOURCES['s2'], ALL_SOURCES['s3']]
    },
    {
        id: '2',
        query: 'Requisitos RGPD empresas pequeñas',
        preview: 'Las pymes deben...',
        response: {
            id: 'r2',
            text: `Las Pymes deben cumplir con el RGPD igual que las grandes empresas, pero con algunas particularidades.

Principales obligaciones:
- Registro de Actividades de Tratamiento (si tratan datos de riesgo o no es ocasional).
- Deber de informar a los interesados.
- Firmar contratos con encargados del tratamiento.
- Notificar brechas de seguridad.`,
            citations: [
                { id: 'c3', sourceId: 's1', text: 'RD 505/2007 — Artículo 8' }
            ]
        },
        sources: [ALL_SOURCES['s1']]
    },
    {
        id: '3',
        query: 'Sanciones por incumplimiento grave',
        preview: 'Hasta 20 millones...',
        response: {
            id: 'r3',
            text: `Las infracciones graves pueden ser sancionadas con multas administrativas de hasta 10 millones de euros o, tratándose de una empresa, de una cuantía equivalente al 2% como máximo del volumen de negocio total anual global del ejercicio financiero anterior, optándose por la de mayor cuantía.`,
            citations: []
        },
        sources: []
    }
];
