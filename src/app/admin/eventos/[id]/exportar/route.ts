import ExcelJS from "exceljs";
import { requireEvent } from "@/lib/auth";
import { formatDateTime, formatTime } from "@/lib/format";
import { slugify } from "@/lib/validation";
import type { EventDate, Registration } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS: Record<Registration["status"], string> = {
  REGISTRADO: "Registrado",
  CHECKED_IN: "Ingresó",
  CANCELADO: "Cancelado",
};

/** GET /admin/eventos/:id/exportar?formato=xlsx|csv&fecha=<eventDateId> */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, event } = await requireEvent(id, "admin");
  const url = new URL(req.url);
  const format = url.searchParams.get("formato") === "csv" ? "csv" : "xlsx";
  const dateFilter = url.searchParams.get("fecha");

  const { data: dates } = await supabase.from("event_dates").select("*").eq("event_id", id).returns<EventDate[]>();
  const dateById = new Map((dates ?? []).map((d) => [d.id, d]));

  // Paginado: PostgREST limita filas por respuesta
  const rows: Registration[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("registrations").select("*").eq("event_id", id).order("created_at").range(from, from + 999);
    if (dateFilter) q = q.eq("event_date_id", dateFilter);
    const { data } = await q.returns<Registration[]>();
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const tz = event.timezone;
  const columns = [
    { header: "Código", key: "code", width: 12 },
    { header: "Fecha", key: "day", width: 12 },
    { header: "Horario", key: "hours", width: 13 },
    { header: "Etiqueta fecha", key: "label", width: 22 },
    { header: "Nombre completo", key: "full_name", width: 30 },
    { header: "Tipo doc.", key: "document_type", width: 11 },
    { header: "N° documento", key: "document_number", width: 15 },
    { header: "Correo", key: "email", width: 30 },
    { header: "Teléfono", key: "phone", width: 16 },
    { header: "Empresa", key: "company", width: 24 },
    { header: "Cargo", key: "job_title", width: 22 },
    { header: "Acompañante", key: "companion_full_name", width: 28 },
    { header: "Tipo doc. acomp.", key: "companion_document_type", width: 15 },
    { header: "N° doc. acomp.", key: "companion_document_number", width: 15 },
    { header: "Estado", key: "status", width: 12 },
    { header: "Ingreso titular", key: "holder_in", width: 17 },
    { header: "Ingreso acompañante", key: "companion_in", width: 19 },
    { header: "Fecha de registro", key: "created", width: 17 },
  ] as const;

  const data = rows.map((r) => {
    const d = dateById.get(r.event_date_id);
    return {
      code: r.token.slice(0, 8).toUpperCase(),
      day: d?.event_day ?? "",
      hours: d ? `${formatTime(d.starts_at)}-${formatTime(d.ends_at)}` : "",
      label: d?.label ?? "",
      full_name: r.full_name,
      document_type: r.document_type,
      document_number: r.document_number,
      email: r.email,
      phone: r.phone,
      company: r.company ?? "",
      job_title: r.job_title ?? "",
      companion_full_name: r.companion_full_name ?? "",
      companion_document_type: r.companion_document_type ?? "",
      companion_document_number: r.companion_document_number ?? "",
      status: STATUS[r.status],
      holder_in: r.holder_checked_in_at ? formatDateTime(r.holder_checked_in_at, tz) : "",
      companion_in: r.companion_checked_in_at ? formatDateTime(r.companion_checked_in_at, tz) : "",
      created: formatDateTime(r.created_at, tz),
    };
  });

  const filename = `${slugify(event.name)}-registros-${new Date().toISOString().slice(0, 10)}`;

  if (format === "csv") {
    const esc = (v: string) => {
      // Neutraliza inyección de fórmulas al abrir en Excel
      const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
      return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [
      columns.map((c) => c.header).join(","),
      ...data.map((row) => columns.map((c) => esc(String(row[c.key]))).join(",")),
    ];
    // BOM para que Excel lea tildes correctamente
    return new Response("﻿" + lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
      },
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Eventos Below";
  const ws = wb.addWorksheet("Registros", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ ...c }));
  ws.addRows(data);
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${event.primary_color.slice(1).toUpperCase()}` } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  // Hoja resumen por fecha
  const summary = wb.addWorksheet("Resumen");
  summary.columns = [
    { header: "Fecha", key: "day", width: 14 },
    { header: "Etiqueta", key: "label", width: 24 },
    { header: "Aforo", key: "capacity", width: 10 },
    { header: "Cupos ocupados", key: "taken", width: 15 },
    { header: "Registros", key: "regs", width: 11 },
    { header: "Personas ingresadas", key: "in", width: 19 },
  ];
  for (const d of (dates ?? []).sort((a, b) => a.event_day.localeCompare(b.event_day))) {
    const rs = rows.filter((r) => r.event_date_id === d.id && r.status !== "CANCELADO");
    summary.addRow({
      day: d.event_day,
      label: d.label ?? "",
      capacity: d.capacity,
      taken: d.registered_count,
      regs: rs.length,
      in: rs.reduce((n, r) => n + (r.holder_checked_in_at ? 1 : 0) + (r.companion_checked_in_at ? 1 : 0), 0),
    });
  }
  summary.getRow(1).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    },
  });
}
