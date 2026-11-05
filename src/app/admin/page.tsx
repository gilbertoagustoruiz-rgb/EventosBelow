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
    project_name: string;
    first_day: string | null;
    date_count: number;
    capacity: number;
    taken: number;
  }>(
    `select e.id, e.name, e.slug, e.is_published, e.registration_open, e.primary_color, e.logo_url,
            t.name as tenant_name, p.name as project_name,
            min(d.event_day) as first_day,
            count(d.id) as date_count,
            coalesce(sum(d.capacity), 0)::int as capacity,
            coalesce(sum(d.registered_count), 0)::int as taken
       from events e
       join tenants t on t.id = e.tenant_id
       join projects p on p.id = e.project_id
       left join event_dates d on d.event_id = e.id
      where ($1::uuid[] is null or e.tenant_id = any($1) or e.id = any($2))
      group by e.id, t.name, p.name
      order by e.created_at desc`,
    // Administrador: todos · Coordinador: sus clientes · Supervisor: eventos donde está como supervisor
    [
      viewer.isPlatformAdmin ? null : adminTenantIds(viewer),
      viewer.staff.filter((s) => s.role === "SUPERVISOR").map((s) => s.event_id),
    ],
  );

  const supervisorOnly = !viewer.isPlatformAdmin && adminTenantIds(viewer).length === 0;
  const canCreate = !supervisorOnly;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-indigo-600">Tu espacio de trabajo</p>
          <h1 className="text-3xl font-bold tracking-tight">Mis eventos</h1>
          <p className="mt-2 text-slate-600">Organiza las fechas, comparte inscripciones y acompaña a tus asistentes.</p>
        </div>
        {canCreate && (
          <Link href="/admin/eventos/nuevo" className="btn-dark">
            <Plus className="size-4" /> Nuevo evento
          </Link>
        )}
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumen de tus eventos">
        {[
          ["Eventos creados", events.length],
          ["Inscripciones abiertas", events.filter((e) => e.is_published && e.registration_open).length],
          ["Cupos ocupados", events.reduce((sum, e) => sum + e.taken, 0)],
          ["Cupos disponibles", events.reduce((sum, e) => sum + Math.max(0, e.capacity - e.taken), 0)],
        ].map(([label, value]) => <div key={label} className="card p-4 sm:p-5"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold tabular-nums tracking-tight">{value}</p></div>)}
      </div>
      <p className="mt-3 text-xs text-slate-500">Totales de todas las fechas configuradas. Un acompañante también ocupa un cupo.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((e) => {
          const { capacity: cap, taken, first_day: first, date_count } = e;
          return (
            <Link key={e.id} href={supervisorOnly ? `/admin/eventos/${e.id}/dashboard` : `/admin/eventos/${e.id}`} className="card group overflow-hidden transition hover:shadow-md">
              <div className="h-2" style={{ background: e.primary_color }} />
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {e.tenant_name} · {e.project_name}
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
                    <span className="text-slate-500"> / {cap} cupos ocupados</span>
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      !e.is_published ? "bg-slate-100 text-slate-600" : e.registration_open ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {!e.is_published ? "Borrador" : e.registration_open ? "Abierto" : "Cerrado"}
                  </span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${cap ? Math.min(100, taken / cap * 100) : 0}%`, background: e.primary_color }} /></div>
                <p className="mt-4 text-sm font-semibold text-indigo-700">{supervisorOnly ? "Ver dashboard y personal →" : "Gestionar evento →"}</p>
              </div>
            </Link>
          );
        })}
        {events.length === 0 && (
          <div className="card col-span-full p-10 text-center"><CalendarDays className="mx-auto size-10 text-indigo-400" /><h2 className="mt-4 text-lg font-semibold">Tu próximo evento empieza aquí</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{supervisorOnly ? "Aún no te agregaron como supervisor en ningún evento." : "Crea un evento, agrega sus fechas y comparte el enlace para recibir inscripciones."}</p>{canCreate && <Link href="/admin/eventos/nuevo" className="btn-dark mt-5"><Plus className="size-4" /> Crear mi primer evento</Link>}</div>
        )}
      </div>
    </>
  );
}
