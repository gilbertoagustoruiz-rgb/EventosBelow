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
  errors: string[];
  exists?: boolean;
};

export type ImportResult = {
  ok: boolean;
  message: string;
  valid: number;
  invalid: number;
  updates: number;
  imported: number;
  preview: Row[];
};

const empty = (message: string): ImportResult => ({ ok: false, message, valid: 0, invalid: 0, updates: 0, imported: 0, preview: [] });

const MAX_ROWS = 5000;
const MAX_BYTES = 5 * 1024 * 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9\s-]{7,20}$/;

/** Encabezados reconocidos. Se comparan en forma canónica (ver `canonical`). */
const aliases: Record<string, string[]> = {
  name: ["nombre", "nombres", "nombre completo", "nombres y apellidos", "apellidos y nombres", "asistente", "participante", "invitado", "full name", "name"],
  document: ["dni", "documento", "documento identidad", "doc", "cedula", "pasaporte", "ce", "document number"],
  documentType: ["tipo documento", "tipo doc"],
  code: ["codigo", "codigo vendedor", "codigo empleado", "cod vendedor", "cod empleado", "vendedor", "employee code", "seller code"],
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
  if (typeof v === "object") {
    if ("text" in v) return String(v.text ?? "").trim();
    if ("result" in v) return String(v.result ?? "").trim();
    if ("richText" in v) return v.richText.map((x) => x.text).join("").trim();
    return "";
  }
  return String(v).trim();
}

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

  const rows: Row[] = [];
  const seenDoc = new Set<string>();
  const seenCode = new Set<string>();
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const get = (key: string) => (mapping[key] ? cell(row.getCell(mapping[key]).value) : "");
    const name = get("name").replace(/\s+/g, " ");
    const document = get("document").toUpperCase().replace(/[\s.-]/g, "");
    if (!name && !document) continue;

    const rawType = get("documentType").toUpperCase().replace(/[^A-Z]/g, "");
    const documentType = TYPE_ALIASES[rawType] ?? (rawType ? rawType : /^[0-9]{8}$/.test(document) ? "DNI" : "CE");
    const code = get("code").toUpperCase().replace(/\s+/g, "");
    const email = get("email").toLowerCase();
    const phone = get("phone");
    const errors: string[] = [];

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
      company: get("company"), jobTitle: get("jobTitle"), errors,
    });
  }
  if (rows.length === 0) throw Error("El archivo no contiene registros.");
  return { eventId, rows };
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
    const { eventId, rows } = await parse(fd);
    await markExisting(eventId, rows);
    const valid = rows.filter((r) => !r.errors.length);
    const updates = valid.filter((r) => r.exists).length;
    return {
      ok: true,
      message: "Vista previa lista. Confirma para cargar solo las filas válidas.",
      valid: valid.length,
      invalid: rows.length - valid.length,
      updates,
      imported: 0,
      preview: rows.slice(0, 100),
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
            `insert into invitees (event_id, document_type, document_number, employee_code, full_name, email, phone, company, job_title)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             on conflict (event_id, document_type, document_number) do update set
               employee_code = coalesce(excluded.employee_code, invitees.employee_code),
               full_name     = excluded.full_name,
               email         = coalesce(excluded.email, invitees.email),
               phone         = coalesce(excluded.phone, invitees.phone),
               company       = coalesce(excluded.company, invitees.company),
               job_title     = coalesce(excluded.job_title, invitees.job_title)
             returning (xmax = 0) as inserted`,
            [eventId, r.documentType, r.document, r.code || null, r.name, r.email || null, r.phone || null, r.company || null, r.jobTitle || null],
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
