"use client";

import { useActionState, useEffect, useRef } from "react";
import { addMember, createTenant, resetMemberPassword, type FormState } from "@/app/admin/actions";
import { slugify } from "@/lib/validation";
import { KeyRound } from "lucide-react";
import { CopyButton, FieldError, FormMessage, SubmitButton } from "./ui";

export function TenantForm() {
  const [state, action] = useActionState<FormState, FormData>(createTenant, {});
  const ref = useRef<HTMLFormElement>(null);
  const e = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="t-name">Razón social / nombre</label>
        <input
          id="t-name"
          name="name"
          className="input"
          onChange={(ev) => {
            const slug = ref.current?.elements.namedItem("slug") as HTMLInputElement | null;
            if (slug && !slug.dataset.touched) slug.value = slugify(ev.target.value);
          }}
        />
        <FieldError error={e.name} />
      </div>
      <div>
        <label className="label" htmlFor="t-slug">Identificador</label>
        <input id="t-slug" name="slug" className="input font-mono" onInput={(ev) => (ev.currentTarget.dataset.touched = "1")} />
        <FieldError error={e.slug} />
      </div>
      <div>
        <label className="label" htmlFor="t-tax">RUC</label>
        <input id="t-tax" name="taxId" className="input" inputMode="numeric" />
      </div>
      <div>
        <label className="label" htmlFor="t-contact">Contacto</label>
        <input id="t-contact" name="contactName" className="input" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="t-email">Correo de contacto</label>
        <input id="t-email" name="contactEmail" type="email" className="input" />
        <FieldError error={e.contactEmail} />
      </div>
      <div className="flex items-center gap-4 sm:col-span-2">
        <SubmitButton>Crear cliente</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function MemberForm({ tenantId }: { tenantId: string }) {
  const [state, action] = useActionState<FormState, FormData>(addMember, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <div className="space-y-3">
      <form ref={ref} action={action} className="flex flex-wrap items-start gap-2">
        <input type="hidden" name="tenantId" value={tenantId} />
        <div className="min-w-48 flex-1">
          <input name="email" type="email" placeholder="correo@cliente.com" className="input py-2" aria-label="Correo" />
          <FieldError error={state.fieldErrors?.email} />
        </div>
        <input name="fullName" placeholder="Nombre (opcional)" className="input min-w-40 flex-1 py-2" aria-label="Nombre" />
        <select name="role" className="input w-auto py-2" defaultValue="CLIENT_ADMIN" aria-label="Rol">
          <option value="CLIENT_ADMIN">Coordinador Below Group</option>
        </select>
        <SubmitButton className="btn-ghost py-2">Agregar</SubmitButton>
      </form>
      {state.tempPassword ? <TempPassword message={state.message} password={state.tempPassword} /> : <FormMessage state={state} />}
    </div>
  );
}

/** Genera una nueva contraseña temporal para un miembro */
export function ResetPasswordButton({ tenantId, userId }: { tenantId: string; userId: string }) {
  const [state, action] = useActionState<FormState, FormData>(resetMemberPassword, {});
  return (
    <>
      <form
        action={action}
        onSubmit={(e) => {
          if (!confirm("¿Generar una nueva contraseña temporal? La actual dejará de funcionar.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="userId" value={userId} />
        <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Restablecer contraseña" title="Restablecer contraseña">
          <KeyRound className="size-4" />
        </button>
      </form>
      {state.tempPassword && (
        <div className="basis-full">
          <TempPassword message={state.message} password={state.tempPassword} />
        </div>
      )}
      {state.message && !state.ok && <span className="text-xs text-red-600">{state.message}</span>}
    </>
  );
}

function TempPassword({ message, password }: { message?: string; password: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-900">{message}</p>
      <p className="mt-1 text-amber-800">
        Comparte esta contraseña temporal; se le pedirá cambiarla al ingresar. No se volverá a mostrar.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="rounded bg-white px-2 py-1 font-mono text-base tracking-wider">{password}</code>
        <CopyButton value={password} />
      </div>
    </div>
  );
}
