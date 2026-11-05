-- =====================================================================
-- 0009 · Proyectos, personal por evento, varios acompañantes y base precargada
--
--  Cliente → Proyecto → Evento
--  Personal de apoyo por evento: SUPERVISOR y PROMOTOR (event_staff), todos con usuario
--  Bitácora de acreditación (checkin_log): quién, qué, cuándo, resultado
--  Acompañantes: tabla propia, máximo configurable por evento
--  Base precargada (invitees): el asistente se identifica con DNI o código de vendedor
--  Login con correo o con documento (users.username)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Proyectos
-- ---------------------------------------------------------------------
create table projects (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint projects_name_uq unique (tenant_id, name),
  constraint projects_id_tenant_uq unique (id, tenant_id)
);

insert into projects (tenant_id, name)
select distinct tenant_id, 'General' from events;

alter table events add column project_id uuid;
update events e set project_id = p.id from projects p where p.tenant_id = e.tenant_id and p.name = 'General';
alter table events alter column project_id set not null;
-- El proyecto debe ser del mismo cliente que el evento
alter table events add constraint events_project_fk
  foreign key (project_id, tenant_id) references projects (id, tenant_id) on delete restrict;
create index events_project_idx on events (project_id);

-- ---------------------------------------------------------------------
-- 2) Acompañantes: máximo configurable
-- ---------------------------------------------------------------------
alter table events add column max_companions smallint not null default 1
  check (max_companions between 0 and 10);
update events set max_companions = case when companion_mode = 'NONE' then 0 else 1 end;
alter table events add constraint events_companions_ck
  check ((companion_mode = 'NONE') = (max_companions = 0));

-- ---------------------------------------------------------------------
-- 3) Usuarios: ingreso con correo o con documento
-- ---------------------------------------------------------------------
alter table users alter column email drop not null;
alter table users add column username text unique check (username = lower(username));
update users set username = email;
alter table users add constraint users_login_ck check (email is not null or username is not null);

-- ---------------------------------------------------------------------
-- 4) Base precargada de invitados
-- ---------------------------------------------------------------------
create table invitees (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events (id) on delete cascade,
  document_type   document_type not null default 'DNI',
  document_number text not null,
  employee_code   text,
  full_name       text not null,
  email           text check (email is null or email = lower(email)),
  phone           text,
  company         text,
  job_title       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index invitees_doc_uq on invitees (event_id, document_type, document_number);
create unique index invitees_code_uq on invitees (event_id, upper(employee_code)) where employee_code is not null;
create index invitees_docnum_idx on invitees (event_id, document_number);
create trigger invitees_touch before update on invitees for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- 5) Inscripciones: vínculo con la base, código y acompañantes en tabla propia
-- ---------------------------------------------------------------------
alter table registrations add column invitee_id uuid references invitees (id) on delete set null;
alter table registrations add column employee_code text;
create unique index registrations_invitee_active_uq on registrations (invitee_id)
  where invitee_id is not null and status <> 'CANCELADO';
create index registrations_code_idx on registrations (event_id, upper(employee_code));

create table companions (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations (id) on delete cascade,
  position        smallint not null check (position between 1 and 10),
  full_name       text not null,
  document_type   document_type not null,
  document_number text not null,
  checked_in_at   timestamptz,
  checked_in_by   uuid references users (id) on delete set null,
  constraint companions_position_uq unique (registration_id, position),
  constraint companions_doc_uq unique (registration_id, document_type, document_number)
);
create index companions_doc_idx on companions (document_number);

insert into companions (registration_id, position, full_name, document_type, document_number, checked_in_at, checked_in_by)
select id, 1, companion_full_name, companion_document_type, companion_document_number, companion_checked_in_at, checked_in_by
  from registrations where has_companion;

-- Cupos: titular + número de acompañantes
alter table registrations add column companions_count smallint not null default 0 check (companions_count between 0 and 10);
update registrations set companions_count = case when has_companion then 1 else 0 end;

drop view event_date_stats;
alter table registrations
  drop constraint registrations_companion_ck,
  drop column seats,
  drop column has_companion,
  drop column companion_full_name,
  drop column companion_document_type,
  drop column companion_document_number,
  drop column companion_checked_in_at;
alter table registrations add column seats smallint generated always as (1 + companions_count) stored;

create view event_date_stats as
select d.id as event_date_id,
       d.event_id,
       d.capacity,
       d.registered_count as seats_taken,
       count(r.id) filter (where r.status <> 'CANCELADO') as registrations,
       count(r.holder_checked_in_at) filter (where r.status <> 'CANCELADO')
         + coalesce(sum((select count(*) from companions c where c.registration_id = r.id and c.checked_in_at is not null))
                    filter (where r.status <> 'CANCELADO'), 0)::bigint as people_checked_in
  from event_dates d
  left join registrations r on r.event_date_id = d.id
 group by d.id;

-- ---------------------------------------------------------------------
-- 6) Personal de apoyo por evento (supervisores y promotores)
-- ---------------------------------------------------------------------
create table event_staff (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  role        text not null check (role in ('SUPERVISOR', 'PROMOTOR')),
  is_active   boolean not null default true,
  added_by    uuid references users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint event_staff_uq unique (event_id, employee_id)
);
create index event_staff_employee_idx on event_staff (employee_id) where is_active;
create trigger event_staff_touch before update on event_staff for each row execute function touch_updated_at();

insert into event_staff (event_id, employee_id, role, is_active, created_at)
select event_id, employee_id, 'PROMOTOR', is_active, created_at from event_promoters;

-- ---------------------------------------------------------------------
-- 7) Bitácora de acreditación
-- ---------------------------------------------------------------------
create table checkin_log (
  id              bigserial primary key,
  event_id        uuid not null references events (id) on delete cascade,
  event_date_id   uuid references event_dates (id) on delete set null,
  registration_id uuid references registrations (id) on delete cascade,
  employee_id     uuid references employees (id) on delete set null,  -- quién acreditó (null = enlace general)
  result          text not null check (result in ('INGRESO', 'YA_INGRESO', 'FECHA_INCORRECTA', 'CANCELADO', 'NO_ENCONTRADO')),
  persons         smallint not null default 0,                         -- personas que ingresaron en esta operación
  method          text check (method in ('QR', 'DOCUMENTO', 'BUSQUEDA')),
  detail          text,
  created_at      timestamptz not null default now()
);
create index checkin_log_event_idx on checkin_log (event_id, created_at desc);
create index checkin_log_employee_idx on checkin_log (event_id, employee_id);
create index checkin_log_registration_idx on checkin_log (registration_id, created_at desc);

-- Lo que ya se acreditó con enlaces de promotor pasa a la bitácora
insert into checkin_log (event_id, event_date_id, registration_id, employee_id, result, persons, method, created_at)
select r.event_id, r.event_date_id, pc.registration_id, ep.employee_id, 'INGRESO',
       case pc.target when 'BOTH' then 2 else 1 end, 'QR', pc.checked_at
  from promoter_checkins pc
  join event_promoters ep on ep.id = pc.promoter_id
  join registrations r on r.id = pc.registration_id;

drop table promoter_checkins;
drop table event_promoters;

-- ---------------------------------------------------------------------
-- 8) Inscripción: varios acompañantes y base precargada
--   p_companions: [{"full_name","document_type","document_number"}, ...]
--   Público (p_admin = false): exige invitado de la base (p_invitee_id) y toma sus datos.
-- ---------------------------------------------------------------------
drop function if exists register_attendee(
  uuid, text, text, text, document_type, text, text, text, boolean, text, document_type, text, boolean
);

create or replace function register_attendee(
  p_event_date_id   uuid,
  p_invitee_id      uuid,
  p_full_name       text,
  p_email           text,
  p_phone           text,
  p_document_type   document_type,
  p_document_number text,
  p_employee_code   text,
  p_company         text,
  p_job_title       text,
  p_companions      jsonb default '[]'::jsonb,
  p_admin           boolean default false
) returns table (out_registration_id uuid, out_token text)
language plpgsql as $$
declare
  v_date  event_dates%rowtype;
  v_event events%rowtype;
  v_inv   invitees%rowtype;
  v_n     int := coalesce(jsonb_array_length(p_companions), 0);
  v_doc   text := upper(trim(p_document_number));
  v_type  document_type := p_document_type;
  c       jsonb;
  i       int := 0;
begin
  select * into v_date from event_dates where id = p_event_date_id;
  if not found then raise exception 'DATE_NOT_FOUND'; end if;
  select * into v_event from events where id = v_date.event_id;

  if not p_admin then
    if not v_event.is_published or not v_event.registration_open then raise exception 'EVENT_CLOSED'; end if;
    if v_date.event_day < (now() at time zone v_event.timezone)::date then raise exception 'DATE_PAST'; end if;
    if p_invitee_id is null then raise exception 'NOT_INVITED'; end if;
  end if;

  if p_invitee_id is not null then
    select * into v_inv from invitees where id = p_invitee_id and event_id = v_event.id;
    if not found then raise exception 'NOT_INVITED'; end if;
    v_doc := v_inv.document_number;
    v_type := v_inv.document_type;
  end if;

  if v_n > v_event.max_companions then raise exception 'TOO_MANY_COMPANIONS'; end if;
  if v_event.companion_mode = 'REQUIRED' and v_n = 0 then raise exception 'COMPANION_REQUIRED'; end if;

  update event_dates set registered_count = registered_count + 1 + v_n
   where id = p_event_date_id and registered_count + 1 + v_n <= capacity;
  if not found then raise exception 'SOLD_OUT'; end if;

  begin
    insert into registrations (
      event_id, event_date_id, invitee_id, full_name, email, phone, document_type, document_number,
      employee_code, company, job_title, companions_count
    ) values (
      v_event.id, p_event_date_id, p_invitee_id,
      coalesce(v_inv.full_name, trim(p_full_name)),
      lower(trim(coalesce(v_inv.email, p_email))),
      coalesce(nullif(trim(p_phone), ''), v_inv.phone),
      v_type, v_doc,
      coalesce(v_inv.employee_code, nullif(trim(p_employee_code), '')),
      coalesce(v_inv.company, nullif(trim(p_company), '')),
      coalesce(v_inv.job_title, nullif(trim(p_job_title), '')),
      v_n
    ) returning id, registrations.token into out_registration_id, out_token;
  exception when unique_violation then
    raise exception 'DUPLICATE';
  end;

  for c in select * from jsonb_array_elements(coalesce(p_companions, '[]'::jsonb)) loop
    i := i + 1;
    if upper(trim(c ->> 'document_number')) = v_doc then raise exception 'COMPANION_IS_HOLDER'; end if;
    begin
      insert into companions (registration_id, position, full_name, document_type, document_number)
      values (out_registration_id, i, trim(c ->> 'full_name'), (c ->> 'document_type')::document_type,
              upper(trim(c ->> 'document_number')));
    exception when unique_violation then
      raise exception 'COMPANION_DUPLICATE';
    end;
  end loop;

  return next;
end $$;

-- ---------------------------------------------------------------------
-- 9) Acreditación por persona (titular y/o acompañantes) con bitácora
--   Devuelve { result: OK | ALREADY | WRONG_DATE | CANCELLED | NOT_FOUND, persons, ... }
-- ---------------------------------------------------------------------
drop function if exists check_in(uuid, uuid, text, uuid);

create or replace function check_in(
  p_registration_id uuid,
  p_event_date_id   uuid,
  p_holder          boolean,
  p_companion_ids   uuid[],
  p_user_id         uuid,
  p_employee_id     uuid,
  p_method          text
) returns jsonb
language plpgsql as $$
declare
  r       registrations%rowtype;
  v_now   timestamptz := now();
  v_hold  boolean;
  v_comp  int;
begin
  select * into r from registrations where id = p_registration_id for update;
  if not found then return jsonb_build_object('result', 'NOT_FOUND'); end if;

  if r.status = 'CANCELADO' then
    insert into checkin_log (event_id, event_date_id, registration_id, employee_id, result, method)
    values (r.event_id, p_event_date_id, r.id, p_employee_id, 'CANCELADO', p_method);
    return jsonb_build_object('result', 'CANCELLED');
  end if;
  if r.event_date_id <> p_event_date_id then
    insert into checkin_log (event_id, event_date_id, registration_id, employee_id, result, method)
    values (r.event_id, p_event_date_id, r.id, p_employee_id, 'FECHA_INCORRECTA', p_method);
    return jsonb_build_object('result', 'WRONG_DATE', 'event_date_id', r.event_date_id);
  end if;

  v_hold := p_holder and r.holder_checked_in_at is null;

  update companions set checked_in_at = v_now, checked_in_by = p_user_id
   where registration_id = r.id and id = any (coalesce(p_companion_ids, '{}')) and checked_in_at is null;
  get diagnostics v_comp = row_count;

  if not v_hold and v_comp = 0 then
    insert into checkin_log (event_id, event_date_id, registration_id, employee_id, result, method)
    values (r.event_id, p_event_date_id, r.id, p_employee_id, 'YA_INGRESO', p_method);
    return jsonb_build_object('result', 'ALREADY', 'holder_checked_in_at', r.holder_checked_in_at);
  end if;

  update registrations set
    holder_checked_in_at = case when v_hold then v_now else holder_checked_in_at end,
    status = case when v_hold or holder_checked_in_at is not null then 'CHECKED_IN'::registration_status else status end,
    checked_in_by = p_user_id
  where id = r.id;

  insert into checkin_log (event_id, event_date_id, registration_id, employee_id, result, persons, method, detail)
  values (r.event_id, p_event_date_id, r.id, p_employee_id, 'INGRESO', (case when v_hold then 1 else 0 end) + v_comp, p_method,
          concat_ws(' + ', case when v_hold then 'titular' end,
                    case when v_comp = 1 then '1 acompañante' when v_comp > 1 then v_comp || ' acompañantes' end));

  return jsonb_build_object('result', 'OK', 'persons', (case when v_hold then 1 else 0 end) + v_comp);
end $$;

-- ---------------------------------------------------------------------
-- 10) Cancelación con varios acompañantes
-- ---------------------------------------------------------------------
create or replace function cancel_registration(p_registration_id uuid) returns void
language plpgsql as $$
declare r registrations%rowtype;
begin
  select * into r from registrations where id = p_registration_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status = 'CANCELADO' then return; end if;
  if r.holder_checked_in_at is not null
     or exists (select 1 from companions where registration_id = r.id and checked_in_at is not null) then
    raise exception 'ALREADY_CHECKED_IN';
  end if;
  update registrations set status = 'CANCELADO', cancelled_at = now() where id = r.id;
  update event_dates set registered_count = registered_count - r.seats where id = r.event_date_id;
end $$;
