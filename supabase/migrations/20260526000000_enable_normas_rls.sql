-- Prepare public.normas and public.normas_partes for authenticated, owner-aware reads.
-- Current model: global legal library rows use owner_user_id IS NULL; private rows use owner_user_id = auth.uid().
-- Service role clients used by trusted server/local importers bypass RLS unless FORCE ROW LEVEL SECURITY is enabled.

ALTER TABLE public.normas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.normas_partes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_normas_owner_user_id
    ON public.normas(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_normas_partes_norma_id
    ON public.normas_partes(norma_id);

DROP POLICY IF EXISTS "Authenticated users can read visible normas"
    ON public.normas;

CREATE POLICY "Authenticated users can read visible normas"
    ON public.normas
    FOR SELECT
    TO authenticated
    USING (
        owner_user_id IS NULL
        OR owner_user_id = auth.uid()
    );

DROP POLICY IF EXISTS "Authenticated users can read parts of visible normas"
    ON public.normas_partes;

CREATE POLICY "Authenticated users can read parts of visible normas"
    ON public.normas_partes
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.normas n
            WHERE n.id = normas_partes.norma_id
              AND (
                  n.owner_user_id IS NULL
                  OR n.owner_user_id = auth.uid()
              )
        )
    );

