-- Promotores reutilizables por cliente. Mantiene asignaciones y auditoría existentes.
create table if not exists promoters (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references tenants(id) on delete cascade,
 full_name text not null,
 document_number text not null,
 phone text,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(tenant_id, document_number),
 unique(id, tenant_id)
);
alter table event_promoters add column if not exists promoter_id uuid references promoters(id);
insert into promoters(tenant_id, full_name, document_number, phone, is_active)
select distinct on (e.tenant_id,p.document_number)
 e.tenant_id,p.full_name,p.document_number,p.phone,true
from event_promoters p join events e on e.id=p.event_id
order by e.tenant_id,p.document_number,p.created_at;
update event_promoters ep set promoter_id=pr.id
from events e, promoters pr
where ep.event_id=e.id and pr.tenant_id=e.tenant_id and pr.document_number=ep.document_number and ep.promoter_id is null;
alter table event_promoters alter column promoter_id set not null;
create unique index if not exists event_promoters_unique_assignment on event_promoters(event_id,promoter_id);
create index if not exists promoters_tenant_idx on promoters(tenant_id);
