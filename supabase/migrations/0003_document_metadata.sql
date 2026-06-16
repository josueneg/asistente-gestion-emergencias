-- ============================================================
-- Fase 2: metadatos enriquecidos, descarga de archivos.
-- ============================================================

-- ------------------------------------------------------------
-- documents: metadatos bibliográficos + almacenamiento
-- ------------------------------------------------------------
alter table documents
  add column title text,
  add column publication_date date,
  add column institutions text,
  add column validity_start_year int,
  add column validity_end_year int,
  add column phases text[],
  add column phase_other text,
  add column storage_path text,
  add column storage_size_bytes int;

-- ------------------------------------------------------------
-- document_submissions: institución del remitente
-- ------------------------------------------------------------
alter table document_submissions
  add column submitter_institution text;

-- ------------------------------------------------------------
-- Storage: bucket privado para archivos originales (máx. 15 MB)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 15728640)
on conflict (id) do nothing;
