"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { addEventDate, deleteEventDate, updateEventDate, type FormState } from "@/app/admin/actions";
import { formatDay, formatTime } from "@/lib/format";
import type { EventDate } from "@/lib/types";
import { ConfirmButton, FieldError, FormMessage, SubmitButton } from "./ui";

export function DatesManager({ eventId, dates }: { eventId: string; dates: EventDate[] }) {
  const [state, action] = useActionState<FormState, FormData>(addEventDate, {});
  const formRef = useRef<HTMLFormElement>(null);
  const e = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">Agrega cada día y horario del evento. El aforo cuenta solo titulares: los acompañantes se registran pero no ocupan cupo.</p>
      <div className="overflow-x-auto" role="region" aria-label="Fechas y cupos del evento" tabIndex={0}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Fecha</th>
              <th className="py-2 pr-4 font-medium">Horario</th>
              <th className="py-2 pr-4 font-medium">Ocupación</th>
              <th className="py-2 pr-4 font-medium">Aforo</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dates.map((d) => (
              <DateRow key={d.id} eventId={eventId} date={d} />
            ))}
            {dates.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">Agrega al menos una fecha para abrir el registro.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form ref={formRef} action={action} className="rounded-xl bg-slate-50 p-4">
        <input type="hidden" name="eventId" value={eventId} />
        <p className="mb-3 text-sm font-semibold">Nueva fecha</p>
        <div className="grid gap-3 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <label className="label text-xs" htmlFor="eventDay">Día</label>
            <input id="eventDay" name="eventDay" type="date" required className="input" />
            <FieldError error={e.eventDay} />
          </div>
          <div>
            <label className="label text-xs" htmlFor="startsAt">Inicio</label>
            <input id="startsAt" name="startsAt" type="time" defaultValue="09:00" required className="input" />
          </div>
          <div>
            <label className="label text-xs" htmlFor="endsAt">Fin</label>
            <input id="endsAt" name="endsAt" type="time" defaultValue="18:00" required className="input" />
            <FieldError error={e.endsAt} />
          </div>
          <div className="sm:col-span-2">
            <label className="label text-xs" htmlFor="capacity">Aforo máximo</label>
            <input id="capacity" name="capacity" type="number" min={1} required className="input" placeholder="200" />
            <FieldError error={e.capacity} />
          </div>
          <div className="sm:col-span-4">
            <label className="label text-xs" htmlFor="label">Etiqueta (opcional)</label>
            <input id="label" name="label" className="input" placeholder="Ej: Día 1 · Conferencias" />
          </div>
          <div className="flex items-end sm:col-span-2">
            <SubmitButton className="btn-dark w-full">
              <Plus className="size-4" /> Agregar
            </SubmitButton>
          </div>
        </div>
        <div className="mt-2">
          <FormMessage state={state} />
        </div>
      </form>
    </div>
  );
}

/** Fila de una fecha: vista normal y modo edición con todos sus datos. */
function DateRow({ eventId, date: d }: { eventId: string; date: EventDate }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState<FormState, FormData>(updateEventDate, {});
  const e = state.fieldErrors ?? {};
  useEffect(() => { if (state.ok) setEditing(false); }, [state]);
  const pct = Math.round((d.registered_count / d.capacity) * 100);
  const id = (f: string) => `${f}-${d.id}`;

  if (editing) {
    return (
      <tr className="bg-indigo-50/40">
        <td colSpan={5} className="p-3">
          <form action={action} className="space-y-3">
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="dateId" value={d.id} />
            <div className="grid gap-3 sm:grid-cols-6">
              <div className="sm:col-span-2">
                <label className="label text-xs" htmlFor={id("day")}>Día</label>
                <input id={id("day")} name="eventDay" type="date" required defaultValue={d.event_day} className="input" />
                <FieldError error={e.eventDay} />
              </div>
              <div>
                <label className="label text-xs" htmlFor={id("start")}>Inicio</label>
                <input id={id("start")} name="startsAt" type="time" required defaultValue={d.starts_at.slice(0, 5)} className="input" />
                <FieldError error={e.startsAt} />
              </div>
              <div>
                <label className="label text-xs" htmlFor={id("end")}>Fin</label>
                <input id={id("end")} name="endsAt" type="time" required defaultValue={d.ends_at.slice(0, 5)} className="input" />
                <FieldError error={e.endsAt} />
              </div>
              <div className="sm:col-span-2">
                <label className="label text-xs" htmlFor={id("cap")}>Aforo máximo</label>
                <input id={id("cap")} name="capacity" type="number" required min={Math.max(1, d.registered_count)} defaultValue={d.capacity} className="input" />
                <FieldError error={e.capacity} />
              </div>
              <div className="sm:col-span-4">
                <label className="label text-xs" htmlFor={id("label")}>Etiqueta (opcional)</label>
                <input id={id("label")} name="label" defaultValue={d.label ?? ""} className="input" placeholder="Ej: Día 1 · Conferencias" />
              </div>
              <div className="flex items-end gap-2 sm:col-span-2">
                <SubmitButton className="btn-dark flex-1" pendingLabel="Guardando…">Guardar</SubmitButton>
                <button type="button" onClick={() => setEditing(false)} className="btn-ghost px-3" aria-label="Cancelar edición">
                  <X className="size-4" />
                </button>
              </div>
            </div>
            {d.registered_count > 0 && (
              <p className="text-xs text-amber-700">
                Esta fecha ya tiene {d.registered_count} titulares confirmados: si cambias el día o el horario, esas confirmaciones e
                invitados asignados pasan al nuevo día. El aforo no puede bajar de {d.registered_count}.
              </p>
            )}
            {state.message && !state.ok && <FormMessage state={state} />}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="py-3 pr-4">
        <p className="font-medium">{formatDay(d.event_day, { year: undefined })}</p>
        {d.label && <p className="text-slate-500">{d.label}</p>}
      </td>
      <td className="py-3 pr-4 tabular-nums">{formatTime(d.starts_at)} – {formatTime(d.ends_at)}</td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 85 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <span className="tabular-nums text-slate-600">{d.registered_count}/{d.capacity}</span>
        </div>
      </td>
      <td className="py-3 pr-4 font-semibold tabular-nums">{d.capacity.toLocaleString("es-PE")}</td>
      <td className="py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          {state.ok && <span className="mr-1 text-xs text-emerald-700">Guardado</span>}
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
            <Pencil className="size-4" /> Editar
          </button>
          {d.registered_count === 0 && (
            <form action={deleteEventDate}>
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="dateId" value={d.id} />
              <ConfirmButton message="¿Eliminar esta fecha?" className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600">
                <Trash2 className="size-4" /><span className="sr-only">Eliminar fecha {formatDay(d.event_day)}</span>
              </ConfirmButton>
            </form>
          )}
        </div>
      </td>
    </tr>
  );
}
