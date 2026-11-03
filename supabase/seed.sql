-- Datos de ejemplo. Ejecutar DESPUÉS de crear tu usuario en Supabase Auth.
-- 1) Conviértete en SuperAdmin (reemplaza el correo):
insert into public.platform_admins (user_id)
select id from auth.users where email = 'tu-correo@empresa.com'
on conflict do nothing;

-- 2) Cliente y evento demo
with t as (
  insert into public.tenants (name, slug, tax_id, contact_name, contact_email)
  values ('Cliente Demo S.A.C.', 'cliente-demo', '20123456789', 'María Pérez', 'maria@clientedemo.pe')
  returning id
), e as (
  insert into public.events (tenant_id, name, slug, description, venue, primary_color, companion_mode, is_published)
  select id, 'Convención Anual 2026', 'convencion-anual-2026',
         'Encuentro anual de socios comerciales con conferencias y networking.',
         'Centro de Convenciones de Lima', '#0f766e', 'OPTIONAL', true
  from t
  returning id
)
insert into public.event_dates (event_id, event_day, starts_at, ends_at, label, capacity)
select e.id, d.day, '09:00', '18:00', d.label, d.cap
from e,
  (values (current_date + 14, 'Día 1 · Conferencias', 300),
          (current_date + 15, 'Día 2 · Networking',  200)) as d(day, label, cap);
