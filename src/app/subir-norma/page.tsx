"use client";

import React, { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

export default function SubirNormaPage() {
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'duplicated' | 'duplicated_hash'>('idle');
    const [result, setResult] = useState<any>(null);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setStatus('loading');
        setResult(null);

        try {
            const formData = new FormData(e.currentTarget);

            const file = formData.get("file") as File;
            if (!file || file.size === 0) {
                throw new Error("Debes seleccionar un archivo.");
            }

            const supabase = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
            );

            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            /* --- AUTH DESACTIVADA TEMPORALMENTE ---
            if (!token) {
                throw new Error("No estás autenticado. Debes iniciar sesión primero.");
            }
            */

            const headers: Record<string, string> = {};
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const res = await fetch('/api/upload-norma', {
                method: 'POST',
                headers,
                body: formData,
            });

            const json = await res.json();

            if (!res.ok) {
                if (res.status === 409 && json.status === "duplicado") {
                    setStatus('duplicated');
                    setResult(json);
                    return;
                }
                if (res.status === 409 && json.status === "duplicado_hash") {
                    setStatus('duplicated_hash');
                    setResult(json);
                    return;
                }
                throw new Error(json.error || "Error al subir la norma");
            }

            setStatus('success');
            setResult(json);
        } catch (error: any) {
            console.error("Error al enviar norma:", error);
            setStatus('error');
            setResult({ error: error.message });
        }
    };

    return (
        <div style={{ maxWidth: '600px', margin: '40px auto', padding: '20px', fontFamily: 'sans-serif' }}>
            <h1>Subir Nueva Norma</h1>
            <p>Sube tu PDF para indexación privada en el buscador.</p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
                <div>
                    <label style={{ display: 'block', fontWeight: 'bold' }}>Título de la Norma *</label>
                    <input type="text" name="titulo" required style={{ width: '100%', padding: '8px' }} placeholder="Ej: Ley Orgánica 3/2018..." />
                </div>

                <div>
                    <label style={{ display: 'block', fontWeight: 'bold' }}>Código / Abreviatura *</label>
                    <input type="text" name="codigo" required style={{ width: '100%', padding: '8px' }} placeholder="Ej: LOPDGDD" />
                </div>

                <div>
                    <label style={{ display: 'block', fontWeight: 'bold' }}>Ámbito</label>
                    <input type="text" name="ambito" style={{ width: '100%', padding: '8px' }} placeholder="Opcional. Ej: Estatal, Autonómico" />
                </div>

                <div>
                    <label style={{ display: 'block', fontWeight: 'bold' }}>Rango / Tipo</label>
                    <input type="text" name="rango" style={{ width: '100%', padding: '8px' }} placeholder="Opcional. Ej: Ley, Real Decreto" />
                </div>

                <div>
                    <label style={{ display: 'block', fontWeight: 'bold' }}>Jurisdicción / Sector</label>
                    <input type="text" name="jurisdiccion" style={{ width: '100%', padding: '8px' }} placeholder="Opcional." />
                </div>

                <div>
                    <label style={{ display: 'block', fontWeight: 'bold' }}>Fecha Publicación</label>
                    <input type="date" name="fecha_publicacion" style={{ width: '100%', padding: '8px' }} />
                </div>

                <div>
                    <label style={{ display: 'block', fontWeight: 'bold' }}>Archivo PDF o TXT *</label>
                    <input type="file" name="file" accept="application/pdf, text/plain" required style={{ width: '100%', padding: '8px' }} />
                </div>

                <button
                    type="submit"
                    disabled={status === 'loading'}
                    style={{ padding: '10px 15px', backgroundColor: '#0070f3', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                >
                    {status === 'loading' ? 'Subiendo...' : 'Subir Norma'}
                </button>
            </form>

            {result && (
                <div style={{ marginTop: '30px', padding: '15px', backgroundColor: status === 'error' ? '#ffe6e6' : (status === 'duplicated' || status === 'duplicated_hash') ? '#fff3cd' : '#e6ffe6', borderRadius: '5px' }}>
                    <h3 style={{ margin: '0 0 10px 0' }}>Resultado ({status === 'success' ? 'Éxito' : (status === 'duplicated' || status === 'duplicated_hash') ? 'Atención: Duplicado' : 'Error'})</h3>
                    {status === 'duplicated' ? (
                        <div>
                            <p style={{ color: '#856404', fontWeight: 'bold' }}>
                                Ya existe una norma con ese código. La ingestión no se ha ejecutado.
                            </p>
                            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: '10px' }}>
                                {JSON.stringify(result, null, 2)}
                            </pre>
                        </div>
                    ) : status === 'duplicated_hash' ? (
                        <div>
                            <p style={{ color: '#856404', fontWeight: 'bold' }}>
                                Ya existe una norma con el mismo archivo exacto. La ingestión no se ha ejecutado.
                            </p>
                            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: '10px' }}>
                                {JSON.stringify(result, null, 2)}
                            </pre>
                        </div>
                    ) : (
                        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {JSON.stringify(result, null, 2)}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
}
