"use client";

import { useActionState } from "react";
import { changePassword, type PasswordState } from "@/app/login/actions";
import { SubmitButton } from "@/components/admin/ui";

export function PasswordForm() {
  const [state, action] = useActionState<PasswordState, FormData>(changePassword, {});
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label className="label" htmlFor="current">Contraseña actual</label>
        <input id="current" name="current" type="password" autoComplete="current-password" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="next">Nueva contraseña (mín. 10 caracteres)</label>
        <input id="next" name="next" type="password" autoComplete="new-password" minLength={10} required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="confirm">Repite la nueva contraseña</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required className="input" />
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <SubmitButton className="btn-dark w-full">Guardar contraseña</SubmitButton>
    </form>
  );
}
