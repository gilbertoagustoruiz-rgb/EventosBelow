"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { pgMessage, query, queryOne } from "@/lib/db";
import { createRateLimiter } from "@/lib/rate-limit";
import { companionSchema, documentIssue, flattenErrors } from "@/lib/validation";

/* Regularizar la confirmación desde el ticket: agregar o quitar acompañantes.
 * El token del ticket identifica la inscripción (es lo que tiene el invitado). */

export type CompanionResult = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };

const limiter = createRateLimiter(20, 10 * 60_000);
const TOKEN = /^[a-f0-9]{32}$/;
const UUID = /^[0-9a-f-]{36}$/i;

const ERRORS: Record<string, string> = {
  TOO_MANY_COMPANIONS: "Ya registraste el máximo de acompañantes permitido para este evento.",
  SOLD_OUT: "Ya no quedan cupos en tu fecha para agregar un acompañante.",
  COMPANION_IS_HOLDER: "El acompañante no puede tener tu mismo documento.",
  COMPANION_DUPLICATE: "Ese acompañante ya está registrado en tu confirmación.",
  COMPANION_REQUIRED: "Este evento requiere al menos un acompañante.",
  ALREADY_CHECKED_IN: "Ese acompañante ya ingresó al evento; no se puede quitar.",
  EVENT_CLOSED: "Las confirmaciones de este evento están cerradas.",
  DATE_PAST: "La fecha de tu evento ya pasó.",
  CANCELLED: "Esta confirmación fue cancelada.",
  NOT_FOUND: "No encontramos tu confirmación.",
};

async function guard(token: string) {
  if (!TOKEN.test(token)) return null;
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!limiter.consume(ip)) return "LIMITED" as const;
  return queryOne<{ id: string; slug: string }>(
    "select r.id, e.slug from registrations r join events e on e.id = r.event_id where r.token = $1",
    [token],
  );
}

function fail(err: unknown): CompanionResult {
  const msg = pgMessage(err);
  const code = Object.keys(ERRORS).find((k) => msg.includes(k));
  if (!code) console.error("[companion]", err);
  return { ok: false, message: code ? ERRORS[code] : "No se pudo guardar el cambio. Inténtalo nuevamente." };
}

export async function addCompanion(token: string, input: { fullName: string; documentType: string; documentNumber: string }): Promise<CompanionResult> {
  const reg = await guard(token);
  if (reg === "LIMITED") return { ok: false, message: "Demasiados intentos. Espera unos minutos." };
  if (!reg) return { ok: false, message: ERRORS.NOT_FOUND };

  const parsed = companionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  const c = parsed.data;
  const issue = documentIssue(c.documentType, c.documentNumber);
  if (issue) return { ok: false, fieldErrors: { documentNumber: issue } };

  try {
    await query("select add_companion($1, $2, $3, $4)", [reg.id, c.fullName, c.documentType, c.documentNumber]);
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/evento/${reg.slug}/ticket/${token}`);
  return { ok: true, message: `Listo: ${c.fullName} ya figura como tu acompañante.` };
}

export async function removeCompanion(token: string, companionId: string): Promise<CompanionResult> {
  if (!UUID.test(companionId)) return { ok: false, message: ERRORS.NOT_FOUND };
  const reg = await guard(token);
  if (reg === "LIMITED") return { ok: false, message: "Demasiados intentos. Espera unos minutos." };
  if (!reg) return { ok: false, message: ERRORS.NOT_FOUND };
  try {
    await query("select remove_companion($1, $2)", [reg.id, companionId]);
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/evento/${reg.slug}/ticket/${token}`);
  return { ok: true, message: "Acompañante quitado. Se liberó su cupo." };
}
