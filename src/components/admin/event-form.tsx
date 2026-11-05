"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveEvent, type FormState } from "@/app/admin/actions";
import { slugify } from "@/lib/validation";
import { readableOn } from "@/lib/format";
import { extractLogoPalette } from "@/lib/logo-colors";
import type { EventRow } from "@/lib/types";
import { FieldError, FormMessage, SubmitButton } from "./ui";

interface Props {
  event?: EventRow;
  tenants: { id: string; name: string }[];
}

const COMPANION_OPTIONS = [
  { value: "NONE", title: "Sin acompañante", hint: "Solo se registra el titular" },
  { value: "OPTIONAL", title: "Opcional", hint: "El asistente decide si lleva a alguien" },
  { value: "REQUIRED", title: "Obligatorio", hint: "Debe registrar a un acompañante" },
] as const;

export function EventForm({ event, tenants }: Props) {
  const [state, action] = useActionState<FormState, FormData>(saveEvent, {});
  const [name, setName] = useState(event?.name ?? "");
  const [slug, setSlug] = useState(event?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(event));
  const [color, setColor] = useState(event?.primary_color ?? "#4f46e5");
  const [preview, setPreview] = useState<string | null>(event?.logo_url ?? null);
  const [palette, setPalette] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [logoMessage, setLogoMessage] = useState("");
  const logoRequest = useRef(0);
  useEffect(() => () => { if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);
  const validColor = /^#[0-9a-f]{6}$/i.test(color) ? color : "#4f46e5";
  function chooseColor(value: string) {
    logoRequest.current++;
    setAnalyzing(false);
    setColor(value);
  }
  async function selectLogo(file?: File) {
    const request = ++logoRequest.current;
    setPalette([]);
    setLogoMessage("");
    setAnalyzing(false);
    if (!file) { setPreview(event?.logo_url ?? null); return; }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setPreview(event?.logo_url ?? null);
      setLogoMessage("Elige un logo PNG, JPG o WEBP de hasta 2 MB.");
      return;
    }
    setPreview(URL.createObjectURL(file));
    setAnalyzing(true);
    try {
      const colors = await extractLogoPalette(file);
      if (request !== logoRequest.current) return;
      setPalette(colors);
      if (colors.length) {
        setColor(colors[0]);
        setLogoMessage("Aplicamos un color de tu logo. Puedes elegir otro tono o ajustarlo.");
      } else setLogoMessage("No encontramos colores definidos. Elige el color de marca manualmente.");
    } catch {
      if (request === logoRequest.current) setLogoMessage("No pudimos leer los colores del logo. Puedes elegirlos manualmente.");
    } finally {
      if (request === logoRequest.current) setAnalyzing(false);
    }
  }
  const e = state.fieldErrors ?? {};

  return (
    <form action={action} onSubmit={(ev) => { if (analyzing) ev.preventDefault(); }} className="space-y-8">
      {event && <input type="hidden" name="eventId" value={event.id} />}

      <section className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2"><h2 className="text-lg font-semibold">Información del evento</h2><p className="mt-1 text-sm text-slate-500">Estos datos aparecerán en el portal de tus invitados.</p></div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="tenantId">Cliente</label>
          <select id="tenantId" name="tenantId" defaultValue={event?.tenant_id ?? tenants[0]?.id} className="input" disabled={Boolean(event)}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {event && <input type="hidden" name="tenantId" value={event.tenant_id} />}
          <FieldError error={e.tenantId} />
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">Nombre del evento</label>
          <input
            id="name"
            name="name"
            className="input"
            value={name}
            aria-invalid={Boolean(e.name) || undefined}
            onChange={(ev) => {
              setName(ev.target.value);
              if (!slugTouched) setSlug(slugify(ev.target.value));
            }}
          />
          <FieldError error={e.name} />
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="slug">Enlace público</label>
          <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-300 focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15">
            <span className="grid place-items-center bg-slate-50 px-3 text-sm text-slate-500">/evento/</span>
            <input
              id="slug"
              name="slug"
              className="min-w-0 flex-1 px-3 py-2.5 text-[15px] outline-none"
              value={slug}
              onChange={(ev) => {
                setSlugTouched(true);
                setSlug(ev.target.value.toLowerCase());
              }}
            />
          </div>
          <FieldError error={e.slug} />
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="description">Descripción</label>
          <textarea id="description" name="description" rows={3} defaultValue={event?.description ?? ""} className="input" />
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="venue">Lugar</label>
          <input id="venue" name="venue" defaultValue={event?.venue ?? ""} className="input" placeholder="Ej: Centro de Convenciones de Lima" />
        </div>
      </section>

      {/* Branding ------------------------------------------------------------------ */}
      <section className="space-y-4">
        <h3 className="text-lg font-semibold">Imagen y colores de tu evento</h3>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="primaryColor">Color primario</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={validColor}
                onChange={(ev) => chooseColor(ev.target.value)}
                className="h-[46px] w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
                aria-label="Selector de color"
              />
              <input id="primaryColor" name="primaryColor" value={color} onChange={(ev) => chooseColor(ev.target.value)} className="input font-mono" />
            </div>
            <p className="mt-2 text-xs text-slate-500">Al subir el logo, adaptamos el color del portal, los botones y el ticket.</p>
            {palette.length > 0 && <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Colores del logo">
              {palette.map((tone) => <button key={tone} type="button" onClick={() => chooseColor(tone)} aria-label={`Usar color ${tone}`} aria-pressed={color.toLowerCase() === tone} title={tone} className="size-9 rounded-full border border-slate-300 outline-offset-4 aria-pressed:ring-2 aria-pressed:ring-slate-900 aria-pressed:ring-offset-2" style={{ backgroundColor: tone }} />)}
            </div>}
            <p className="mt-2 text-sm text-slate-600" role="status">{analyzing ? "Obteniendo los colores del logo…" : logoMessage}</p>
            <FieldError error={e.primaryColor} />
          </div>
          <div>
            <label className="label" htmlFor="logo">Logo (PNG, JPG o WEBP, máx. 2 MB)</label>
            <input
              id="logo"
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
              onChange={(ev) => { void selectLogo(ev.target.files?.[0]); }}
            />
            <FieldError error={e.logo} />
            {event?.logo_url && (
              <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" name="removeLogo" /> Quitar logo actual
              </label>
            )}
          </div>
        </div>

        {/* Vista previa del encabezado público */}
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="px-5 py-6" style={{ background: validColor, color: readableOn(validColor) }}>
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="mb-3 h-9 w-auto max-w-[160px] rounded bg-white/95 object-contain p-1" />
            )}
            <p className="text-xl font-bold">{name || "Nombre del evento"}</p>
            <p className="text-sm opacity-80">Vista previa del portal de registro</p>
          </div>
          <div className="flex items-center justify-between bg-white px-5 py-4">
            <p className="text-sm text-slate-500">Tu identidad, en cada inscripción</p>
            <span className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: validColor, color: readableOn(validColor) }}>Registrarme</span>
          </div>
        </div>
      </section>

      {/* Reglas -------------------------------------------------------------------- */}
      <section className="space-y-4">
        <h3 className="font-semibold">Acompañante</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {COMPANION_OPTIONS.map((o) => (
            <label key={o.value} className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-4 has-[:checked]:border-slate-900 has-[:checked]:ring-2 has-[:checked]:ring-slate-900/10">
              <input type="radio" name="companionMode" value={o.value} defaultChecked={(event?.companion_mode ?? "NONE") === o.value} className="mt-1" />
              <span className="text-sm">
                <span className="block font-medium">{o.title}</span>
                <span className="text-slate-500">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Visibilidad e inscripciones</h3>
        <p className="text-sm text-slate-500">Puedes guardar un borrador y publicarlo cuando hayas agregado sus fechas.</p>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="isPublished" defaultChecked={event?.is_published ?? false} className="size-4" />
          Publicado (el enlace público es accesible)
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="registrationOpen" defaultChecked={event?.registration_open ?? true} className="size-4" />
          Inscripciones abiertas
        </label>
      </section>

      <div className="flex items-center gap-4 border-t border-slate-100 pt-6">
        <SubmitButton disabled={analyzing}>{event ? "Guardar cambios" : "Crear evento"}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
