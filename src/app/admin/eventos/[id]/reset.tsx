"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { resetEvent } from "./reset-actions";
import type { FormState } from "@/app/admin/actions";
import { FieldError, FormMessage } from "@/components/admin/ui";

/** Zona de reinicio del evento (solo administrador). */
export function ResetEvent({
  eventId,
  registrations,
  checkins,
  invitees,
}: {
  eventId: string;
  registrations: number;
  checkins: number;
  invitees: number;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(resetEvent, {});
  const [scope, setScope] = useState<"registros" | "todo">("registros");
  const [word, setWord] = useState("");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) { setWord(""); ref.current?.reset(); } }, [state]);
  const ready = word.trim().toUpperCase() === "REINICIAR";

  return (
    <section id="reiniciar" className="card border-red-200 p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-red-700">
        <RotateCcw className="size-5" /> Reiniciar evento
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Úsalo al terminar las pruebas, antes de que empiece el evento. Se conservan el evento, sus fechas y aforos, la
        configuración y el personal. <b>No se puede deshacer.</b>
      </p>
      <p className="mt-2 text-sm text-slate-500">
        Hoy hay {registrations} confirmaciones, {checkins} registros de ingreso y {invitees} invitados en la base.
      </p>

      <form ref={ref} action={action} className="mt-4 space-y-4">
        <input type="hidden" name="eventId" value={eventId} />
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { value: "registros", title: "Solo confirmaciones e ingresos", hint: "Borra confirmaciones, acompañantes e ingresos. La base de invitados queda cargada." },
            { value: "todo", title: "Todo, incluida la base de invitados", hint: "Además borra la base, para volver a cargar el Excel definitivo." },
          ].map((o) => (
            <label key={o.value} className={`flex cursor-pointer gap-3 rounded-xl border-2 p-4 ${scope === o.value ? "border-red-400 bg-red-50/50" : "border-slate-200"}`}>
              <input type="radio" name="scope" value={o.value} checked={scope === o.value} onChange={() => setScope(o.value as typeof scope)} className="mt-1" />
              <span>
                <span className="block text-sm font-semibold">{o.title}</span>
                <span className="block text-xs text-slate-500">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="max-w-xs">
          <label className="label" htmlFor="reset-confirm">Escribe REINICIAR para confirmar</label>
          <input id="reset-confirm" name="confirm" className="input" autoComplete="off" value={word} onChange={(e) => setWord(e.target.value)} />
          <FieldError error={state.fieldErrors?.confirm} />
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!ready || pending}
        >
          <RotateCcw className="size-4" /> {pending ? "Reiniciando…" : scope === "todo" ? "Reiniciar todo" : "Reiniciar confirmaciones e ingresos"}
        </button>
        <FormMessage state={state} />
      </form>
    </section>
  );
}
