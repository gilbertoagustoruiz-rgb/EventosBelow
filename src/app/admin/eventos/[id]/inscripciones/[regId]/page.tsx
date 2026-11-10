import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, RotateCcw, Trash2, UserPlus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { formatDateTime, formatDayShort, formatTime } from "@/lib/format";
import { ConfirmButton } from "@/components/admin/ui";
import { deleteRegistration, removeCompanionAdmin, undoCheckin } from "./actions";
import { CompanionForm, EditableCompanion, HolderForm } from "./forms";
import type { EventDate, EventRow, Registration } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar asistente" };

/** Edición completa de un asistente (solo administrador general). */
export default async function EditAttendeePage({ params }: { params: Promise<{ id: string; regId: string }> }) {
  const { id, regId } = await params;
  await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(regId)) notFound();
  const [event, reg] = await Promise.all([
    queryOne<EventRow>("select * from events where id = $1", [id]),
    queryOne<Registration>("select * from registrations where id = $1 and event_id = $2", [regId, id]),
  ]);
  if (!event || !reg) notFound();
  const [dates, companions] = await Promise.all([
    query<EventDate>("select * from event_dates where event_id = $1 order by event_day, starts_at", [id]),
    query<{ id: string; full_name: string; document_type: string; document_number: string; checked_in_at: string | null }>(
      "select id, full_name, document_type, document_number, checked_in_at from companions where registration_id = $1 order by position",
      [regId],
    ),
  ]);
  const tz = event.timezone;
  const ids = { eventId: id, registrationId: regId };
  const anyIn = Boolean(reg.holder_checked_in_at) || companions.some((c) => c.checked_in_at);
  const active = reg.status !== "CANCELADO";
  const canAddCompanion = active && event.companion_mode !== "NONE" && companions.length < event.max_companions;
  const hidden = (
    <>
      <input type="hidden" name="eventId" value={id} />
      <input type="hidden" name="registrationId" value={regId} />
    </>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/admin/eventos/${id}#inscripciones`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" /> {event.name}
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{reg.full_name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Confirmó el {formatDateTime(reg.created_at, tz)} ·{" "}
          {reg.status === "CANCELADO" ? "Cancelado" : reg.holder_checked_in_at ? "Ingresó" : "Confirmado"}
        </p>
      </div>

      <section className="card p-5 sm:p-6">
        <h2 className="mb-4 font-semibold">Datos del titular</h2>
        <HolderForm
          ids={ids}
          dates={dates.map((d) => ({
            id: d.id,
            label: `${formatDayShort(d.event_day)} · ${formatTime(d.starts_at)}${d.label ? ` · ${d.label}` : ""} (${d.registered_count}/${d.capacity})`,
            disabled: d.id !== reg.event_date_id && (anyIn || (active && d.registered_count >= d.capacity)),
          }))}
          value={{
            eventDateId: reg.event_date_id, fullName: reg.full_name, documentType: reg.document_type, documentNumber: reg.document_number,
            employeeCode: reg.employee_code ?? "", company: reg.company ?? "", email: reg.email ?? "", phone: reg.phone ?? "",
          }}
        />
        {anyIn && <p className="mt-3 text-xs text-slate-500">Para cambiarlo de fecha, primero anula sus ingresos.</p>}
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="font-semibold">Ingreso al evento</h2>
        {reg.holder_checked_in_at ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
              <CheckCircle2 className="size-4" /> El titular ingresó el {formatDateTime(reg.holder_checked_in_at, tz)}
            </span>
            <form action={undoCheckin} className="ml-auto">
              {hidden}
              <input type="hidden" name="holder" value="1" />
              <ConfirmButton message="¿Anular el ingreso del titular? Volverá a figurar como pendiente de ingresar." className="btn-ghost py-2">
                <RotateCcw className="size-4" /> Anular ingreso
              </ConfirmButton>
            </form>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">El titular aún no ingresa.</p>
        )}
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="font-semibold">Acompañantes</h2>
        <p className="text-sm text-slate-500">
          Máximo {event.max_companions} por invitado. Los acompañantes no ocupan cupo.
        </p>
        <ul className="mt-3 divide-y divide-slate-100">
          {companions.map((c) => (
            <EditableCompanion key={c.id} ids={ids} companion={{ id: c.id, fullName: c.full_name, documentType: c.document_type, documentNumber: c.document_number }}>
              {c.checked_in_at && (
                <form action={undoCheckin}>
                  {hidden}
                  <input type="hidden" name="companionId" value={c.id} />
                  <ConfirmButton message={`¿Anular el ingreso de ${c.full_name}?`} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-amber-700 hover:bg-amber-50">
                    <RotateCcw className="size-4" /> Anular ingreso ({formatDateTime(c.checked_in_at, tz)})
                  </ConfirmButton>
                </form>
              )}
              <form action={removeCompanionAdmin}>
                {hidden}
                <input type="hidden" name="companionId" value={c.id} />
                <ConfirmButton message={`¿Quitar a ${c.full_name} de esta inscripción?`} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="size-4" /><span className="sr-only">Quitar a {c.full_name}</span>
                </ConfirmButton>
              </form>
            </EditableCompanion>
          ))}
          {companions.length === 0 && <li className="py-3 text-sm text-slate-500">Sin acompañantes.</li>}
        </ul>
        {canAddCompanion && (
          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-medium"><UserPlus className="size-4" /> Agregar acompañante</p>
            <CompanionForm ids={ids} />
          </div>
        )}
      </section>

      <section className="card border-red-200 p-5 sm:p-6">
        <h2 className="font-semibold text-red-700">Eliminar asistente</h2>
        <p className="mt-1 text-sm text-slate-600">
          Borra la inscripción, sus acompañantes y sus ingresos, y libera su cupo. Sigue en la base de invitados, así que
          podrá volver a confirmar. <b>No se puede deshacer.</b>
        </p>
        <form action={deleteRegistration} className="mt-4">
          {hidden}
          <ConfirmButton
            message={`¿Eliminar a ${reg.full_name}${companions.length ? ` y sus ${companions.length} acompañante(s)` : ""}? No se puede deshacer.`}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
          >
            <Trash2 className="size-4" /> Eliminar asistente
          </ConfirmButton>
        </form>
      </section>
    </div>
  );
}
