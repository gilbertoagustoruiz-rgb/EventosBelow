-- =====================================================================
-- 0015 · Edición y eliminación de asistentes (solo administrador)
--   - admin_update_registration: datos del titular y cambio de fecha (mueve su cupo)
--   - admin_update_companion: corrige nombre/documento de un acompañante
--   - admin_undo_checkin: anula un ingreso marcado por error (titular y/o acompañantes)
--   - admin_delete_registration: elimina al asistente y libera su cupo
-- El cupo cuenta solo titulares (0014).
-- =====================================================================

create or replace function admin_update_registration(
  p_registration_id uuid,
  p_event_date_id   uuid,
  p_full_name       text,
  p_document_type   document_type,
  p_document_number text,
  p_employee_code   text,
  p_company         text,
  p_email           text,
  p_phone           text
) returns void
language plpgsql as $$
declare
  r      registrations%rowtype;
  v_date event_dates%rowtype;
begin
  select * into r from registrations where id = p_registration_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if length(trim(coalesce(p_full_name, ''))) < 3 or length(trim(coalesce(p_document_number, ''))) < 3 then
    raise exception 'INVALID';
  end if;

  if p_event_date_id <> r.event_date_id then
    select * into v_date from event_dates where id = p_event_date_id and event_id = r.event_id;
    if not found then raise exception 'DATE_NOT_FOUND'; end if;
    if r.holder_checked_in_at is not null
       or exists (select 1 from companions where registration_id = r.id and checked_in_at is not null) then
      raise exception 'ALREADY_CHECKED_IN';
    end if;
    if r.status <> 'CANCELADO' then
      update event_dates set registered_count = registered_count + 1
       where id = p_event_date_id and registered_count + 1 <= capacity;
      if not found then raise exception 'SOLD_OUT'; end if;
      update event_dates set registered_count = registered_count - 1 where id = r.event_date_id;
    end if;
    -- La fecha asignada en la base sigue a la inscripción
    if r.invitee_id is not null then
      update invitees set event_date_id = p_event_date_id where id = r.invitee_id;
    end if;
  end if;

  begin
    update registrations
       set event_date_id   = p_event_date_id,
           full_name       = trim(p_full_name),
           document_type   = p_document_type,
           document_number = upper(trim(p_document_number)),
           employee_code   = nullif(trim(coalesce(p_employee_code, '')), ''),
           company         = nullif(trim(coalesce(p_company, '')), ''),
           email           = nullif(lower(trim(coalesce(p_email, ''))), ''),
           phone           = nullif(trim(coalesce(p_phone, '')), '')
     where id = r.id;
  exception when unique_violation then
    raise exception 'DUPLICATE';
  end;
end $$;

create or replace function admin_update_companion(
  p_companion_id    uuid,
  p_full_name       text,
  p_document_type   document_type,
  p_document_number text
) returns void
language plpgsql as $$
declare
  c companions%rowtype;
  r registrations%rowtype;
  v_doc text := upper(trim(coalesce(p_document_number, '')));
begin
  select * into c from companions where id = p_companion_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into r from registrations where id = c.registration_id;
  if length(trim(coalesce(p_full_name, ''))) < 3 or length(v_doc) < 3 then raise exception 'INVALID'; end if;
  if v_doc = upper(r.document_number) then raise exception 'COMPANION_IS_HOLDER'; end if;
  begin
    update companions set full_name = trim(p_full_name), document_type = p_document_type, document_number = v_doc
     where id = c.id;
  exception when unique_violation then
    raise exception 'COMPANION_DUPLICATE';
  end;
end $$;

-- Anula ingresos marcados por error y descuenta a esas personas de la bitácora
create or replace function admin_undo_checkin(
  p_registration_id uuid,
  p_holder          boolean,
  p_companion_ids   uuid[]
) returns int
language plpgsql as $$
declare
  r       registrations%rowtype;
  v_times timestamptz[] := '{}';
  v_t     timestamptz;
begin
  select * into r from registrations where id = p_registration_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  if p_holder and r.holder_checked_in_at is not null then
    v_times := v_times || r.holder_checked_in_at;
    update registrations set holder_checked_in_at = null, status = 'REGISTRADO' where id = r.id;
  end if;

  v_times := v_times || coalesce((
    select array_agg(checked_in_at) from companions
     where registration_id = r.id and id = any (coalesce(p_companion_ids, '{}')) and checked_in_at is not null
  ), '{}');
  update companions set checked_in_at = null, checked_in_by = null
   where registration_id = r.id and id = any (coalesce(p_companion_ids, '{}'));

  -- Cada ingreso se registró con la misma hora en la bitácora: restamos una persona por cada uno
  foreach v_t in array v_times loop
    update checkin_log set persons = persons - 1
     where id = (select id from checkin_log
                  where registration_id = r.id and result = 'INGRESO' and created_at = v_t and persons > 0
                  order by id limit 1);
  end loop;
  delete from checkin_log where registration_id = r.id and result = 'INGRESO' and persons <= 0;

  return coalesce(array_length(v_times, 1), 0);
end $$;

create or replace function admin_delete_registration(p_registration_id uuid) returns void
language plpgsql as $$
declare r registrations%rowtype;
begin
  select * into r from registrations where id = p_registration_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'CANCELADO' then
    update event_dates set registered_count = registered_count - 1 where id = r.event_date_id;
  end if;
  delete from registrations where id = r.id; -- acompañantes y bitácora en cascada
end $$;
