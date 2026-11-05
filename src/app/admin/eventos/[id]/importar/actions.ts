"use server";

import ExcelJS from "exceljs";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireEvent } from "@/lib/auth";
import { pgMessage, query, queryOne, transaction } from "@/lib/db";
import { sendConfirmationEmail } from "@/lib/email";
import { registrationSchema } from "@/lib/validation";
import type { CompanionMode } from "@/lib/types";

type Row = {
  line: number;
  name: string;
  email: string;
  phone: string;
  documentType: string;
  document: string;
  company: string;
  jobTitle: string;
  companionName: string;
  companionType: string;
  companionDocument: string;
  errors: string[];
};

export type ImportResult = {
  ok: boolean;
  message: string;
  valid: number;
  invalid: number;
  duplicates: number;
  imported: number;
  emailed: number;
  preview: Row[];
};

const empty = (message: string): ImportResult => ({
  ok: false,
  message,
  valid: 0,
  invalid: 0,
  duplicates: 0,
  imported: 0,
  emailed: 0,
  preview: [],
});

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_ROWS = 2000;
const MAX_BYTES = 3 * 1024 * 1024;

/** Encabezados reconocidos. Se comparan en forma canónica (ver `canonical`). */
const aliases: Record<string, string[]> = {
  name: ["nombre", "nombres", "nombre completo", "nombres y apellidos", "apellidos y nombres", "asistente", "participante", "full name", "name"],
  email: ["correo", "correo electronico", "email", "e mail", "mail"],
  phone: ["celular", "telefono", "telefono celular", "movil", "numero celular", "whatsapp", "phone"],
  document: ["dni", "documento", "documento identidad", "doc", "cedula", "pasaporte", "ce", "document number"],
  documentType: ["tipo documento", "tipo doc"],
  company: ["empresa", "organizacion", "compania", "razon social", "company"],
  jobTitle: ["cargo", "puesto", "job title"],
  companionName: ["acompanante", "nombre acompanante", "acompanante nombre"],
  companionType: ["tipo documento acompanante", "tipo doc acompanante"],
  companionDocument: ["documento acompanante", "dni acompanante"],
};

// Palabras que no aportan: "N° de Documento", "Nro. DNI", "Número del documento" → "documento" / "dni"
const STOP = new Set(["n", "no", "nro", "num", "numero", "de", "del", "la", "el", "y", "o"]);

/** Sin tildes, símbolos (°, º, #, .) ni palabras de relleno; "y" se conserva solo en el alias original. */
const canonical = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .join(" ");

const canonicalAliases = Object.fromEntries(
  Object.entries(aliases).map(([key, list]) => [key, new Set(list.map(canonical))]),
) as Record<string, Set<string>>;

function cell(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("text" in v) return String(v.text ?? "").trim();
    if ("result" in v) return String(v.result ?? "").trim();
    if ("richText" in v) return v.richText.map((x) => x.text).join("").trim();
    return "";
  }
  return String(v).trim();
}

const DB_ROW_ERRORS: Record<string, string> = {
  DUPLICATE: "Ya inscrito en esta fecha",
  COMPANION_REQUIRED: "El evento exige acompañante",
  COMPANION_NOT_ALLOWED: "El evento no admite acompañante",
};

async function parse(fd: FormData) {
  const eventId = String(fd.get("eventId") ?? "");
  const dateId = String(fd.get("dateId") ?? "");
  const { event } = await requireEvent(eventId, "admin");
  if (!UUID.test(dateId)) throw Error("Selecciona una fecha válida del evento.");

  const date = await queryOne<{ id: string; capacity: number; registered_count: number }>(
    "select id, capacity, registered_count from event_dates where id = $1 and event_id = $2",
    [dateId, eventId],
  );
  if (!date) throw Error("Selecciona una fecha válida del evento.");

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES || !/\.xlsx$/i.test(file.name)) {
    throw Error("Adjunta un Excel .xlsx de máximo 3 MB.");
  }

  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
  } catch {
    throw Error("No se pudo leer el archivo. Guárdalo como Excel (.xlsx) e inténtalo otra vez.");
  }
  const sheet = book.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw Error("El archivo no contiene registros.");
  if (sheet.rowCount > MAX_ROWS + 1) throw Error(`Máximo ${MAX_ROWS.toLocaleString("es-PE")} filas por archivo.`);

  const headers = sheet.getRow(1).values as ExcelJS.CellValue[];
  const mapping: Record<string, number> = {};
  for (const [key, options] of Object.entries(canonicalAliases)) {
    const ix = headers.findIndex((v, i) => i > 0 && options.has(canonical(cell(v))));
    if (ix > 0) mapping[key] = ix;
  }
  if (!mapping.name || !mapping.document) {
    throw Error("No se identificaron las columnas Nombre y Documento/DNI en la primera fila.");
  }

  const companionMode = event.companion_mode as CompanionMode;
  const rows: Row[] = [];
  const seen = new Set<string>();

  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const get = (key: string) => (mapping[key] ? cell(row.getCell(mapping[key]).value) : "");
    const name = get("name");
    const document = get("document").toUpperCase().replace(/[\s.-]/g, "");
    if (!name && !document) continue;

    const documentType = (get("documentType") || (/^[0-9]{8}$/.test(document) ? "DNI" : "CE")).toUpperCase();
    const companionName = get("companionName");
    const companionDocument = get("companionDocument");
    const companionType = (get("companionType") || "DNI").toUpperCase();

    const validation = registrationSchema.safeParse({
      eventDateId: dateId,
      fullName: name,
      email: get("email"),
      phone: get("phone"),
      documentType,
      documentNumber: document,
      company: get("company"),
      jobTitle: get("jobTitle"),
      hasCompanion: !!companionName,
      companionFullName: companionName,
      companionDocumentType: companionType,
      companionDocumentNumber: companionDocument,
    });
    const errors = validation.success ? [] : [...new Set(validation.error.issues.map((e) => e.message))];

    // Reglas de acompañante del evento: se informan por fila en la vista previa
    if (companionMode === "NONE" && companionName) errors.push(DB_ROW_ERRORS.COMPANION_NOT_ALLOWED);
    if (companionMode === "REQUIRED" && !companionName) errors.push(DB_ROW_ERRORS.COMPANION_REQUIRED);

    const unique = documentType + ":" + document;
    if (seen.has(unique)) errors.push("Documento duplicado dentro del Excel");
    seen.add(unique);

    rows.push({
      line: i,
      name,
      email: validation.success ? validation.data.email : get("email"),
      phone: get("phone"),
      documentType,
      document,
      company: get("company"),
      jobTitle: get("jobTitle"),
      companionName,
      companionType,
      companionDocument,
      errors,
    });
  }
  if (rows.length === 0) throw Error("El archivo no contiene registros.");

  return { event, eventId, dateId, date, rows };
}

export async function previewImport(_: ImportResult, fd: FormData): Promise<ImportResult> {
  try {
    const { eventId, dateId, date, rows } = await parse(fd);
    const existing = await query<{ document_type: string; document_number: string }>(
      `select document_type, document_number from registrations
        where event_id = $1 and event_date_id = $2 and status <> 'CANCELADO'`,
      [eventId, dateId],
    );
    const used = new Set(existing.map((r) => r.document_type + ":" + r.document_number));

    let duplicates = 0;
    for (const row of rows) {
      if (used.has(row.documentType + ":" + row.document)) {
        row.errors.push(DB_ROW_ERRORS.DUPLICATE);
        duplicates++;
      }
    }

    const validRows = rows.filter((r) => !r.errors.length);
    const seats = validRows.reduce((n, r) => n + (r.companionName ? 2 : 1), 0);
    const free = date.capacity - date.registered_count;

    return {
      ok: true,
      message:
        seats > free
          ? `Atención: las filas válidas necesitan ${seats} cupos y solo quedan ${free}. Amplía el aforo de la fecha o reduce el archivo; si confirmas así, no se importará ninguna fila.`
          : "Vista previa lista. Confirma para importar solo las filas válidas.",
      valid: validRows.length,
      invalid: rows.length - validRows.length,
      duplicates,
      imported: 0,
      emailed: 0,
      preview: rows.slice(0, 100),
    };
  } catch (e) {
    return empty(e instanceof Error ? e.message : "No se pudo leer el Excel.");
  }
}

export async function commitImport(_: ImportResult, fd: FormData): Promise<ImportResult> {
  try {
    const { event, eventId, dateId, rows } = await parse(fd);
    const sendTickets = fd.get("sendTickets") === "on";
    const invalid = rows.filter((r) => r.errors.length).length;
    let duplicates = 0;
    const created: { token: string; row: Row }[] = [];

    // Cada fila usa la misma función de inscripción (aforo y duplicados) en modo administrador:
    // no exige que el evento esté publicado ni abierto. Toda la carga es una sola transacción.
    await transaction(async (client) => {
      for (const r of rows) {
        if (r.errors.length) continue;
        try {
          await client.query("savepoint import_row");
          const res = await client.query<{ out_token: string }>(
            "select out_token from register_attendee($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)",
            [
              dateId,
              r.name,
              r.email,
              r.phone,
              r.documentType,
              r.document,
              r.company || null,
              r.jobTitle || null,
              !!r.companionName,
              r.companionName || null,
              r.companionName ? r.companionType : null,
              r.companionName ? r.companionDocument : null,
            ],
          );
          await client.query("release savepoint import_row");
          created.push({ token: res.rows[0].out_token, row: r });
        } catch (e) {
          await client.query("rollback to savepoint import_row");
          await client.query("release savepoint import_row");
          const message = pgMessage(e);
          if (message.includes("DUPLICATE")) duplicates++;
          else if (message.includes("SOLD_OUT")) throw Error("Aforo insuficiente: no se importó ninguna fila. Amplía el aforo de la fecha e inténtalo de nuevo.");
          else throw e;
        }
      }
    });

    // Tickets por correo después de responder (no bloquea la pantalla del administrador)
    if (sendTickets && created.length) {
      const date = await queryOne<{ event_day: string; starts_at: string; ends_at: string }>(
        "select event_day, starts_at::text, ends_at::text from event_dates where id = $1",
        [dateId],
      );
      after(async () => {
        const queue = [...created];
        const worker = async () => {
          for (let item = queue.shift(); item; item = queue.shift()) {
            await sendConfirmationEmail({
              to: item.row.email,
              fullName: item.row.name,
              eventName: event.name,
              eventSlug: event.slug,
              venue: event.venue,
              brandColor: event.primary_color,
              day: date!.event_day,
              startsAt: date!.starts_at,
              endsAt: date!.ends_at,
              token: item.token,
              companionName: item.row.companionName || null,
            });
          }
        };
        await Promise.all(Array.from({ length: 4 }, worker));
      });
    }

    revalidatePath("/admin/eventos/" + eventId);
    return {
      ok: true,
      message: sendTickets
        ? "Importación completada. Los tickets QR se están enviando por correo."
        : "Importación completada. Los asistentes importados ya tienen ticket QR y aparecen en inscripciones.",
      valid: created.length,
      invalid,
      duplicates,
      imported: created.length,
      emailed: sendTickets ? created.length : 0,
      preview: [],
    };
  } catch (e) {
    console.error("[commitImport]", e);
    const msg = e instanceof Error ? e.message : "";
    // Mensajes propios se muestran; errores internos de la base no
    return empty(/^[A-ZÁÉÍÓÚ]/.test(msg) && !/^[A-Z_]+$/.test(msg) ? msg : "Error al importar. No se guardó ningún cambio.");
  }
}
