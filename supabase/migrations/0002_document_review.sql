-- ============================================================
-- Fase 1.5: biblioteca de documentos con revisión manual,
-- clasificación por país y recomendaciones por país.
-- ============================================================

-- ------------------------------------------------------------
-- documents: clasificación, texto crudo y estado de aprobación
-- ------------------------------------------------------------
alter table documents
  add column country_origin text,
  add column country_applicable text,
  add column description text,
  add column raw_text text,
  add column approval_status text not null default 'pending',
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users(id);

alter table documents
  add constraint documents_approval_status_check
  check (approval_status in ('pending', 'approved'));

-- Los documentos ya indexados (subidos por el admin) se consideran aprobados
update documents set approval_status = 'approved' where status = 'indexed';

create index documents_approval_status_idx on documents (approval_status);

-- ------------------------------------------------------------
-- document_submissions: datos de contacto de quien sube un
-- documento (separados de "documents" para no exponerlos
-- públicamente en la biblioteca)
-- ------------------------------------------------------------
create table document_submissions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  submitter_name text,
  submitter_email text,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);

alter table document_submissions enable row level security;

create policy "admins leen envios" on document_submissions
  for select using (auth.role() = 'authenticated');

-- insert/update: solo service_role (Edge Function submit-document / approve-document)

-- ------------------------------------------------------------
-- submission_rate_limits: límite simple por IP para el envío
-- público de documentos (anti-abuso)
-- ------------------------------------------------------------
create table submission_rate_limits (
  ip_hash text not null,
  window_start timestamptz not null,
  request_count int not null default 0,
  primary key (ip_hash, window_start)
);

alter table submission_rate_limits enable row level security;
-- sin policies -> solo accesible con la service_role key

-- ------------------------------------------------------------
-- Lectura pública de documentos aprobados (biblioteca de
-- transparencia: qué usa el asistente para responder/recomendar)
-- ------------------------------------------------------------
create policy "lectura publica de documentos aprobados" on documents
  for select using (approval_status = 'approved');

-- ------------------------------------------------------------
-- match_doc_chunks: ahora exige documentos aprobados y permite
-- filtrar por país (los documentos "generales", sin
-- country_applicable, se incluyen siempre)
-- ------------------------------------------------------------
create or replace function match_doc_chunks(
  query_embedding vector(768),
  match_count int default 5,
  country_filter text default null
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  similarity float
)
language sql stable
as $$
  select
    dc.id,
    dc.document_id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from doc_chunks dc
  join documents d on d.id = dc.document_id
  where d.approval_status = 'approved'
    and (
      country_filter is null
      or d.country_applicable is null
      or d.country_applicable = country_filter
    )
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- ------------------------------------------------------------
-- sites: país por defecto del sitio (para el widget y el snippet)
-- ------------------------------------------------------------
alter table sites add column country text;
