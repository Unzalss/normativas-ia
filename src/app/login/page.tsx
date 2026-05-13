"use client";

import React, { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const nextPath = searchParams.get("next") || "/admin/normas-cargadas";

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const supabase = useMemo(
        () =>
            createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
            ),
        []
    );

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setIsLoading(true);
        setError(null);
        setMessage(null);

        try {
            const { data, error: signInError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (signInError || !data.user) {
                throw new Error(signInError?.message || "No se pudo iniciar sesión.");
            }

            const { data: profile, error: profileError } = await supabase
                .from("profiles")
                .select("role")
                .eq("id", data.user.id)
                .single();

            if (profileError || profile?.role !== "admin") {
                await supabase.auth.signOut();
                setMessage("Sin permisos de administración.");
                return;
            }

            router.push(nextPath);
            router.refresh();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <section
            style={{
                width: "100%",
                maxWidth: 420,
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
            <h1 style={{ fontSize: 28, lineHeight: 1.2, marginBottom: 8 }}>Acceso admin</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 15, marginBottom: 22 }}>
                Inicia sesión con tu cuenta administradora.
            </p>

            <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
                <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 700 }}>
                    Email
                    <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        autoComplete="email"
                        style={inputStyle}
                    />
                </label>

                <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 700 }}>
                    Contraseña
                    <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        autoComplete="current-password"
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
                    {isLoading ? "Entrando..." : "Entrar"}
                </button>
            </form>

            {error && <p style={{ marginTop: 16, color: "#991b1b", fontSize: 14 }}>{error}</p>}
            {message && <p style={{ marginTop: 16, color: "#92400e", fontSize: 14 }}>{message}</p>}
        </section>
    );
}

export default function LoginPage() {
    return (
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg-app)" }}>
            <Suspense fallback={null}>
                <LoginForm />
            </Suspense>
        </main>
    );
}

const inputStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 40,
    border: "1px solid var(--border-color)",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 15,
};
