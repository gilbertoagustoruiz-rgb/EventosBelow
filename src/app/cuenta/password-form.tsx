"use client";

import { useActionState } from "react";
import { changePassword, type PasswordState } from "@/app/login/actions";
import { SubmitButton } from "@/components/admin/ui";
import { PasswordInput } from "@/components/password-input";

export function PasswordForm() {
  const [state, action] = useActionState<PasswordState, FormData>(changePassword, {});
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label className="label" htmlFor="current">Contraseña actual</label>
        <PasswordInput id="current" name="current" autoComplete="current-password" required />
      </div>
      <div>
        <label className="label" htmlFor="next">Nueva contraseña (mín. 10 caracteres)</label>
        <PasswordInput id="next" name="next" autoComplete="new-password" minLength={10} required />
      </div>
      <div>
        <label className="label" htmlFor="confirm">Repite la nueva contraseña</label>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" minLength={10} required />
      </div>
      {state.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
      <SubmitButton className="btn-dark w-full">Guardar contraseña</SubmitButton>
    </form>
  );
}
