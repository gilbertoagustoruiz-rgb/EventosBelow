"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { KeyRound, Pencil, UserPlus } from "lucide-react";
import { createEmployee, resetEmployeePassword, updateEmployee } from "./actions";
import type { FormState } from "@/app/admin/actions";
import { FieldError, FormMessage, SubmitButton, TempPassword } from "@/components/admin/ui";
import { DOCUMENT_LABELS, DOCUMENT_TYPES } from "@/lib/validation";
import { PROFILES, PROFILE_ORDER, type Profile } from "@/lib/profiles";

export function EmployeeForm({ tenants }: { tenants: { id: string; name: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(createEmployee, {});
  const [profile, setProfile] = useState<Profile>("PROMOTOR");
  const ref = useRef<HTMLFormElement>(null);
  const e = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      setProfile("PROMOTOR");
    }
  }, [state]);

  return (
    <form ref={ref} action={action} className="space-y-5">
      <fieldset>
        <legend className="label">Perfil</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PROFILE_ORDER.map((p) => (
            <label
              key={p}
              className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 text-sm has-[:checked]:border-indigo-600 has-[:checked]:ring-2 has-[:checked]:ring-indigo-600/10"
            >
              <input type="radio" name="profile" value={p} checked={profile === p} onChange={() => setProfile(p)} className="mt-1" />
              <span>
                <span className="block font-semibold">{PROFILES[p].label}</span>
                <span className="text-slate-500">{PROFILES[p].access}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="e-name">Nombre completo</label>
          <input id="e-name" name="fullName" className="input" aria-invalid={Boolean(e.fullName) || undefined} />
          <FieldError error={e.fullName} />
        </div>
        <div>
          <label className="label" htmlFor="e-doctype">Tipo de documento</label>
          <select id="e-doctype" name="documentType" className="input" defaultValue="DNI">
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{DOCUMENT_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="e-doc">
            Número de documento{profile === "PROMOTOR" ? "" : " (opcional)"}
          </label>
          <input id="e-doc" name="documentNumber" className="input" inputMode="numeric" aria-invalid={Boolean(e.documentNumber) || undefined} />
          <FieldError error={e.documentNumber} />
        </div>
        <div>
          <label className="label" htmlFor="e-email">
            Correo{profile === "PROMOTOR" ? " (opcional)" : " (será su usuario)"}
          </label>
          <input id="e-email" name="email" type="email" className="input" aria-invalid={Boolean(e.email) || undefined} />
          <FieldError error={e.email} />
        </div>
        <div>
          <label className="label" htmlFor="e-phone">Celular (opcional)</label>
          <input id="e-phone" name="phone" type="tel" className="input" />
        </div>
      </div>

      {profile !== "ADMINISTRADOR" && tenants.length > 0 && (
        <fieldset>
          <legend className="label">Asignar a clientes (opcional, también puedes hacerlo en Asignaciones)</legend>
          <div className="flex flex-wrap gap-2">
            {tenants.map((t) => (
              <label key={t.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-indigo-600 has-[:checked]:bg-indigo-50">
                <input type="checkbox" name="tenantIds" value={t.id} />
                {t.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="space-y-3">
        <SubmitButton className="btn-dark">
          <UserPlus className="size-4" /> Crear empleado
        </SubmitButton>
        {state.tempPassword ? <TempPassword message={state.message} password={state.tempPassword} /> : <FormMessage state={state} />}
      </div>
    </form>
  );
}

/** Edición en línea de nombre, documento y celular. */
export function EditEmployee({
  employee,
}: {
  employee: { id: string; full_name: string; document_type: string; document_number: string | null; phone: string | null };
}) {
  const [state, action] = useActionState<FormState, FormData>(updateEmployee, {});
  const e = state.fieldErrors ?? {};
  return (
    <details className="group">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 text-sm text-slate-600 hover:bg-slate-100">
        <Pencil className="size-4" /> Editar
      </summary>
      <form action={action} className="mt-3 grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-4">
        <input type="hidden" name="id" value={employee.id} />
        <div className="sm:col-span-2">
          <input name="fullName" defaultValue={employee.full_name} className="input py-2" aria-label="Nombre completo" />
          <FieldError error={e.fullName} />
        </div>
        <select name="documentType" defaultValue={employee.document_type} className="input py-2" aria-label="Tipo de documento">
          {DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>{DOCUMENT_LABELS[t]}</option>
          ))}
        </select>
        <div>
          <input name="documentNumber" defaultValue={employee.document_number ?? ""} placeholder="Documento" className="input py-2" aria-label="Número de documento" />
          <FieldError error={e.documentNumber} />
        </div>
        <input name="phone" defaultValue={employee.phone ?? ""} placeholder="Celular" className="input py-2 sm:col-span-2" aria-label="Celular" />
        <SubmitButton className="btn-ghost py-2">Guardar</SubmitButton>
        <div className="sm:col-span-4"><FormMessage state={state} /></div>
      </form>
    </details>
  );
}

export function ResetPassword({ id }: { id: string }) {
  const [state, action] = useActionState<FormState, FormData>(resetEmployeePassword, {});
  return (
    <div className="contents">
      <form
        action={action}
        onSubmit={(ev) => {
          if (!confirm("¿Generar una nueva contraseña temporal? La actual dejará de funcionar.")) ev.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={id} />
        <button className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-slate-600 hover:bg-slate-100">
          <KeyRound className="size-4" /> Nueva contraseña
        </button>
      </form>
      {state.tempPassword && (
        <div className="basis-full">
          <TempPassword message={state.message} password={state.tempPassword} />
        </div>
      )}
      {state.message && !state.ok && <span className="text-xs text-red-600">{state.message}</span>}
    </div>
  );
}
