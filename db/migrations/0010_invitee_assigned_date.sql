-- =====================================================================
-- 0010 · Fecha asignada por invitado
--   La base precargada puede traer la "Fecha de asistencia" de cada persona.
--   Si la tiene, el invitado solo puede confirmar esa fecha (WRONG_DATE_ASSIGNED).
-- =====================================================================

alter table invitees add column event_date_id uuid references event_dates (id) on delete set null;
create index invitees_date_idx on invitees (event_date_id);

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
    -- Fecha asignada en la base: el invitado solo confirma esa fecha
    if not p_admin and v_inv.event_date_id is not null and v_inv.event_date_id <> p_event_date_id then
      raise exception 'WRONG_DATE_ASSIGNED';
    end if;
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
