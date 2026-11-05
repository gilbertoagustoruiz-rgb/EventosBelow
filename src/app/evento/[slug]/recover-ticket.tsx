"use client";

import { useActionState } from "react";
import { resendTicket, type RecoveryState } from "./recover-actions";

export function RecoverTicket({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState<RecoveryState, FormData>(resendTicket, {});
  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">¿Ya te registraste? Recupera tu QR</h2>
      <p className="mt-1 text-sm text-slate-600">Te enviaremos nuevamente el enlace de tu ticket al correo usado en la inscripción. No necesitas iniciar sesión.</p>
      <form action={action} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input type="hidden" name="slug" value={slug} />
        <input className="input min-w-0 flex-1" name="email" type="email" required maxLength={254} autoComplete="email" placeholder="Correo registrado" aria-label="Correo registrado" />
        <button className="btn-brand" disabled={pending}>{pending ? "Enviando…" : "Recuperar QR"}</button>
      </form>
      {state.message && <p role="status" className="mt-3 text-sm text-slate-600">{state.message}</p>}
    </section>
  );
}
