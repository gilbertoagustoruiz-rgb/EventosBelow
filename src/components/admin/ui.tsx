"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Copy, Loader2 } from "lucide-react";

export function SubmitButton({ children, className = "btn-dark", disabled = false, pendingLabel = "Guardando…" }: { children: React.ReactNode; className?: string; disabled?: boolean; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={className}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {pending ? pendingLabel : children}
    </button>
  );
}

export function FieldError({ error }: { error?: string }) {
  return error ? <p role="alert" className="mt-1.5 text-sm text-red-600">{error}</p> : null;
}

export function FormMessage({ state }: { state: { ok?: boolean; message?: string } }) {
  if (!state.message) return null;
  return <p role={state.ok ? "status" : "alert"} className={`rounded-xl px-3 py-2 text-sm ${state.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{state.message}</p>;
}

export function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
    <button
      type="button"
      className="btn-ghost px-3 py-1.5"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setError(false); setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch { setError(true); }
      }}
    >
      {done ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      {done ? "Copiado" : label}
    </button>
    <span role="status" className={error ? "max-w-48 text-xs text-amber-700" : "sr-only"}>{error ? "No se pudo copiar. Selecciona el enlace y cópialo manualmente." : done ? "Enlace copiado" : ""}</span>
    </span>
  );
}

/** Botón que pide confirmación antes de enviar su formulario */
export function ConfirmButton({
  children,
  message,
  className = "text-sm font-medium text-red-600 hover:underline",
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

/** Contraseña temporal recién generada: se muestra una sola vez para compartirla. */
export function TempPassword({ message, password }: { message?: string; password: string }) {
  return (
    <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-900">{message}</p>
      <p className="mt-1 text-amber-800">
        Comparte esta contraseña temporal; se le pedirá cambiarla al ingresar. No se volverá a mostrar.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="rounded bg-white px-2 py-1 font-mono text-base tracking-wider">{password}</code>
        <CopyButton value={password} />
      </div>
    </div>
  );
}
