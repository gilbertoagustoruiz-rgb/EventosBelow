import { Fragment } from "react";
import { query } from "@/lib/db";
import { formatDayShort } from "@/lib/format";

interface Row {
  id: string; event_day: string; label: string | null; capacity: number;
  holders: number; solo: number; one: number; more: number; companions: number;
}

/**
 * Confirmaciones por fecha (mismo cuadro para administrador, coordinador y cliente):
 * titulares (los que ocupan cupo), cuántos van solos o acompañados y el total de personas.
 */
export async function ConfirmationSummary({ eventId, dateId }: { eventId: string; dateId?: string | null }) {
  const rows = await query<Row>(
    `select d.id, d.event_day, d.label, d.capacity,
            count(r.id)::int as holders,
            count(r.id) filter (where r.companions_count = 0)::int as solo,
            count(r.id) filter (where r.companions_count = 1)::int as one,
            count(r.id) filter (where r.companions_count > 1)::int as more,
            coalesce(sum(r.companions_count), 0)::int as companions
       from event_dates d
       left join registrations r on r.event_date_id = d.id and r.status <> 'CANCELADO'
      where d.event_id = $1 and ($2::uuid is null or d.id = $2)
      group by d.id order by d.event_day, d.starts_at`,
    [eventId, dateId ?? null],
  );
  if (!rows.length) return null;
  const total = rows.reduce(
    (a, r) => ({ capacity: a.capacity + r.capacity, holders: a.holders + r.holders, solo: a.solo + r.solo, one: a.one + r.one, more: a.more + r.more, companions: a.companions + r.companions }),
    { capacity: 0, holders: 0, solo: 0, one: 0, more: 0, companions: 0 },
  );
  const showMore = total.more > 0;
  const line = (r: Omit<Row, "id" | "event_day" | "label">, label: string, bold = false) => (
    <tr className={bold ? "border-t-2 border-slate-200 font-semibold" : "border-t border-slate-100"}>
      <td className="py-2.5 pr-3">{label}</td>
      <td className="py-2.5 pr-3 text-right tabular-nums"><b>{r.holders.toLocaleString("es-PE")}</b> <span className="font-normal text-slate-400">/ {r.capacity.toLocaleString("es-PE")}</span></td>
      <td className="py-2.5 pr-3 text-right tabular-nums">{r.solo.toLocaleString("es-PE")}</td>
      {showMore && <td className="py-2.5 pr-3 text-right tabular-nums">{r.more.toLocaleString("es-PE")}</td>}
      <td className="py-2.5 pr-3 text-right tabular-nums">{r.companions.toLocaleString("es-PE")}</td>
      <td className="py-2.5 text-right tabular-nums">{(r.holders + r.companions).toLocaleString("es-PE")}</td>
    </tr>
  );
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="font-semibold">Confirmaciones por fecha</h2>
      <p className="text-sm text-slate-500">Los titulares ocupan el cupo; los acompañantes se registran pero no descuentan aforo.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-2 pr-3 text-left font-medium">Fecha</th>
              <th className="pb-2 pr-3 text-right font-medium">Titulares / aforo</th>
              <th className="pb-2 pr-3 text-right font-medium">Solos</th>
              {showMore && <th className="pb-2 pr-3 text-right font-medium">Con 2 o más</th>}
              <th className="pb-2 pr-3 text-right font-medium">Acompañantes</th>
              <th className="pb-2 text-right font-medium">Total personas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <Fragment key={r.id}>{line(r, `${formatDayShort(r.event_day)}${r.label ? ` · ${r.label}` : ""}`)}</Fragment>)}
            {rows.length > 1 && line(total, "Total", true)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

