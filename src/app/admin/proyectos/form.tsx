"use client";

import { useActionState, useEffect, useRef } from "react";
import { createProject } from "./actions";
import type { FormState } from "@/app/admin/actions";
import { FieldError, FormMessage, SubmitButton } from "@/components/admin/ui";

export function ProjectForm({ tenants, defaultTenantId }: { tenants: { id: string; name: string }[]; defaultTenantId?: string }) {
  const [state, action] = useActionState<FormState, FormData>(createProject, {});
  const ref = useRef<HTMLFormElement>(null);
  const e = state.fieldErrors ?? {};
  useEffect(() => { if (state.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="p-tenant">Cliente</label>
          <select id="p-tenant" name="tenantId" className="input" defaultValue={defaultTenantId ?? tenants[0]?.id}>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <FieldError error={e.tenantId} />
        </div>
        <div>
          <label className="label" htmlFor="p-name">Nombre del proyecto</label>
          <input id="p-name" name="name" className="input" placeholder="Ej: Convención de ventas 2026" aria-invalid={Boolean(e.name) || undefined} />
          <FieldError error={e.name} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="p-desc">Descripción (opcional)</label>
          <input id="p-desc" name="description" className="input" />
        </div>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Creando…">Crear proyecto</SubmitButton>
    </form>
  );
}
