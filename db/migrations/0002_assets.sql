-- Archivos pequeños (logos) guardados en la base de datos.
-- Se usa cuando no hay almacenamiento externo configurado (p. ej. en Render).
create table assets (
  id           uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  data         bytea not null check (octet_length(data) <= 2 * 1024 * 1024),
  created_at   timestamptz not null default now()
);
