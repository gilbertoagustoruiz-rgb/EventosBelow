import Link from "next/link";
import { ArrowLeft, BarChart3, Eye, Pencil, Trash2, Download, ExternalLink, FileSpreadsheet, RefreshCw, ScanLine, Search, Users } from "lucide-react";
import { requireEvent } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { withCheckinBy } from "@/lib/registrations";
import { appUrl, brandStyle, formatDateTime, formatDayShort } from "@/lib/format";
import { EventStaff } from "./staff";
import { ResetEvent } from "./reset";
import { deleteRegistration } from "./inscripciones/[regId]/actions";
import { GenerateQr } from "@/components/admin/generate-qr";
import { ReportLinks } from "@/components/admin/report-links";
import { eventStaff, staffCandidates } from "@/lib/staff";
import { projectOptions } from "@/lib/projects";
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
  const { event, viewer } = await requireEvent(id, "admin");
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
         or employee_code ilike $3 || '%'
         or ($4 <> '' and document_number like $4 || '%'))`;
  const like = q?.replace(/[\\%_]/g, (c) => "\\" + c) ?? null;
  const doc = q?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  const filterParams = [id, fecha, like, doc];

  const [regs, countRow, tenant, staff, candidates, projects, inviteeCount] = await Promise.all([
    query<Registration & { checked_in_by_label: string | null; companions_in: number; companions_list: string | null }>(
      withCheckinBy(
        `select * from registrations where ${where} order by created_at desc limit ${PAGE_SIZE} offset $5`,
        "r.created_at desc",
      ),
      [...filterParams, (page - 1) * PAGE_SIZE],
    ),
    queryOne<{ n: number }>(`select count(*) as n from registrations where ${where}`, filterParams),
    queryOne<{ id: string; name: string; project: string }>(
      "select t.id, t.name, p.name as project from tenants t join projects p on p.id = $2 where t.id = $1",
      [event.tenant_id, event.project_id],
    ),
    eventStaff(id),
    staffCandidates(),
    projectOptions(viewer),
    queryOne<{ n: number }>("select count(*)::int as n from invitees where event_id = $1", [id]),
  ]);
  const reportCounts = await queryOne<{ confirmed: number; entered: number }>(
    `select count(*)::int as confirmed,
            (count(holder_checked_in_at)
              + coalesce(sum((select count(*) from companions c where c.registration_id = r.id and c.checked_in_at is not null)), 0))::int as entered
       from registrations r where r.event_id = $1 and r.status <> 'CANCELADO'`,
    [id],
  );
  const resetCounts = viewer.isPlatformAdmin
    ? await queryOne<{ regs: number; logs: number }>(
        `select (select count(*) from registrations where event_id = $1)::int as regs,
                (select count(*) from checkin_log where event_id = $1)::int as logs`,
        [id],
      )
    : null;
  const count = countRow?.n ?? 0;

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
            <p className="text-sm text-slate-500">{tenant?.name} · {tenant?.project}</p>
            <h1 className="text-2xl font-bold">{event.name}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/eventos/${event.id}/dashboard`} className="btn-ghost">
              <BarChart3 className="size-4" /> Dashboard
            </Link>
            <Link href={`/cliente/eventos/${event.id}`} className="btn-ghost">
              <Eye className="size-4" /> Vista del cliente
            </Link>
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
        {[["fechas", "1. Fechas y cupos"], ["invitados", "2. Invitados"], ["personal", "3. Personal"], ["inscripciones", "4. Inscripciones"], ["configuracion", "5. Configuración"]].map(([anchor, label]) => <a key={anchor} href={`#${anchor}`} className="btn-ghost">{label}</a>)}
      </nav>
      {(!dates.length || !event.is_published) && <aside className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5 text-sm text-indigo-900"><h2 className="font-semibold">Prepara tu evento para recibir inscripciones</h2><ul className="mt-2 space-y-1"><li>{dates.length ? "✓ Ya agregaste las fechas." : "1. Agrega al menos una fecha con sus cupos."}</li><li>{inviteeCount?.n ? `✓ Base de invitados cargada (${inviteeCount.n}).` : "2. Carga la base de invitados: solo ellos podrán confirmar su asistencia."}</li><li>{event.is_published ? "✓ El evento está publicado." : "3. Activa «Publicado» en Configuración cuando esté listo."}</li><li>4. Comparte el enlace con tus invitados: confirman con su DNI o código de vendedor.</li></ul></aside>}

      {/* Enlace público --------------------------------------------------------------- */}
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm font-medium text-slate-700">Enlace de registro:</span>
        <code className="min-w-0 flex-1 break-all rounded bg-slate-100 px-2 py-1 text-sm">{publicUrl}</code>
        <CopyButton value={publicUrl} />
        <GenerateQr eventId={event.id} eventName={event.name} url={publicUrl} />
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
              message="¿Generar un enlace nuevo? El enlace actual dejará de funcionar para quien lo tenga."
              className="btn-ghost px-3 py-1.5"
            >
              <RefreshCw className="size-4" /> Regenerar
            </ConfirmButton>
          </form>
        </div>
        <p className="text-xs text-slate-500">
          Enlace general sin inicio de sesión, para apoyo eventual. Los ingresos por este enlace figuran como «Enlace general».
          Lo recomendado es que supervisores y promotores ingresen con su usuario. Si se filtra, regenéralo.
        </p>
      </div>

      {/* Fechas y aforo ------------------------------------------------------------- */}
      <section id="fechas" className="card p-4 sm:p-6">
        <h2 className="mb-4 text-lg font-semibold">Fechas y aforo</h2>
        <DatesManager eventId={event.id} dates={dates} />
      </section>

      {/* Invitados ----------------------------------------------------------------- */}
      <section id="invitados" className="card flex flex-wrap items-center gap-4 p-4 sm:p-6">
        <span className="grid size-10 place-items-center rounded-xl bg-slate-100"><Users className="size-5 text-slate-500" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Base de invitados <span className="font-normal text-slate-500">({inviteeCount?.n ?? 0})</span></h2>
          <p className="text-sm text-slate-500">Solo las personas de la base pueden confirmar su asistencia, con su DNI o código de vendedor.</p>
        </div>
        <Link href={`/admin/eventos/${event.id}/invitados`} className="btn-ghost">Ver invitados</Link>
        <Link href={`/admin/eventos/${event.id}/importar`} className="btn-brand"><FileSpreadsheet className="size-4" /> Cargar Excel</Link>
      </section>

      <EventStaff eventId={event.id} staff={staff} candidates={candidates} canManageSupervisors />

      <section id="reportes" className="card p-4 sm:p-6">
        <h2 className="text-lg font-semibold">Reportes en Excel</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">Con el logo y los colores del evento. Se generan con los datos del momento.</p>
        <ReportLinks eventId={event.id} confirmed={reportCounts?.confirmed ?? 0} entered={reportCounts?.entered ?? 0} />
      </section>

      {/* Registros ------------------------------------------------------------------ */}
      <section id="inscripciones" className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            Inscripciones <span className="font-normal text-slate-500">({count})</span>
          </h2>
          <div className="flex gap-2">
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
            <input name="q" aria-label="Buscar inscripciones por nombre, correo, documento o código" defaultValue={sp.q} placeholder="Nombre, correo, documento o código" className="input py-2 pl-9" />
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
                <th className="py-2 pr-4 font-medium">Acompañantes</th>
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
                      {(r.email || r.phone) && <p className="text-slate-500">{[r.email, r.phone].filter(Boolean).join(" · ")}</p>}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      {r.document_type} {r.document_number}
                      {r.employee_code && <p className="text-slate-500">Cód. {r.employee_code}</p>}
                    </td>
                    <td className="py-3 pr-4">
                      {r.company ?? "—"}
                      {r.job_title && <p className="text-slate-500">{r.job_title}</p>}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">{d ? formatDayShort(d.event_day) : "—"}</td>
                    <td className="py-3 pr-4">
                      {r.companions_count > 0 ? (
                        <>
                          <p className="font-medium">{r.companions_count} · {r.companions_in} ingresaron</p>
                          <p className="max-w-64 text-xs text-slate-500">{r.companions_list}</p>
                        </>
                      ) : (
                        "Solo"
                      )}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <StatusBadge status={r.status} />
                      {r.holder_checked_in_at && (
                        <p className="mt-1 text-xs text-slate-500">Titular: {formatDateTime(r.holder_checked_in_at, event.timezone)}</p>
                      )}
                      {r.checked_in_by_label && <p className="text-xs text-slate-400">por {r.checked_in_by_label}</p>}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {viewer.isPlatformAdmin && (
                          <>
                            <Link href={`/admin/eventos/${event.id}/inscripciones/${r.id}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-indigo-700 hover:bg-indigo-50">
                              <Pencil className="size-3.5" /> Editar
                            </Link>
                            <form action={deleteRegistration}>
                              <input type="hidden" name="eventId" value={event.id} />
                              <input type="hidden" name="registrationId" value={r.id} />
                              <input type="hidden" name="back" value="list" />
                              <ConfirmButton
                                message={`¿Eliminar a ${r.full_name}${r.companions_count ? ` y sus ${r.companions_count} acompañante(s)` : ""}? Se borran su inscripción e ingresos. No se puede deshacer.`}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="size-4" /><span className="sr-only">Eliminar a {r.full_name}</span>
                              </ConfirmButton>
                            </form>
                          </>
                        )}
                        {!viewer.isPlatformAdmin && r.status === "REGISTRADO" && r.companions_in === 0 && (
                          <form action={cancelRegistration}>
                            <input type="hidden" name="eventId" value={event.id} />
                            <input type="hidden" name="registrationId" value={r.id} />
                            <ConfirmButton message={`¿Cancelar el registro de ${r.full_name}? Se liberará su cupo.`}>Cancelar</ConfirmButton>
                          </form>
                        )}
                      </div>
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
        <EventForm event={event} projects={projects} />
      </section>

      {resetCounts && (
        <ResetEvent eventId={event.id} registrations={resetCounts.regs} checkins={resetCounts.logs} invitees={inviteeCount?.n ?? 0} />
      )}
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
