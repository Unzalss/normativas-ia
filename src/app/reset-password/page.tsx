"use client";

import React, { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

export default function ResetPasswordPage() {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isCheckingSession, setIsCheckingSession] = useState(true);
    const [hasSession, setHasSession] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const supabase = useMemo(
        () =>
            createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
            ),
        []
    );

    useEffect(() => {
        async function checkSession() {
            const { data: { session } } = await supabase.auth.getSession();
            setHasSession(Boolean(session));
            setIsCheckingSession(false);
        }

        checkSession();
    }, [supabase]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        setSuccess(false);

        if (password !== confirmPassword) {
            setError("Las contraseñas no coinciden.");
            return;
        }

        if (password.length < 6) {
            setError("La contraseña debe tener al menos 6 caracteres.");
            return;
        }

        setIsLoading(true);

        try {
            const { error: updateError } = await supabase.auth.updateUser({ password });

            if (updateError) {
                throw new Error(updateError.message);
            }

            setSuccess(true);
            setPassword("");
            setConfirmPassword("");
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No se pudo actualizar la contraseña.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg-app)" }}>
            <section
                style={{
                    width: "100%",
                    maxWidth: 440,
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-color)",
                    borderRadius: 8,
                    boxShadow: "var(--shadow-sm)",
                    padding: 28,
                }}
            >
                <p style={{ color: "var(--text-secondary)", fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                    Administración
                </p>
                <h1 style={{ fontSize: 28, lineHeight: 1.2, marginBottom: 8 }}>Nueva contraseña</h1>
                <p style={{ color: "var(--text-secondary)", fontSize: 15, marginBottom: 22 }}>
                    Define una contraseña nueva para tu cuenta.
                </p>

                {isCheckingSession && (
                    <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>Comprobando enlace de recuperación...</p>
                )}

                {!isCheckingSession && !hasSession && (
                    <p style={{ color: "#92400e", fontSize: 14, lineHeight: 1.5 }}>
                        Abre esta pantalla desde el enlace de recuperación recibido por email.
                    </p>
                )}

                {!isCheckingSession && hasSession && !success && (
                    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
                        <label style={labelStyle}>
                            Nueva contraseña
                            <input
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                required
                                autoComplete="new-password"
                                style={inputStyle}
                            />
                        </label>

                        <label style={labelStyle}>
                            Repetir contraseña
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(event) => setConfirmPassword(event.target.value)}
                                required
                                autoComplete="new-password"
                                style={inputStyle}
                            />
                        </label>

                        <button
                            type="submit"
                            disabled={isLoading}
                            style={{
                                minHeight: 42,
                                border: "none",
                                borderRadius: 6,
                                background: "var(--primary-color)",
                                color: "white",
                                fontWeight: 700,
                                cursor: isLoading ? "default" : "pointer",
                                opacity: isLoading ? 0.7 : 1,
                            }}
                        >
                            {isLoading ? "Guardando..." : "Guardar contraseña"}
                        </button>
                    </form>
                )}

                {success && (
                    <div style={{ display: "grid", gap: 14 }}>
                        <p style={{ color: "#166534", fontSize: 14, lineHeight: 1.5 }}>
                            Contraseña actualizada correctamente.
                        </p>
                        <Link href="/login" style={linkButtonStyle}>
                            Ir a login
                        </Link>
                    </div>
                )}

                {error && <p style={{ marginTop: 16, color: "#991b1b", fontSize: 14 }}>{error}</p>}
            </section>
        </main>
    );
}

const labelStyle: React.CSSProperties = {
    display: "grid",
    gap: 6,
    fontSize: 14,
    fontWeight: 700,
};

const inputStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 40,
    border: "1px solid var(--border-color)",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 15,
};

const linkButtonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
    borderRadius: 6,
    background: "var(--primary-color)",
    color: "white",
    fontWeight: 700,
};
