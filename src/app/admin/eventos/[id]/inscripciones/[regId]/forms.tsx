"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { saveCompanion, updateHolder } from "./actions";
import type { FormState } from "@/app/admin/actions";
import { FieldError, FormMessage, SubmitButton } from "@/components/admin/ui";
import { DOCUMENT_LABELS, DOCUMENT_TYPES } from "@/lib/validation";

type Hidden = { eventId: string; registrationId: string };

export function HolderForm({
  ids, dates, value,
}: {
  ids: Hidden;
  dates: { id: string; label: string; disabled: boolean }[];
  value: { eventDateId: string; fullName: string; documentType: string; documentNumber: string; employeeCode: string; company: string; email: string; phone: string };
}) {
  const [state, action] = useActionState<FormState, FormData>(updateHolder, {});
  const e = state.fieldErrors ?? {};
  const input = (name: keyof typeof value, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label" htmlFor={`h-${name}`}>{label}</label>
      <input id={`h-${name}`} name={name} defaultValue={value[name]} className="input" aria-invalid={Boolean(e[name]) || undefined} {...props} />
      <FieldError error={e[name]} />
    </div>
  );
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="eventId" value={ids.eventId} />
      <input type="hidden" name="registrationId" value={ids.registrationId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">{input("fullName", "Nombre completo")}</div>
        <div>
          <label className="label" htmlFor="h-documentType">Tipo de documento</label>
          <select id="h-documentType" name="documentType" defaultValue={value.documentType} className="input">
            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_LABELS[t]}</option>)}
          </select>
        </div>
        {input("documentNumber", "Número de documento", { autoComplete: "off" })}
        {input("employeeCode", "Código del trabajador (opcional)", { autoComplete: "off" })}
        <div>
          <label className="label" htmlFor="h-eventDateId">Fecha</label>
          <select id="h-eventDateId" name="eventDateId" defaultValue={value.eventDateId} className="input">
            {dates.map((d) => <option key={d.id} value={d.id} disabled={d.disabled}>{d.label}</option>)}
          </select>
          <FieldError error={e.eventDateId} />
        </div>
        {input("company", "Empresa (opcional)")}
        {input("email", "Correo (opcional)", { type: "email" })}
        {input("phone", "Celular (opcional)", { type: "tel" })}
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Guardando…">Guardar cambios</SubmitButton>
    </form>
  );
}

/** Alta o edición de un acompañante. Sin `companion` agrega uno nuevo. */
export function CompanionForm({
  ids, companion, onDone,
}: {
  ids: Hidden;
  companion?: { id: string; fullName: string; documentType: string; documentNumber: string };
  onDone?: () => void;
}) {
  const [state, action] = useActionState<FormState, FormData>(saveCompanion, {});
  const ref = useRef<HTMLFormElement>(null);
  const e = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok) { if (!companion) ref.current?.reset(); onDone?.(); }
  }, [state, companion, onDone]);
  const k = companion?.id ?? "new";
  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="eventId" value={ids.eventId} />
      <input type="hidden" name="registrationId" value={ids.registrationId} />
      {companion && <input type="hidden" name="companionId" value={companion.id} />}
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-3">
          <label className="label text-xs" htmlFor={`c-name-${k}`}>Nombre completo</label>
          <input id={`c-name-${k}`} name="fullName" defaultValue={companion?.fullName} className="input" />
          <FieldError error={e.fullName} />
        </div>
        <div>
          <label className="label text-xs" htmlFor={`c-type-${k}`}>Tipo</label>
          <select id={`c-type-${k}`} name="documentType" defaultValue={companion?.documentType ?? "DNI"} className="input">
            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label text-xs" htmlFor={`c-doc-${k}`}>Documento</label>
          <input id={`c-doc-${k}`} name="documentNumber" defaultValue={companion?.documentNumber} className="input" autoComplete="off" />
          <FieldError error={e.documentNumber} />
        </div>
      </div>
      {state.message && !state.ok && <FormMessage state={state} />}
      {state.ok && !companion && <FormMessage state={state} />}
      <SubmitButton className="btn-dark py-2" pendingLabel="Guardando…">{companion ? "Guardar" : "Agregar acompañante"}</SubmitButton>
    </form>
  );
}

export function EditableCompanion({
  ids, companion, children,
}: {
  ids: Hidden;
  companion: { id: string; fullName: string; documentType: string; documentNumber: string };
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li className="rounded-xl bg-indigo-50/50 p-3">
        <div className="mb-2 flex justify-end">
          <button type="button" onClick={() => setEditing(false)} className="rounded-lg p-1 text-slate-400 hover:bg-white" aria-label="Cancelar edición"><X className="size-4" /></button>
        </div>
        <CompanionForm ids={ids} companion={companion} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{companion.fullName}</span>
        <span className="text-sm text-slate-500">{companion.documentType} {companion.documentNumber}</span>
      </span>
      <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
        <Pencil className="size-4" /> Editar
      </button>
      {children}
    </li>
  );
}
