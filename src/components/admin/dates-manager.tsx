"use client";

import { useActionState, useEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { addEventDate, deleteEventDate, updateCapacity, type FormState } from "@/app/admin/actions";
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
      <p className="text-sm text-slate-600">Agrega cada día y horario del evento. El aforo cuenta personas, incluidos los acompañantes.</p>
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
            {dates.map((d) => {
              const pct = Math.round((d.registered_count / d.capacity) * 100);
              return (
                <tr key={d.id}>
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
                  <td className="py-3 pr-4">
                    <CapacityEditor eventId={eventId} date={d} />
                  </td>
                  <td className="py-3 text-right">
                    {d.registered_count === 0 && (
                      <form action={deleteEventDate}>
                        <input type="hidden" name="eventId" value={eventId} />
                        <input type="hidden" name="dateId" value={d.id} />
                        <ConfirmButton message="¿Eliminar esta fecha?" className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="size-4" /><span className="sr-only">Eliminar fecha {formatDay(d.event_day)}</span>
                        </ConfirmButton>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
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

function CapacityEditor({ eventId, date }: { eventId: string; date: EventDate }) {
  const [state, action] = useActionState<FormState, FormData>(updateCapacity, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="dateId" value={date.id} />
      <input
        name="capacity"
        type="number"
        min={Math.max(1, date.registered_count)}
        defaultValue={date.capacity}
        className="input w-24 py-1.5"
        aria-label="Aforo"
      />
      <SubmitButton className="btn-ghost px-3 py-1.5">OK</SubmitButton>
      {state.message && !state.ok && <span className="text-xs text-red-600">{state.message}</span>}
    </form>
  );
}
