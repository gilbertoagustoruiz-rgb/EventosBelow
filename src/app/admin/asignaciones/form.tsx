"use client";

import { useActionState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { assignEmployee } from "./actions";
import type { FormState } from "@/app/admin/actions";
import { FormMessage, SubmitButton } from "@/components/admin/ui";

export function AssignForm({
  tenantId,
  label,
  options,
}: {
  tenantId: string;
  label: string;
  options: { id: string; full_name: string; detail: string }[];
}) {
  const [state, action] = useActionState<FormState, FormData>(assignEmployee, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  if (options.length === 0) {
    return (
      <div className="space-y-2">
        <FormMessage state={state} />
        <p className="text-xs text-slate-500">No hay más {label.toLowerCase()} activos para asignar. Créalos en Empleados.</p>
      </div>
    );
  }
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <select name="employeeId" required defaultValue="" className="input min-w-56 flex-1 py-2" aria-label={`Agregar ${label.toLowerCase()}`}>
        <option value="" disabled>Agregar {label.toLowerCase()}…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.full_name}{o.detail ? ` · ${o.detail}` : ""}</option>
        ))}
      </select>
      <SubmitButton className="btn-ghost py-2" pendingLabel="Asignando…">
        <Plus className="size-4" /> Asignar
      </SubmitButton>
      <div className="w-full empty:hidden"><FormMessage state={state} /></div>
    </form>
  );
}
