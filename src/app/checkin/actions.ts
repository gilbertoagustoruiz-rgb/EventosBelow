"use server";

import { z } from "zod";
import { checkinAccess } from "@/lib/auth";
import { query, queryOne, transaction } from "@/lib/db";
import type { Registration } from "@/lib/types";

/** Estado visual de una validación */
export type LookupState =
  | "VALID" //            verde: puede ingresar (titular y/o acompañante pendiente)
  | "ALREADY_IN" //       rojo: todos ya ingresaron
  | "WRONG_DATE" //       rojo: registrado para otra fecha
  | "CANCELLED" //        rojo
  | "NOT_FOUND" //        rojo
  | "NO_ACCESS"; //       rojo: el enlace de acreditación fue revocado

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

const KEY = z.string().regex(/^[a-f0-9]{32}$/).optional();

const lookupSchema = z.object({
  eventId: z.string().uuid(),
  key: KEY,
  eventDateId: z.string().uuid(),
  token: z.string().optional(),
  registrationId: z.string().uuid().optional(),
});

/** Valida un QR escaneado o un registro elegido en la búsqueda. No modifica nada. */
export async function lookupRegistration(input: z.input<typeof lookupSchema>): Promise<LookupResult> {
  const { eventId, eventDateId, token, registrationId, key } = lookupSchema.parse(input);
  if (!(await checkinAccess(eventId, key))) return { state: "NO_ACCESS", person: null };

  let row: Row | null;
  if (registrationId) {
    row = await queryOne<Row>(`select ${COLUMNS} from registrations where event_id = $1 and id = $2`, [eventId, registrationId]);
  } else if (token && /^[a-f0-9]{32}$/i.test(token)) {
    row = await queryOne<Row>(`select ${COLUMNS} from registrations where event_id = $1 and token = $2`, [eventId, token.toLowerCase()]);
  } else {
    return { state: "NOT_FOUND", person: null };
  }
  if (!row) return { state: "NOT_FOUND", person: null };

  const state = evaluate(row, eventDateId);
  let registeredDay: string | undefined;
  if (state === "WRONG_DATE") {
    const d = await queryOne<{ event_day: string }>("select event_day from event_dates where id = $1", [row.event_date_id]);
    registeredDay = d?.event_day;
  }
  return { state, person: toPerson(row), registeredDay };
}

const searchSchema = z.object({ eventId: z.string().uuid(), key: KEY, q: z.string().trim().min(2).max(80) });

/** Búsqueda predictiva por DNI, nombre o correo (titular o acompañante) en todo el evento. */
/** Devuelve null si el enlace de acreditación ya no tiene acceso (revocado). */
export async function searchRegistrations(input: z.input<typeof searchSchema>): Promise<CheckinPerson[] | null> {
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return [];
  const { eventId, q, key } = parsed.data;
  if (!(await checkinAccess(eventId, key))) return null;

  // Escapa comodines de LIKE; los valores van parametrizados
  const term = q.replace(/[\\%_]/g, (c) => "\\" + c).replace(/\s+/g, " ").trim();
  if (!term) return [];
  const doc = q.toUpperCase().replace(/[^A-Z0-9]/g, "");

  const rows = await query<Row>(
    `select ${COLUMNS} from registrations
      where event_id = $1
        and (full_name ilike '%' || $2 || '%'
          or email ilike '%' || $2 || '%'
          or companion_full_name ilike '%' || $2 || '%'
          or ($3 <> '' and (document_number like $3 || '%' or companion_document_number like $3 || '%')))
      order by full_name
      limit 15`,
    [eventId, term, doc],
  );
  return rows.map(toPerson);
}

const checkInSchema = z.object({
  eventId: z.string().uuid(),
  key: KEY,
  eventDateId: z.string().uuid(),
  registrationId: z.string().uuid(),
  target: z.enum(["HOLDER", "COMPANION", "BOTH"]),
});

/** Marca el ingreso. La función SQL bloquea la fila y evita doble ingreso aunque dos anfitriones escaneen a la vez. */
export async function performCheckIn(input: z.input<typeof checkInSchema>): Promise<LookupResult> {
  const { eventId, eventDateId, registrationId, target, key } = checkInSchema.parse(input);
  const access = await checkinAccess(eventId, key);
  if (!access) return { state: "NO_ACCESS", person: null };
  const { userId } = access;

  // El registro debe pertenecer al evento autorizado
  const owns = await queryOne("select 1 from registrations where id = $1 and event_id = $2", [registrationId, eventId]);
  if (!owns) return { state: "NOT_FOUND", person: null };

  // Acreditación y auditoría en una sola transacción: nunca confirmar sin registrar al promotor.
  const res = await transaction(async client => {
    if (key) {
      const access = await client.query<{id:string}>(`select ep.id from event_promoters ep
        join promoters p on p.id=ep.promoter_id
        where ep.event_id=$1 and ep.access_key=$2 and ep.is_active and p.is_active
        for update of ep,p`,[eventId,key]);
      if (access.rows.length) {
        const result=await client.query<{r:{result:string}}>("select check_in($1,$2,$3,$4) as r",[registrationId,eventDateId,target,userId]);
        if(result.rows[0]?.r.result==="OK")await client.query("insert into promoter_checkins(promoter_id,registration_id,target) values($1,$2,$3)",[access.rows[0].id,registrationId,target]);
        return result.rows[0]??null;
      }
      // Conserva compatibilidad con el enlace general del evento.
      const legacy=await client.query("select 1 from events where id=$1 and checkin_key=$2",[eventId,key]);
      if (!legacy.rows.length) return { revoked: true as const };
    }
    const result=await client.query<{r:{result:string}}>("select check_in($1,$2,$3,$4) as r",[registrationId,eventDateId,target,userId]);
    return result.rows[0]??null;
  });
  // Revocado entre la validación y el ingreso: no se marcó nada
  if (res && "revoked" in res) return { state: "NO_ACCESS", person: null };

  const fresh = await lookupRegistration({ eventId, eventDateId, registrationId, key });
  return { ...fresh, justCheckedIn: res?.r.result === "OK" };
}

export interface DateStats {
  capacity: number;
  seatsTaken: number;
  registrations: number;
  peopleCheckedIn: number;
}

export async function getDateStats(eventId: string, eventDateId: string, key?: string): Promise<DateStats | null> {
  if (!/^[0-9a-f-]{36}$/i.test(eventDateId)) return null;
  if (!(await checkinAccess(eventId, key))) return null;
  const row = await queryOne<{ capacity: number; seats_taken: number; registrations: number; people_checked_in: number }>(
    `select capacity, seats_taken, registrations, people_checked_in
       from event_date_stats where event_date_id = $1 and event_id = $2`,
    [eventDateId, eventId],
  );
  if (!row) return null;
  return {
    capacity: row.capacity,
    seatsTaken: row.seats_taken,
    registrations: Number(row.registrations),
    peopleCheckedIn: Number(row.people_checked_in),
  };
}
