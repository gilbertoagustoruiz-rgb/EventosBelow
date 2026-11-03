-- =====================================================================
--  EventosBelow · Esquema inicial (Supabase / PostgreSQL 15+)
--  Multi-tenant: tenants → events → event_dates → registrations
-- =====================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.member_role         as enum ('CLIENT_ADMIN', 'HOST');
create type public.registration_status as enum ('REGISTRADO', 'CHECKED_IN', 'CANCELADO');
create type public.companion_mode      as enum ('NONE', 'OPTIONAL', 'REQUIRED');
create type public.document_type       as enum ('DNI', 'CE', 'PASAPORTE', 'CEDULA');

-- ---------------------------------------------------------------------
-- Tenants (empresas cliente)
-- ---------------------------------------------------------------------
create table public.tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  tax_id        text,                       -- RUC
  contact_name  text,
  contact_email text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- SuperAdmins de la plataforma (Below Trade)
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Usuarios del cliente: administradores y anfitriones (check-in)
create table public.tenant_members (
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.member_role not null default 'HOST',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_idx on public.tenant_members (user_id);

-- ---------------------------------------------------------------------
-- Eventos (proyectos)
-- ---------------------------------------------------------------------
create table public.events (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  name              text not null,
  slug              text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description       text,
  venue             text,
  logo_url          text,
  primary_color     text not null default '#4f46e5' check (primary_color ~* '^#[0-9a-f]{6}$'),
  companion_mode    public.companion_mode not null default 'NONE',
  timezone          text not null default 'America/Lima',
  is_published      boolean not null default false,
  registration_open boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index events_tenant_idx on public.events (tenant_id);

-- ---------------------------------------------------------------------
-- Fechas del evento con aforo
-- registered_count = asientos ocupados (titular + acompañante)
-- ---------------------------------------------------------------------
create table public.event_dates (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events (id) on delete cascade,
  event_day        date not null,
  starts_at        time not null,
  ends_at          time not null,
  label            text,
  capacity         integer not null check (capacity > 0),
  registered_count integer not null default 0,
  created_at       timestamptz not null default now(),
  constraint event_dates_hours_ck    check (ends_at > starts_at),
  constraint event_dates_capacity_ck check (registered_count >= 0 and registered_count <= capacity),
  constraint event_dates_slot_uq     unique (event_id, event_day, starts_at),
  constraint event_dates_id_event_uq unique (id, event_id)  -- para FK compuesta
);
create index event_dates_event_idx on public.event_dates (event_id, event_day);

-- ---------------------------------------------------------------------
-- Registros (asistentes)
-- ---------------------------------------------------------------------
create table public.registrations (
  id                        uuid primary key default gen_random_uuid(),
  event_id                  uuid not null,
  event_date_id             uuid not null,
  -- 122 bits aleatorios, 32 caracteres hex. Es lo que viaja en el QR.
  token                     text not null unique default replace(gen_random_uuid()::text, '-', ''),
  full_name                 text not null,
  email                     text not null,
  phone                     text not null,
  document_type             public.document_type not null,
  document_number           text not null,
  company                   text,
  job_title                 text,
  has_companion             boolean not null default false,
  companion_full_name       text,
  companion_document_type   public.document_type,
  companion_document_number text,
  seats                     smallint generated always as (case when has_companion then 2 else 1 end) stored,
  status                    public.registration_status not null default 'REGISTRADO',
  holder_checked_in_at      timestamptz,
  companion_checked_in_at   timestamptz,
  checked_in_by             uuid references auth.users (id) on delete set null,
  cancelled_at              timestamptz,
  created_at                timestamptz not null default now(),
  constraint registrations_date_fk foreign key (event_date_id, event_id)
    references public.event_dates (id, event_id) on delete restrict,
  constraint registrations_event_fk foreign key (event_id)
    references public.events (id) on delete cascade,
  constraint registrations_companion_ck check (
    not has_companion or (
      companion_full_name is not null
      and companion_document_type is not null
      and companion_document_number is not null
    )
  )
);

-- Una persona (documento) solo puede tener un registro activo por fecha
create unique index registrations_doc_per_date_uq
  on public.registrations (event_date_id, document_type, document_number)
  where status <> 'CANCELADO';

create index registrations_event_date_idx on public.registrations (event_id, event_date_id);
create index registrations_doc_idx        on public.registrations (event_id, document_number);
create index registrations_email_idx      on public.registrations (event_id, email);
create index registrations_name_trgm_idx  on public.registrations using gin (full_name gin_trgm_ops);

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Helpers de autorización
-- ---------------------------------------------------------------------
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function public.has_tenant_role(
  p_tenant_id uuid,
  p_roles     public.member_role[] default array['CLIENT_ADMIN', 'HOST']::public.member_role[]
) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (
    select 1 from tenant_members
    where tenant_id = p_tenant_id and user_id = auth.uid() and role = any (p_roles)
  );
$$;

create or replace function public.event_tenant(p_event_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from events where id = p_event_id;
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- (El portal público NO lee tablas con la anon key: pasa por el servidor
--  con service_role y expone solo campos públicos.)
-- ---------------------------------------------------------------------
alter table public.tenants         enable row level security;
alter table public.platform_admins enable row level security;
alter table public.tenant_members  enable row level security;
alter table public.events          enable row level security;
alter table public.event_dates     enable row level security;
alter table public.registrations   enable row level security;

-- tenants
create policy tenants_select on public.tenants for select to authenticated
  using (public.has_tenant_role(id));
create policy tenants_admin on public.tenants for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- platform_admins
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = auth.uid());

-- tenant_members
create policy members_select on public.tenant_members for select to authenticated
  using (user_id = auth.uid() or public.has_tenant_role(tenant_id, array['CLIENT_ADMIN']::public.member_role[]));
create policy members_manage on public.tenant_members for all to authenticated
  using (public.has_tenant_role(tenant_id, array['CLIENT_ADMIN']::public.member_role[]))
  with check (public.has_tenant_role(tenant_id, array['CLIENT_ADMIN']::public.member_role[]));

-- events
create policy events_select on public.events for select to authenticated
  using (public.has_tenant_role(tenant_id));
create policy events_insert on public.events for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['CLIENT_ADMIN']::public.member_role[]));
create policy events_update on public.events for update to authenticated
  using (public.has_tenant_role(tenant_id, array['CLIENT_ADMIN']::public.member_role[]))
  with check (public.has_tenant_role(tenant_id, array['CLIENT_ADMIN']::public.member_role[]));
create policy events_delete on public.events for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['CLIENT_ADMIN']::public.member_role[]));

-- event_dates
create policy dates_select on public.event_dates for select to authenticated
  using (public.has_tenant_role(public.event_tenant(event_id)));
create policy dates_write on public.event_dates for all to authenticated
  using (public.has_tenant_role(public.event_tenant(event_id), array['CLIENT_ADMIN']::public.member_role[]))
  with check (public.has_tenant_role(public.event_tenant(event_id), array['CLIENT_ADMIN']::public.member_role[]));

-- registrations: lectura para admins y anfitriones.
-- Escrituras SOLO vía funciones (mantienen el contador de aforo consistente).
create policy registrations_select on public.registrations for select to authenticated
  using (public.has_tenant_role(public.event_tenant(event_id)));

-- ---------------------------------------------------------------------
-- Vista de métricas por fecha (respeta RLS del que consulta)
-- ---------------------------------------------------------------------
create view public.event_date_stats with (security_invoker = true) as
select
  d.id               as event_date_id,
  d.event_id,
  d.capacity,
  d.registered_count as seats_taken,
  count(r.id) filter (where r.status <> 'CANCELADO')                     as registrations,
  count(r.holder_checked_in_at) filter (where r.status <> 'CANCELADO')
    + count(r.companion_checked_in_at) filter (where r.status <> 'CANCELADO') as people_checked_in
from public.event_dates d
left join public.registrations r on r.event_date_id = d.id
group by d.id;

-- ---------------------------------------------------------------------
-- register_attendee: inscripción ATÓMICA con control de aforo
--   · el UPDATE condicional reserva cupo sin carreras (row lock)
--   · si el INSERT falla, toda la transacción se revierte
-- Errores: DATE_NOT_FOUND, EVENT_CLOSED, DATE_PAST, COMPANION_REQUIRED,
--          COMPANION_NOT_ALLOWED, SOLD_OUT, DUPLICATE
-- ---------------------------------------------------------------------
create or replace function public.register_attendee(
  p_event_date_id             uuid,
  p_full_name                 text,
  p_email                     text,
  p_phone                     text,
  p_document_type             public.document_type,
  p_document_number           text,
  p_company                   text,
  p_job_title                 text,
  p_has_companion             boolean,
  p_companion_full_name       text,
  p_companion_document_type   public.document_type,
  p_companion_document_number text
) returns table (out_registration_id uuid, out_token text)
language plpgsql security definer set search_path = public as $$
declare
  v_date  event_dates%rowtype;
  v_event events%rowtype;
  v_seats int := case when p_has_companion then 2 else 1 end;
begin
  select * into v_date from event_dates where id = p_event_date_id;
  if not found then raise exception 'DATE_NOT_FOUND'; end if;

  select * into v_event from events where id = v_date.event_id;
  if not v_event.is_published or not v_event.registration_open then
    raise exception 'EVENT_CLOSED';
  end if;
  if v_date.event_day < (now() at time zone v_event.timezone)::date then
    raise exception 'DATE_PAST';
  end if;
  if v_event.companion_mode = 'REQUIRED' and not p_has_companion then
    raise exception 'COMPANION_REQUIRED';
  end if;
  if v_event.companion_mode = 'NONE' and p_has_companion then
    raise exception 'COMPANION_NOT_ALLOWED';
  end if;

  update event_dates
     set registered_count = registered_count + v_seats
   where id = p_event_date_id
     and registered_count + v_seats <= capacity;
  if not found then raise exception 'SOLD_OUT'; end if;

  begin
    insert into registrations (
      event_id, event_date_id, full_name, email, phone, document_type, document_number,
      company, job_title, has_companion, companion_full_name,
      companion_document_type, companion_document_number
    ) values (
      v_event.id, p_event_date_id, trim(p_full_name), lower(trim(p_email)), trim(p_phone),
      p_document_type, upper(trim(p_document_number)),
      nullif(trim(p_company), ''), nullif(trim(p_job_title), ''), p_has_companion,
      case when p_has_companion then trim(p_companion_full_name) end,
      case when p_has_companion then p_companion_document_type end,
      case when p_has_companion then upper(trim(p_companion_document_number)) end
    )
    returning id, registrations.token into out_registration_id, out_token;
  exception when unique_violation then
    raise exception 'DUPLICATE';
  end;

  return next;
end $$;

-- ---------------------------------------------------------------------
-- check_in: marca ingreso de titular / acompañante sin duplicidad
--   p_target: 'HOLDER' | 'COMPANION' | 'BOTH'
--   Devuelve jsonb { result: OK | ALREADY | WRONG_DATE | CANCELLED | NOT_FOUND, ... }
-- ---------------------------------------------------------------------
create or replace function public.check_in(
  p_registration_id uuid,
  p_event_date_id   uuid,
  p_target          text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r      registrations%rowtype;
  v_now  timestamptz := now();
  v_hold boolean := false;
  v_comp boolean := false;
begin
  if p_target not in ('HOLDER', 'COMPANION', 'BOTH') then
    raise exception 'INVALID_TARGET';
  end if;

  select * into r from registrations where id = p_registration_id for update;
  if not found then return jsonb_build_object('result', 'NOT_FOUND'); end if;

  if not public.has_tenant_role(public.event_tenant(r.event_id)) then
    raise exception 'FORBIDDEN';
  end if;

  if r.status = 'CANCELADO' then
    return jsonb_build_object('result', 'CANCELLED');
  end if;
  if r.event_date_id <> p_event_date_id then
    return jsonb_build_object('result', 'WRONG_DATE', 'event_date_id', r.event_date_id);
  end if;

  v_hold := p_target in ('HOLDER', 'BOTH') and r.holder_checked_in_at is null;
  v_comp := p_target in ('COMPANION', 'BOTH') and r.has_companion and r.companion_checked_in_at is null;

  if not v_hold and not v_comp then
    return jsonb_build_object(
      'result', 'ALREADY',
      'holder_checked_in_at', r.holder_checked_in_at,
      'companion_checked_in_at', r.companion_checked_in_at
    );
  end if;

  update registrations set
    holder_checked_in_at    = case when v_hold then v_now else holder_checked_in_at end,
    companion_checked_in_at = case when v_comp then v_now else companion_checked_in_at end,
    status                  = case when v_hold or holder_checked_in_at is not null
                                   then 'CHECKED_IN'::registration_status else status end,
    checked_in_by           = auth.uid()
  where id = r.id
  returning * into r;

  return jsonb_build_object(
    'result', 'OK',
    'holder_checked_in_at', r.holder_checked_in_at,
    'companion_checked_in_at', r.companion_checked_in_at
  );
end $$;

-- ---------------------------------------------------------------------
-- cancel_registration: libera cupos (solo CLIENT_ADMIN / SuperAdmin)
-- ---------------------------------------------------------------------
create or replace function public.cancel_registration(p_registration_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r registrations%rowtype;
begin
  select * into r from registrations where id = p_registration_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.has_tenant_role(public.event_tenant(r.event_id), array['CLIENT_ADMIN']::member_role[]) then
    raise exception 'FORBIDDEN';
  end if;
  if r.status = 'CANCELADO' then return; end if;
  if r.holder_checked_in_at is not null or r.companion_checked_in_at is not null then
    raise exception 'ALREADY_CHECKED_IN';
  end if;

  update registrations set status = 'CANCELADO', cancelled_at = now() where id = r.id;
  update event_dates set registered_count = registered_count - r.seats where id = r.event_date_id;
end $$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
revoke execute on function public.register_attendee(uuid, text, text, text, public.document_type, text, text, text, boolean, text, public.document_type, text) from public, anon, authenticated;
grant  execute on function public.register_attendee(uuid, text, text, text, public.document_type, text, text, text, boolean, text, public.document_type, text) to service_role;

revoke execute on function public.check_in(uuid, uuid, text)       from public, anon;
grant  execute on function public.check_in(uuid, uuid, text)       to authenticated;
revoke execute on function public.cancel_registration(uuid)        from public, anon;
grant  execute on function public.cancel_registration(uuid)        to authenticated;

-- ---------------------------------------------------------------------
-- Storage: logos públicos (la subida la hace el servidor con service_role)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('event-logos', 'event-logos', true)
on conflict (id) do nothing;
