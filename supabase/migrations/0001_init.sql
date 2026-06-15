-- ============================================================
-- Asistente IA COE Panamá - esquema inicial
-- ============================================================

-- Extensiones necesarias
create extension if not exists vector;
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Documentos subidos por el COE (manuales, planes de emergencia)
-- ------------------------------------------------------------
create table documents (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  mime_type text,
  status text not null default 'pending', -- pending | indexed | error
  char_count int,
  error_message text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Fragmentos de texto + embeddings para búsqueda semántica (RAG)
-- ------------------------------------------------------------
create table doc_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index doc_chunks_embedding_idx
  on doc_chunks using hnsw (embedding vector_cosine_ops);

create index doc_chunks_document_id_idx
  on doc_chunks (document_id);

-- Función de búsqueda por similitud, usada por la Edge Function "chat"
create or replace function match_doc_chunks(
  query_embedding vector(768),
  match_count int default 5
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
    doc_chunks.id,
    doc_chunks.document_id,
    doc_chunks.content,
    1 - (doc_chunks.embedding <=> query_embedding) as similarity
  from doc_chunks
  order by doc_chunks.embedding <=> query_embedding
  limit match_count;
$$;

-- ------------------------------------------------------------
-- Alertas mostradas en el widget (clima ahora; noticias en Fase 2)
-- ------------------------------------------------------------
create table alerts (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'weather', -- weather | news | manual
  severity text not null default 'info', -- info | bajo | medio | alto
  title text not null,
  message text not null,
  raw_data jsonb,
  created_at timestamptz not null default now()
);

create index alerts_created_at_idx on alerts (created_at desc);

-- Habilita Supabase Realtime para que el widget reciba alertas al instante
alter publication supabase_realtime add table alerts;

-- ------------------------------------------------------------
-- Ubicaciones y umbrales monitoreados por el cron de clima
-- ------------------------------------------------------------
create table weather_config (
  id uuid primary key default gen_random_uuid(),
  location_name text not null,
  lat double precision not null,
  lon double precision not null,
  rain_threshold_mm_h double precision not null default 10,
  wind_threshold_kmh double precision not null default 50,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- Ubicación de ejemplo: Ciudad de Panamá (ajustable desde el panel admin)
insert into weather_config (location_name, lat, lon, rain_threshold_mm_h, wind_threshold_kmh)
values ('Ciudad de Panamá', 8.9824, -79.5199, 10, 50);

-- ------------------------------------------------------------
-- Sitios autorizados a usar el widget (para limitar abuso)
-- ------------------------------------------------------------
create table sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  allowed_origin text not null default '*',
  site_key text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now()
);

-- Sitio de demostración, usado por widget/index.html
insert into sites (name, allowed_origin) values ('Demo / pruebas', '*');

-- ------------------------------------------------------------
-- Contador simple de solicitudes por hora, por sitio (rate limit)
-- ------------------------------------------------------------
create table rate_limit_counters (
  site_id uuid not null references sites(id) on delete cascade,
  window_start timestamptz not null,
  request_count int not null default 0,
  primary key (site_id, window_start)
);

-- ------------------------------------------------------------
-- Historial de conversaciones (auditoría)
-- ------------------------------------------------------------
create table chat_logs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id),
  session_id text,
  question text not null,
  answer text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table documents enable row level security;
alter table doc_chunks enable row level security;
alter table alerts enable row level security;
alter table weather_config enable row level security;
alter table sites enable row level security;
alter table rate_limit_counters enable row level security;
alter table chat_logs enable row level security;

-- documents: solo personal del COE autenticado (panel admin)
create policy "admins leen documentos" on documents
  for select using (auth.role() = 'authenticated');
create policy "admins crean documentos" on documents
  for insert with check (auth.role() = 'authenticated');
create policy "admins actualizan documentos" on documents
  for update using (auth.role() = 'authenticated');
create policy "admins borran documentos" on documents
  for delete using (auth.role() = 'authenticated');

-- doc_chunks: sin policies -> solo accesible con la service_role key
-- (usada internamente por las Edge Functions "ingest-document" y "chat")

-- alerts: lectura pública (el widget no requiere login),
-- la escritura la hacen las Edge Functions con service_role
create policy "lectura publica de alertas" on alerts
  for select using (true);

-- weather_config: lectura pública (la lee el cron con la anon key),
-- edición solo para el personal autenticado (panel admin)
create policy "lectura publica de config de clima" on weather_config
  for select using (true);
create policy "admins editan config de clima" on weather_config
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- sites: gestión solo para el personal autenticado
create policy "admins gestionan sitios" on sites
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- rate_limit_counters: sin policies -> solo service_role

-- chat_logs: lectura para el personal autenticado (auditoría)
create policy "admins leen historial de chat" on chat_logs
  for select using (auth.role() = 'authenticated');
