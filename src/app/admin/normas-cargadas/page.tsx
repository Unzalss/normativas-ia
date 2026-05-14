"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

type NormaAdminRow = {
    id: number;
    titulo: string | null;
    codigo: string | null;
    estado_ingesta: string | null;
    num_fragmentos: number | null;
    num_articulos_detectados: number | null;
    num_anexos_detectados: number | null;
    fecha_ingesta: string | null;
    fecha_publicacion: string | null;
    estado: string | null;
    materia: string | null;
    ambito: string | null;
    jurisdiccion: string | null;
    error_ingesta: string | null;
};

type FilterKey = "estado_ingesta" | "estado" | "materia" | "ambito";

function formatDate(value: string | null): string {
    if (!value) return "-";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat("es-ES", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}

function StatusBadge({ value }: { value: string | null }) {
    const normalized = value || "sin_estado";
    const colors: Record<string, { bg: string; text: string; border: string }> = {
        lista: { bg: "#ecfdf5", text: "#166534", border: "#bbf7d0" },
        procesando: { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
        error: { bg: "#fef2f2", text: "#991b1b", border: "#fecaca" },
        sin_estado: { bg: "#f8fafc", text: "#475569", border: "#e2e8f0" },
    };
    const palette = colors[normalized] || colors.sin_estado;

    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 24,
                padding: "2px 9px",
                borderRadius: 999,
                border: `1px solid ${palette.border}`,
                background: palette.bg,
                color: palette.text,
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1.4,
                whiteSpace: "nowrap",
            }}
        >
            {value || "Sin estado"}
        </span>
    );
}

export default function NormasCargadasAdminPage() {
    const router = useRouter();
    const [rows, setRows] = useState<NormaAdminRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [filters, setFilters] = useState<Record<FilterKey, string>>({
        estado_ingesta: "",
        estado: "",
        materia: "",
        ambito: "",
    });

    const supabase = useMemo(
        () =>
            createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
            ),
        []
    );

    useEffect(() => {
        async function fetchNormas() {
            setIsLoading(true);
            setError(null);

            try {
                const { data: { session } } = await supabase.auth.getSession();
                const token = session?.access_token;

                if (!token) {
                    setRows([]);
                    router.replace("/login?next=/admin/normas-cargadas");
                    return;
                }

                const res = await fetch("/api/admin/normas", {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });
                const json = await res.json();

                if (res.status === 403) {
                    setRows([]);
                    setError("Acceso denegado. Sin permisos de administración.");
                    return;
                }

                if (!res.ok || !json.ok) {
                    throw new Error(json.error || "No se pudieron cargar las normas.");
                }

                setRows(Array.isArray(json.data) ? json.data : []);
            } catch (err: unknown) {
                setRows([]);
                setError(err instanceof Error ? err.message : "No se pudieron cargar las normas.");
            } finally {
                setIsLoading(false);
            }
        }

        fetchNormas();
    }, [router, supabase]);

    const filterOptions = useMemo(() => {
        const buildOptions = (key: FilterKey) =>
            Array.from(new Set(rows.map((row) => row[key]).filter((value): value is string => Boolean(value))))
                .sort((a, b) => a.localeCompare(b, "es"));

        return {
            estado_ingesta: buildOptions("estado_ingesta"),
            estado: buildOptions("estado"),
            materia: buildOptions("materia"),
            ambito: buildOptions("ambito"),
        };
    }, [rows]);

    const filteredRows = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase();

        return rows.filter((row) => {
            const matchesSearch = !normalizedSearch ||
                [row.codigo, row.titulo].some((value) => value?.toLowerCase().includes(normalizedSearch));

            const matchesFilters = (Object.keys(filters) as FilterKey[]).every((key) => {
                return !filters[key] || row[key] === filters[key];
            });

            return matchesSearch && matchesFilters;
        });
    }, [filters, rows, search]);

    function updateFilter(key: FilterKey, value: string) {
        setFilters((current) => ({ ...current, [key]: value }));
    }

    return (
        <main style={{ minHeight: "100vh", padding: "32px", background: "var(--bg-app)" }}>
            <section style={{ maxWidth: 1500, margin: "0 auto" }}>
                <header style={pageHeaderStyle}>
                    <div>
                        <p style={{ color: "var(--text-secondary)", fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                            Administración
                        </p>
                        <h1 style={{ fontSize: 30, lineHeight: 1.2, marginBottom: 8 }}>
                            Normas cargadas
                        </h1>
                        <p style={{ color: "var(--text-secondary)", fontSize: 15 }}>
                            Listado de control de las normas registradas en la base documental.
                        </p>
                    </div>
                    <Link href="/" style={backLinkStyle}>
                        Volver al buscador
                    </Link>
                </header>

                <div style={panelStyle}>
                    <div style={panelTopStyle}>
                        <strong style={{ fontSize: 15 }}>
                            Mostrando {filteredRows.length} de {rows.length}
                        </strong>
                        {isLoading && <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>Cargando...</span>}
                    </div>

                    <div style={filtersGridStyle}>
                        <label style={filterLabelStyle}>
                            Buscar por código o título
                            <input
                                type="search"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Ej: RD-486, accesibilidad..."
                                style={controlStyle}
                            />
                        </label>

                        <FilterSelect
                            label="Estado ingesta"
                            value={filters.estado_ingesta}
                            options={filterOptions.estado_ingesta}
                            onChange={(value) => updateFilter("estado_ingesta", value)}
                        />
                        <FilterSelect
                            label="Estado"
                            value={filters.estado}
                            options={filterOptions.estado}
                            onChange={(value) => updateFilter("estado", value)}
                        />
                        <FilterSelect
                            label="Materia"
                            value={filters.materia}
                            options={filterOptions.materia}
                            onChange={(value) => updateFilter("materia", value)}
                        />
                        <FilterSelect
                            label="Ámbito"
                            value={filters.ambito}
                            options={filterOptions.ambito}
                            onChange={(value) => updateFilter("ambito", value)}
                        />
                    </div>

                    {error && (
                        <div style={{ padding: 18, color: "#991b1b", background: "#fef2f2", borderBottom: "1px solid #fecaca" }}>
                            {error}
                        </div>
                    )}

                    <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1680, tableLayout: "fixed" }}>
                            <thead>
                                <tr style={{ background: "#f8fafc", color: "var(--text-secondary)", textAlign: "left" }}>
                                    {[
                                        "Código",
                                        "Título",
                                        "Estado ingesta",
                                        "Fragmentos",
                                        "Artículos",
                                        "Anexos",
                                        "Materia",
                                        "Ámbito",
                                        "Jurisdicción",
                                        "Fecha publicación",
                                        "Fecha ingesta",
                                        "Estado",
                                        "Notas",
                                    ].map((heading, index) => (
                                        <th key={heading} style={{ ...headerCellStyle, width: columnWidths[index] }}>
                                            {heading}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {!isLoading && filteredRows.length === 0 && !error && (
                                    <tr>
                                        <td colSpan={13} style={{ padding: 24, color: "var(--text-secondary)", textAlign: "center" }}>
                                            No hay normas que coincidan con los filtros.
                                        </td>
                                    </tr>
                                )}

                                {filteredRows.map((row) => (
                                    <tr key={row.id}>
                                        <td style={{ ...cellStyle, width: columnWidths[0] }}>
                                            <strong style={strongWrapStyle}>{row.codigo || "-"}</strong>
                                        </td>
                                        <td style={{ ...cellStyle, width: columnWidths[1] }}>
                                            <span style={longTextStyle}>{row.titulo || "-"}</span>
                                        </td>
                                        <td style={{ ...cellStyle, width: columnWidths[2] }}>
                                            <StatusBadge value={row.estado_ingesta} />
                                        </td>
                                        <td style={{ ...numberCellStyle, width: columnWidths[3] }}>{row.num_fragmentos ?? 0}</td>
                                        <td style={{ ...numberCellStyle, width: columnWidths[4] }}>{row.num_articulos_detectados ?? 0}</td>
                                        <td style={{ ...numberCellStyle, width: columnWidths[5] }}>{row.num_anexos_detectados ?? 0}</td>
                                        <td style={{ ...cellStyle, width: columnWidths[6] }}>{row.materia || "-"}</td>
                                        <td style={{ ...cellStyle, width: columnWidths[7] }}>{row.ambito || "-"}</td>
                                        <td style={{ ...cellStyle, width: columnWidths[8] }}>{row.jurisdiccion || "-"}</td>
                                        <td style={{ ...cellStyle, width: columnWidths[9] }}>{formatDate(row.fecha_publicacion)}</td>
                                        <td style={{ ...cellStyle, width: columnWidths[10] }}>{formatDate(row.fecha_ingesta)}</td>
                                        <td style={{ ...cellStyle, width: columnWidths[11] }}>{row.estado || "-"}</td>
                                        <td style={{ ...cellStyle, width: columnWidths[12], color: row.error_ingesta ? "#991b1b" : "var(--text-secondary)" }}>
                                            <span style={longTextStyle}>{row.error_ingesta || "Sin incidencias"}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>
        </main>
    );
}

function FilterSelect({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: string[];
    onChange: (value: string) => void;
}) {
    return (
        <label style={filterLabelStyle}>
            {label}
            <select value={value} onChange={(event) => onChange(event.target.value)} style={controlStyle}>
                <option value="">Todos</option>
                {options.map((option) => (
                    <option key={option} value={option}>
                        {option}
                    </option>
                ))}
            </select>
        </label>
    );
}

const columnWidths = [150, 360, 140, 100, 100, 90, 150, 140, 140, 140, 140, 110, 320];

const pageHeaderStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 20,
    marginBottom: 24,
};

const backLinkStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    padding: "8px 13px",
    border: "1px solid var(--border-color)",
    borderRadius: 6,
    background: "var(--bg-card)",
    color: "var(--primary-color)",
    fontSize: 14,
    fontWeight: 700,
    whiteSpace: "nowrap",
};

const panelStyle: React.CSSProperties = {
    background: "var(--bg-card)",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    boxShadow: "var(--shadow-sm)",
    overflow: "hidden",
};

const panelTopStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "16px 18px",
    borderBottom: "1px solid var(--border-color)",
    flexWrap: "wrap",
};

const filtersGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(260px, 1.4fr) repeat(4, minmax(160px, 1fr))",
    gap: 12,
    padding: 18,
    borderBottom: "1px solid var(--border-color)",
    background: "#fbfdff",
};

const filterLabelStyle: React.CSSProperties = {
    display: "grid",
    gap: 6,
    color: "var(--text-secondary)",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: 0,
};

const controlStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 38,
    border: "1px solid var(--border-color)",
    borderRadius: 6,
    background: "white",
    color: "var(--text-primary)",
    padding: "7px 9px",
    fontSize: 14,
    textTransform: "none",
};

const headerCellStyle: React.CSSProperties = {
    padding: "12px 14px",
    borderBottom: "1px solid var(--border-color)",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: 0,
    whiteSpace: "nowrap",
};

const cellStyle: React.CSSProperties = {
    padding: "13px 14px",
    borderBottom: "1px solid var(--border-color)",
    fontSize: 14,
    lineHeight: 1.5,
    verticalAlign: "top",
    overflowWrap: "anywhere",
    wordBreak: "normal",
};

const numberCellStyle: React.CSSProperties = {
    ...cellStyle,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
};

const longTextStyle: React.CSSProperties = {
    display: "block",
    maxWidth: "100%",
    overflowWrap: "anywhere",
    whiteSpace: "normal",
};

const strongWrapStyle: React.CSSProperties = {
    ...longTextStyle,
    color: "var(--primary-color)",
};
