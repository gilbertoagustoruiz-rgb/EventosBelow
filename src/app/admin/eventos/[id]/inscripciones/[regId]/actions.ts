"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { pgMessage, query, queryOne } from "@/lib/db";
import { DOCUMENT_TYPES, documentIssue, flattenErrors } from "@/lib/validation";
import type { FormState } from "@/app/admin/actions";

/* Edición y eliminación de asistentes: solo el administrador general. */

const UUID = /^[0-9a-f-]{36}$/i;
const ERRORS: Record<string, string> = {
  SOLD_OUT: "La fecha elegida no tiene cupos disponibles.",
  DUPLICATE: "Ya existe otra inscripción activa con ese documento en esa fecha.",
  ALREADY_CHECKED_IN: "No se puede cambiar de fecha a alguien que ya ingresó. Anula primero su ingreso.",
  DATE_NOT_FOUND: "La fecha elegida no pertenece al evento.",
  COMPANION_IS_HOLDER: "El acompañante no puede tener el mismo documento que el titular.",
  COMPANION_DUPLICATE: "Ese documento ya está en otro acompañante de esta inscripción.",
  TOO_MANY_COMPANIONS: "Ya tiene el máximo de acompañantes permitido para el evento.",
  COMPANION_REQUIRED: "El evento exige al menos un acompañante.",
  CANCELLED: "La inscripción está cancelada.",
  INVALID: "Revisa el nombre y el documento.",
  NOT_FOUND: "No se encontró el registro.",
};
const fail = (err: unknown): FormState => {
  const msg = pgMessage(err);
  const code = Object.keys(ERRORS).find((k) => msg.includes(k));
  if (!code) console.error("[asistente]", err);
  return { message: code ? ERRORS[code] : "No se pudo guardar el cambio." };
};

/** El registro debe pertenecer al evento indicado. */
async function owned(fd: FormData) {
  await requireAdmin();
  const eventId = String(fd.get("eventId") ?? "");
  const regId = String(fd.get("registrationId") ?? "");
  if (!UUID.test(eventId) || !UUID.test(regId)) return null;
  const ok = await queryOne("select 1 from registrations where id = $1 and event_id = $2", [regId, eventId]);
  return ok ? { eventId, regId } : null;
}
const refresh = (eventId: string, regId: string) => {
  for (const p of ["", "/dashboard", `/inscripciones/${regId}`]) revalidatePath(`/admin/eventos/${eventId}${p}`);
};

const opt = z.string().trim().max(120).optional().transform((v) => v || "");
const holderSchema = z
  .object({
    eventDateId: z.string().uuid("Elige una fecha"),
    fullName: z.string().trim().min(3, "Ingresa el nombre completo").max(120),
    documentType: z.enum(DOCUMENT_TYPES),
    documentNumber: z.string().trim().transform((v) => v.toUpperCase().replace(/[\s.-]/g, "")),
    employeeCode: z.string().trim().max(40).optional().transform((v) => v || ""),
    company: opt,
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Correo no válido")]).optional().transform((v) => v || ""),
    phone: z.union([z.literal(""), z.string().trim().regex(/^\+?[0-9\s-]{7,20}$/, "Celular no válido")]).optional().transform((v) => v || ""),
  })
  .superRefine((d, ctx) => {
    const issue = documentIssue(d.documentType, d.documentNumber);
    if (issue) ctx.addIssue({ code: "custom", path: ["documentNumber"], message: issue });
  });

export async function updateHolder(_: FormState, fd: FormData): Promise<FormState> {
  const o = await owned(fd);
  if (!o) return { message: ERRORS.NOT_FOUND };
  const parsed = holderSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: flattenErrors(parsed.error) };
  const d = parsed.data;
  try {
    await query("select admin_update_registration($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      o.regId, d.eventDateId, d.fullName, d.documentType, d.documentNumber, d.employeeCode, d.company, d.email, d.phone,
    ]);
  } catch (err) {
    return fail(err);
  }
  refresh(o.eventId, o.regId);
  return { ok: true, message: "Datos del asistente guardados." };
}

const companionSchema = z
  .object({
    fullName: z.string().trim().min(3, "Ingresa el nombre completo").max(120),
    documentType: z.enum(DOCUMENT_TYPES),
    documentNumber: z.string().trim().transform((v) => v.toUpperCase().replace(/[\s.-]/g, "")),
  })
  .superRefine((d, ctx) => {
    const issue = documentIssue(d.documentType, d.documentNumber);
    if (issue) ctx.addIssue({ code: "custom", path: ["documentNumber"], message: issue });
  });

export async function saveCompanion(_: FormState, fd: FormData): Promise<FormState> {
  const o = await owned(fd);
  if (!o) return { message: ERRORS.NOT_FOUND };
  const parsed = companionSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: flattenErrors(parsed.error) };
  const c = parsed.data;
  const companionId = String(fd.get("companionId") ?? "");
  try {
    if (UUID.test(companionId)) {
      const mine = await queryOne("select 1 from companions where id = $1 and registration_id = $2", [companionId, o.regId]);
      if (!mine) return { message: ERRORS.NOT_FOUND };
      await query("select admin_update_companion($1,$2,$3,$4)", [companionId, c.fullName, c.documentType, c.documentNumber]);
    } else {
      await query("select add_companion($1,$2,$3,$4,true)", [o.regId, c.fullName, c.documentType, c.documentNumber]);
    }
  } catch (err) {
    return fail(err);
  }
  refresh(o.eventId, o.regId);
  return { ok: true, message: UUID.test(companionId) ? "Acompañante actualizado." : "Acompañante agregado." };
}

export async function removeCompanionAdmin(fd: FormData) {
  const o = await owned(fd);
  const companionId = String(fd.get("companionId") ?? "");
  if (!o || !UUID.test(companionId)) return;
  try {
    // Si había ingresado, primero se anula su ingreso
    await query("select admin_undo_checkin($1, false, $2::uuid[])", [o.regId, [companionId]]);
    await query("select remove_companion($1, $2, true)", [o.regId, companionId]);
  } catch (err) {
    fail(err);
  }
  refresh(o.eventId, o.regId);
}

/** Anula el ingreso del titular (holder=1) o de un acompañante (companionId). */
export async function undoCheckin(fd: FormData) {
  const o = await owned(fd);
  if (!o) return;
  const companionId = String(fd.get("companionId") ?? "");
  const holder = fd.get("holder") === "1";
  await query("select admin_undo_checkin($1, $2, $3::uuid[])", [o.regId, holder, UUID.test(companionId) ? [companionId] : []]);
  refresh(o.eventId, o.regId);
}

export async function deleteRegistration(fd: FormData) {
  const o = await owned(fd);
  if (!o) return;
  await query("select admin_delete_registration($1)", [o.regId]);
  for (const p of ["", "/dashboard", "/invitados"]) revalidatePath(`/admin/eventos/${o.eventId}${p}`);
  if (fd.get("back") !== "list") redirect(`/admin/eventos/${o.eventId}#inscripciones`);
}
