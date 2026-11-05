import "server-only";

/**
 * Envuelve una consulta de inscripciones y agrega `checked_in_by_label`:
 * el promotor que acreditó (último registro de auditoría), si no el coordinador
 * con sesión, y si no "Enlace general" cuando hubo ingreso por el enlace del evento.
 * `inner` debe devolver filas de `registrations`; `orderBy` usa el alias r.
 */
export function withCheckinBy(inner: string, orderBy: string) {
  return `select r.*,
         coalesce(pc.full_name, u.full_name, u.email,
                  case when r.holder_checked_in_at is not null or r.companion_checked_in_at is not null
                       then 'Enlace general' end) as checked_in_by_label
    from (${inner}) r
    left join users u on u.id = r.checked_in_by
    left join lateral (
      select p.full_name
        from promoter_checkins c
        join event_promoters ep on ep.id = c.promoter_id
        join employees p on p.id = ep.employee_id
       where c.registration_id = r.id
       order by c.checked_at desc
       limit 1
    ) pc on true
   order by ${orderBy}`;
}
