"use client";

import { useActionState, useEffect, useRef } from "react";
import { createTenant, type FormState } from "@/app/admin/actions";
import { slugify } from "@/lib/validation";
import { FieldError, FormMessage, SubmitButton } from "./ui";

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
