import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import { adminTenantIds, requireViewer } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDayShort } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Eventos" };

export default async function AdminHome() {
  const viewer = await requireViewer();
  const events = await query<{
    id: string;
    name: string;
    slug: string;
    is_published: boolean;
    registration_open: boolean;
    primary_color: string;
    logo_url: string | null;
    tenant_name: string;
    first_day: string | null;
    date_count: number;
    capacity: number;
    taken: number;
  }>(
    `select e.id, e.name, e.slug, e.is_published, e.registration_open, e.primary_color, e.logo_url,
            t.name as tenant_name,
            min(d.event_day) as first_day,
            count(d.id) as date_count,
            coalesce(sum(d.capacity), 0)::int as capacity,
            coalesce(sum(d.registered_count), 0)::int as taken
       from events e
       join tenants t on t.id = e.tenant_id
       left join event_dates d on d.event_id = e.id
      where ($1::uuid[] is null or e.tenant_id = any($1))
      group by e.id, t.name
      order by e.created_at desc`,
    [viewer.isPlatformAdmin ? null : adminTenantIds(viewer)],
  );

  const canCreate = viewer.isPlatformAdmin || adminTenantIds(viewer).length > 0;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Eventos</h1>
          <p className="text-slate-600">Proyectos de tus clientes, con sus fechas y aforo.</p>
        </div>
        {canCreate && (
          <Link href="/admin/eventos/nuevo" className="btn-dark">
            <Plus className="size-4" /> Nuevo evento
          </Link>
        )}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((e) => {
          const { capacity: cap, taken, first_day: first, date_count } = e;
          return (
            <Link key={e.id} href={`/admin/eventos/${e.id}`} className="card group overflow-hidden transition hover:shadow-md">
              <div className="h-2" style={{ background: e.primary_color }} />
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {e.tenant_name}
                    </p>
                    <h2 className="mt-0.5 truncate font-semibold group-hover:underline">{e.name}</h2>
                  </div>
                  {e.logo_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.logo_url} alt="" className="h-8 w-auto max-w-16 object-contain" />
                  )}
                </div>
                <div className="mt-4 flex items-center gap-2 text-sm text-slate-600">
                  <CalendarDays className="size-4" />
                  {first ? <span>{formatDayShort(first)}</span> : "Sin fechas"}
                  {date_count > 1 && <span className="text-slate-400">+{date_count - 1}</span>}
                </div>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="tabular-nums text-slate-700">
                    <strong>{taken}</strong>
                    <span className="text-slate-400">/{cap} inscritos</span>
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      !e.is_published ? "bg-slate-100 text-slate-600" : e.registration_open ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {!e.is_published ? "Borrador" : e.registration_open ? "Abierto" : "Cerrado"}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
        {events.length === 0 && (
          <div className="card col-span-full p-10 text-center text-slate-500">Aún no hay eventos.</div>
        )}
      </div>
    </>
  );
}
