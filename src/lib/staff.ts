import "server-only";
import { query } from "@/lib/db";
import type { StaffCandidate, StaffMember } from "@/app/admin/eventos/[id]/staff";

/** Personal del evento con su actividad de acreditación. */
export function eventStaff(eventId: string) {
  return query<StaffMember>(
    `select s.id, s.employee_id, s.role, e.full_name, e.document_number,
            s.is_active and e.is_active as is_active, e.user_id is not null as has_user,
            coalesce(a.checkins, 0)::int as checkins, coalesce(a.persons, 0)::int as persons, a.last_at
       from event_staff s
       join employees e on e.id = s.employee_id
       left join lateral (
         select count(*) filter (where l.result = 'INGRESO') as checkins,
                sum(l.persons) filter (where l.result = 'INGRESO') as persons,
                max(l.created_at) as last_at
           from checkin_log l where l.event_id = s.event_id and l.employee_id = s.employee_id
       ) a on true
      where s.event_id = $1
      order by s.is_active desc, e.full_name`,
    [eventId],
  );
}

/** Supervisores y promotores activos del directorio (candidatos a agregar). */
export function staffCandidates() {
  return query<StaffCandidate>(
    `select id, profile, full_name, document_number, email from employees
      where is_active and profile in ('SUPERVISOR', 'PROMOTOR') order by full_name`,
  );
}
