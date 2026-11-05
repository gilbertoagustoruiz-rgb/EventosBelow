"use client";

import { useActionState, useEffect, useRef } from "react";
import { ExternalLink, RefreshCw, UserCheck, UserMinus, Users } from "lucide-react";
import { selectPromoters, updateEventPromoter } from "./promoter-actions";
import type { FormState } from "@/app/admin/actions";
import { ConfirmButton, CopyButton, FormMessage, SubmitButton } from "@/components/admin/ui";

export interface EventPromoter {
  id: string;
  full_name: string;
  document_number: string | null;
  is_active: boolean;
  still_assigned: boolean;
  access_key: string;
  url: string;
  checkins: number;
}

export function EventPromoters({
  eventId,
  available,
  selected,
}: {
  eventId: string;
  available: { id: string; full_name: string; document_number: string | null }[];
  selected: EventPromoter[];
}) {
  const [state, action] = useActionState<FormState, FormData>(selectPromoters, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Users className="size-5" /> Promotores del evento</h2>
        <p className="text-sm text-slate-600">
          Elige quién acreditará en este evento. Cada promotor recibe su propio enlace; todo lo que acredite queda a su nombre.
        </p>
      </div>

      {available.length > 0 ? (
        <form ref={ref} action={action} className="space-y-3">
          <input type="hidden" name="eventId" value={eventId} />
          <div className="flex flex-wrap gap-2">
            {available.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-indigo-600 has-[:checked]:bg-indigo-50">
                <input type="checkbox" name="employeeId" value={p.id} />
                {p.full_name}
                {p.document_number && <span className="text-slate-400">· {p.document_number}</span>}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton className="btn-brand py-2" pendingLabel="Seleccionando…">
              <UserCheck className="size-4" /> Seleccionar para este evento
            </SubmitButton>
          </div>
        </form>
      ) : (
        <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
          {selected.length
            ? "Ya seleccionaste a todos los promotores disponibles para este cliente."
            : "Este cliente no tiene promotores asignados. Pide al administrador general que los asigne."}
        </p>
      )}

      {/* Fuera del formulario: si se eligió al último disponible, el formulario desaparece */}
      <FormMessage state={state} />

      {selected.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {selected.map((p) => {
            const usable = p.is_active && p.still_assigned;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <div className="min-w-48 flex-1">
                  <p className="font-medium">{p.full_name}</p>
                  <p className="text-xs text-slate-500">
                    {!p.still_assigned ? "Ya no está asignado a este cliente" : p.is_active ? "Activo" : "Retirado"}
                    {` · ${p.checkins} acreditación(es)`}
                  </p>
                </div>
                {usable && (
                  <>
                    <CopyButton value={p.url} label="Copiar enlace" />
                    <a className="btn-ghost px-3 py-1.5" target="_blank" rel="noreferrer" href={p.url}>
                      <ExternalLink className="size-4" /> Abrir
                    </a>
                  </>
                )}
                <form action={updateEventPromoter}>
                  <input type="hidden" name="id" value={p.id} />
                  {p.is_active ? (
                    <>
                      <input type="hidden" name="operation" value="disable" />
                      <ConfirmButton message={`¿Retirar a ${p.full_name} de este evento? Su enlace dejará de funcionar.`} className="btn-ghost px-3 py-1.5 text-red-600">
                        <UserMinus className="size-4" /> Retirar
                      </ConfirmButton>
                    </>
                  ) : (
                    p.still_assigned && (
                      <>
                        <input type="hidden" name="operation" value="enable" />
                        <button className="btn-ghost px-3 py-1.5">Volver a activar</button>
                      </>
                    )
                  )}
                </form>
                {usable && (
                  <form action={updateEventPromoter}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="operation" value="rotate" />
                    <ConfirmButton message="¿Generar un enlace nuevo? El actual dejará de funcionar." className="btn-ghost px-3 py-1.5">
                      <RefreshCw className="size-4" /> Nuevo enlace
                    </ConfirmButton>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
