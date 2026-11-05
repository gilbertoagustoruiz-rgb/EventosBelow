import Link from "next/link";
import { ChevronRight, KeyRound, LogOut, ScanLine } from "lucide-react";
import { requireViewer, visibleTenantFilter } from "@/lib/auth";
import { PROFILES } from "@/lib/profiles";
import { query } from "@/lib/db";
import { formatDayShort } from "@/lib/format";
import { logout } from "@/app/login/actions";

export const metadata = { title: "Acreditación" };
export const dynamic = "force-dynamic";

/** Eventos con fechas de hoy en adelante que el usuario puede acreditar. */
export default async function CheckinIndex() {
  const viewer = await requireViewer();
  const list = await query<{
    id: string;
    name: string;
    primary_color: string;
    tenant_name: string;
    next_day: string;
    is_today: boolean;
  }>(
    `select e.id, e.name, e.primary_color, t.name as tenant_name,
            min(d.event_day) as next_day,
            min(d.event_day) = (now() at time zone e.timezone)::date as is_today
       from events e
       join tenants t on t.id = e.tenant_id
       join event_dates d on d.event_id = e.id and d.event_day >= (now() at time zone e.timezone)::date
      where ($1::uuid[] is null or e.tenant_id = any($1) or e.id = any($2))
      group by e.id, t.name
      order by next_day, e.name`,
    // Administrador: todos · Coordinador: sus clientes · Supervisor/promotor: eventos donde lo agregaron
    [visibleTenantFilter(viewer), viewer.staff.map((s) => s.event_id)],
  );

  return (
    <main className="mx-auto min-h-dvh max-w-xl bg-slate-950 px-4 py-8 text-white">
      <div className="flex items-start justify-between">
        <ScanLine className="size-7 text-emerald-400" />
        <div className="flex gap-1">
          <Link href="/cuenta" className="rounded-lg p-2 text-slate-400 hover:bg-white/10" aria-label="Cambiar contraseña">
            <KeyRound className="size-4" />
          </Link>
          <form action={logout}>
            <button className="rounded-lg p-2 text-slate-400 hover:bg-white/10" aria-label="Cerrar sesión">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
      <h1 className="mt-3 text-2xl font-bold">Acreditación</h1>
      <p className="mt-1 text-slate-400">
        {viewer.fullName ?? viewer.email ?? viewer.username}
        {viewer.profile && ` · ${PROFILES[viewer.profile].label}`}
      </p>
      <p className="mt-1 text-sm text-slate-500">Elige el evento que vas a acreditar.</p>

      <ul className="mt-6 space-y-2">
        {list.map((e) => (
          <li key={e.id}>
            <Link href={`/checkin/${e.id}`} className="flex items-center gap-4 rounded-xl bg-white/5 p-4 transition hover:bg-white/10">
              <span className="size-3 shrink-0 rounded-full" style={{ background: e.primary_color }} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{e.name}</p>
                <p className="text-sm text-slate-400">
                  {e.tenant_name} · {formatDayShort(e.next_day)}
                </p>
              </div>
              {e.is_today && <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300">Hoy</span>}
              <ChevronRight className="size-5 text-slate-500" />
            </Link>
          </li>
        ))}
        {list.length === 0 && <p className="rounded-xl bg-white/5 p-6 text-center text-slate-400">No tienes eventos próximos asignados. Pide al coordinador o supervisor que te agregue al evento.</p>}
      </ul>
    </main>
  );
}
