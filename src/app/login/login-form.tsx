"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";
import { SubmitButton } from "@/components/admin/ui";
import { PasswordInput } from "@/components/password-input";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="email">Correo</label>
        <input id="email" name="email" type="email" autoComplete="username" placeholder="tu@empresa.com" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">Contraseña</label>
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </div>
      {state.error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
      <SubmitButton className="btn-dark w-full" pendingLabel="Ingresando…">Ingresar</SubmitButton>
      <p className="text-center text-xs leading-relaxed text-slate-500">¿Olvidaste tu contraseña? Solicita una nueva al administrador de tu equipo.</p>
    </form>
  );
}
