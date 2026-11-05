"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEvent } from "@/lib/auth";
import { pgCode, query } from "@/lib/db";
import { DOCUMENT_TYPES, documentIssue, flattenErrors } from "@/lib/validation";
import type { FormState } from "@/app/admin/actions";

const UUID = /^[0-9a-f-]{36}$/i;
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

const inviteeSchema = z
  .object({
    fullName: z.string().trim().min(3, "Ingresa el nombre completo").max(120),
    documentType: z.enum(DOCUMENT_TYPES),
    documentNumber: z.string().trim().transform((v) => v.toUpperCase().replace(/[\s.-]/g, "")),
    employeeCode: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((v) => (v ? v.toUpperCase().replace(/\s+/g, "") : null))
      .refine((v) => !v || /^[A-Z0-9_-]{2,40}$/.test(v), "Código no válido"),
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Correo no válido")]).optional().transform((v) => v || null),
    phone: z.union([z.literal(""), z.string().trim().regex(/^\+?[0-9\s-]{7,20}$/, "Celular no válido")]).optional().transform((v) => v || null),
    company: opt(120),
    jobTitle: opt(120),
  })
  .superRefine((d, ctx) => {
    const issue = documentIssue(d.documentType, d.documentNumber);
    if (issue) ctx.addIssue({ code: "custom", path: ["documentNumber"], message: issue });
  });

export async function addInvitee(_: FormState, fd: FormData): Promise<FormState> {
  const eventId = String(fd.get("eventId") ?? "");
  await requireEvent(eventId, "admin");
  const parsed = inviteeSchema.safeParse({
    fullName: fd.get("fullName"),
    documentType: fd.get("documentType") || "DNI",
    documentNumber: fd.get("documentNumber") ?? "",
    employeeCode: fd.get("employeeCode") ?? "",
    email: fd.get("email") ?? "",
    phone: fd.get("phone") ?? "",
    company: fd.get("company") ?? "",
    jobTitle: fd.get("jobTitle") ?? "",
  });
  if (!parsed.success) return { fieldErrors: flattenErrors(parsed.error) };
  const d = parsed.data;
  try {
    await query(
      `insert into invitees (event_id, document_type, document_number, employee_code, full_name, email, phone, company, job_title)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [eventId, d.documentType, d.documentNumber, d.employeeCode, d.fullName, d.email, d.phone, d.company, d.jobTitle],
    );
  } catch (e) {
    if (pgCode(e) === "23505") return { message: "Ya existe un invitado con ese documento o código en este evento." };
    throw e;
  }
  revalidatePath(`/admin/eventos/${eventId}/invitados`);
  return { ok: true, message: `${d.fullName} se agregó a la base de invitados.` };
}

export async function deleteInvitee(fd: FormData) {
  const eventId = String(fd.get("eventId") ?? "");
  const inviteeId = String(fd.get("inviteeId") ?? "");
  if (!UUID.test(inviteeId)) return;
  await requireEvent(eventId, "admin");
  // La inscripción (si existe) se conserva; solo pierde el vínculo con la base.
  await query("delete from invitees where id = $1 and event_id = $2", [inviteeId, eventId]);
  revalidatePath(`/admin/eventos/${eventId}/invitados`);
}
