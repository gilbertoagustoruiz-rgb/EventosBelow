"use server";

import { revalidatePath } from "next/cache";
import { requireEvent } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import type { FormState } from "@/app/admin/actions";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * El coordinador selecciona promotores para su evento. Solo se aceptan promotores activos
 * asignados por el administrador al cliente del evento. Reactiva la asignación si ya existía.
 */
export async function selectPromoters(_: FormState, fd: FormData): Promise<FormState> {
  const eventId = String(fd.get("eventId") ?? "");
  const ids = fd.getAll("employeeId").map(String).filter((v) => UUID.test(v));
  if (ids.length === 0) return { message: "Selecciona al menos un promotor." };
  const { event } = await requireEvent(eventId, "admin");

  const allowed = await query<{ id: string }>(
    `select e.id from employees e
       join employee_clients ec on ec.employee_id = e.id and ec.tenant_id = $2
      where e.id = any($1) and e.profile = 'PROMOTOR' and e.is_active`,
    [ids, event.tenant_id],
  );
  if (allowed.length === 0) return { message: "Esos promotores no están asignados a este cliente." };

  await query(
    `insert into event_promoters (event_id, employee_id)
     select $1, unnest($2::uuid[])
     on conflict (event_id, employee_id) do update set is_active = true`,
    [event.id, allowed.map((a) => a.id)],
  );
  revalidatePath(`/admin/eventos/${event.id}`);
  return {
    ok: true,
    message: allowed.length === 1 ? "Promotor seleccionado. Comparte su enlace personal." : `${allowed.length} promotores seleccionados.`,
  };
}

/** Retirar, volver a activar o regenerar el enlace de un promotor del evento. */
export async function updateEventPromoter(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  const operation = String(fd.get("operation") ?? "");
  if (!UUID.test(id) || !["disable", "enable", "rotate"].includes(operation)) return;

  const row = await queryOne<{ event_id: string; tenant_id: string; employee_id: string }>(
    `select ep.event_id, e.tenant_id, ep.employee_id from event_promoters ep join events e on e.id = ep.event_id where ep.id = $1`,
    [id],
  );
  if (!row) return;
  await requireEvent(row.event_id, "admin");

  if (operation === "rotate") {
    await query("update event_promoters set access_key = replace(gen_random_uuid()::text, '-', '') where id = $1", [id]);
  } else if (operation === "disable") {
    await query("update event_promoters set is_active = false where id = $1", [id]);
  } else {
    // Reactivar solo si sigue activo y asignado al cliente
    await query(
      `update event_promoters set is_active = true
        where id = $1 and exists (
          select 1 from employees em join employee_clients ec on ec.employee_id = em.id and ec.tenant_id = $2
           where em.id = $3 and em.is_active)`,
      [id, row.tenant_id, row.employee_id],
    );
  }
  revalidatePath(`/admin/eventos/${row.event_id}`);
}
