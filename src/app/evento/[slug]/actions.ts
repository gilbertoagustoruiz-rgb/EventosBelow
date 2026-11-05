"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { pgMessage, query, queryOne } from "@/lib/db";
import { sendConfirmationEmail } from "@/lib/email";
import { createRateLimiter } from "@/lib/rate-limit";
import { confirmationSchema, flattenErrors, type ConfirmationInput } from "@/lib/validation";
import type { DocumentType } from "@/lib/types";

/* ------------------------------------------------------------------------------------
 * Inscripción desde la base precargada:
 *   1) lookupInvitee: el asistente escribe su DNI o código de vendedor; si está en la base
 *      se muestran sus datos (enmascarados) y elige el día.
 *   2) confirmRegistration: confirma el día (y acompañantes si el evento lo permite).
 * Si ya estaba inscrito no se muestra el ticket: se reenvía al correo registrado.
 * ---------------------------------------------------------------------------------- */

export interface InviteePreview {
  id: string;
  fullName: string;
  documentType: DocumentType;
  maskedDocument: string;
  employeeCode: string | null;
  company: string | null;
  maskedEmail: string | null;
  needsEmail: boolean;
  needsPhone: boolean;
}

export type LookupInviteeResult =
  | { state: "FOUND"; invitee: InviteePreview }
  | { state: "REGISTERED"; maskedEmail: string; day: string }
  | { state: "NOT_FOUND" | "LIMITED" | "INVALID" | "CLOSED"; message: string };

export type ConfirmResult =
  | { ok: true; token: string }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };

const lookups = createRateLimiter(20, 10 * 60_000);
const confirms = createRateLimiter(10, 10 * 60_000);

const DB_ERRORS: Record<string, string> = {
  SOLD_OUT: "Se agotaron los cupos para este día mientras confirmabas. Elige otro día.",
  DUPLICATE: "Ya tienes una inscripción para este evento. Te reenviamos el ticket a tu correo.",
  EVENT_CLOSED: "Las inscripciones para este evento están cerradas.",
  DATE_PAST: "Este día ya pasó.",
  DATE_NOT_FOUND: "El día seleccionado ya no está disponible.",
  NOT_INVITED: "No encontramos tus datos en la lista de invitados de este evento.",
  TOO_MANY_COMPANIONS: "Superaste el número máximo de acompañantes permitido.",
  COMPANION_REQUIRED: "Este evento requiere registrar al menos un acompañante.",
  COMPANION_IS_HOLDER: "Un acompañante no puede tener tu mismo documento.",
  COMPANION_DUPLICATE: "Hay acompañantes con el mismo documento.",
};

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

async function clientIp() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

/** DNI o código: sin espacios, puntos ni guiones; en mayúsculas (el código se compara igual). */
function normalizeCode(raw: string) {
  return raw.replace(/[\s.-]/g, "").toUpperCase();
}

const maskEmail = (e: string) => e.replace(/^(.)[^@]*/, "$1***");
const maskDoc = (d: string) => (d.length <= 4 ? "****" : "*".repeat(d.length - 4) + d.slice(-4));

interface InviteeRow {
  id: string;
  full_name: string;
  document_type: DocumentType;
  document_number: string;
  employee_code: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
}

async function findInvitee(eventId: string, code: string) {
  return queryOne<InviteeRow>(
    `select id, full_name, document_type, document_number, employee_code, company, email, phone
       from invitees
      where event_id = $1
        and (upper(document_number) = $2 or regexp_replace(upper(employee_code), '[[:space:].-]', '', 'g') = $2)
      order by (upper(document_number) = $2) desc
      limit 1`,
    [eventId, code],
  );
}

/** Reenvía el ticket vigente al correo registrado (nunca lo muestra en pantalla). */
async function resendExisting(registrationId: string, slug: string) {
  const r = await queryOne<{
    token: string; email: string; full_name: string; name: string; venue: string | null;
    primary_color: string; event_day: string; starts_at: string; ends_at: string; companion_names: string[];
  }>(
    `select r.token, r.email, r.full_name, e.name, e.venue, e.primary_color,
            d.event_day::text, d.starts_at::text, d.ends_at::text,
            coalesce((select array_agg(c.full_name order by c.position) from companions c where c.registration_id = r.id), '{}') as companion_names
       from registrations r
       join events e on e.id = r.event_id
       join event_dates d on d.id = r.event_date_id
      where r.id = $1`,
    [registrationId],
  );
  if (!r) return null;
  await sendConfirmationEmail({
    to: r.email, fullName: r.full_name, eventName: r.name, eventSlug: slug, venue: r.venue,
    brandColor: r.primary_color, day: r.event_day, startsAt: r.starts_at, endsAt: r.ends_at,
    token: r.token, companionNames: r.companion_names,
  });
  return { maskedEmail: maskEmail(r.email), day: r.event_day };
}

async function activeRegistration(eventId: string, inv: InviteeRow) {
  return queryOne<{ id: string }>(
    `select id from registrations
      where event_id = $1 and status <> 'CANCELADO'
        and (invitee_id = $2 or (document_type = $3 and document_number = $4))
      order by created_at desc limit 1`,
    [eventId, inv.id, inv.document_type, inv.document_number],
  );
}

export async function lookupInvitee(slug: string, value: string): Promise<LookupInviteeResult> {
  if (!slugSchema.safeParse(slug).success) return { state: "INVALID", message: "Evento no válido." };
  const code = normalizeCode(String(value ?? ""));
  if (code.length < 3 || code.length > 30 || !/^[A-Z0-9]+$/.test(code)) {
    return { state: "INVALID", message: "Ingresa tu número de documento o tu código de vendedor." };
  }
  if (!lookups.consume(await clientIp())) {
    return { state: "LIMITED", message: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo." };
  }

  const event = await queryOne<{ id: string; registration_open: boolean }>(
    "select id, registration_open from events where slug = $1 and is_published",
    [slug],
  );
  if (!event) return { state: "INVALID", message: "Evento no válido." };
  if (!event.registration_open) return { state: "CLOSED", message: DB_ERRORS.EVENT_CLOSED };

  const inv = await findInvitee(event.id, code);
  if (!inv) {
    return {
      state: "NOT_FOUND",
      message: "No encontramos ese documento o código en la lista de invitados. Verifícalo o comunícate con el organizador.",
    };
  }

  const existing = await activeRegistration(event.id, inv);
  if (existing) {
    const sent = await resendExisting(existing.id, slug);
    if (sent) return { state: "REGISTERED", ...sent };
  }

  return {
    state: "FOUND",
    invitee: {
      id: inv.id,
      fullName: inv.full_name,
      documentType: inv.document_type,
      maskedDocument: maskDoc(inv.document_number),
      employeeCode: inv.employee_code,
      company: inv.company,
      maskedEmail: inv.email ? maskEmail(inv.email) : null,
      needsEmail: !inv.email,
      needsPhone: !inv.phone,
    },
  };
}

export async function confirmRegistration(slug: string, input: ConfirmationInput): Promise<ConfirmResult> {
  if (!slugSchema.safeParse(slug).success) return { ok: false, code: "INVALID", message: "Evento no válido." };
  const parsed = confirmationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION", message: "Revisa los campos marcados.", fieldErrors: flattenErrors(parsed.error) };
  }
  const d = parsed.data;
  if (!confirms.consume(await clientIp())) {
    return { ok: false, code: "LIMITED", message: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo." };
  }

  // La fecha y el invitado deben pertenecer al evento del slug
  const ctx = await queryOne<{
    event_id: string; event_day: string; starts_at: string; ends_at: string; name: string;
    venue: string | null; primary_color: string;
  }>(
    `select e.id as event_id, d.event_day, d.starts_at::text, d.ends_at::text, e.name, e.venue, e.primary_color
       from event_dates d join events e on e.id = d.event_id
      where d.id = $1 and e.slug = $2`,
    [d.eventDateId, slug],
  );
  if (!ctx) return { ok: false, code: "DATE_NOT_FOUND", message: DB_ERRORS.DATE_NOT_FOUND };
  const inv = await queryOne<InviteeRow>(
    `select id, full_name, document_type, document_number, employee_code, company, email, phone
       from invitees where id = $1 and event_id = $2`,
    [d.inviteeId, ctx.event_id],
  );
  if (!inv) return { ok: false, code: "NOT_INVITED", message: DB_ERRORS.NOT_INVITED };

  // El correo y el celular de la base no se pueden cambiar desde el formulario público
  const email = inv.email ?? (d.email || null);
  const phone = inv.phone ?? (d.phone || null);
  const fieldErrors: Record<string, string> = {};
  if (!email) fieldErrors.email = "Ingresa tu correo para recibir el ticket";
  if (!phone) fieldErrors.phone = "Ingresa tu celular";
  if (Object.keys(fieldErrors).length) {
    return { ok: false, code: "VALIDATION", message: "Revisa los campos marcados.", fieldErrors };
  }
  const holderDoc = inv.document_number.toUpperCase();
  const clash = d.companions.findIndex((c) => c.documentNumber.toUpperCase() === holderDoc);
  if (clash >= 0) {
    return {
      ok: false, code: "COMPANION_IS_HOLDER", message: DB_ERRORS.COMPANION_IS_HOLDER,
      fieldErrors: { [`companions.${clash}.documentNumber`]: "Es tu mismo documento" },
    };
  }

  let token: string;
  try {
    const [row] = await query<{ out_token: string }>(
      `select out_token from register_attendee($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, false)`,
      [
        d.eventDateId, inv.id, inv.full_name, email, phone, inv.document_type, inv.document_number,
        inv.employee_code, inv.company, null,
        JSON.stringify(d.companions.map((c) => ({
          full_name: c.fullName, document_type: c.documentType, document_number: c.documentNumber,
        }))),
      ],
    );
    token = row.out_token;
  } catch (err) {
    const msg = pgMessage(err);
    const code = Object.keys(DB_ERRORS).find((k) => msg.includes(k)) ?? "UNKNOWN";
    if (code === "DUPLICATE") {
      const existing = await activeRegistration(ctx.event_id, inv);
      if (existing) await resendExisting(existing.id, slug);
    }
    if (code === "UNKNOWN") console.error("[register_attendee]", err);
    return { ok: false, code, message: DB_ERRORS[code] ?? "No pudimos completar tu inscripción. Inténtalo nuevamente." };
  }

  await sendConfirmationEmail({
    to: email!, fullName: inv.full_name, eventName: ctx.name, eventSlug: slug, venue: ctx.venue,
    brandColor: ctx.primary_color, day: ctx.event_day, startsAt: ctx.starts_at, endsAt: ctx.ends_at,
    token, companionNames: d.companions.map((c) => c.fullName),
  });

  revalidatePath(`/evento/${slug}`);
  return { ok: true, token };
}
