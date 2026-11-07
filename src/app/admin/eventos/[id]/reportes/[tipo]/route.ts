import ExcelJS from "exceljs";
import { requireClientEvent } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { formatClock, formatDateTime, formatDayShort, formatTime } from "@/lib/format";
import { addBrandedSheet, fileName, loadLogo, type Brand } from "@/lib/report-xlsx";
import type { EventDate } from "@/lib/types";

export const dynamic = "force-dynamic";

const METHOD: Record<string, string> = { QR: "QR", DOCUMENTO: "DNI / código", BUSQUEDA: "Búsqueda por nombre" };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

/**
 * GET /admin/eventos/:id/reportes/confirmacion | asistencia
 * Excel con el logo y los colores del evento (administrador, coordinador y cliente).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; tipo: string }> }) {
  const { id, tipo } = await params;
  if (tipo !== "confirmacion" && tipo !== "asistencia") return new Response("Not found", { status: 404 });
  const { event } = await requireClientEvent(id); // administrador, coordinador o cliente de la empresa
  const tz = event.timezone;

  const [client, dates] = await Promise.all([
    queryOne<{ name: string }>("select name from tenants where id = $1", [event.tenant_id]),
    query<EventDate>("select * from event_dates where event_id = $1 order by event_day, starts_at", [id]),
  ]);
  const brand: Brand = {
    eventName: event.name,
    clientName: client?.name ?? "",
    color: /^#[0-9a-f]{6}$/i.test(event.primary_color) ? event.primary_color : "#0f172a",
    logo: await loadLogo(event.logo_url),
  };
  const dateLabel = (d?: EventDate) => (d ? `${formatDayShort(d.event_day)}${d.label ? ` · ${d.label}` : ""}` : "");
  const dateById = new Map(dates.map((d) => [d.id, d]));
  const generated = `${brand.clientName} · Generado el ${formatDateTime(new Date().toISOString(), tz)}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = brand.clientName || brand.eventName;
  wb.created = new Date();

  if (tipo === "confirmacion") {
    const summary = await query<{ id: string; assigned: number; confirmed: number; persons: number; pending: number }>(
      `select d.id,
              (select count(*) from invitees i where i.event_date_id = d.id)::int as assigned,
              (select count(*) from registrations r where r.event_date_id = d.id and r.status <> 'CANCELADO')::int as confirmed,
              (select coalesce(sum(r.seats), 0) from registrations r where r.event_date_id = d.id and r.status <> 'CANCELADO')::int as persons,
              (select count(*) from invitees i where i.event_date_id = d.id
                 and not exists (select 1 from registrations r where r.invitee_id = i.id and r.status <> 'CANCELADO'))::int as pending
         from event_dates d where d.event_id = $1`,
      [id],
    );
    const unassigned = await queryOne<{ n: number; pending: number }>(
      `select count(*)::int as n,
              count(*) filter (where not exists (select 1 from registrations r where r.invitee_id = i.id and r.status <> 'CANCELADO'))::int as pending
         from invitees i where i.event_id = $1 and i.event_date_id is null`,
      [id],
    );
    type S = { label: string; hours: string; capacity: number | string; assigned: number | string; confirmed: number; persons: number; pending: number | string; rate: string };
    const sRows: S[] = dates.map((d) => {
      const s = summary.find((x) => x.id === d.id)!;
      return {
        label: dateLabel(d), hours: `${formatTime(d.starts_at)} – ${formatTime(d.ends_at)}`, capacity: d.capacity,
        assigned: s.assigned, confirmed: s.confirmed, persons: s.persons, pending: s.pending, rate: pct(s.confirmed, s.assigned),
      };
    });
    if (unassigned?.n) {
      sRows.push({ label: "Sin fecha asignada", hours: "", capacity: "", assigned: unassigned.n, confirmed: 0, persons: 0, pending: unassigned.pending, rate: "" });
    }
    const tot = sRows.reduce((a, r) => ({ a: a.a + Number(r.assigned || 0), c: a.c + r.confirmed, p: a.p + r.persons, pe: a.pe + Number(r.pending || 0) }), { a: 0, c: 0, p: 0, pe: 0 });
    sRows.push({ label: "TOTAL", hours: "", capacity: dates.reduce((n, d) => n + d.capacity, 0), assigned: tot.a, confirmed: tot.c, persons: tot.p, pending: tot.pe, rate: pct(tot.c, tot.a) });
    const resumen = addBrandedSheet(wb, brand, {
      name: "Resumen", title: "Base de confirmación", rows: sRows,
      columns: [
        { header: "Fecha", width: 24, value: (r) => r.label },
        { header: "Horario", width: 15, value: (r) => r.hours },
        { header: "Aforo", width: 10, value: (r) => r.capacity, align: "right" },
        { header: "Invitados en la base", width: 14, value: (r) => r.assigned, align: "right" },
        { header: "Confirmaron", width: 13, value: (r) => r.confirmed, align: "right" },
        { header: "Personas (con acompañantes)", width: 16, value: (r) => r.persons, align: "right" },
        { header: "Pendientes", width: 12, value: (r) => r.pending, align: "right" },
        { header: "% confirmación", width: 14, value: (r) => r.rate, align: "right" },
      ],
    }, generated);
    resumen.lastRow!.font = { bold: true };

    const confirmed = await query<{
      full_name: string; document_type: string; document_number: string; employee_code: string | null; company: string | null;
      event_date_id: string; companions_count: number; companions_list: string | null; seats: number; created_at: string;
      status: string; email: string | null; phone: string | null;
    }>(
      `select r.full_name, r.document_type, r.document_number, r.employee_code, r.company, r.event_date_id,
              r.companions_count, r.seats, r.created_at, r.status, r.email, r.phone,
              (select string_agg(c.full_name || ' (' || c.document_type || ' ' || c.document_number || ')', '; ' order by c.position)
                 from companions c where c.registration_id = r.id) as companions_list
         from registrations r
        where r.event_id = $1 and r.status <> 'CANCELADO'
        order by r.created_at`,
      [id],
    );
    addBrandedSheet(wb, brand, {
      name: "Confirmados", title: "Confirmados", rows: confirmed, empty: "Aún no hay confirmaciones.",
      columns: [
        { header: "N°", width: 6, value: () => null, align: "right" },
        { header: "Nombre completo", width: 34, value: (r) => r.full_name },
        { header: "Tipo doc.", width: 9, value: (r) => r.document_type },
        { header: "N° documento", width: 14, value: (r) => r.document_number },
        { header: "Código", width: 11, value: (r) => r.employee_code },
        { header: "Empresa", width: 20, value: (r) => r.company },
        { header: "Fecha confirmada", width: 18, value: (r) => dateLabel(dateById.get(r.event_date_id)) },
        { header: "Acompañantes", width: 13, value: (r) => r.companions_count, align: "right" },
        { header: "Detalle de acompañantes", width: 36, value: (r) => r.companions_list },
        { header: "Personas", width: 10, value: (r) => r.seats, align: "right" },
        { header: "Confirmó el", width: 18, value: (r) => formatDateTime(r.created_at, tz) },
        { header: "Estado", width: 12, value: (r) => (r.status === "CHECKED_IN" ? "Ingresó" : "Confirmado") },
      ],
    }, generated).eachRow((row, n) => { if (n > 6 && confirmed.length) row.getCell(1).value = n - 6; });

    const pending = await query<{ full_name: string; document_type: string; document_number: string; employee_code: string | null; company: string | null; event_date_id: string | null; email: string | null; phone: string | null }>(
      `select i.full_name, i.document_type, i.document_number, i.employee_code, i.company, i.event_date_id, i.email, i.phone
         from invitees i
        where i.event_id = $1
          and not exists (select 1 from registrations r where r.invitee_id = i.id and r.status <> 'CANCELADO')
        order by i.full_name`,
      [id],
    );
    addBrandedSheet(wb, brand, {
      name: "Pendientes", title: "Pendientes de confirmar", rows: pending, empty: "Todos los invitados confirmaron.",
      columns: [
        { header: "Nombre completo", width: 34, value: (r) => r.full_name },
        { header: "Tipo doc.", width: 9, value: (r) => r.document_type },
        { header: "N° documento", width: 14, value: (r) => r.document_number },
        { header: "Código", width: 11, value: (r) => r.employee_code },
        { header: "Empresa", width: 20, value: (r) => r.company },
        { header: "Fecha asignada", width: 18, value: (r) => (r.event_date_id ? dateLabel(dateById.get(r.event_date_id)) : "Libre") },
        { header: "Correo", width: 26, value: (r) => r.email },
        { header: "Celular", width: 14, value: (r) => r.phone },
      ],
    }, generated);
  } else {
    // Una fila por persona que ingresó (titular o acompañante), con quién la acreditó
    const people = await query<{
      at: string; event_date_id: string; kind: string; full_name: string; document_type: string; document_number: string;
      employee_code: string | null; holder: string | null; employee: string | null; method: string | null;
    }>(
      `select r.holder_checked_in_at as at, r.event_date_id, 'Titular' as kind, r.full_name, r.document_type, r.document_number,
              r.employee_code, null as holder, coalesce(em.full_name, case when l.id is not null then 'Enlace general' end) as employee, l.method
         from registrations r
         left join checkin_log l on l.registration_id = r.id and l.result = 'INGRESO' and l.created_at = r.holder_checked_in_at
         left join employees em on em.id = l.employee_id
        where r.event_id = $1 and r.status <> 'CANCELADO' and r.holder_checked_in_at is not null
       union all
       select c.checked_in_at, r.event_date_id, 'Acompañante', c.full_name, c.document_type, c.document_number,
              r.employee_code, r.full_name, coalesce(em.full_name, case when l.id is not null then 'Enlace general' end), l.method
         from companions c
         join registrations r on r.id = c.registration_id
         left join checkin_log l on l.registration_id = r.id and l.result = 'INGRESO' and l.created_at = c.checked_in_at
         left join employees em on em.id = l.employee_id
        where r.event_id = $1 and r.status <> 'CANCELADO' and c.checked_in_at is not null
        order by 1`,
      [id],
    );
    const absent = await query<{ event_date_id: string; kind: string; full_name: string; document_type: string; document_number: string; employee_code: string | null; holder: string | null }>(
      `select r.event_date_id, 'Titular' as kind, r.full_name, r.document_type, r.document_number, r.employee_code, null as holder
         from registrations r
        where r.event_id = $1 and r.status <> 'CANCELADO' and r.holder_checked_in_at is null
       union all
       select r.event_date_id, 'Acompañante', c.full_name, c.document_type, c.document_number, r.employee_code, r.full_name
         from companions c join registrations r on r.id = c.registration_id
        where r.event_id = $1 and r.status <> 'CANCELADO' and c.checked_in_at is null
        order by 1, 3`,
      [id],
    );
    const expected = await query<{ event_date_id: string; persons: number }>(
      `select event_date_id, coalesce(sum(seats), 0)::int as persons from registrations
        where event_id = $1 and status <> 'CANCELADO' group by event_date_id`,
      [id],
    );

    type S = { label: string; expected: number; holders: number; companions: number; total: number; rate: string; peak: string };
    const sRows: S[] = dates.map((d) => {
      const list = people.filter((p) => p.event_date_id === d.id);
      const hours = new Map<string, number>();
      const hourOf = new Intl.DateTimeFormat("es-PE", { hour: "2-digit", hourCycle: "h23", timeZone: tz });
      for (const p of list) {
        const h = hourOf.format(new Date(p.at));
        hours.set(h, (hours.get(h) ?? 0) + 1);
      }
      const peak = [...hours.entries()].sort((a, b) => b[1] - a[1])[0];
      const exp = expected.find((e) => e.event_date_id === d.id)?.persons ?? 0;
      return {
        label: dateLabel(d), expected: exp,
        holders: list.filter((p) => p.kind === "Titular").length,
        companions: list.filter((p) => p.kind !== "Titular").length,
        total: list.length, rate: pct(list.length, exp),
        peak: peak ? `${peak[0]}:00 (${peak[1]} personas)` : "",
      };
    });
    const t = sRows.reduce((a, r) => ({ e: a.e + r.expected, h: a.h + r.holders, c: a.c + r.companions, n: a.n + r.total }), { e: 0, h: 0, c: 0, n: 0 });
    sRows.push({ label: "TOTAL", expected: t.e, holders: t.h, companions: t.c, total: t.n, rate: pct(t.n, t.e), peak: "" });
    const resumen = addBrandedSheet(wb, brand, {
      name: "Resumen", title: "Base de asistencia", rows: sRows,
      columns: [
        { header: "Fecha", width: 24, value: (r) => r.label },
        { header: "Personas confirmadas", width: 14, value: (r) => r.expected, align: "right" },
        { header: "Titulares que ingresaron", width: 14, value: (r) => r.holders, align: "right" },
        { header: "Acompañantes que ingresaron", width: 16, value: (r) => r.companions, align: "right" },
        { header: "Total ingresaron", width: 12, value: (r) => r.total, align: "right" },
        { header: "% asistencia", width: 12, value: (r) => r.rate, align: "right" },
        { header: "Hora pico", width: 22, value: (r) => r.peak },
      ],
    }, generated);
    resumen.lastRow!.font = { bold: true };

    const asistentes = addBrandedSheet(wb, brand, {
      name: "Asistentes", title: "Asistentes", rows: people, empty: "Aún no hay ingresos registrados.",
      columns: [
        { header: "N°", width: 6, value: () => null, align: "right" },
        { header: "Fecha del evento", width: 18, value: (r) => dateLabel(dateById.get(r.event_date_id)) },
        { header: "Hora de ingreso", width: 13, value: (r) => formatClock(r.at, tz), align: "center" },
        { header: "Tipo", width: 12, value: (r) => r.kind },
        { header: "Nombre completo", width: 34, value: (r) => r.full_name },
        { header: "Tipo doc.", width: 9, value: (r) => r.document_type },
        { header: "N° documento", width: 14, value: (r) => r.document_number },
        { header: "Código", width: 11, value: (r) => (r.kind === "Titular" ? r.employee_code : null) },
        { header: "Acompañante de", width: 30, value: (r) => r.holder },
        { header: "Acreditado por", width: 26, value: (r) => r.employee },
        { header: "Método", width: 16, value: (r) => (r.method ? METHOD[r.method] ?? r.method : null) },
      ],
    }, generated);
    asistentes.eachRow((row, n) => { if (n > 6 && people.length) row.getCell(1).value = n - 6; });

    addBrandedSheet(wb, brand, {
      name: "No asistieron", title: "Confirmados que no ingresaron", rows: absent, empty: "Todos los confirmados ingresaron.",
      columns: [
        { header: "Fecha confirmada", width: 18, value: (r) => dateLabel(dateById.get(r.event_date_id)) },
        { header: "Tipo", width: 12, value: (r) => r.kind },
        { header: "Nombre completo", width: 34, value: (r) => r.full_name },
        { header: "Tipo doc.", width: 9, value: (r) => r.document_type },
        { header: "N° documento", width: 14, value: (r) => r.document_number },
        { header: "Código", width: 11, value: (r) => (r.kind === "Titular" ? r.employee_code : null) },
        { header: "Acompañante de", width: 30, value: (r) => r.holder },
      ],
    }, generated);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const name = `${tipo === "confirmacion" ? "Base-confirmacion" : "Base-asistencia"}-${fileName(event.name)}.xlsx`;
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
