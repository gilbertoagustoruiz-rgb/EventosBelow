import "server-only";

/**
 * Envuelve una consulta de inscripciones y agrega:
 *  - `checked_in_by_label`: quién registró el último ingreso (empleado; si no, "Enlace general")
 *  - `companions_in`: acompañantes que ya ingresaron
 *  - `companions_list`: "Nombre (DNI 123)" de cada acompañante
 * `inner` debe devolver filas de `registrations`; `orderBy` usa el alias r.
 */
export function withCheckinBy(inner: string, orderBy: string) {
  return `select r.*,
         case when lg.id is not null then coalesce(em.full_name, 'Enlace general') end as checked_in_by_label,
         (select count(*) from companions c where c.registration_id = r.id and c.checked_in_at is not null)::int as companions_in,
         (select string_agg(c.full_name || ' (' || c.document_type || ' ' || c.document_number || ')', '; ' order by c.position)
            from companions c where c.registration_id = r.id) as companions_list
    from (${inner}) r
    left join lateral (
      select l.id, l.employee_id from checkin_log l
       where l.registration_id = r.id and l.result = 'INGRESO'
       order by l.created_at desc limit 1
    ) lg on true
    left join employees em on em.id = lg.employee_id
   order by ${orderBy}`;
}
