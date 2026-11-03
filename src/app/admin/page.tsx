import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import { adminTenantIds, requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDayShort } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Eventos" };

export default async function AdminHome() {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const { data: events } = await supabase
    .from("events")
    .select("id, name, slug, is_published, registration_open, primary_color, logo_url, tenants(name), event_dates(event_day, capacity, registered_count)")
    .order("created_at", { ascending: false });

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
        {(events ?? []).map((e) => {
          const dates = (e.event_dates as { event_day: string; capacity: number; registered_count: number }[]) ?? [];
          const cap = dates.reduce((s, d) => s + d.capacity, 0);
          const taken = dates.reduce((s, d) => s + d.registered_count, 0);
          const first = dates.map((d) => d.event_day).sort()[0];
          return (
            <Link key={e.id} href={`/admin/eventos/${e.id}`} className="card group overflow-hidden transition hover:shadow-md">
              <div className="h-2" style={{ background: e.primary_color }} />
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {(e.tenants as unknown as { name: string } | null)?.name}
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
                  {dates.length > 1 && <span className="text-slate-400">+{dates.length - 1}</span>}
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
        {(events ?? []).length === 0 && (
          <div className="card col-span-full p-10 text-center text-slate-500">Aún no hay eventos.</div>
        )}
      </div>
    </>
  );
}
