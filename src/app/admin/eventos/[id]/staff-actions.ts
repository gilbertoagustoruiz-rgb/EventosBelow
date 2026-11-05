"use server";

import { revalidatePath } from "next/cache";
import { requireEvent } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import type { FormState } from "@/app/admin/actions";

const UUID = /^[0-9a-f-]{36}$/i;
type StaffRole = "SUPERVISOR" | "PROMOTOR";

function refresh(eventId: string) {
  revalidatePath(`/admin/eventos/${eventId}`);
  revalidatePath(`/admin/eventos/${eventId}/dashboard`);
  revalidatePath("/checkin");
}

/**
 * Agrega personal de apoyo al evento desde el directorio de empleados.
 * Coordinador/administrador: supervisores y promotores. Supervisor: solo promotores.
 */
export async function addStaff(_: FormState, fd: FormData): Promise<FormState> {
  const eventId = String(fd.get("eventId") ?? "");
  const role = String(fd.get("role") ?? "") as StaffRole;
  const ids = fd.getAll("employeeId").map(String).filter((v) => UUID.test(v));
  if (role !== "SUPERVISOR" && role !== "PROMOTOR") return { message: "Perfil no válido." };
  const { event, access, viewer } = await requireEvent(eventId, "supervise");
  if (role === "SUPERVISOR" && access !== "manage") return { message: "Solo el coordinador agrega supervisores." };
  if (ids.length === 0) return { message: role === "SUPERVISOR" ? "Selecciona al menos un supervisor." : "Selecciona al menos un promotor." };

  const valid = await query<{ id: string; has_user: boolean }>(
    `select id, user_id is not null as has_user from employees where id = any($1) and is_active and profile = $2`,
    [ids, role],
  );
  if (valid.length === 0) return { message: "Esos empleados no están activos con ese perfil." };

  await query(
    `insert into event_staff (event_id, employee_id, role, added_by)
     select $1, unnest($2::uuid[]), $3, $4
     on conflict (event_id, employee_id) do update set is_active = true, role = excluded.role, added_by = excluded.added_by`,
    [event.id, valid.map((v) => v.id), role, viewer.userId],
  );
  refresh(event.id);
  const noLogin = valid.filter((v) => !v.has_user).length;
  const label = role === "SUPERVISOR" ? ["supervisor", "supervisores"] : ["promotor", "promotores"];
  return {
    ok: true,
    message:
      (valid.length === 1 ? `1 ${label[0]} agregado al evento.` : `${valid.length} ${label[1]} agregados al evento.`) +
      (noLogin ? ` ${noLogin} aún no tiene acceso: pide al administrador que lo cree en Empleados.` : ""),
  };
}

/** Quita (o vuelve a activar) a una persona del personal del evento. La bitácora se conserva. */
export async function setStaffActive(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  const active = fd.get("active") === "true";
  if (!UUID.test(id)) return;
  const row = await queryOne<{ event_id: string; role: StaffRole; employee_active: boolean }>(
    `select s.event_id, s.role, e.is_active as employee_active
       from event_staff s join employees e on e.id = s.employee_id where s.id = $1`,
    [id],
  );
  if (!row) return;
  const { access } = await requireEvent(row.event_id, "supervise");
  if (row.role === "SUPERVISOR" && access !== "manage") return;
  if (active && !row.employee_active) return;
  await query("update event_staff set is_active = $2 where id = $1", [id, active]);
  refresh(row.event_id);
}
