import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import { adminTenantIds, requireViewer } from "@/lib/auth";
import { query } from "@/lib/db";
import { brandStyle, formatDayShort } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Eventos de la empresa del cliente. Con un solo evento, entra directo a su dashboard. */
export default async function ClientHome() {
  const viewer = await requireViewer();
  const tenants = viewer.isPlatformAdmin
    ? null
    : viewer.profile === "CLIENTE"
      ? viewer.clientTenants.map((t) => t.tenant_id)
      : adminTenantIds(viewer);
  const events = await query<{
    id: string; name: string; venue: string | null; primary_color: string; logo_url: string | null;
    first_day: string | null; last_day: string | null; base: number; attended: number;
  }>(
    `select e.id, e.name, e.venue, e.primary_color, e.logo_url,
            (select min(event_day) from event_dates d where d.event_id = e.id) as first_day,
            (select max(event_day) from event_dates d where d.event_id = e.id) as last_day,
            (select count(*) from invitees i where i.event_id = e.id)::int as base,
            (select count(*) from registrations r where r.event_id = e.id and r.status <> 'CANCELADO' and r.holder_checked_in_at is not null)::int as attended
       from events e
      where ($1::uuid[] is null or e.tenant_id = any($1))
      order by first_day desc nulls last, e.name`,
    [tenants],
  );
  if (events.length === 1 && viewer.profile === "CLIENTE") redirect(`/cliente/eventos/${events[0].id}`);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Tus eventos</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {events.map((e) => (
          <Link key={e.id} href={`/cliente/eventos/${e.id}`} style={brandStyle(e.primary_color)} className="card group overflow-hidden transition hover:shadow-md">
            <div className="h-1.5 bg-brand" />
            <div className="flex items-start gap-4 p-5">
              {e.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.logo_url} alt="" className="h-10 w-auto max-w-28 object-contain" />
              )}
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{e.name}</h2>
                <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-slate-500">
                  {e.first_day && (
                    <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" />
                      {formatDayShort(e.first_day)}{e.last_day && e.last_day !== e.first_day ? ` – ${formatDayShort(e.last_day)}` : ""}
                    </span>
                  )}
                  {e.venue && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{e.venue}</span>}
                </p>
                <p className="mt-3 text-sm"><b className="tabular-nums">{e.attended}</b> de <span className="tabular-nums">{e.base}</span> invitados asistieron</p>
              </div>
              <ArrowRight className="size-5 text-slate-400 group-hover:text-slate-700" />
            </div>
          </Link>
        ))}
        {events.length === 0 && <p className="card p-8 text-center text-slate-500 sm:col-span-2">Aún no hay eventos para tu empresa.</p>}
      </div>
    </div>
  );
}
