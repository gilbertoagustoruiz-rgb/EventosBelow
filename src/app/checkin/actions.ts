"use server";

import { z } from "zod";
import { requireEvent } from "@/lib/auth";
import type { Registration } from "@/lib/types";

/** Estado visual de una validación */
export type LookupState =
  | "VALID" //            verde: puede ingresar (titular y/o acompañante pendiente)
  | "ALREADY_IN" //       rojo: todos ya ingresaron
  | "WRONG_DATE" //       rojo: registrado para otra fecha
  | "CANCELLED" //        rojo
  | "NOT_FOUND"; //       rojo

export interface CheckinPerson {
  id: string;
  fullName: string;
  documentType: string;
  documentNumber: string;
  email: string;
  company: string | null;
  jobTitle: string | null;
  hasCompanion: boolean;
  companionFullName: string | null;
  companionDocumentNumber: string | null;
  holderCheckedInAt: string | null;
  companionCheckedInAt: string | null;
  eventDateId: string;
  status: Registration["status"];
}

export interface LookupResult {
  state: LookupState;
  person: CheckinPerson | null;
  /** Fecha real del registro cuando state = WRONG_DATE */
  registeredDay?: string;
  /** Se acaba de marcar un ingreso en esta operación */
  justCheckedIn?: boolean;
}

const COLUMNS =
  "id, event_date_id, full_name, document_type, document_number, email, company, job_title, has_companion, companion_full_name, companion_document_number, holder_checked_in_at, companion_checked_in_at, status";

type Row = Pick<
  Registration,
  | "id"
  | "event_date_id"
  | "full_name"
  | "document_type"
  | "document_number"
  | "email"
  | "company"
  | "job_title"
  | "has_companion"
  | "companion_full_name"
  | "companion_document_number"
  | "holder_checked_in_at"
  | "companion_checked_in_at"
  | "status"
>;

function toPerson(r: Row): CheckinPerson {
  return {
    id: r.id,
    fullName: r.full_name,
    documentType: r.document_type,
    documentNumber: r.document_number,
    email: r.email,
    company: r.company,
    jobTitle: r.job_title,
    hasCompanion: r.has_companion,
    companionFullName: r.companion_full_name,
    companionDocumentNumber: r.companion_document_number,
    holderCheckedInAt: r.holder_checked_in_at,
    companionCheckedInAt: r.companion_checked_in_at,
    eventDateId: r.event_date_id,
    status: r.status,
  };
}

function evaluate(r: Row, eventDateId: string): LookupState {
  if (r.status === "CANCELADO") return "CANCELLED";
  if (r.event_date_id !== eventDateId) return "WRONG_DATE";
  const holderPending = !r.holder_checked_in_at;
  const companionPending = r.has_companion && !r.companion_checked_in_at;
  return holderPending || companionPending ? "VALID" : "ALREADY_IN";
}

const lookupSchema = z.object({
  eventId: z.string().uuid(),
  eventDateId: z.string().uuid(),
  token: z.string().optional(),
  registrationId: z.string().uuid().optional(),
});

/** Valida un QR escaneado o un registro elegido en la búsqueda. No modifica nada. */
export async function lookupRegistration(input: z.input<typeof lookupSchema>): Promise<LookupResult> {
  const { eventId, eventDateId, token, registrationId } = lookupSchema.parse(input);
  const { supabase } = await requireEvent(eventId, "host");

  let query = supabase.from("registrations").select(COLUMNS).eq("event_id", eventId);
  if (registrationId) query = query.eq("id", registrationId);
  else if (token && /^[a-f0-9]{32}$/i.test(token)) query = query.eq("token", token.toLowerCase());
  else return { state: "NOT_FOUND", person: null };

  const { data } = await query.maybeSingle<Row>();
  if (!data) return { state: "NOT_FOUND", person: null };

  const state = evaluate(data, eventDateId);
  let registeredDay: string | undefined;
  if (state === "WRONG_DATE") {
    const { data: d } = await supabase.from("event_dates").select("event_day").eq("id", data.event_date_id).single();
    registeredDay = d?.event_day;
  }
  return { state, person: toPerson(data), registeredDay };
}

const searchSchema = z.object({ eventId: z.string().uuid(), q: z.string().trim().min(2).max(80) });

/** Búsqueda predictiva por DNI, nombre o correo (titular o acompañante) en todo el evento. */
export async function searchRegistrations(input: z.input<typeof searchSchema>): Promise<CheckinPerson[]> {
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return [];
  const { eventId, q } = parsed.data;
  const { supabase } = await requireEvent(eventId, "host");

  // Escapa comodines y separadores del filtro .or() de PostgREST
  const term = q.replace(/[%_,()"\\]/g, " ").replace(/\s+/g, " ").trim();
  if (!term) return [];
  const doc = term.toUpperCase().replace(/[\s.-]/g, "");

  const filters = [
    `full_name.ilike."%${term}%"`,
    `email.ilike."%${term}%"`,
    `companion_full_name.ilike."%${term}%"`,
  ];
  if (doc) filters.push(`document_number.ilike.${doc}%`, `companion_document_number.ilike.${doc}%`);

  const { data } = await supabase
    .from("registrations")
    .select(COLUMNS)
    .eq("event_id", eventId)
    .or(filters.join(","))
    .order("full_name")
    .limit(15)
    .returns<Row[]>();

  return (data ?? []).map(toPerson);
}

const checkInSchema = z.object({
  eventId: z.string().uuid(),
  eventDateId: z.string().uuid(),
  registrationId: z.string().uuid(),
  target: z.enum(["HOLDER", "COMPANION", "BOTH"]),
});

/** Marca el ingreso. La función SQL bloquea la fila y evita doble ingreso aunque dos anfitriones escaneen a la vez. */
export async function performCheckIn(input: z.input<typeof checkInSchema>): Promise<LookupResult> {
  const { eventId, eventDateId, registrationId, target } = checkInSchema.parse(input);
  const { supabase } = await requireEvent(eventId, "host");

  const { data, error } = await supabase.rpc("check_in", {
    p_registration_id: registrationId,
    p_event_date_id: eventDateId,
    p_target: target,
  });
  if (error) throw new Error("No se pudo registrar el ingreso");

  const fresh = await lookupRegistration({ eventId, eventDateId, registrationId });
  return { ...fresh, justCheckedIn: (data as { result: string }).result === "OK" };
}

export interface DateStats {
  capacity: number;
  seatsTaken: number;
  registrations: number;
  peopleCheckedIn: number;
}

export async function getDateStats(eventId: string, eventDateId: string): Promise<DateStats | null> {
  const { supabase } = await requireEvent(eventId, "host");
  const { data } = await supabase
    .from("event_date_stats")
    .select("capacity, seats_taken, registrations, people_checked_in")
    .eq("event_date_id", eventDateId)
    .maybeSingle();
  if (!data) return null;
  return {
    capacity: data.capacity,
    seatsTaken: data.seats_taken,
    registrations: Number(data.registrations),
    peopleCheckedIn: Number(data.people_checked_in),
  };
}
