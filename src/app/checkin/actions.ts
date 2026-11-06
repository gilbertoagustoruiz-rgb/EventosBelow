"use server";

import { z } from "zod";
import { checkinAccess } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import type { Registration } from "@/lib/types";

/** Estado visual de una validación */
export type LookupState =
  | "VALID" //            verde: hay personas pendientes de ingresar
  | "ALREADY_IN" //       rojo: todos ya ingresaron (se muestra a qué hora)
  | "WRONG_DATE" //       rojo: registrado para otra fecha
  | "CANCELLED" //        rojo
  | "NOT_FOUND" //        rojo
  | "NO_ACCESS"; //       rojo: el enlace de acreditación ya no es válido

export interface CheckinCompanion {
  id: string;
  fullName: string;
  documentType: string;
  documentNumber: string;
  checkedInAt: string | null;
}

export interface CheckinPerson {
  id: string;
  fullName: string;
  documentType: string;
  documentNumber: string;
  employeeCode: string | null;
  email: string | null;
  company: string | null;
  jobTitle: string | null;
  holderCheckedInAt: string | null;
  companions: CheckinCompanion[];
  eventDateId: string;
  status: Registration["status"];
}

export interface LookupResult {
  state: LookupState;
  person: CheckinPerson | null;
  /** Fecha real del registro cuando state = WRONG_DATE */
  registeredDay?: string;
  /** Personas que ingresaron en esta operación */
  justCheckedIn?: number;
}

/** Inscripción + acompañantes (json) */
const SELECT = `
  select r.id, r.event_date_id, r.full_name, r.document_type, r.document_number, r.employee_code, r.email,
         r.company, r.job_title, r.holder_checked_in_at, r.status,
         coalesce((select json_agg(json_build_object(
                     'id', c.id, 'fullName', c.full_name, 'documentType', c.document_type,
                     'documentNumber', c.document_number, 'checkedInAt', c.checked_in_at) order by c.position)
                     from companions c where c.registration_id = r.id), '[]') as companions
    from registrations r`;

type Row = Pick<
  Registration,
  | "id"
  | "event_date_id"
  | "full_name"
  | "document_type"
  | "document_number"
  | "employee_code"
  | "email"
  | "company"
  | "job_title"
  | "holder_checked_in_at"
  | "status"
> & { companions: CheckinCompanion[] };

function toPerson(r: Row): CheckinPerson {
  return {
    id: r.id,
    fullName: r.full_name,
    documentType: r.document_type,
    documentNumber: r.document_number,
    employeeCode: r.employee_code,
    email: r.email,
    company: r.company,
    jobTitle: r.job_title,
    holderCheckedInAt: r.holder_checked_in_at,
    companions: r.companions.map((c) => ({
      ...c,
      checkedInAt: c.checkedInAt ? new Date(c.checkedInAt).toISOString() : null,
    })),
    eventDateId: r.event_date_id,
    status: r.status,
  };
}

function evaluate(r: Row, eventDateId: string): LookupState {
  if (r.status === "CANCELADO") return "CANCELLED";
  if (r.event_date_id !== eventDateId) return "WRONG_DATE";
  const pending = !r.holder_checked_in_at || r.companions.some((c) => !c.checkedInAt);
  return pending ? "VALID" : "ALREADY_IN";
}

const LOG_RESULT: Partial<Record<LookupState, string>> = {
  ALREADY_IN: "YA_INGRESO",
  WRONG_DATE: "FECHA_INCORRECTA",
  CANCELLED: "CANCELADO",
  NOT_FOUND: "NO_ENCONTRADO",
};

const KEY = z.string().regex(/^[a-f0-9]{32}$/).optional();
const METHOD = z.enum(["QR", "DOCUMENTO", "BUSQUEDA"]).default("BUSQUEDA");

const lookupSchema = z.object({
  eventId: z.string().uuid(),
  key: KEY,
  eventDateId: z.string().uuid(),
  token: z.string().optional(),
  registrationId: z.string().uuid().optional(),
  /** DNI / documento (titular o acompañante) o código de vendedor, búsqueda exacta */
  code: z.string().trim().max(40).optional(),
  method: METHOD,
});

/**
 * Valida un QR, un documento / código de vendedor exacto o un registro elegido en la búsqueda.
 * No marca ingresos. Las lecturas por QR o documento quedan en la bitácora (incluidas las alertas).
 */
export async function lookupRegistration(input: z.input<typeof lookupSchema>): Promise<LookupResult> {
  const { eventId, eventDateId, token, registrationId, code, method, key } = lookupSchema.parse(input);
  const access = await checkinAccess(eventId, key);
  if (!access) return { state: "NO_ACCESS", person: null };

  let row: Row | null = null;
  if (registrationId) {
    row = await queryOne<Row>(`${SELECT} where r.event_id = $1 and r.id = $2`, [eventId, registrationId]);
  } else if (token && /^[a-f0-9]{32}$/i.test(token)) {
    row = await queryOne<Row>(`${SELECT} where r.event_id = $1 and r.token = $2`, [eventId, token.toLowerCase()]);
  } else if (code) {
    const doc = code.toUpperCase().replace(/[\s.-]/g, "");
    // Prioriza inscripciones activas de la fecha seleccionada
    row = await queryOne<Row>(
      `${SELECT}
        where r.event_id = $1
          and (r.document_number = $2 or upper(r.employee_code) = upper($3)
               or regexp_replace(upper(r.employee_code), '[[:space:].-]', '', 'g') = $2
               or exists (select 1 from companions c where c.registration_id = r.id and c.document_number = $2))
        order by (r.status = 'CANCELADO'), (r.event_date_id <> $4), r.created_at desc
        limit 1`,
      [eventId, doc, code.trim(), eventDateId],
    );
  }

  const state: LookupState = row ? evaluate(row, eventDateId) : "NOT_FOUND";

  // Bitácora de lecturas en el ingreso (no de búsquedas por nombre)
  if (method !== "BUSQUEDA" && LOG_RESULT[state]) {
    await query(
      `insert into checkin_log (event_id, event_date_id, registration_id, employee_id, result, method, detail)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [eventId, eventDateId, row?.id ?? null, access.employeeId, LOG_RESULT[state], method, row ? null : maskCode(code ?? "QR")],
    );
  }

  if (!row) return { state: "NOT_FOUND", person: null };
  let registeredDay: string | undefined;
  if (state === "WRONG_DATE") {
    const d = await queryOne<{ event_day: string }>("select event_day from event_dates where id = $1", [row.event_date_id]);
    registeredDay = d?.event_day;
  }
  return { state, person: toPerson(row), registeredDay };
}

/** "12345678" → "•••••678" (la bitácora no guarda documentos de personas no inscritas) */
function maskCode(v: string) {
  const s = v.trim();
  return s.length <= 3 ? s : "•".repeat(Math.min(s.length - 3, 6)) + s.slice(-3);
}

const searchSchema = z.object({ eventId: z.string().uuid(), key: KEY, q: z.string().trim().min(2).max(80) });

/**
 * Búsqueda predictiva por nombre, correo, documento o código de vendedor (titular o acompañantes).
 * Devuelve null si el enlace de acreditación ya no tiene acceso.
 */
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
    `${SELECT}
      where r.event_id = $1
        and (r.full_name ilike '%' || $2 || '%'
          or r.email ilike '%' || $2 || '%'
          or ($3 <> '' and (r.document_number like $3 || '%' or upper(r.employee_code) like $3 || '%'))
          or exists (select 1 from companions c where c.registration_id = r.id
                      and (c.full_name ilike '%' || $2 || '%' or ($3 <> '' and c.document_number like $3 || '%'))))
      order by r.full_name
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
  holder: z.boolean(),
  companionIds: z.array(z.string().uuid()).max(10).default([]),
  method: METHOD,
});

/**
 * Marca el ingreso del titular y/o de los acompañantes elegidos. La función SQL bloquea la fila,
 * evita el doble ingreso aunque dos promotores lean el mismo QR y registra quién acreditó.
 */
export async function performCheckIn(input: z.input<typeof checkInSchema>): Promise<LookupResult> {
  const { eventId, eventDateId, registrationId, holder, companionIds, method, key } = checkInSchema.parse(input);
  const access = await checkinAccess(eventId, key);
  if (!access) return { state: "NO_ACCESS", person: null };

  // El registro debe pertenecer al evento autorizado
  const owns = await queryOne("select 1 from registrations where id = $1 and event_id = $2", [registrationId, eventId]);
  if (!owns) return { state: "NOT_FOUND", person: null };

  const res = await queryOne<{ r: { result: string; persons?: number } }>(
    "select check_in($1, $2, $3, $4::uuid[], $5, $6, $7) as r",
    [registrationId, eventDateId, holder, companionIds, access.userId, access.employeeId, method],
  );

  const fresh = await lookupRegistration({ eventId, eventDateId, registrationId, key });
  return { ...fresh, justCheckedIn: res?.r.result === "OK" ? (res.r.persons ?? 1) : 0 };
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
