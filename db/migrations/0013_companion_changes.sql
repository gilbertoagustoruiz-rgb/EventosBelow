-- =====================================================================
-- 0013 · Regularizar la confirmación: agregar o quitar acompañantes
--   El invitado puede, desde su ticket, agregar acompañantes hasta el máximo
--   del evento (y si hay cupo), o quitar uno que aún no ingresó.
--   Mismas reglas que register_attendee; cupos atómicos.
-- =====================================================================

create or replace function add_companion(
  p_registration_id uuid,
  p_full_name       text,
  p_document_type   document_type,
  p_document_number text,
  p_admin           boolean default false
) returns uuid
language plpgsql as $$
declare
  r       registrations%rowtype;
  v_event events%rowtype;
  v_date  event_dates%rowtype;
  v_doc   text := upper(trim(p_document_number));
  v_id    uuid;
begin
  select * into r from registrations where id = p_registration_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status = 'CANCELADO' then raise exception 'CANCELLED'; end if;
  select * into v_event from events where id = r.event_id;
  select * into v_date from event_dates where id = r.event_date_id;

  if not p_admin then
    if not v_event.is_published or not v_event.registration_open then raise exception 'EVENT_CLOSED'; end if;
    if v_date.event_day < (now() at time zone v_event.timezone)::date then raise exception 'DATE_PAST'; end if;
  end if;
  if v_event.companion_mode = 'NONE' or r.companions_count + 1 > v_event.max_companions then
    raise exception 'TOO_MANY_COMPANIONS';
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 3 or length(v_doc) < 3 then raise exception 'INVALID'; end if;
  if v_doc = upper(r.document_number) then raise exception 'COMPANION_IS_HOLDER'; end if;

  update event_dates set registered_count = registered_count + 1
   where id = r.event_date_id and registered_count + 1 <= capacity;
  if not found then raise exception 'SOLD_OUT'; end if;

  begin
    insert into companions (registration_id, position, full_name, document_type, document_number)
    values (r.id,
            coalesce((select max(position) from companions where registration_id = r.id), 0) + 1,
            trim(p_full_name), p_document_type, v_doc)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'COMPANION_DUPLICATE';
  end;

  update registrations set companions_count = companions_count + 1 where id = r.id;
  return v_id;
end $$;

create or replace function remove_companion(
  p_registration_id uuid,
  p_companion_id    uuid,
  p_admin           boolean default false
) returns void
language plpgsql as $$
declare
  r       registrations%rowtype;
  v_event events%rowtype;
  v_date  event_dates%rowtype;
  c       companions%rowtype;
begin
  select * into r from registrations where id = p_registration_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status = 'CANCELADO' then raise exception 'CANCELLED'; end if;
  select * into c from companions where id = p_companion_id and registration_id = r.id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if c.checked_in_at is not null then raise exception 'ALREADY_CHECKED_IN'; end if;
  select * into v_event from events where id = r.event_id;
  select * into v_date from event_dates where id = r.event_date_id;

  if not p_admin then
    if not v_event.is_published or not v_event.registration_open then raise exception 'EVENT_CLOSED'; end if;
    if v_date.event_day < (now() at time zone v_event.timezone)::date then raise exception 'DATE_PAST'; end if;
  end if;
  if v_event.companion_mode = 'REQUIRED' and r.companions_count <= 1 then raise exception 'COMPANION_REQUIRED'; end if;

  delete from companions where id = c.id;
  update registrations set companions_count = companions_count - 1 where id = r.id;
  update event_dates set registered_count = registered_count - 1 where id = r.event_date_id;
end $$;
