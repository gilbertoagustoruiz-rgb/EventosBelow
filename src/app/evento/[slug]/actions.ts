"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const db = createAdminClient();

  // La fecha debe pertenecer al evento del slug (evita registrar en eventos ajenos)
  const { data: date } = await db
    .from("event_dates")
    .select("id, event_day, starts_at, ends_at, events!inner(id, slug, name, venue, primary_color)")
    .eq("id", d.eventDateId)
    .eq("events.slug", slug)
    .maybeSingle();
  if (!date) return { ok: false, code: "DATE_NOT_FOUND", message: DB_ERRORS.DATE_NOT_FOUND };

  const { data, error } = await db
    .rpc("register_attendee", {
      p_event_date_id: d.eventDateId,
      p_full_name: d.fullName,
      p_email: d.email,
      p_phone: d.phone,
      p_document_type: d.documentType,
      p_document_number: d.documentNumber,
      p_company: d.company ?? null,
      p_job_title: d.jobTitle ?? null,
      p_has_companion: d.hasCompanion,
      p_companion_full_name: d.hasCompanion ? d.companionFullName : null,
      p_companion_document_type: d.hasCompanion ? d.companionDocumentType : null,
      p_companion_document_number: d.hasCompanion ? d.companionDocumentNumber : null,
    })
    .single<{ out_registration_id: string; out_token: string }>();

  if (error || !data) {
    const code = Object.keys(DB_ERRORS).find((k) => error?.message?.includes(k)) ?? "UNKNOWN";
    if (code === "UNKNOWN") console.error("[register_attendee]", error);
    return { ok: false, code, message: DB_ERRORS[code] ?? "No pudimos completar tu registro. Inténtalo nuevamente." };
  }

  const event = date.events as unknown as { slug: string; name: string; venue: string | null; primary_color: string };
  await sendConfirmationEmail({
    to: d.email,
    fullName: d.fullName,
    eventName: event.name,
    eventSlug: event.slug,
    venue: event.venue,
    brandColor: event.primary_color,
    day: date.event_day,
    startsAt: date.starts_at,
    endsAt: date.ends_at,
    token: data.out_token,
    companionName: d.hasCompanion ? (d.companionFullName ?? null) : null,
  });

  revalidatePath(`/evento/${slug}`);
  return { ok: true, token: data.out_token };
}
