create table if not exists event_promoters (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references events(id) on delete cascade,
 full_name text not null,
 document_number text not null,
 phone text,
 access_key text not null unique default replace(gen_random_uuid()::text, '-', ''),
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(event_id, document_number)
);
create index if not exists event_promoters_event_idx on event_promoters(event_id);
create table if not exists promoter_checkins (
 id uuid primary key default gen_random_uuid(),
 promoter_id uuid not null references event_promoters(id),
 registration_id uuid not null references registrations(id),
 target text not null check (target in ('HOLDER','COMPANION','BOTH')),
 checked_at timestamptz not null default now()
);
create index if not exists promoter_checkins_event_idx on promoter_checkins(promoter_id, checked_at);
