-- Datos de ejemplo (opcional). Ejecutar después de las migraciones:
--   psql "$DATABASE_URL" -f db/seed-demo.sql
-- Crea Cliente → Proyecto → Evento con dos fechas y una pequeña base de invitados.
with t as (
  insert into tenants (name, slug, tax_id, contact_name, contact_email)
  values ('Cliente Demo S.A.C.', 'cliente-demo', '20123456789', 'María Pérez', 'maria@clientedemo.pe')
  returning id
), p as (
  insert into projects (tenant_id, name, description)
  select id, 'Convención 2026', 'Eventos de la convención anual' from t
  returning id, tenant_id
), e as (
  insert into events (tenant_id, project_id, name, slug, description, venue, primary_color, companion_mode, max_companions, is_published)
  select tenant_id, id, 'Convención Anual 2026', 'convencion-anual-2026',
         'Encuentro anual de socios comerciales con conferencias y networking.',
         'Centro de Convenciones de Lima', '#0f766e', 'OPTIONAL', 2, true
  from p
  returning id
), d as (
  insert into event_dates (event_id, event_day, starts_at, ends_at, label, capacity)
  select e.id, x.day, '09:00', '18:00', x.label, x.cap
  from e,
    (values (current_date + 14, 'Día 1 · Conferencias', 300),
            (current_date + 15, 'Día 2 · Networking',  200)) as x(day, label, cap)
  returning event_id
)
insert into invitees (event_id, document_type, document_number, employee_code, full_name, email, phone, company)
select e.id, 'DNI', i.doc, i.code, i.name, i.email, i.phone, 'Cliente Demo S.A.C.'
from e,
  (values ('45678912', 'V-1001', 'Ana Torres Ríos',     'ana.torres@example.com',  '+51 999 111 222'),
          ('41234567', 'V-1002', 'Luis Mendoza Paz',    'luis.mendoza@example.com', null),
          ('70123456', 'V-1003', 'Carla Quispe Huamán', null,                       '+51 988 333 444')) as i(doc, code, name, email, phone);
