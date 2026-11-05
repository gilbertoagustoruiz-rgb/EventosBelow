"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { requireEvent } from "@/lib/auth";
import { pgCode, query, transaction } from "@/lib/db";
import { DOCUMENT_TYPES, documentIssue } from "@/lib/validation";

/* Carga de la base de invitados del evento (lista precargada).
 * Los asistentes luego confirman su día con su DNI o código de vendedor. */

type Row = {
  line: number;
  name: string;
  documentType: string;
  document: string;
  code: string;
  email: string;
  phone: string;
  company: string;
  jobTitle: string;
  /** Fecha de asistencia tal como vino (dd/mm/aaaa) y la fecha del evento que le corresponde */
  dateText: string;
  dateId: string | null;
  errors: string[];
  exists?: boolean;
};

/** Qué columna del Excel se usó para cada dato y cuáles se ignoraron. */
export type ColumnReport = { used: { field: string; header: string }[]; ignored: string[] };

export type ImportResult = {
  ok: boolean;
  message: string;
  valid: number;
  invalid: number;
  updates: number;
  imported: number;
  preview: Row[];
  columns?: ColumnReport;
};

const empty = (message: string): ImportResult => ({ ok: false, message, valid: 0, invalid: 0, updates: 0, imported: 0, preview: [] });

const FIELD_LABELS: Record<string, string> = {
  name: "Nombre", document: "Documento", documentType: "Tipo de documento", code: "Código",
  email: "Correo", phone: "Celular", company: "Empresa", jobTitle: "Cargo", date: "Fecha de asistencia",
};

const MAX_ROWS = 5000;
const MAX_BYTES = 5 * 1024 * 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9\s-]{7,20}$/;

/** Encabezados reconocidos. Se comparan en forma canónica (ver `canonical`). */
const aliases: Record<string, string[]> = {
  name: ["nombre", "nombres", "nombre completo", "nombres y apellidos", "apellidos y nombres", "asistente", "participante", "invitado", "full name", "name"],
  document: ["dni", "documento", "documento identidad", "doc", "cedula", "pasaporte", "ce", "document number"],
  documentType: ["tipo documento", "tipo doc"],
  code: [
    "codigo", "codigo vendedor", "codigo empleado", "codigo asesor", "codigo trabajador", "codigo colaborador", "codigo rh",
    "cod", "cod vendedor", "cod empleado", "cod asesor", "cod rh", "vendedor", "id", "id rh", "id empleado", "id vendedor",
    "id trabajador", "id colaborador", "rh", "employee code", "employee id", "seller code",
  ],
  date: ["fecha", "fecha asistencia", "dia asistencia", "fecha evento", "fecha participacion", "dia", "fecha ingreso evento"],
  email: ["correo", "correo electronico", "email", "e mail", "mail"],
  phone: ["celular", "telefono", "telefono celular", "movil", "numero celular", "whatsapp", "phone"],
  company: ["empresa", "organizacion", "compania", "razon social", "company"],
  jobTitle: ["cargo", "puesto", "job title"],
};

// Palabras que no aportan: "N° de Documento", "Nro. DNI", "Código del vendedor"
const STOP = new Set(["n", "no", "nro", "num", "numero", "de", "del", "la", "el", "y", "o"]);

const canonical = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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
  if (v instanceof Date) return isoDay(v);
  if (typeof v === "object") {
    if ("result" in v && v.result instanceof Date) return isoDay(v.result);
    if ("text" in v) return String(v.text ?? "").trim();
    if ("result" in v) return String(v.result ?? "").trim();
    if ("richText" in v) return v.richText.map((x) => x.text).join("").trim();
    return "";
  }
  return String(v).trim();
}

/** Las fechas de Excel llegan como medianoche UTC. */
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** "21/11/2026", "21-11-26", "2026-11-21" o el número de serie de Excel → "2026-11-21" */
function parseDay(raw: string): string | null {
  const t = raw.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(t)) return isoDay(new Date(Math.round((Number(t) - 25569) * 86400000)));
  return null;
}
const showDay = (iso: string) => iso.split("-").reverse().join("/");

const TYPE_ALIASES: Record<string, (typeof DOCUMENT_TYPES)[number]> = {
  DNI: "DNI", CE: "CE", "CARNE": "CE", "CARNEEXTRANJERIA": "CE", PASAPORTE: "PASAPORTE", PAS: "PASAPORTE", CEDULA: "CEDULA",
};

async function parse(fd: FormData) {
  const eventId = String(fd.get("eventId") ?? "");
  await requireEvent(eventId, "admin");

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES || !/\.xlsx$/i.test(file.name)) {
    throw Error("Adjunta un Excel .xlsx de máximo 5 MB.");
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
  const usedIx = new Set(Object.values(mapping));
  const columns: ColumnReport = {
    used: Object.entries(mapping).map(([field, ix]) => ({ field: FIELD_LABELS[field] ?? field, header: cell(headers[ix]) })),
    ignored: headers.map((h, i) => (i > 0 && !usedIx.has(i) ? cell(h) : "")).filter(Boolean),
  };

  // Fechas del evento por día, para la columna "Fecha de asistencia"
  const eventDates = await query<{ id: string; event_day: string }>(
    "select id, event_day::text from event_dates where event_id = $1",
    [eventId],
  );
  const dateByDay = new Map<string, string[]>();
  for (const d of eventDates) dateByDay.set(d.event_day, [...(dateByDay.get(d.event_day) ?? []), d.id]);

  const rows: Row[] = [];
  const seenDoc = new Set<string>();
  const seenCode = new Set<string>();
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const get = (key: string) => (mapping[key] ? cell(row.getCell(mapping[key]).value) : "");
    const name = get("name").replace(/\s+/g, " ");
    let document = get("document").toUpperCase().replace(/[\s.-]/g, "");
    // DNI guardado como número en Excel pierde el cero inicial (04407269 → 4407269)
    if (typeof row.getCell(mapping.document).value === "number" && /^\d{5,7}$/.test(document)) document = document.padStart(8, "0");
    if (!name && !document) continue;

    const rawType = get("documentType").toUpperCase().replace(/[^A-Z]/g, "");
    const documentType = TYPE_ALIASES[rawType] ?? (rawType ? rawType : /^[0-9]{8}$/.test(document) ? "DNI" : "CE");
    const code = get("code").toUpperCase().replace(/\s+/g, "");
    const email = get("email").toLowerCase();
    const phone = get("phone");
    const dateRaw = get("date");
    const errors: string[] = [];
    let dateText = "";
    let dateId: string | null = null;
    if (dateRaw) {
      const day = parseDay(dateRaw);
      if (!day) errors.push("Fecha no válida");
      else {
        dateText = showDay(day);
        const ids = dateByDay.get(day) ?? [];
        if (ids.length === 0) errors.push(`El evento no tiene la fecha ${dateText}`);
        else if (ids.length > 1) errors.push(`El ${dateText} tiene varios horarios: asígnalo desde la base`);
        else dateId = ids[0];
      }
    }

    if (name.length < 3) errors.push("Falta el nombre");
    if (!(DOCUMENT_TYPES as readonly string[]).includes(documentType)) errors.push("Tipo de documento no válido");
    else {
      const issue = documentIssue(documentType as (typeof DOCUMENT_TYPES)[number], document);
      if (issue) errors.push(issue);
    }
    if (code && !/^[A-Z0-9_-]{2,40}$/.test(code)) errors.push("Código no válido");
    if (email && !EMAIL.test(email)) errors.push("Correo no válido");
    if (phone && !PHONE.test(phone)) errors.push("Celular no válido");

    const unique = documentType + ":" + document;
    if (seenDoc.has(unique)) errors.push("Documento repetido en el Excel");
    seenDoc.add(unique);
    if (code) {
      if (seenCode.has(code)) errors.push("Código repetido en el Excel");
      seenCode.add(code);
    }

    rows.push({
      line: i, name, documentType, document, code, email, phone,
      company: get("company"), jobTitle: get("jobTitle"), dateText, dateId, errors,
    });
  }
  if (rows.length === 0) throw Error("El archivo no contiene registros.");
  return { eventId, rows, columns };
}

/** Marca filas que actualizan invitados existentes y códigos que ya usa otra persona. */
async function markExisting(eventId: string, rows: Row[]) {
  const existing = await query<{ document_type: string; document_number: string; employee_code: string | null }>(
    "select document_type, document_number, upper(employee_code) as employee_code from invitees where event_id = $1",
    [eventId],
  );
  const byDoc = new Set(existing.map((r) => r.document_type + ":" + r.document_number));
  const codeOwner = new Map(existing.filter((r) => r.employee_code).map((r) => [r.employee_code!, r.document_type + ":" + r.document_number]));
  for (const r of rows) {
    const key = r.documentType + ":" + r.document;
    r.exists = byDoc.has(key);
    const owner = r.code ? codeOwner.get(r.code) : undefined;
    if (owner && owner !== key) r.errors.push("El código ya pertenece a otro invitado");
  }
}

export async function previewImport(_: ImportResult, fd: FormData): Promise<ImportResult> {
  try {
    const { eventId, rows, columns } = await parse(fd);
    await markExisting(eventId, rows);
    const valid = rows.filter((r) => !r.errors.length);
    const updates = valid.filter((r) => r.exists).length;
    // Errores primero en la vista previa para que se vean sin desplazarse
    rows.sort((x, y) => Number(y.errors.length > 0) - Number(x.errors.length > 0) || x.line - y.line);
    return {
      ok: true,
      message: "Vista previa lista. Confirma para cargar solo las filas válidas.",
      valid: valid.length,
      invalid: rows.length - valid.length,
      updates,
      imported: 0,
      preview: rows.slice(0, 100),
      columns,
    };
  } catch (e) {
    return empty(e instanceof Error ? e.message : "No se pudo leer el Excel.");
  }
}

export async function commitImport(_: ImportResult, fd: FormData): Promise<ImportResult> {
  try {
    const { eventId, rows } = await parse(fd);
    await markExisting(eventId, rows);
    const valid = rows.filter((r) => !r.errors.length);
    let imported = 0;
    let updates = 0;
    let conflicts = 0;

    // Inserta o actualiza por documento; un código ya usado por otra persona se omite sin abortar la carga.
    await transaction(async (client) => {
      for (const r of valid) {
        await client.query("savepoint inv_row");
        try {
          const res = await client.query<{ inserted: boolean }>(
            `insert into invitees (event_id, document_type, document_number, employee_code, full_name, email, phone, company, job_title, event_date_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             on conflict (event_id, document_type, document_number) do update set
               event_date_id = coalesce(excluded.event_date_id, invitees.event_date_id),
               employee_code = coalesce(excluded.employee_code, invitees.employee_code),
               full_name     = excluded.full_name,
               email         = coalesce(excluded.email, invitees.email),
               phone         = coalesce(excluded.phone, invitees.phone),
               company       = coalesce(excluded.company, invitees.company),
               job_title     = coalesce(excluded.job_title, invitees.job_title)
             returning (xmax = 0) as inserted`,
            [eventId, r.documentType, r.document, r.code || null, r.name, r.email || null, r.phone || null, r.company || null, r.jobTitle || null, r.dateId],
          );
          await client.query("release savepoint inv_row");
          if (res.rows[0].inserted) imported++;
          else updates++;
        } catch (e) {
          await client.query("rollback to savepoint inv_row");
          await client.query("release savepoint inv_row");
          if (pgCode(e) === "23505") conflicts++;
          else throw e;
        }
      }
    });

    revalidatePath("/admin/eventos/" + eventId);
    revalidatePath("/admin/eventos/" + eventId + "/invitados");
    return {
      ok: true,
      message:
        `Base cargada. Nuevos: ${imported}. Actualizados: ${updates}.` +
        (conflicts ? ` Omitidos por código duplicado: ${conflicts}.` : "") +
        " Los invitados ya pueden confirmar su asistencia con su DNI o código.",
      valid: imported + updates,
      invalid: rows.length - valid.length + conflicts,
      updates,
      imported,
      preview: [],
    };
  } catch (e) {
    console.error("[commitImport]", e);
    const msg = e instanceof Error ? e.message : "";
    return empty(/^[A-ZÁÉÍÓÚ]/.test(msg) && !/^[A-Z_]+$/.test(msg) ? msg : "Error al importar. No se guardó ningún cambio.");
  }
}
