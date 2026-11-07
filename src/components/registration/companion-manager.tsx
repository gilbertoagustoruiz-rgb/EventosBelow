"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, UserPlus, X } from "lucide-react";
import { addCompanion, removeCompanion } from "@/app/evento/[slug]/ticket/[token]/actions";
import { DOCUMENT_LABELS, DOCUMENT_TYPES } from "@/lib/validation";
import type { DocumentType } from "@/lib/types";

interface Companion { id: string; fullName: string; documentType: string; documentNumber: string; checkedIn: boolean }

/** Regularizar la confirmación: agregar o quitar acompañantes desde el ticket. */
export function CompanionManager({
  token,
  companions,
  max,
  required,
}: {
  token: string;
  companions: Companion[];
  max: number;
  required: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<DocumentType>("DNI");
  const [doc, setDoc] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const canAdd = companions.length < max;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const res = await addCompanion(token, { fullName: name, documentType: type, documentNumber: doc });
      setErrors(res.fieldErrors ?? {});
      if (res.message) setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setName(""); setDoc(""); setOpen(false);
        router.refresh();
      }
    });
  }

  function remove(c: Companion) {
    if (!window.confirm(`¿Quitar a ${c.fullName} de tu confirmación? Se liberará su cupo.`)) return;
    setMessage(null);
    start(async () => {
      const res = await removeCompanion(token, c.id);
      if (res.message) setMessage({ ok: res.ok, text: res.message });
      if (res.ok) router.refresh();
    });
  }

  return (
    <section className="no-print mx-auto mt-5 max-w-md rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <UserPlus className="size-5 text-brand" /> ¿Vienes con un acompañante?
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Puedes registrar {max === 1 ? "1 acompañante" : `hasta ${max} acompañantes`} con su nombre y documento.
        {required && " Este evento requiere al menos uno."}
      </p>

      {companions.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100">
          {companions.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.fullName}</span>
                <span className="text-slate-500">{c.documentType} {c.documentNumber}</span>
              </span>
              {c.checkedIn ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="size-4" /> Ingresó</span>
              ) : (
                <button type="button" disabled={pending} onClick={() => remove(c)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Quitar a ${c.fullName}`}>
                  <X className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {message && (
        <p role={message.ok ? "status" : "alert"} className={`mt-3 rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}

      {canAdd && !open && (
        <button type="button" onClick={() => setOpen(true)} className="btn-brand mt-4 w-full py-3">
          <UserPlus className="size-4" /> Agregar acompañante
        </button>
      )}
      {!canAdd && <p className="mt-4 text-xs text-slate-500">Ya registraste el máximo de acompañantes.</p>}

      {open && (
        <form onSubmit={submit} noValidate className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4">
          <div>
            <label className="label" htmlFor="cm-name">Nombre completo del acompañante</label>
            <input id="cm-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
            {errors.fullName && <p className="mt-1 text-sm text-red-600">{errors.fullName}</p>}
          </div>
          <div className="grid grid-cols-5 gap-3">
            <div className="col-span-2">
              <label className="label" htmlFor="cm-type">Documento</label>
              <select id="cm-type" className="input" value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
                {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="col-span-3">
              <label className="label" htmlFor="cm-doc">Número</label>
              <input id="cm-doc" className="input" value={doc} onChange={(e) => setDoc(e.target.value)} autoComplete="off"
                inputMode={type === "DNI" || type === "CEDULA" ? "numeric" : "text"} />
              {errors.documentNumber && <p className="mt-1 text-sm text-red-600">{errors.documentNumber}</p>}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn-brand flex-1 py-2.5">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {pending ? "Guardando…" : "Confirmar acompañante"}
            </button>
            <button type="button" onClick={() => { setOpen(false); setErrors({}); }} className="btn-ghost px-4">Cancelar</button>
          </div>
        </form>
      )}
    </section>
  );
}
