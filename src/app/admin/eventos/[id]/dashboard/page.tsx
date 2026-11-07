import Link from "next/link";
import { AlertTriangle, ArrowLeft, Clock, DoorOpen, ScanLine, UserCheck, UserPlus, Users } from "lucide-react";
import { requireEvent } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { brandStyle, formatClock, formatDateTime, formatDayShort, todayIn } from "@/lib/format";
import { eventStaff, staffCandidates } from "@/lib/staff";
import { EventStaff } from "../staff";
import { AutoRefresh } from "@/components/auto-refresh";
import type { EventDate } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard del evento" };

const RESULT: Record<string, { label: string; tone: string }> = {
  INGRESO: { label: "Ingreso", tone: "bg-emerald-50 text-emerald-700" },
  YA_INGRESO: { label: "Ya había ingresado", tone: "bg-amber-50 text-amber-800" },
  FECHA_INCORRECTA: { label: "Otra fecha", tone: "bg-amber-50 text-amber-800" },
  CANCELADO: { label: "Cancelado", tone: "bg-red-50 text-red-700" },
  NO_ENCONTRADO: { label: "No encontrado", tone: "bg-slate-100 text-slate-600" },
};
const METHOD: Record<string, string> = { QR: "QR", DOCUMENTO: "DNI/código", BUSQUEDA: "Nombre" };

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fecha?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { event, access } = await requireEvent(id, "supervise");
  const tz = event.timezone;
  const dates = await query<EventDate>("select * from event_dates where event_id = $1 order by event_day, starts_at", [id]);

  // Fecha elegida (null = todas). Por defecto: hoy si hay función hoy; si no, todas.
  const today = todayIn(tz);
  const fecha =
    sp.fecha === "todas" ? null : (dates.find((d) => d.id === sp.fecha) ?? dates.find((d) => d.event_day === today))?.id ?? null;
  const P = [id, fecha] as const;
  const dateCond = "($2::uuid is null or r.event_date_id = $2)";

  const [kpi, invitees, hours, groups, activity, recent, staff, candidates] = await Promise.all([
    queryOne<{ registrations: number; expected: number; holders_in: number; companions_in: number; groups_in: number }>(
      `select count(*)::int as registrations,
              coalesce(sum(r.seats), 0)::int as expected,
              count(r.holder_checked_in_at)::int as holders_in,
              coalesce(sum((select count(*) from companions c where c.registration_id = r.id and c.checked_in_at is not null)), 0)::int as companions_in,
              count(*) filter (where r.holder_checked_in_at is not null
                               or exists (select 1 from companions c where c.registration_id = r.id and c.checked_in_at is not null))::int as groups_in
         from registrations r
        where r.event_id = $1 and r.status <> 'CANCELADO' and ${dateCond}`,
      [...P],
    ),
    queryOne<{ n: number }>("select count(*)::int as n from invitees where event_id = $1", [id]),
    // Ingresos por hora (hora local del evento), titulares y acompañantes
    query<{ hour: number; persons: number }>(
      `with entries as (
         select r.holder_checked_in_at as at from registrations r
          where r.event_id = $1 and r.status <> 'CANCELADO' and r.holder_checked_in_at is not null and ${dateCond}
         union all
         select c.checked_in_at from companions c join registrations r on r.id = c.registration_id
          where r.event_id = $1 and r.status <> 'CANCELADO' and c.checked_in_at is not null and ${dateCond}
       )
       select extract(hour from at at time zone $3)::int as hour, count(*)::int as persons
         from entries group by 1 order by 1`,
      [...P, tz],
    ),
    // Grupos que ingresaron: solo, con 1 acompañante, con 2 o más
    query<{ bucket: string; n: number }>(
      `select case when x.c = 0 then 'solo' when x.c = 1 then 'uno' else 'varios' end as bucket, count(*)::int as n
         from (
           select (select count(*) from companions c where c.registration_id = r.id and c.checked_in_at is not null) as c
             from registrations r
            where r.event_id = $1 and r.status <> 'CANCELADO' and r.holder_checked_in_at is not null and ${dateCond}
         ) x group by 1`,
      [...P],
    ),
    // Gestión por persona (incluye el enlace general como "sin usuario")
    query<{ employee_id: string | null; name: string; profile: string | null; ingresos: number; persons: number; alerts: number; not_found: number; last_at: string | null }>(
      `select l.employee_id, coalesce(e.full_name, 'Enlace general') as name, e.profile::text as profile,
              count(*) filter (where l.result = 'INGRESO')::int as ingresos,
              coalesce(sum(l.persons) filter (where l.result = 'INGRESO'), 0)::int as persons,
              count(*) filter (where l.result in ('YA_INGRESO', 'FECHA_INCORRECTA', 'CANCELADO'))::int as alerts,
              count(*) filter (where l.result = 'NO_ENCONTRADO')::int as not_found,
              max(l.created_at) as last_at
         from checkin_log l left join employees e on e.id = l.employee_id
        where l.event_id = $1 and ($2::uuid is null or l.event_date_id = $2)
        group by l.employee_id, e.full_name, e.profile
        order by persons desc, name`,
      [...P],
    ),
    query<{ id: number; created_at: string; result: string; method: string; persons: number; detail: string | null; employee: string | null; person: string | null }>(
      `select l.id, l.created_at, l.result, l.method, l.persons, l.detail, e.full_name as employee, r.full_name as person
         from checkin_log l
         left join employees e on e.id = l.employee_id
         left join registrations r on r.id = l.registration_id
        where l.event_id = $1 and ($2::uuid is null or l.event_date_id = $2)
        order by l.id desc limit 40`,
      [...P],
    ),
    eventStaff(id),
    staffCandidates(),
  ]);

  const k = kpi ?? { registrations: 0, expected: 0, holders_in: 0, companions_in: 0, groups_in: 0 };
  const entered = k.holders_in + k.companions_in;
  const pct = k.expected ? Math.round((entered / k.expected) * 100) : 0;
  const peak = hours.reduce<{ hour: number; persons: number } | null>((m, h) => (!m || h.persons > m.persons ? h : m), null);
  const maxHour = peak?.persons ?? 0;
  const hourRange = hours.length ? range(hours[0].hour, hours[hours.length - 1].hour) : [];
  const g = (b: string) => groups.find((x) => x.bucket === b)?.n ?? 0;
  const totalGroups = g("solo") + g("uno") + g("varios");
  const selected = dates.find((d) => d.id === fecha);

  return (
    <div style={brandStyle(event.primary_color)} className="space-y-8">
      <div>
        <Link href={access === "manage" ? `/admin/eventos/${id}` : "/admin"} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="size-4" /> {access === "manage" ? "Volver al evento" : "Mis eventos"}
        </Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">Dashboard</p>
            <h1 className="text-2xl font-bold">{event.name}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <AutoRefresh />
            <Link href={`/checkin/${id}`} className="btn-brand py-2"><ScanLine className="size-4" /> Acreditar</Link>
          </div>
        </div>
      </div>

      <nav aria-label="Fecha" className="flex flex-wrap gap-2">
        <DateLink href={`?fecha=todas`} active={!fecha}>Todas las fechas</DateLink>
        {dates.map((d) => (
          <DateLink key={d.id} href={`?fecha=${d.id}`} active={d.id === fecha}>
            {formatDayShort(d.event_day)}{d.event_day === today ? " · Hoy" : ""}{d.label ? ` · ${d.label}` : ""}
          </DateLink>
        ))}
      </nav>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Indicadores">
        <Kpi icon={<DoorOpen />} label="Personas que ingresaron" value={entered} hint={`${pct}% de ${k.expected} esperadas`} strong />
        <Kpi icon={<UserCheck />} label="Titulares que ingresaron" value={k.holders_in} hint={`de ${k.registrations} inscritos`} />
        <Kpi icon={<UserPlus />} label="Acompañantes que ingresaron" value={k.companions_in} hint={`de ${k.expected - k.registrations} registrados`} />
        <Kpi icon={<Users />} label="Base de invitados" value={invitees?.n ?? 0} hint={`${k.registrations} confirmaron${selected ? " esta fecha" : ""}`} />
      </section>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="card p-5 lg:col-span-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold"><Clock className="size-4 text-slate-400" /> Ingresos por hora</h2>
            {peak && <p className="text-sm text-slate-600">Hora pico: <b>{hh(peak.hour)}–{hh(peak.hour + 1)}</b> · {peak.persons} personas</p>}
          </div>
          {hourRange.length ? (
            <div className="mt-5 flex h-48 items-end justify-center gap-1.5" role="img" aria-label={`Ingresos por hora. Hora pico ${hh(peak!.hour)} con ${peak!.persons} personas`}>
              {hourRange.map((h) => {
                const n = hours.find((x) => x.hour === h)?.persons ?? 0;
                const isPeak = n > 0 && n === maxHour;
                return (
                  <div key={h} className="flex min-w-0 max-w-16 flex-1 flex-col items-center gap-1">
                    <span className={`text-xs tabular-nums ${isPeak ? "font-bold text-slate-900" : "text-slate-500"}`}>{n || ""}</span>
                    <div
                      className={`w-full rounded-t-md ${isPeak ? "bg-brand" : "bg-brand/35"}`}
                      style={{ height: `${maxHour ? Math.max(n ? 4 : 0, (n / maxHour) * 150) : 0}px` }}
                      title={`${hh(h)}: ${n} personas`}
                    />
                    <span className="text-[11px] tabular-nums text-slate-500">{hh(h)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-6 rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">Aún no hay ingresos registrados.</p>
          )}
        </section>

        <section className="card p-5 lg:col-span-2">
          <h2 className="font-semibold">¿Cómo llegaron?</h2>
          <p className="text-sm text-slate-500">Titulares que ingresaron, según acompañantes que entraron con ellos.</p>
          <ul className="mt-5 space-y-4">
            {[
              ["Solos", g("solo")],
              ["Con 1 acompañante", g("uno")],
              ["Con más de un acompañante", g("varios")],
            ].map(([label, n]) => {
              const share = totalGroups ? Math.round(((n as number) / totalGroups) * 100) : 0;
              return (
                <li key={label as string}>
                  <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums"><b>{n}</b> <span className="text-slate-400">· {share}%</span></span></div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand" style={{ width: `${share}%` }} /></div>
                </li>
              );
            })}
          </ul>
          <p className="mt-5 text-xs text-slate-500">{k.groups_in} {k.groups_in === 1 ? "grupo ingresó" : "grupos ingresaron"} en total.</p>
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="p-5">
          <h2 className="font-semibold">Gestión de supervisores y promotores</h2>
          <p className="text-sm text-slate-500">Alertas = intentos de ingreso repetido, de otra fecha o de una inscripción cancelada.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="p-3">Persona</th><th className="p-3 text-right">Ingresos</th><th className="p-3 text-right">Personas</th><th className="p-3 text-right">Alertas</th><th className="p-3 text-right">No encontrados</th><th className="p-3">Última actividad</th></tr>
            </thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.employee_id ?? "link"} className="border-t border-slate-100">
                  <td className="p-3 font-medium">{a.name}<span className="block text-xs font-normal text-slate-500">{a.profile === "SUPERVISOR" ? "Supervisor" : a.profile === "PROMOTOR" ? "Promotor" : a.profile ? "Coordinación" : "Sin usuario"}</span></td>
                  <td className="p-3 text-right tabular-nums">{a.ingresos}</td>
                  <td className="p-3 text-right font-semibold tabular-nums">{a.persons}</td>
                  <td className={`p-3 text-right tabular-nums ${a.alerts ? "text-amber-700" : ""}`}>{a.alerts}</td>
                  <td className="p-3 text-right tabular-nums">{a.not_found}</td>
                  <td className="p-3 text-slate-600">{formatDateTime(a.last_at, tz)}</td>
                </tr>
              ))}
              {activity.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Todavía no hay actividad de acreditación.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card overflow-hidden">
        <h2 className="p-5 font-semibold">Actividad reciente</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {recent.map((l) => {
            const r = RESULT[l.result] ?? { label: l.result, tone: "bg-slate-100" };
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                <span className="w-20 whitespace-nowrap tabular-nums text-slate-500">{formatClock(l.created_at, tz)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.tone}`}>
                  {l.result === "YA_INGRESO" && <AlertTriangle className="mr-1 inline size-3" />}{r.label}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {l.person ?? l.detail ?? "—"}
                  {l.result === "INGRESO" && l.detail && <span className="text-slate-500"> · {l.detail}</span>}
                </span>
                <span className="text-xs text-slate-500">{METHOD[l.method] ?? l.method} · {l.employee ?? "Enlace general"}</span>
              </li>
            );
          })}
          {recent.length === 0 && <li className="px-5 pb-6 text-center text-slate-500">Sin movimientos.</li>}
        </ul>
      </section>

      <EventStaff eventId={id} staff={staff} candidates={candidates} canManageSupervisors={access === "manage"} />
    </div>
  );
}

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function Kpi({ icon, label, value, hint, strong }: { icon: React.ReactElement; label: string; value: number; hint: string; strong?: boolean }) {
  return (
    <div className={`card p-4 sm:p-5 ${strong ? "ring-2 ring-brand/20" : ""}`}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500 [&>svg]:size-4">{icon}{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function DateLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
      {children}
    </Link>
  );
}
