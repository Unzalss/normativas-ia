-- 1) public.ai_usage_logs
CREATE TABLE public.ai_usage_logs (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    user_id uuid null references auth.users(id) on delete set null,
    norma_id bigint null references public.normas(id) on delete set null,
    request_id text not null,
    operation_type text not null,
    provider text not null default 'openai',
    model text not null,
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    total_tokens integer not null default 0,
    estimated_input_cost numeric(12,6) not null default 0,
    estimated_output_cost numeric(12,6) not null default 0,
    estimated_total_cost numeric(12,6) not null default 0,
    currency text not null default 'USD',
    route text null,
    success boolean not null default true,
    error_message text null,
    metadata jsonb not null default '{}'::jsonb,
    CONSTRAINT input_tokens_check CHECK (input_tokens >= 0),
    CONSTRAINT output_tokens_check CHECK (output_tokens >= 0),
    CONSTRAINT total_tokens_check CHECK (total_tokens >= 0),
    CONSTRAINT estimated_costs_check CHECK (estimated_input_cost >= 0 AND estimated_output_cost >= 0 AND estimated_total_cost >= 0)
);

CREATE INDEX idx_ai_usage_logs_request_id ON public.ai_usage_logs(request_id);
CREATE INDEX idx_ai_usage_logs_norma_id ON public.ai_usage_logs(norma_id);
CREATE INDEX idx_ai_usage_logs_user_id ON public.ai_usage_logs(user_id);
CREATE INDEX idx_ai_usage_logs_created_at ON public.ai_usage_logs(created_at);

-- 2) public.norma_ingest_reports
CREATE TABLE public.norma_ingest_reports (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    norma_id bigint null references public.normas(id) on delete set null,
    user_id uuid null references auth.users(id) on delete set null,
    request_id text not null,
    route text not null default 'upload-norma-ia',
    status text not null,
    num_articulos_detectados integer not null default 0,
    num_anexos_detectados integer not null default 0,
    num_tablas_detectadas integer not null default 0,
    num_fragmentos integer not null default 0,
    num_fragmentos_dudosos integer not null default 0,
    errores jsonb not null default '[]'::jsonb,
    warnings jsonb not null default '[]'::jsonb,
    coste_total_estimado numeric(12,6) not null default 0,
    currency text not null default 'USD',
    modelos_usados jsonb not null default '[]'::jsonb,
    resumen text null,
    metadata jsonb not null default '{}'::jsonb,
    CONSTRAINT ingest_status_check CHECK (status IN ('success', 'partial', 'error')),
    CONSTRAINT ingest_cost_check CHECK (coste_total_estimado >= 0)
);

CREATE INDEX idx_norma_ingest_reports_norma_id ON public.norma_ingest_reports(norma_id);
CREATE INDEX idx_norma_ingest_reports_user_id ON public.norma_ingest_reports(user_id);
CREATE INDEX idx_norma_ingest_reports_request_id ON public.norma_ingest_reports(request_id);

-- 3) public.norma_ingest_issues
CREATE TABLE public.norma_ingest_issues (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    norma_id bigint null references public.normas(id) on delete cascade,
    report_id uuid null references public.norma_ingest_reports(id) on delete cascade,
    severity text not null,
    kind text not null,
    section_ref text null,
    message text not null,
    payload jsonb not null default '{}'::jsonb,
    CONSTRAINT ingest_issue_severity_check CHECK (severity IN ('info', 'warning', 'error'))
);

CREATE INDEX idx_norma_ingest_issues_norma_id ON public.norma_ingest_issues(norma_id);
CREATE INDEX idx_norma_ingest_issues_report_id ON public.norma_ingest_issues(report_id);
