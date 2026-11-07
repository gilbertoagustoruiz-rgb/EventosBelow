import Link from "next/link";
import { ArrowLeft, CalendarDays, Clock, DoorOpen, Gauge, Hourglass, MapPin, Timer, UserPlus, Users } from "lucide-react";
import { requireClientEvent } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { brandStyle, formatClock, formatDayShort, todayIn } from "@/lib/format";
import { AutoRefresh } from "@/components/auto-refresh";
import { ReportLinks } from "@/components/admin/report-links";
import type { EventDate } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Dashboard del evento" } };

/* Dashboard del cliente: asistentes frente a la base cargada, en línea. Solo lectura. */
export default async function ClientDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fecha?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { event, viewer } = await requireClientEvent(id);
  const tz = event.timezone;
  const dates = await query<EventDate>("select * from event_dates where event_id = $1 order by event_day, starts_at", [id]);

  const today = todayIn(tz);
  const todayDate = dates.find((d) => d.event_day === today);
  const fecha = sp.fecha === "todas" ? null : (dates.find((d) => d.id === sp.fecha) ?? todayDate)?.id ?? null;
  const selected = dates.find((d) => d.id === fecha);
  const live = Boolean(todayDate && (!fecha || fecha === todayDate.id));
  const P = [id, fecha] as const;
  const regDate = "($2::uuid is null or r.event_date_id = $2)";
  // Personas que ingresaron (titulares y acompañantes), con su hora
  const entries = `
    select r.holder_checked_in_at as at, 'T' as kind, r.full_name as name, r.event_date_id
      from registrations r
     where r.event_id = $1 and r.status <> 'CANCELADO' and r.holder_checked_in_at is not null and ${regDate}
    union all
    select c.checked_in_at, 'A', c.full_name, r.event_date_id
      from companions c join registrations r on r.id = c.registration_id
     where r.event_id = $1 and r.status <> 'CANCELADO' and c.checked_in_at is not null and ${regDate}`;

  const [base, regs, hours, pace, arrival, perDate, companies, recent, groups] = await Promise.all([
    queryOne<{ total: number; assigned: number; for_date: number }>(
      `select count(*)::int as total,
              count(event_date_id)::int as assigned,
              count(*) filter (where event_date_id = $2)::int as for_date
         from invitees where event_id = $1`,
      [...P],
    ),
    queryOne<{ confirmed: number; persons: number; holders_in: number; companions_in: number; companions: number }>(
      `select count(*)::int as confirmed,
              coalesce(sum(r.seats), 0)::int as persons,
              count(r.holder_checked_in_at)::int as holders_in,
              coalesce(sum(r.companions_count), 0)::int as companions,
              coalesce(sum((select count(*) from companions c where c.registration_id = r.id and c.checked_in_at is not null)), 0)::int as companions_in
         from registrations r
        where r.event_id = $1 and r.status <> 'CANCELADO' and ${regDate}`,
      [...P],
    ),
    query<{ hour: number; persons: number }>(
      `select extract(hour from at at time zone $3)::int as hour, count(*)::int as persons
         from (${entries}) x group by 1 order by 1`,
      [...P, tz],
    ),
    queryOne<{ last15: number; prev15: number }>(
      `select count(*) filter (where at > now() - interval '15 minutes')::int as last15,
              count(*) filter (where at <= now() - interval '15 minutes' and at > now() - interval '30 minutes')::int as prev15
         from (${entries}) x`,
      [...P],
    ),
    // Hora media del día (no mezcla fechas): mediana de la hora local de llegada
    queryOne<{ first_at: string | null; last_at: string | null; median_time: string | null }>(
      `select min(at) as first_at, max(at) as last_at,
              to_char(time '00:00' + percentile_cont(0.5) within group (order by extract(epoch from (at at time zone $3)::time))
                      * interval '1 second', 'HH24:MI') as median_time
         from (${entries}) x`,
      [...P, tz],
    ),
    query<{ id: string; base: number; confirmed: number; holders_in: number; persons_in: number }>(
      `select d.id,
              (select count(*) from invitees i where i.event_date_id = d.id)::int as base,
              (select count(*) from registrations r where r.event_date_id = d.id and r.status <> 'CANCELADO')::int as confirmed,
              (select count(*) from registrations r where r.event_date_id = d.id and r.status <> 'CANCELADO' and r.holder_checked_in_at is not null)::int as holders_in,
              ((select count(*) from registrations r where r.event_date_id = d.id and r.status <> 'CANCELADO' and r.holder_checked_in_at is not null)
               + (select count(*) from companions c join registrations r on r.id = c.registration_id
                   where r.event_date_id = d.id and r.status <> 'CANCELADO' and c.checked_in_at is not null))::int as persons_in
         from event_dates d where d.event_id = $1 order by d.event_day, d.starts_at`,
      [id],
    ),
    query<{ company: string; base: number; attended: number }>(
      `select coalesce(nullif(trim(i.company), ''), 'Sin empresa') as company,
              count(*)::int as base,
              count(r.holder_checked_in_at)::int as attended
         from invitees i
         left join registrations r on r.invitee_id = i.id and r.status <> 'CANCELADO'
        where i.event_id = $1 and ($2::uuid is null or i.event_date_id = $2 or i.event_date_id is null)
        group by 1 order by base desc limit 8`,
      [...P],
    ),
    query<{ at: string; kind: string; name: string; event_date_id: string }>(
      `select at, kind, name, event_date_id from (${entries}) x order by at desc limit 8`,
      [...P],
    ),
    query<{ bucket: string; n: number }>(
      `select case when x.c = 0 then 'solo' when x.c = 1 then 'uno' else 'varios' end as bucket, count(*)::int as n
         from (select (select count(*) from companions c where c.registration_id = r.id and c.checked_in_at is not null) as c
                 from registrations r
                where r.event_id = $1 and r.status <> 'CANCELADO' and r.holder_checked_in_at is not null and ${regDate}) x
        group by 1`,
      [...P],
    ),
  ]);

  // Base de comparación: los asignados a la fecha elegida; si la base no trae fechas, la base completa
  const baseN = fecha && (base?.assigned ?? 0) > 0 ? base!.for_date : (base?.total ?? 0);
  const r = regs ?? { confirmed: 0, persons: 0, holders_in: 0, companions_in: 0, companions: 0 };
  const peopleIn = r.holders_in + r.companions_in;
  const attendPct = pct(r.holders_in, baseN);
  const confirmPct = pct(r.confirmed, baseN);
  const showUpPct = pct(r.holders_in, r.confirmed);
  const waiting = Math.max(0, r.persons - peopleIn);
  const peak = hours.reduce<{ hour: number; persons: number } | null>((m, h) => (!m || h.persons > m.persons ? h : m), null);
  const maxHour = peak?.persons ?? 0;
  const hourRange = hours.length ? range(hours[0].hour, hours[hours.length - 1].hour) : [];
  const g = (b: string) => groups.find((x) => x.bucket === b)?.n ?? 0;
  const groupTotal = g("solo") + g("uno") + g("varios");
  const showCompanies = companies.length >= 2;
  const dateById = new Map(dates.map((d) => [d.id, d]));
  const trend = pace ? pace.last15 - pace.prev15 : 0;
  const multiDay = !fecha && dates.length > 1;
  const dayOf = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", timeZone: tz });
  const withDay = (iso: string | null) => (iso ? `${multiDay ? dayOf.format(new Date(iso)) + " · " : ""}${formatClock(iso, tz)}` : "—");

  return (
    <div style={brandStyle(event.primary_color)} className="space-y-6">
      {viewer.profile !== "CLIENTE" || viewer.clientTenants.length > 1 ? (
        <Link href="/cliente" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="size-4" /> Tus eventos
        </Link>
      ) : null}

      {/* Encabezado con la marca del evento */}
      <section className="overflow-hidden rounded-2xl bg-brand text-brand-fg shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-7">
          {event.logo_url && (
            <span className="self-start rounded-xl bg-white p-2.5 shadow-sm sm:self-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={event.logo_url} alt="" className="h-12 w-auto max-w-40 object-contain" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{event.name}</h1>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm opacity-90">
              {event.venue && <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" />{event.venue}</span>}
              {dates.length > 0 && (
                <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" />{dates.map((d) => formatDayShort(d.event_day)).join(" · ")}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {live && (
              <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-red-600">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-red-600" />
                </span>
                En vivo
              </span>
            )}
            <div className="rounded-xl bg-white text-slate-900"><AutoRefresh /></div>
          </div>
        </div>
      </section>

      {dates.length > 1 && (
        <nav aria-label="Fecha" className="flex flex-wrap gap-2">
          <DateLink href="?fecha=todas" active={!fecha}>Todas las fechas</DateLink>
          {dates.map((d) => (
            <DateLink key={d.id} href={`?fecha=${d.id}`} active={d.id === fecha}>
              {formatDayShort(d.event_day)}{d.event_day === today ? " · Hoy" : ""}{d.label ? ` · ${d.label}` : ""}
            </DateLink>
          ))}
        </nav>
      )}

      {/* Asistentes vs base cargada */}
      <section className="grid gap-4 lg:grid-cols-5">
        <div className="card p-5 sm:p-6 lg:col-span-3">
          <p className="text-sm font-medium text-slate-500">Asistentes frente a la base cargada{selected ? ` · ${formatDayShort(selected.event_day)}` : ""}</p>
          <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
            <p className="text-5xl font-bold tabular-nums tracking-tight sm:text-6xl">{r.holders_in.toLocaleString("es-PE")}</p>
            <p className="pb-2 text-lg text-slate-500">de <b className="text-slate-800 tabular-nums">{baseN.toLocaleString("es-PE")}</b> invitados</p>
            <p className="ml-auto pb-2 text-3xl font-bold tabular-nums">{attendPct}%</p>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={attendPct} aria-label="Porcentaje de asistencia sobre la base">
            <div className="h-full rounded-full bg-brand transition-all duration-700" style={{ width: `${Math.min(100, attendPct)}%` }} />
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Con acompañantes ingresaron <b className="tabular-nums">{peopleIn.toLocaleString("es-PE")}</b> personas.
            {r.confirmed > 0 && <> El <b>{showUpPct}%</b> de quienes confirmaron ya llegó.</>}
          </p>
        </div>

        <div className="card p-5 sm:p-6 lg:col-span-2">
          <p className="text-sm font-medium text-slate-500">Del invitado al ingreso</p>
          <ul className="mt-4 space-y-4">
            {[
              { label: "Base cargada", n: baseN, p: 100 },
              { label: "Confirmaron asistencia", n: r.confirmed, p: confirmPct },
              { label: "Ingresaron al evento", n: r.holders_in, p: attendPct },
            ].map((s) => (
              <li key={s.label}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{s.label}</span>
                  <span className="tabular-nums"><b>{s.n.toLocaleString("es-PE")}</b> <span className="text-slate-400">· {s.p}%</span></span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100" title={`${s.label}: ${s.n} (${s.p}%)`}>
                  <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, s.p)}%`, opacity: s.label === "Base cargada" ? 0.35 : 1 }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Indicadores">
        <Kpi icon={<Users />} label="Confirmaron" value={r.confirmed} hint={`${confirmPct}% de la base`} />
        <Kpi icon={<UserPlus />} label="Acompañantes que ingresaron" value={r.companions_in} hint={`de ${r.companions} registrados`} />
        <Kpi icon={<Hourglass />} label="Por llegar" value={waiting} hint="confirmados que aún no ingresan" />
        {live ? (
          <Kpi
            icon={<Gauge />}
            label="Ritmo de llegada"
            value={pace?.last15 ?? 0}
            hint={`en los últimos 15 min${trend ? ` · ${trend > 0 ? "▲" : "▼"} ${Math.abs(trend)} vs. los 15 anteriores` : ""}`}
          />
        ) : (
          <Kpi icon={<Timer />} label="Hora media de llegada" text={clock12(arrival?.median_time)} hint="la mitad llegó antes de esta hora" />
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Horas pico */}
        <section className="card p-5 sm:p-6 lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold"><Clock className="size-4 text-slate-400" /> Horas pico de ingreso</h2>
            {peak && <p className="text-sm text-slate-600">Hora pico: <b>{hh(peak.hour)}–{hh(peak.hour + 1)}</b> · {peak.persons} personas</p>}
          </div>
          {hourRange.length ? (
            <>
              <div className="mt-6 flex h-52 items-end justify-center gap-1.5" role="img" aria-label={`Ingresos por hora. Hora pico ${hh(peak!.hour)} con ${peak!.persons} personas`}>
                {hourRange.map((h) => {
                  const n = hours.find((x) => x.hour === h)?.persons ?? 0;
                  const isPeak = n > 0 && n === maxHour;
                  return (
                    <div key={h} className="group flex min-w-0 max-w-16 flex-1 flex-col items-center gap-1" title={`${hh(h)}–${hh(h + 1)}: ${n} personas`}>
                      <span className={`text-xs tabular-nums ${isPeak ? "font-bold text-slate-900" : "text-slate-500"}`}>{n || ""}</span>
                      <div
                        className={`w-full rounded-t-[4px] transition group-hover:opacity-80 ${isPeak ? "bg-brand" : "bg-brand/40"}`}
                        style={{ height: `${maxHour ? Math.max(n ? 4 : 0, (n / maxHour) * 160) : 0}px` }}
                      />
                      <span className="text-[11px] tabular-nums text-slate-500">{hh(h)}</span>
                    </div>
                  );
                })}
              </div>
              <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-center text-sm">
                <div><dt className="text-slate-500">Primer ingreso</dt><dd className="font-semibold tabular-nums">{withDay(arrival?.first_at ?? null)}</dd></div>
                <div><dt className="text-slate-500">Hora media</dt><dd className="font-semibold tabular-nums">{clock12(arrival?.median_time)}</dd></div>
                <div><dt className="text-slate-500">Último ingreso</dt><dd className="font-semibold tabular-nums">{withDay(arrival?.last_at ?? null)}</dd></div>
              </dl>
            </>
          ) : (
            <p className="mt-6 rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">
              {live ? "Esperando los primeros ingresos…" : "Aún no hay ingresos registrados."}
            </p>
          )}
        </section>

        {/* Últimas llegadas */}
        <section className="card p-5 sm:p-6 lg:col-span-2">
          <h2 className="flex items-center gap-2 font-semibold"><DoorOpen className="size-4 text-slate-400" /> Últimas llegadas</h2>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {recent.map((e, i) => (
              <li key={i} className="flex items-center gap-3 py-2.5">
                <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-500">
                  {multiDay && <span className="mr-1 text-slate-400">{dayOf.format(new Date(e.at))}</span>}
                  {formatClock(e.at, tz)}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
                {e.kind === "A" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Acompañante</span>}
              </li>
            ))}
            {recent.length === 0 && <li className="py-6 text-center text-slate-500">Sin ingresos todavía.</li>}
          </ul>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Cómo llegaron */}
        <section className="card p-5 sm:p-6">
          <h2 className="font-semibold">¿Cómo llegaron?</h2>
          <p className="text-sm text-slate-500">Invitados que ingresaron, según los acompañantes que entraron con ellos.</p>
          <ul className="mt-5 space-y-4">
            {[["Solos", g("solo")], ["Con 1 acompañante", g("uno")], ["Con más de un acompañante", g("varios")]].map(([label, n]) => {
              const share = pct(n as number, groupTotal);
              return (
                <li key={label as string}>
                  <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums"><b>{n}</b> <span className="text-slate-400">· {share}%</span></span></div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand" style={{ width: `${share}%` }} /></div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Por fecha o por empresa */}
        {!fecha && dates.length > 1 ? (
          <section className="card p-5 sm:p-6">
            <h2 className="font-semibold">Asistencia por fecha</h2>
            <p className="text-sm text-slate-500">Invitados que ingresaron frente a los asignados a cada fecha.</p>
            <ul className="mt-5 space-y-4">
              {perDate.map((d) => {
                const date = dateById.get(d.id)!;
                const denom = d.base || d.confirmed;
                const p = pct(d.holders_in, denom);
                return (
                  <li key={d.id}>
                    <div className="flex flex-wrap justify-between gap-x-3 text-sm">
                      <span className="font-medium">{formatDayShort(date.event_day)}{date.label ? ` · ${date.label}` : ""}</span>
                      <span className="tabular-nums text-slate-600"><b className="text-slate-900">{d.holders_in}</b> de {denom} · {p}% <span className="text-slate-400">({d.confirmed} confirmaron)</span></span>
                    </div>
                    <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100" title={`${d.holders_in} de ${denom}`}>
                      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, p)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : showCompanies ? (
          <CompanySection companies={companies} />
        ) : (
          <section className="card p-5 sm:p-6">
            <h2 className="font-semibold">Confirmados por llegar</h2>
            <p className="text-sm text-slate-500">Personas confirmadas (con acompañantes) frente a las que ya ingresaron.</p>
            <p className="mt-6 text-4xl font-bold tabular-nums">{peopleIn} <span className="text-lg font-normal text-slate-500">de {r.persons}</span></p>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand" style={{ width: `${pct(peopleIn, r.persons)}%` }} /></div>
            <p className="mt-3 text-sm text-slate-600">{waiting ? `Faltan ${waiting} personas por llegar.` : r.persons ? "Llegaron todos los confirmados." : "Aún no hay confirmaciones."}</p>
          </section>
        )}
      </div>

      {showCompanies && !fecha && dates.length > 1 && <CompanySection companies={companies} />}

      <section className="card p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Descargar bases</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">Excel con los datos de este momento.</p>
        <ReportLinks eventId={event.id} confirmed={r.confirmed} entered={peopleIn} />
      </section>
    </div>
  );
}

/** "19:24" → "07:24 p. m." (mismo formato que el resto del panel) */
function clock12(t: string | null | undefined) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function CompanySection({ companies }: { companies: { company: string; base: number; attended: number }[] }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="font-semibold">Asistencia por empresa</h2>
      <p className="text-sm text-slate-500">Invitados que ingresaron frente a la base de cada empresa.</p>
      <ul className="mt-5 space-y-4">
        {companies.map((c) => {
          const p = pct(c.attended, c.base);
          return (
            <li key={c.company}>
              <div className="flex justify-between gap-3 text-sm">
                <span className="truncate">{c.company}</span>
                <span className="shrink-0 tabular-nums text-slate-600"><b className="text-slate-900">{c.attended}</b> de {c.base} · {p}%</span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand" style={{ width: `${p}%` }} /></div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Kpi({ icon, label, value, text, hint }: { icon: React.ReactElement; label: string; value?: number; text?: string; hint: string }) {
  return (
    <div className="card p-4 sm:p-5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500 [&>svg]:size-4">{icon}{label}</p>
      <p className={`mt-2 font-bold tabular-nums tracking-tight ${text ? "whitespace-nowrap text-2xl sm:text-3xl" : "text-3xl"}`}>{text ?? (value ?? 0).toLocaleString("es-PE")}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function DateLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ${active ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"}`}>
      {children}
    </Link>
  );
}
