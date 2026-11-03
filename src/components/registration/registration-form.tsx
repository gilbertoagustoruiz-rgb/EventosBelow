"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarDays, Check, Clock, Loader2, UserPlus, Users } from "lucide-react";
import { registerAttendee } from "@/app/evento/[slug]/actions";
import { DOCUMENT_LABELS, DOCUMENT_TYPES } from "@/lib/validation";
import { formatDay, formatTime } from "@/lib/format";
import type { CompanionMode, DocumentType, PublicDateOption } from "@/lib/types";

const POLL_MS = 15_000;

interface Props {
  slug: string;
  companionMode: CompanionMode;
  dates: PublicDateOption[];
}

interface FormState {
  fullName: string;
  email: string;
  phone: string;
  documentType: DocumentType;
  documentNumber: string;
  company: string;
  jobTitle: string;
  wantsCompanion: boolean;
  companionFullName: string;
  companionDocumentType: DocumentType;
  companionDocumentNumber: string;
}

const EMPTY: FormState = {
  fullName: "",
  email: "",
  phone: "",
  documentType: "DNI",
  documentNumber: "",
  company: "",
  jobTitle: "",
  wantsCompanion: false,
  companionFullName: "",
  companionDocumentType: "DNI",
  companionDocumentNumber: "",
};

export function RegistrationForm({ slug, companionMode, dates }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [dateId, setDateId] = useState<string | null>(dates.length === 1 && dates[0].remaining > 0 ? dates[0].id : null);
  const [remaining, setRemaining] = useState<Record<string, number>>(() =>
    Object.fromEntries(dates.map((d) => [d.id, d.remaining])),
  );
  const [open, setOpen] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasCompanion = companionMode === "REQUIRED" || (companionMode === "OPTIONAL" && form.wantsCompanion);
  const seatsNeeded = hasCompanion ? 2 : 1;

  // --- Cupos en tiempo (casi) real: polling + al volver a la pestaña -------------------
  const refreshAvailability = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/events/${slug}/availability`, { cache: "no-store" });
      if (!res.ok) return;
      const json: { open: boolean; dates: { id: string; remaining: number }[] } = await res.json();
      setOpen(json.open);
      setRemaining(Object.fromEntries(json.dates.map((d) => [d.id, d.remaining])));
    } catch {
      /* sin red: se mantiene el último valor; la BD valida al enviar */
    }
  }, [slug]);

  useEffect(() => {
    const id = setInterval(refreshAvailability, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && refreshAvailability();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshAvailability]);

  const selectedLeft = dateId ? (remaining[dateId] ?? 0) : null;
  const selectedInsufficient = selectedLeft !== null && selectedLeft < seatsNeeded;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFormError(null);
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };

  const fieldProps = (key: keyof FormState) => ({
    id: key,
    name: key,
    value: form[key] as string,
    "aria-invalid": Boolean(errors[key]) || undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(key, e.target.value as never),
    className: "input",
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!dateId) {
      setErrors((x) => ({ ...x, eventDateId: "Selecciona una fecha" }));
      return;
    }
    startTransition(async () => {
      const res = await registerAttendee(slug, {
        eventDateId: dateId,
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        documentType: form.documentType,
        documentNumber: form.documentNumber,
        company: form.company,
        jobTitle: form.jobTitle,
        hasCompanion,
        companionFullName: hasCompanion ? form.companionFullName : undefined,
        companionDocumentType: hasCompanion ? form.companionDocumentType : undefined,
        companionDocumentNumber: hasCompanion ? form.companionDocumentNumber : undefined,
      });
      if (res.ok) {
        router.push(`/evento/${slug}/ticket/${res.token}?nuevo=1`);
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(res.message);
      if (res.code === "SOLD_OUT" || res.code === "DATE_NOT_FOUND") {
        setDateId(null);
        refreshAvailability();
      }
      document.getElementById("form-top")?.scrollIntoView({ behavior: "smooth" });
    });
  }

  if (!open) {
    return <Notice>Las inscripciones para este evento están cerradas.</Notice>;
  }
  if (dates.length === 0) {
    return <Notice>No hay fechas disponibles por el momento.</Notice>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8" id="form-top">
      {formError && (
        <div role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 size-5 shrink-0" />
          <p>{formError}</p>
        </div>
      )}

      {/* 1. Fecha ------------------------------------------------------------------ */}
      <Section number={1} title="Elige tu fecha" icon={<CalendarDays className="size-4" />}>
        <div role="radiogroup" aria-label="Fechas disponibles" className="grid gap-3 sm:grid-cols-2">
          {dates.map((d) => {
            const left = remaining[d.id] ?? 0;
            const disabled = left < seatsNeeded;
            const selected = d.id === dateId;
            const low = left > 0 && left <= Math.max(5, d.capacity * 0.1);
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => {
                  setDateId(d.id);
                  setErrors(({ eventDateId: _, ...rest }) => rest);
                }}
                className={[
                  "relative rounded-xl border-2 p-4 text-left transition",
                  selected ? "border-brand bg-brand/5 ring-4 ring-brand/10" : "border-slate-200 bg-white hover:border-slate-300",
                  disabled && "cursor-not-allowed opacity-50 hover:border-slate-200",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {selected && (
                  <span className="absolute right-3 top-3 grid size-6 place-items-center rounded-full bg-brand text-brand-fg">
                    <Check className="size-4" />
                  </span>
                )}
                {d.label && <p className="text-xs font-semibold uppercase tracking-wide text-brand">{d.label}</p>}
                <p className="mt-0.5 font-semibold">{formatDay(d.event_day)}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
                  <Clock className="size-3.5" />
                  {formatTime(d.starts_at)} – {formatTime(d.ends_at)}
                </p>
                <p
                  className={[
                    "mt-3 text-sm font-medium",
                    left === 0 ? "text-red-600" : low ? "text-amber-600" : "text-emerald-700",
                  ].join(" ")}
                >
                  {left === 0
                    ? "Agotado"
                    : disabled
                      ? "Solo queda 1 cupo (no alcanza con acompañante)"
                      : `${left} ${left === 1 ? "cupo disponible" : "cupos disponibles"}`}
                </p>
              </button>
            );
          })}
        </div>
        {errors.eventDateId && <FieldError>{errors.eventDateId}</FieldError>}
        {selectedInsufficient && (
          <FieldError>La fecha elegida ya no tiene cupos suficientes. Elige otra.</FieldError>
        )}
      </Section>

      {/* 2. Titular ---------------------------------------------------------------- */}
      <Section number={2} title="Tus datos" icon={<Users className="size-4" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre completo" error={errors.fullName} className="sm:col-span-2">
            <input {...fieldProps("fullName")} autoComplete="name" placeholder="Como figura en tu documento" />
          </Field>
          <Field label="Correo electrónico" error={errors.email}>
            <input {...fieldProps("email")} type="email" autoComplete="email" inputMode="email" placeholder="nombre@empresa.com" />
          </Field>
          <Field label="Teléfono / celular" error={errors.phone}>
            <input {...fieldProps("phone")} type="tel" autoComplete="tel" inputMode="tel" placeholder="+51 999 999 999" />
          </Field>
          <Field label="Tipo de documento" error={errors.documentType}>
            <select {...fieldProps("documentType")}>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>{DOCUMENT_LABELS[t]}</option>
              ))}
            </select>
          </Field>
          <Field label="Número de documento" error={errors.documentNumber}>
            <input
              {...fieldProps("documentNumber")}
              inputMode={form.documentType === "DNI" || form.documentType === "CEDULA" ? "numeric" : "text"}
              autoComplete="off"
            />
          </Field>
          <Field label="Empresa (opcional)" error={errors.company}>
            <input {...fieldProps("company")} autoComplete="organization" />
          </Field>
          <Field label="Cargo (opcional)" error={errors.jobTitle}>
            <input {...fieldProps("jobTitle")} autoComplete="organization-title" />
          </Field>
        </div>
      </Section>

      {/* 3. Acompañante ------------------------------------------------------------ */}
      {companionMode !== "NONE" && (
        <Section
          number={3}
          title={companionMode === "REQUIRED" ? "Datos de tu acompañante" : "Acompañante"}
          icon={<UserPlus className="size-4" />}
        >
          {companionMode === "OPTIONAL" && (
            <label className="mb-4 flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <input
                type="checkbox"
                checked={form.wantsCompanion}
                onChange={(e) => set("wantsCompanion", e.target.checked)}
                className="size-5 accent-[var(--brand)]"
              />
              <span className="text-sm">
                <span className="font-medium">Asistiré con un acompañante</span>
                <span className="block text-slate-500">Ocupa un cupo adicional en la fecha elegida.</span>
              </span>
            </label>
          )}
          {hasCompanion && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre completo del acompañante" error={errors.companionFullName} className="sm:col-span-2">
                <input {...fieldProps("companionFullName")} autoComplete="off" />
              </Field>
              <Field label="Tipo de documento" error={errors.companionDocumentType}>
                <select {...fieldProps("companionDocumentType")}>
                  {DOCUMENT_TYPES.map((t) => (
                    <option key={t} value={t}>{DOCUMENT_LABELS[t]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Número de documento" error={errors.companionDocumentNumber}>
                <input {...fieldProps("companionDocumentNumber")} autoComplete="off" />
              </Field>
            </div>
          )}
        </Section>
      )}

      <div className="space-y-3">
        <button type="submit" className="btn-brand w-full py-3.5 text-base" disabled={pending || selectedInsufficient}>
          {pending ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
          {pending ? "Reservando tu lugar…" : "Confirmar registro"}
        </button>
        <p className="text-center text-xs text-slate-500">
          Recibirás tu ticket con código QR en pantalla y por correo electrónico.
        </p>
      </div>
    </form>
  );
}

function Section({
  number,
  title,
  icon,
  children,
}: {
  number: number;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className="mb-4 flex items-center gap-2.5 text-lg font-semibold">
        <span className="grid size-7 place-items-center rounded-full bg-brand text-sm text-brand-fg">{number}</span>
        {title}
        <span className="text-slate-400">{icon}</span>
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactElement<{ id: string }>;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={children.props.id}>{label}</label>
      {children}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-sm text-red-600">{children}</p>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-slate-600">{children}</div>;
}
