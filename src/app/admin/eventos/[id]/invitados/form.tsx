"use client";

import { useActionState, useEffect, useRef } from "react";
import { addInvitee } from "./actions";
import type { FormState } from "@/app/admin/actions";
import { FieldError, FormMessage, SubmitButton } from "@/components/admin/ui";
import { DOCUMENT_LABELS, DOCUMENT_TYPES } from "@/lib/validation";

export function InviteeForm({ eventId }: { eventId: string }) {
  const [state, action] = useActionState<FormState, FormData>(addInvitee, {});
  const ref = useRef<HTMLFormElement>(null);
  const e = state.fieldErrors ?? {};
  useEffect(() => { if (state.ok) ref.current?.reset(); }, [state]);

  const input = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label" htmlFor={`inv-${name}`}>{label}</label>
      <input id={`inv-${name}`} name={name} className="input" aria-invalid={Boolean(e[name]) || undefined} {...props} />
      <FieldError error={e[name]} />
    </div>
  );

  return (
    <form ref={ref} action={action} className="space-y-4">
      <input type="hidden" name="eventId" value={eventId} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">{input("fullName", "Nombre completo")}</div>
        <div>
          <label className="label" htmlFor="inv-documentType">Tipo de documento</label>
          <select id="inv-documentType" name="documentType" className="input" defaultValue="DNI">
            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_LABELS[t]}</option>)}
          </select>
        </div>
        {input("documentNumber", "Número de documento", { autoComplete: "off" })}
        {input("employeeCode", "Código de vendedor (opcional)", { autoComplete: "off" })}
        {input("email", "Correo (opcional)", { type: "email" })}
        {input("phone", "Celular (opcional)", { type: "tel" })}
        {input("company", "Empresa (opcional)")}
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Agregando…">Agregar invitado</SubmitButton>
    </form>
  );
}
