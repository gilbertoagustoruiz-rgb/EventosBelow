-- =====================================================================
-- 0006 · Ajustes tras integrar importación y promotores
--  1) register_attendee acepta p_admin: las cargas del administrador (Excel)
--     no dependen de que el evento esté publicado/abierto ni de que la fecha
--     sea futura. Aforo, duplicados y reglas de acompañante se mantienen.
--  2) La auditoría de promotores se borra en cascada con su registro,
--     asignación o promotor (antes bloqueaba esos borrados).
-- =====================================================================

drop function if exists register_attendee(
  uuid, text, text, text, document_type, text, text, text, boolean, text, document_type, text
);

create or replace function register_attendee(
  p_event_date_id             uuid,
  p_full_name                 text,
  p_email                     text,
  p_phone                     text,
  p_document_type             document_type,
  p_document_number           text,
  p_company                   text,
  p_job_title                 text,
  p_has_companion             boolean,
  p_companion_full_name       text,
  p_companion_document_type   document_type,
  p_companion_document_number text,
  p_admin                     boolean default false
) returns table (out_registration_id uuid, out_token text)
language plpgsql as $$
declare
  v_date  event_dates%rowtype;
  v_event events%rowtype;
  v_seats int := case when p_has_companion then 2 else 1 end;
begin
  select * into v_date from event_dates where id = p_event_date_id;
  if not found then raise exception 'DATE_NOT_FOUND'; end if;

  select * into v_event from events where id = v_date.event_id;
  if not p_admin then
    if not v_event.is_published or not v_event.registration_open then
      raise exception 'EVENT_CLOSED';
    end if;
    if v_date.event_day < (now() at time zone v_event.timezone)::date then
      raise exception 'DATE_PAST';
    end if;
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

-- Auditoría de promotores: borrado en cascada
alter table promoter_checkins
  drop constraint if exists promoter_checkins_promoter_id_fkey,
  add constraint promoter_checkins_promoter_id_fkey
    foreign key (promoter_id) references event_promoters (id) on delete cascade,
  drop constraint if exists promoter_checkins_registration_id_fkey,
  add constraint promoter_checkins_registration_id_fkey
    foreign key (registration_id) references registrations (id) on delete cascade;

alter table event_promoters
  drop constraint if exists event_promoters_promoter_id_fkey,
  add constraint event_promoters_promoter_id_fkey
    foreign key (promoter_id) references promoters (id) on delete cascade;

-- Consulta "acreditado por" desde la lista de inscripciones y la exportación
create index if not exists promoter_checkins_registration_idx
  on promoter_checkins (registration_id, checked_at desc);
