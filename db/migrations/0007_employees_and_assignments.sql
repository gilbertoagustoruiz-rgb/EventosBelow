-- =====================================================================
-- 0007 · Empleados, perfiles y asignaciones
--
--  Perfiles fijos: ADMINISTRADOR (Below Trade), COORDINADOR, PROMOTOR.
--  employees         → directorio único de todo el personal (lo gestiona el administrador)
--  employee_clients  → asignación de empleados a empresas cliente
--  event_promoters   → el coordinador elige, para cada evento, promotores asignados a su cliente
--
--  tenant_members deja de ser una tabla editable: pasa a ser una VISTA derivada de
--  coordinadores activos asignados a cada cliente (así el login y los permisos existentes
--  siguen funcionando, y desactivar o desasignar a un coordinador le quita el acceso).
--  Se migran: administradores, coordinadores, promotores, sus asignaciones y enlaces.
-- =====================================================================

create type employee_profile as enum ('ADMINISTRADOR', 'COORDINADOR', 'PROMOTOR');

create table employees (
  id              uuid primary key default gen_random_uuid(),
  profile         employee_profile not null,
  full_name       text not null,
  document_type   document_type not null default 'DNI',
  document_number text,
  email           text check (email is null or email = lower(email)),
  phone           text,
  user_id         uuid unique references users (id) on delete set null,  -- acceso al panel
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint employees_promoter_document_ck
    check (profile <> 'PROMOTOR' or document_number is not null)
);
create unique index employees_document_uq on employees (document_type, document_number)
  where document_number is not null;
create unique index employees_email_uq on employees (email) where email is not null;
create index employees_profile_idx on employees (profile, is_active);

create trigger employees_touch before update on employees
  for each row execute function touch_updated_at();

create table employee_clients (
  employee_id uuid not null references employees (id) on delete cascade,
  tenant_id   uuid not null references tenants (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (employee_id, tenant_id)
);
create index employee_clients_tenant_idx on employee_clients (tenant_id);

-- ---------------------------------------------------------------------
-- Migración de datos
-- ---------------------------------------------------------------------

-- 1) Administradores generales
insert into employees (profile, full_name, email, user_id)
select 'ADMINISTRADOR', coalesce(u.full_name, u.email), u.email, u.id
  from users u
 where u.is_platform_admin;

-- 2) Coordinadores (miembros CLIENT_ADMIN que no son administradores)
insert into employees (profile, full_name, email, user_id, is_active)
select distinct on (u.id) 'COORDINADOR', coalesce(u.full_name, u.email), u.email, u.id, u.is_active
  from tenant_members m
  join users u on u.id = m.user_id
 where m.role = 'CLIENT_ADMIN' and not u.is_platform_admin
 order by u.id;

insert into employee_clients (employee_id, tenant_id, created_at)
select e.id, m.tenant_id, m.created_at
  from tenant_members m
  join employees e on e.user_id = m.user_id and e.profile = 'COORDINADOR'
 where m.role = 'CLIENT_ADMIN'
on conflict do nothing;

-- 3) Promotores: el directorio por cliente se unifica por número de documento
insert into employees (profile, full_name, document_number, phone, is_active, created_at)
select distinct on (p.document_number)
       'PROMOTOR', p.full_name, p.document_number, p.phone, p.is_active, p.created_at
  from promoters p
 order by p.document_number, p.created_at
on conflict do nothing;

insert into employee_clients (employee_id, tenant_id, created_at)
select e.id, p.tenant_id, p.created_at
  from promoters p
  join employees e on e.profile = 'PROMOTOR' and e.document_type = 'DNI' and e.document_number = p.document_number
on conflict do nothing;

-- 4) Asignaciones a eventos: de promoters.id a employees.id (se conservan enlaces y auditoría)
alter table event_promoters add column employee_id uuid references employees (id) on delete cascade;

update event_promoters ep
   set employee_id = e.id
  from promoters p
  join employees e on e.profile = 'PROMOTOR' and e.document_type = 'DNI' and e.document_number = p.document_number
 where p.id = ep.promoter_id;

delete from event_promoters where employee_id is null;  -- no debería haber ninguna
alter table event_promoters alter column employee_id set not null;

drop index if exists event_promoters_unique_assignment;
alter table event_promoters
  drop constraint if exists event_promoters_event_id_document_number_key,
  drop column promoter_id,
  drop column full_name,
  drop column document_number,
  drop column phone;
create unique index event_promoters_event_employee_uq on event_promoters (event_id, employee_id);

drop table promoters;

-- 5) tenant_members pasa a ser una vista derivada (el rol histórico HOST desaparece)
drop table tenant_members;
create view tenant_members as
select ec.tenant_id,
       e.user_id,
       'CLIENT_ADMIN'::member_role as role,
       ec.created_at
  from employee_clients ec
  join employees e on e.id = ec.employee_id
 where e.profile = 'COORDINADOR'
   and e.is_active
   and e.user_id is not null;
