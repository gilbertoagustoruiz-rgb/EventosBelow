import Link from "next/link";
import { ArrowLeft, Download, ExternalLink, FileSpreadsheet, RefreshCw, ScanLine, Search } from "lucide-react";
import { requireEvent } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { withCheckinBy } from "@/lib/registrations";
import { appUrl, brandStyle, formatDateTime, formatDayShort } from "@/lib/format";
import { EventPromoters, type EventPromoter } from "./event-promoters";
import { EventForm } from "@/components/admin/event-form";
import { DatesManager } from "@/components/admin/dates-manager";
import { ConfirmButton, CopyButton } from "@/components/admin/ui";
import { cancelRegistration, regenerateCheckinKey } from "@/app/admin/actions";
import type { EventDate, Registration } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; fecha?: string; page?: string; creado?: string; logo?: string }>;
};

export default async function EventAdminPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { event } = await requireEvent(id, "admin");
  const page = Math.max(1, Number(sp.page) || 1);
  const fecha = sp.fecha && /^[0-9a-f-]{36}$/i.test(sp.fecha) ? sp.fecha : null;
  const q = sp.q?.trim() || null;

  const dates = await query<EventDate>(
    "select * from event_dates where event_id = $1 order by event_day, starts_at",
    [id],
  );

  // Filtros parametrizados; $3 = texto libre (nombre/correo), $4 = documento normalizado
  const where = `event_id = $1
    and ($2::uuid is null or event_date_id = $2)
    and ($3::text is null
         or full_name ilike '%' || $3 || '%'
         or email ilike '%' || $3 || '%'
         or ($4 <> '' and document_number like $4 || '%'))`;
  const like = q?.replace(/[\\%_]/g, (c) => "\\" + c) ?? null;
  const doc = q?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  const filterParams = [id, fecha, like, doc];

  const [regs, countRow, tenant] = await Promise.all([
    query<Registration & { checked_in_by_label: string | null }>(
      withCheckinBy(
        `select * from registrations where ${where} order by created_at desc limit ${PAGE_SIZE} offset $5`,
        "r.created_at desc",
      ),
      [...filterParams, (page - 1) * PAGE_SIZE],
    ),
    queryOne<{ n: number }>(`select count(*) as n from registrations where ${where}`, filterParams),
    queryOne<{ id: string; name: string }>("select id, name from tenants where id = $1", [event.tenant_id]),
  ]);
  const count = countRow?.n ?? 0;

  // Promotores que el administrador asignó al cliente y aún no están seleccionados en este evento
  const availablePromoters = await query<{ id: string; full_name: string; document_number: string | null }>(
    `select e.id, e.full_name, e.document_number
       from employees e
       join employee_clients ec on ec.employee_id = e.id and ec.tenant_id = $1
      where e.profile = 'PROMOTOR' and e.is_active
        and not exists (select 1 from event_promoters ep where ep.event_id = $2 and ep.employee_id = e.id and ep.is_active)
      order by e.full_name`,
    [event.tenant_id, id],
  );
  const selectedPromoters: EventPromoter[] = (
    await query<Omit<EventPromoter, "url">>(
      `select ep.id, e.full_name, e.document_number, ep.access_key,
              ep.is_active and e.is_active as is_active,
              exists (select 1 from employee_clients ec where ec.employee_id = e.id and ec.tenant_id = $2) as still_assigned,
              (select count(*) from promoter_checkins c where c.promoter_id = ep.id)::int as checkins
         from event_promoters ep join employees e on e.id = ep.employee_id
        where ep.event_id = $1
        order by ep.is_active desc, e.full_name`,
      [id, event.tenant_id],
    )
  ).map((p) => ({ ...p, url: appUrl(`/promotor/${p.access_key}`) }));

  const publicUrl = appUrl(`/evento/${event.slug}`);
  const checkinUrl = appUrl(`/acreditar/${event.checkin_key}`);
  const dateById = new Map(dates.map((d) => [d.id, d]));
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const exportQs = fecha ? `&fecha=${fecha}` : "";

  return (
    <div style={brandStyle(event.primary_color)} className="space-y-8">
      <div>
        <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="size-4" /> Eventos
        </Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">{tenant?.name}</p>
            <h1 className="text-2xl font-bold">{event.name}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/checkin/${event.id}`} className="btn-ghost">
              <ScanLine className="size-4" /> Acreditar asistentes
            </Link>
            {event.is_published && (
              <a href={publicUrl} target="_blank" rel="noreferrer" className="btn-brand">
                <ExternalLink className="size-4" /> Ver portal
              </a>
            )}
          </div>
        </div>
        {sp.logo === "error" && (
          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            El evento se creó, pero el logo no se pudo subir. Vuelve a cargarlo abajo, en Configuración y branding.
          </p>
        )}
        {sp.creado && (
          <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
            Evento creado. Agrega las fechas con su aforo y luego márcalo como publicado.
          </p>
        )}
      </div>

      <nav aria-label="Secciones del evento" className="flex flex-wrap gap-2">
        {[["fechas", "1. Fechas y cupos"], ["inscripciones", "2. Inscripciones"], ["configuracion", "3. Configuración"]].map(([anchor, label]) => <a key={anchor} href={`#${anchor}`} className="btn-ghost">{label}</a>)}
      </nav>
      {(!dates.length || !event.is_published) && <aside className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5 text-sm text-indigo-900"><h2 className="font-semibold">Prepara tu evento para recibir inscripciones</h2><ul className="mt-2 space-y-1"><li>{dates.length ? "✓ Ya agregaste las fechas." : "1. Agrega al menos una fecha con sus cupos."}</li><li>{event.is_published ? "✓ El evento está publicado." : "2. Activa «Publicado» en Configuración cuando esté listo."}</li><li>3. Comparte el enlace de registro con tus invitados.</li></ul></aside>}

      {/* Enlace público --------------------------------------------------------------- */}
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm font-medium text-slate-700">Enlace de registro:</span>
        <code className="min-w-0 flex-1 break-all rounded bg-slate-100 px-2 py-1 text-sm">{publicUrl}</code>
        <CopyButton value={publicUrl} />
        {!event.is_published && <span className="text-xs font-medium text-amber-700">Aún no publicado</span>}
      </div>

      {/* Enlace de acreditación ------------------------------------------------------ */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <ScanLine className="size-4" /> Enlace de acreditación:
          </span>
          <code className="min-w-0 flex-1 break-all rounded bg-slate-100 px-2 py-1 text-sm">{checkinUrl}</code>
          <CopyButton value={checkinUrl} />
          <a href={checkinUrl} target="_blank" rel="noreferrer" className="btn-ghost px-3 py-1.5">
            <ExternalLink className="size-4" /> Abrir
          </a>
          <form action={regenerateCheckinKey}>
            <input type="hidden" name="eventId" value={event.id} />
            <ConfirmButton
              message="¿Generar un enlace nuevo? El enlace actual dejará de funcionar para todos los anfitriones."
              className="btn-ghost px-3 py-1.5"
            >
              <RefreshCw className="size-4" /> Regenerar
            </ConfirmButton>
          </form>
        </div>
        <p className="text-xs text-slate-500">
          Compártelo solo con tus anfitriones: quien lo abra puede acreditar y ver los datos de los asistentes sin iniciar sesión.
          Si se filtra, regenéralo.
        </p>
      </div>

      <EventPromoters eventId={event.id} available={availablePromoters} selected={selectedPromoters} />

      {/* Fechas y aforo ------------------------------------------------------------- */}
      <section id="fechas" className="card p-4 sm:p-6">
        <h2 className="mb-4 text-lg font-semibold">Fechas y aforo</h2>
        <DatesManager eventId={event.id} dates={dates} />
      </section>

      {/* Registros ------------------------------------------------------------------ */}
      <section id="inscripciones" className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            Inscripciones <span className="font-normal text-slate-500">({count})</span>
          </h2>
          <div className="flex gap-2">
            <Link href={`/admin/eventos/${event.id}/importar`} className="btn-brand py-2"><FileSpreadsheet className="size-4"/> Importar Excel</Link>
            <a href={`/admin/eventos/${event.id}/exportar?formato=xlsx${exportQs}`} className="btn-ghost py-2">
              <FileSpreadsheet className="size-4" /> Excel
            </a>
            <a href={`/admin/eventos/${event.id}/exportar?formato=csv${exportQs}`} className="btn-ghost py-2">
              <Download className="size-4" /> CSV
            </a>
          </div>
        </div>

        <form className="mt-4 flex flex-wrap gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input name="q" aria-label="Buscar inscripciones por nombre, correo o documento" defaultValue={sp.q} placeholder="Nombre, correo o documento" className="input py-2 pl-9" />
          </div>
          <select name="fecha" aria-label="Filtrar por fecha del evento" defaultValue={sp.fecha ?? ""} className="input w-full py-2 sm:w-auto">
            <option value="">Todas las fechas</option>
            {dates.map((d) => (
              <option key={d.id} value={d.id}>{formatDayShort(d.event_day)}{d.label ? ` · ${d.label}` : ""}</option>
            ))}
          </select>
          <button className="btn-dark py-2">Filtrar</button>
          {(q || fecha) && <Link href={`/admin/eventos/${id}#inscripciones`} className="btn-ghost">Limpiar filtros</Link>}
        </form>

        <p className="mt-3 text-xs text-slate-500">En pantallas pequeñas, desliza la tabla para ver todos los datos.</p>
        <div className="mt-4 overflow-x-auto" role="region" aria-label="Inscripciones del evento" tabIndex={0}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Asistente</th>
                <th className="py-2 pr-4 font-medium">Documento</th>
                <th className="py-2 pr-4 font-medium">Empresa</th>
                <th className="py-2 pr-4 font-medium">Fecha</th>
                <th className="py-2 pr-4 font-medium">Acompañante</th>
                <th className="py-2 pr-4 font-medium">Estado</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {regs.map((r) => {
                const d = dateById.get(r.event_date_id);
                return (
                  <tr key={r.id} className={r.status === "CANCELADO" ? "text-slate-400" : ""}>
                    <td className="py-3 pr-4">
                      <p className="font-medium">{r.full_name}</p>
                      <p className="text-slate-500">{r.email} · {r.phone}</p>
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">{r.document_type} {r.document_number}</td>
                    <td className="py-3 pr-4">
                      {r.company ?? "—"}
                      {r.job_title && <p className="text-slate-500">{r.job_title}</p>}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">{d ? formatDayShort(d.event_day) : "—"}</td>
                    <td className="py-3 pr-4">
                      {r.has_companion ? (
                        <>
                          {r.companion_full_name}
                          <p className="text-slate-500">{r.companion_document_number}</p>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <StatusBadge status={r.status} />
                      {r.holder_checked_in_at && (
                        <p className="mt-1 text-xs text-slate-500">Titular: {formatDateTime(r.holder_checked_in_at, event.timezone)}</p>
                      )}
                      {r.companion_checked_in_at && (
                        <p className="text-xs text-slate-500">Acompañante: {formatDateTime(r.companion_checked_in_at, event.timezone)}</p>
                      )}
                      {r.checked_in_by_label && <p className="text-xs text-slate-400">por {r.checked_in_by_label}</p>}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      {r.status === "REGISTRADO" && !r.companion_checked_in_at && (
                        <form action={cancelRegistration}>
                          <input type="hidden" name="eventId" value={event.id} />
                          <input type="hidden" name="registrationId" value={r.id} />
                          <ConfirmButton message={`¿Cancelar el registro de ${r.full_name}? Se liberarán sus cupos.`}>Cancelar</ConfirmButton>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
              {regs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">{q || fecha ? "No encontramos inscripciones con estos filtros. Prueba con otro dato o limpia los filtros." : "Aún no hay inscripciones. Publica el evento y comparte su enlace de registro."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-end gap-2 text-sm">
            {page > 1 && <PageLink sp={sp} page={page - 1}>Anterior</PageLink>}
            <span className="text-slate-500">Página {page} de {totalPages}</span>
            {page < totalPages && <PageLink sp={sp} page={page + 1}>Siguiente</PageLink>}
          </div>
        )}
      </section>

      {/* Configuración -------------------------------------------------------------- */}
      <section id="configuracion" className="card p-4 sm:p-8">
        <h2 className="mb-6 text-lg font-semibold">Configuración y branding</h2>
        <EventForm event={event} tenants={tenant ? [tenant] : []} />
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: Registration["status"] }) {
  const map = {
    REGISTRADO: "bg-sky-50 text-sky-700",
    CHECKED_IN: "bg-emerald-50 text-emerald-700",
    CANCELADO: "bg-slate-100 text-slate-500",
  } as const;
  const label = { REGISTRADO: "Registrado", CHECKED_IN: "Ingresó", CANCELADO: "Cancelado" }[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${map[status]}`}>{label}</span>;
}

function PageLink({ sp, page, children }: { sp: Record<string, string | undefined>; page: number; children: React.ReactNode }) {
  const qs = new URLSearchParams();
  if (sp.q) qs.set("q", sp.q);
  if (sp.fecha) qs.set("fecha", sp.fecha);
  qs.set("page", String(page));
  return <Link href={`?${qs}`} className="btn-ghost px-3 py-1.5">{children}</Link>;
}
