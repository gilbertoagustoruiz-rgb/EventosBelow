"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { transaction } from "@/lib/db";
import type { FormState } from "@/app/admin/actions";

const UUID = /^[0-9a-f-]{36}$/i;
const RESET_WORD = "REINICIAR";

/**
 * Reinicia un evento después de las pruebas (solo administrador).
 *  - "registros": borra confirmaciones, acompañantes e ingresos, y devuelve los cupos. Conserva la base de invitados.
 *  - "todo": además borra la base de invitados, para volver a cargar el Excel.
 * Se conservan el evento, sus fechas y aforos, la configuración y el personal.
 */
export async function resetEvent(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const eventId = String(fd.get("eventId") ?? "");
  const scope = String(fd.get("scope") ?? "");
  const confirm = String(fd.get("confirm") ?? "").trim().toUpperCase();
  if (!UUID.test(eventId) || (scope !== "registros" && scope !== "todo")) return { message: "Datos no válidos." };
  if (confirm !== RESET_WORD) return { fieldErrors: { confirm: `Escribe ${RESET_WORD} para confirmar` } };

  const counts = await transaction(async (client) => {
    const log = await client.query("delete from checkin_log where event_id = $1", [eventId]);
    const regs = await client.query("delete from registrations where event_id = $1", [eventId]); // acompañantes en cascada
    await client.query("update event_dates set registered_count = 0 where event_id = $1", [eventId]);
    const inv = scope === "todo" ? await client.query("delete from invitees where event_id = $1", [eventId]) : null;
    return { log: log.rowCount ?? 0, regs: regs.rowCount ?? 0, inv: inv?.rowCount ?? 0 };
  });

  for (const path of ["", "/dashboard", "/invitados"]) revalidatePath(`/admin/eventos/${eventId}${path}`);
  revalidatePath("/evento/[slug]", "page");
  return {
    ok: true,
    message:
      `Evento reiniciado: ${counts.regs} confirmaciones y ${counts.log} registros de ingreso eliminados; cupos liberados.` +
      (scope === "todo" ? ` Base de invitados eliminada (${counts.inv}). Ya puedes cargar el Excel definitivo.` : " La base de invitados se conservó."),
  };
}
