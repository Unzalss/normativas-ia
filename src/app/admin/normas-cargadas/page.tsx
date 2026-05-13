"use client";

import React, { useEffect, useMemo, useState } from "react";
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
    error_ingesta: string | null;
};

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
    const [rows, setRows] = useState<NormaAdminRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
                    setError("Debes iniciar sesión con un usuario administrador.");
                    return;
                }

                const res = await fetch("/api/admin/normas", {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });
                const json = await res.json();

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
    }, [supabase]);

    return (
        <main style={{ minHeight: "100vh", padding: "32px", background: "var(--bg-app)" }}>
            <section style={{ maxWidth: 1280, margin: "0 auto" }}>
                <header style={{ marginBottom: 24 }}>
                    <p style={{ color: "var(--text-secondary)", fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                        Administración
                    </p>
                    <h1 style={{ fontSize: 30, lineHeight: 1.2, marginBottom: 8 }}>
                        Normas cargadas
                    </h1>
                    <p style={{ color: "var(--text-secondary)", fontSize: 15 }}>
                        Listado de control de las normas registradas en la base documental.
                    </p>
                </header>

                <div
                    style={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-color)",
                        borderRadius: 8,
                        boxShadow: "var(--shadow-sm)",
                        overflow: "hidden",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 16,
                            padding: "16px 18px",
                            borderBottom: "1px solid var(--border-color)",
                        }}
                    >
                        <strong style={{ fontSize: 15 }}>Total: {rows.length}</strong>
                        {isLoading && <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>Cargando...</span>}
                    </div>

                    {error && (
                        <div style={{ padding: 18, color: "#991b1b", background: "#fef2f2", borderBottom: "1px solid #fecaca" }}>
                            {error}
                        </div>
                    )}

                    <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1120 }}>
                            <thead>
                                <tr style={{ background: "#f8fafc", color: "var(--text-secondary)", textAlign: "left" }}>
                                    {[
                                        "Código",
                                        "Título",
                                        "Estado ingesta",
                                        "Fragmentos",
                                        "Artículos",
                                        "Anexos",
                                        "Fecha publicación",
                                        "Fecha ingesta",
                                        "Estado",
                                        "Notas",
                                    ].map((heading) => (
                                        <th
                                            key={heading}
                                            style={{
                                                padding: "12px 14px",
                                                borderBottom: "1px solid var(--border-color)",
                                                fontSize: 12,
                                                fontWeight: 800,
                                                textTransform: "uppercase",
                                                letterSpacing: 0,
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {heading}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {!isLoading && rows.length === 0 && !error && (
                                    <tr>
                                        <td colSpan={10} style={{ padding: 24, color: "var(--text-secondary)", textAlign: "center" }}>
                                            No hay normas cargadas.
                                        </td>
                                    </tr>
                                )}

                                {rows.map((row) => (
                                    <tr key={row.id}>
                                        <td style={cellStyle}>
                                            <strong>{row.codigo || "-"}</strong>
                                        </td>
                                        <td style={{ ...cellStyle, minWidth: 260 }}>{row.titulo || "-"}</td>
                                        <td style={cellStyle}>
                                            <StatusBadge value={row.estado_ingesta} />
                                        </td>
                                        <td style={numberCellStyle}>{row.num_fragmentos ?? 0}</td>
                                        <td style={numberCellStyle}>{row.num_articulos_detectados ?? 0}</td>
                                        <td style={numberCellStyle}>{row.num_anexos_detectados ?? 0}</td>
                                        <td style={cellStyle}>{formatDate(row.fecha_publicacion)}</td>
                                        <td style={cellStyle}>{formatDate(row.fecha_ingesta)}</td>
                                        <td style={cellStyle}>{row.estado || "-"}</td>
                                        <td style={{ ...cellStyle, minWidth: 240, color: row.error_ingesta ? "#991b1b" : "var(--text-secondary)" }}>
                                            {row.error_ingesta || "Sin incidencias"}
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

const cellStyle: React.CSSProperties = {
    padding: "13px 14px",
    borderBottom: "1px solid var(--border-color)",
    fontSize: 14,
    lineHeight: 1.45,
    verticalAlign: "top",
};

const numberCellStyle: React.CSSProperties = {
    ...cellStyle,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
};
