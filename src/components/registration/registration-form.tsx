"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowLeft, BadgeCheck, CalendarDays, Check, Clock, Loader2, Minus, Plus, Search, UserPlus,
} from "lucide-react";
import {
  confirmRegistration, lookupInvitee, type InviteePreview,
} from "@/app/evento/[slug]/actions";
import { DOCUMENT_LABELS, DOCUMENT_TYPES } from "@/lib/validation";
import { formatDay, formatTime } from "@/lib/format";
import type { CompanionMode, DocumentType, PublicDateOption } from "@/lib/types";

const POLL_MS = 15_000;

interface Props {
  slug: string;
  companionMode: CompanionMode;
  maxCompanions: number;
  dates: PublicDateOption[];
}

interface CompanionForm { fullName: string; documentType: DocumentType; documentNumber: string }
const EMPTY_COMPANION: CompanionForm = { fullName: "", documentType: "DNI", documentNumber: "" };

/**
 * Paso 1: el asistente escribe su DNI o código de vendedor y traemos sus datos de la base.
 * Paso 2: confirma el día al que asistirá (y acompañantes si el evento lo permite).
 */
export function RegistrationForm({ slug, companionMode, maxCompanions, dates }: Props) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [invitee, setInvitee] = useState<InviteePreview | null>(null);
  const [dateId, setDateId] = useState<string | null>(dates.length === 1 && dates[0].remaining > 0 ? dates[0].id : null);
  const [remaining, setRemaining] = useState<Record<string, number>>(() =>
    Object.fromEntries(dates.map((d) => [d.id, d.remaining])),
  );
  const [open, setOpen] = useState(true);
  const minCompanions = companionMode === "REQUIRED" ? 1 : 0;
  const allowCompanions = companionMode !== "NONE" && maxCompanions > 0;
  const [companions, setCompanions] = useState<CompanionForm[]>(() =>
    Array.from({ length: minCompanions }, () => ({ ...EMPTY_COMPANION })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (formError) errorRef.current?.focus(); }, [formError]);

  const seatsNeeded = 1 + companions.length;

  // Cupos casi en tiempo real: polling + al volver a la pestaña
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
  const selectedDate = dates.find((d) => d.id === dateId);
  const selectedInsufficient = selectedLeft !== null && selectedLeft < seatsNeeded;

  function clearError(key: string) {
    setFormError(null);
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  }

  function onLookup(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    startTransition(async () => {
      try {
        const res = await lookupInvitee(slug, code);
        if (res.state === "FOUND") {
          setInvitee(res.invitee);
          if (res.invitee.assignedDateId) setDateId(res.invitee.assignedDateId);
          setErrors({});
        } else if (res.state === "REGISTERED") {
          router.push(`/evento/${slug}/ticket/${res.token}?ya=1`);
        } else {
          setFormError(res.message);
        }
      } catch {
        setFormError("No pudimos consultar tus datos. Revisa tu conexión e inténtalo nuevamente.");
      }
    });
  }

  function onConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!invitee) return;
    setFormError(null);
    if (!dateId) {
      setErrors((x) => ({ ...x, eventDateId: "Selecciona un día" }));
      setFormError("Elige el día al que asistirás.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await confirmRegistration(slug, {
          inviteeId: invitee.id,
          eventDateId: dateId,
          email: "",
          phone: "",
          companions,
        });
        if (res.ok) {
          router.push(`/evento/${slug}/ticket/${res.token}?${res.already ? "ya" : "nuevo"}=1`);
          return;
        }
        setErrors(res.fieldErrors ?? {});
        setFormError(res.message);
        if (res.code === "SOLD_OUT" || res.code === "DATE_NOT_FOUND") {
          setDateId(null);
          refreshAvailability();
        }
        document.getElementById("form-top")?.scrollIntoView({ behavior: "smooth" });
      } catch {
        setFormError("No pudimos confirmar la inscripción. Si se interrumpió la conexión, revisa tu correo antes de volver a intentarlo.");
      }
    });
  }

  if (!open) return <Notice>Las inscripciones para este evento están cerradas.</Notice>;
  if (dates.length === 0) return <Notice>No hay fechas disponibles por el momento.</Notice>;

  const errorBox = formError && (
    <div ref={errorRef} tabIndex={-1} role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <AlertCircle className="mt-0.5 size-5 shrink-0" />
      <p>{formError}</p>
    </div>
  );

  /* ---------------- Paso 1: identificación ---------------- */
  if (!invitee) {
    return (
      <form onSubmit={onLookup} noValidate className="space-y-6" id="form-top">
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:p-5">
          <h2 className="text-xl font-bold tracking-tight">Confirma tu asistencia</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Ingresa tu número de documento (DNI) o tu código. Tus datos ya están registrados por el organizador.
          </p>
        </div>
        {errorBox}
        <div>
          <label htmlFor="code" className="label">DNI o código</label>
          <input
            id="code"
            name="code"
            className="input text-lg tracking-wide"
            value={code}
            onChange={(e) => { setCode(e.target.value); setFormError(null); }}
            autoComplete="off"
            autoFocus
            placeholder="Ej: 45678912"
            inputMode="text"
            maxLength={30}
          />
        </div>
        <button type="submit" className="btn-brand w-full py-3.5 text-base" disabled={pending || code.trim().length < 3}>
          {pending ? <Loader2 className="size-5 animate-spin" /> : <Search className="size-5" />}
          {pending ? "Buscando…" : "Continuar"}
        </button>
      </form>
    );
  }

  /* ---------------- Paso 2: día y acompañantes ---------------- */
  return (
    <form onSubmit={onConfirm} noValidate className="space-y-8" id="form-top">
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 sm:p-5">
        <BadgeCheck className="mt-0.5 size-6 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold leading-tight">Hola, {invitee.fullName}</p>
          <p className="mt-1 text-sm text-slate-600">
            {DOCUMENT_LABELS[invitee.documentType]} {invitee.maskedDocument}
            {invitee.employeeCode && <> · <span className="whitespace-nowrap">Código {invitee.employeeCode}</span></>}
            {invitee.company && ` · ${invitee.company}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setInvitee(null); setFormError(null); setErrors({}); }}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="size-4" /> No soy yo
        </button>
      </div>

      {errorBox}

      <Section number={1} title={invitee.assignedDateId ? "Tu fecha de asistencia" : "¿Qué día asistirás?"} icon={<CalendarDays className="size-4" />}>
        {invitee.assignedDateId && (
          <p className="-mt-2 mb-3 text-sm text-slate-600">
            {dates.some((d) => d.id === invitee.assignedDateId)
              ? "Esta es la fecha que te asignaron. Confírmala para recibir tu ticket."
              : "Tu fecha asignada ya no está disponible. Comunícate con el organizador."}
          </p>
        )}
        <div role="group" aria-label="Días disponibles, selecciona uno" className="grid gap-3 sm:grid-cols-2">
          {dates.filter((d) => !invitee.assignedDateId || d.id === invitee.assignedDateId).map((d) => {
            const left = remaining[d.id] ?? 0;
            const notAssigned = Boolean(invitee.assignedDateId) && d.id !== invitee.assignedDateId;
            const disabled = notAssigned || left < seatsNeeded;
            const selected = d.id === dateId;
            const low = left > 0 && left <= Math.max(5, d.capacity * 0.1);
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => { setDateId(d.id); clearError("eventDateId"); }}
                className={[
                  "relative rounded-xl border-2 p-4 text-left transition",
                  selected ? "border-brand bg-brand/5 ring-4 ring-brand/10" : "border-slate-200 bg-white hover:border-slate-300",
                  disabled && "cursor-not-allowed opacity-50 hover:border-slate-200",
                ].filter(Boolean).join(" ")}
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
                <p className={["mt-3 text-sm font-medium", left === 0 ? "text-red-600" : low ? "text-amber-600" : "text-emerald-700"].join(" ")}>
                  {notAssigned
                    ? "No es tu fecha asignada"
                    : left === 0
                    ? "Agotado"
                    : disabled
                      ? `Quedan ${left} cupos (no alcanza para ${seatsNeeded} personas)`
                      : `${left} ${left === 1 ? "cupo disponible" : "cupos disponibles"}`}
                </p>
              </button>
            );
          })}
        </div>
        {errors.eventDateId && <FieldError>{errors.eventDateId}</FieldError>}
        {selectedInsufficient && <FieldError>El día elegido ya no tiene cupos suficientes. Elige otro.</FieldError>}
      </Section>

      {allowCompanions && (
        <Section
          number={2}
          title={companionMode === "REQUIRED" ? "Tus acompañantes" : "¿Vienes con acompañantes?"}
          icon={<UserPlus className="size-4" />}
        >
          <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm">
              <p className="font-medium">
                {companions.length === 0 ? "Asistiré solo" : `${companions.length} ${companions.length === 1 ? "acompañante" : "acompañantes"}`}
              </p>
              <p className="text-slate-500">Máximo {maxCompanions}. Cada acompañante ocupa un cupo.</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-ghost size-10 p-0" aria-label="Quitar acompañante"
                disabled={companions.length <= minCompanions}
                onClick={() => setCompanions((c) => c.slice(0, -1))}>
                <Minus className="size-4" />
              </button>
              <span className="w-6 text-center font-semibold tabular-nums">{companions.length}</span>
              <button type="button" className="btn-ghost size-10 p-0" aria-label="Agregar acompañante"
                disabled={companions.length >= maxCompanions}
                onClick={() => setCompanions((c) => [...c, { ...EMPTY_COMPANION }])}>
                <Plus className="size-4" />
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {companions.map((c, i) => {
              const set = (patch: Partial<CompanionForm>, key: string) => {
                setCompanions((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                clearError(`companions.${i}.${key}`);
              };
              return (
                <div key={i} className="rounded-xl border border-slate-200 p-4">
                  <p className="mb-3 text-sm font-semibold text-slate-700">Acompañante {i + 1}</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id={`c${i}-name`} label="Nombre completo" error={errors[`companions.${i}.fullName`]} className="sm:col-span-2">
                      <input id={`c${i}-name`} className="input" autoComplete="off" value={c.fullName}
                        onChange={(e) => set({ fullName: e.target.value }, "fullName")} />
                    </Field>
                    <Field id={`c${i}-type`} label="Tipo de documento" error={errors[`companions.${i}.documentType`]}>
                      <select id={`c${i}-type`} className="input" value={c.documentType}
                        onChange={(e) => set({ documentType: e.target.value as DocumentType }, "documentType")}>
                        {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_LABELS[t]}</option>)}
                      </select>
                    </Field>
                    <Field id={`c${i}-doc`} label="Número de documento" error={errors[`companions.${i}.documentNumber`]}>
                      <input id={`c${i}-doc`} className="input" autoComplete="off" value={c.documentNumber}
                        inputMode={c.documentType === "DNI" || c.documentType === "CEDULA" ? "numeric" : "text"}
                        onChange={(e) => set({ documentNumber: e.target.value }, "documentNumber")} />
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <div className="space-y-3">
        {selectedDate && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-semibold">Tu selección</p>
            <p className="mt-1">{formatDay(selectedDate.event_day)} · {formatTime(selectedDate.starts_at)}</p>
            <p className="mt-1 text-slate-500">
              {seatsNeeded === 1 ? "1 persona: tú" : `${seatsNeeded} personas: tú y ${companions.length} ${companions.length === 1 ? "acompañante" : "acompañantes"}`}
            </p>
          </div>
        )}
        <button type="submit" className="btn-brand w-full py-3.5 text-base" disabled={pending || selectedInsufficient}>
          {pending ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
          {pending ? "Confirmando…" : "Confirmar mi asistencia"}
        </button>
        <p className="text-center text-xs text-slate-500">Al confirmar verás tu ticket con código QR. Guárdalo o toma una captura.</p>
      </div>
    </form>
  );
}

function Section({ number, title, icon, children }: { number: number; title: string; icon: React.ReactNode; children: React.ReactNode }) {
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

function Field({ id, label, error, className, children }: { id: string; label: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={id}>{label}</label>
      {children}
      {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-sm text-red-600">{children}</p>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-slate-600">{children}</div>;
}
