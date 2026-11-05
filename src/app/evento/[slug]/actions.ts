"use server";

import { revalidatePath } from "next/cache";
import { pgMessage, query, queryOne } from "@/lib/db";
import { sendConfirmationEmail } from "@/lib/email";
import { flattenErrors, registrationSchema, type RegistrationInput } from "@/lib/validation";

export type RegisterResult =
  | { ok: true; token: string }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };

const DB_ERRORS: Record<string, string> = {
  SOLD_OUT: "Se agotaron los cupos para esta fecha mientras completabas el formulario. Elige otra fecha.",
  DUPLICATE: "Ya existe un registro con este documento para la fecha elegida. Revisa tu correo.",
  EVENT_CLOSED: "Las inscripciones para este evento están cerradas.",
  DATE_PAST: "Esta fecha ya pasó.",
  DATE_NOT_FOUND: "La fecha seleccionada ya no está disponible.",
  COMPANION_REQUIRED: "Este evento requiere registrar un acompañante.",
  COMPANION_NOT_ALLOWED: "Este evento no admite acompañantes.",
};

export async function registerAttendee(slug: string, input: RegistrationInput): Promise<RegisterResult> {
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION", message: "Revisa los campos marcados.", fieldErrors: flattenErrors(parsed.error) };
  }
  const d = parsed.data;

  // La fecha debe pertenecer al evento del slug (evita registrar en eventos ajenos)
  const date = await queryOne<{
    event_day: string;
    starts_at: string;
    ends_at: string;
    slug: string;
    name: string;
    venue: string | null;
    primary_color: string;
  }>(
    `select d.event_day, d.starts_at::text, d.ends_at::text, e.slug, e.name, e.venue, e.primary_color
       from event_dates d join events e on e.id = d.event_id
      where d.id = $1 and e.slug = $2`,
    [d.eventDateId, slug],
  );
  if (!date) return { ok: false, code: "DATE_NOT_FOUND", message: DB_ERRORS.DATE_NOT_FOUND };

  let token: string;
  try {
    const [row] = await query<{ out_token: string }>(
      `select out_token from register_attendee($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        d.eventDateId,
        d.fullName,
        d.email,
        d.phone,
        d.documentType,
        d.documentNumber,
        d.company ?? null,
        d.jobTitle ?? null,
        d.hasCompanion,
        d.hasCompanion ? d.companionFullName : null,
        d.hasCompanion ? d.companionDocumentType : null,
        d.hasCompanion ? d.companionDocumentNumber : null,
      ],
    );
    token = row.out_token;
  } catch (err) {
    const msg = pgMessage(err);
    const code = Object.keys(DB_ERRORS).find((k) => msg.includes(k)) ?? "UNKNOWN";
    if (code === "UNKNOWN") console.error("[register_attendee]", err);
    return { ok: false, code, message: DB_ERRORS[code] ?? "No pudimos completar tu registro. Inténtalo nuevamente." };
  }

  await sendConfirmationEmail({
    to: d.email,
    fullName: d.fullName,
    eventName: date.name,
    eventSlug: date.slug,
    venue: date.venue,
    brandColor: date.primary_color,
    day: date.event_day,
    startsAt: date.starts_at,
    endsAt: date.ends_at,
    token,
    companionName: d.hasCompanion ? (d.companionFullName ?? null) : null,
  });

  revalidatePath(`/evento/${slug}`);
  return { ok: true, token };
}
