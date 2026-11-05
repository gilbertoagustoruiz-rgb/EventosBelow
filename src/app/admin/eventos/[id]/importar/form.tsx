"use client";

import { startTransition, useActionState, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, Upload, Users } from "lucide-react";
import { commitImport, previewImport, type ImportResult } from "./actions";

const initial: ImportResult = { ok: false, message: "", valid: 0, invalid: 0, updates: 0, imported: 0, preview: [] };

export function ImportForm({ eventId }: { eventId: string }) {
  const [preview, previewAction, previewPending] = useActionState(previewImport, initial);
  const [result, commitAction, commitPending] = useActionState(commitImport, initial);
  const [file, setFile] = useState<File | null>(null);
  const [analyzed, setAnalyzed] = useState(false);
  const [committed, setCommitted] = useState(false);

  function submit(action: (fd: FormData) => void) {
    if (!file) return;
    const fd = new FormData();
    fd.set("eventId", eventId);
    fd.set("file", file);
    startTransition(() => action(fd));
  }

  const reset = () => {
    setAnalyzed(false);
    setCommitted(false);
  };

  return (
    <div className="space-y-5">
      <label className="block space-y-2 text-sm font-medium">
        Archivo Excel (.xlsx, máximo 5 MB)
        <input className="input" type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} />
      </label>

      <p className="text-sm text-slate-600">
        La primera fila debe tener los encabezados. Obligatorios: <b>Nombre</b> y <b>DNI/Documento</b>. Opcionales:{" "}
        <b>Código</b> (vendedor, Id RH…), <b>Fecha de asistencia</b>, Tipo de documento, Correo, Celular, Empresa y Cargo. Si el
        documento ya está en la base, se actualizan sus datos. Con fecha de asistencia, el invitado solo confirma esa fecha;
        sin correo, lo ingresará al confirmar.
      </p>

      <button type="button" disabled={!file || previewPending} className="btn-dark" onClick={() => { setAnalyzed(true); setCommitted(false); submit(previewAction); }}>
        {previewPending ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
        {previewPending ? "Analizando…" : "Analizar Excel y mostrar vista previa"}
      </button>

      {analyzed && !committed && !previewPending && preview.message && (
        <div className="space-y-4">
          <p role="status" className={`rounded-xl p-3 text-sm ${preview.ok && !preview.message.startsWith("Atención") ? "bg-slate-50 text-slate-700" : "bg-amber-50 text-amber-800"}`}>
            {preview.message}
          </p>
          {preview.ok && (
            <>
              {preview.columns && (
                <div className="rounded-xl border border-slate-200 p-3 text-sm">
                  <p className="font-medium text-slate-700">Columnas reconocidas</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {preview.columns.used.map((c) => (
                      <span key={c.field} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800">
                        {c.field} ← «{c.header}»
                      </span>
                    ))}
                  </div>
                  {preview.columns.ignored.length > 0 && (
                    <p className="mt-2 text-xs text-amber-700">No se usan: {preview.columns.ignored.map((h) => `«${h}»`).join(", ")}</p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <Stat label="Nuevos" value={preview.valid - preview.updates} tone="text-emerald-700" />
                <Stat label="Actualizan datos" value={preview.updates} tone="text-slate-600" />
                <Stat label="Con errores" value={preview.invalid} tone="text-red-600" />
              </div>
              <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr><th className="p-2">Fila</th><th className="p-2">Nombre</th><th className="p-2">Documento</th><th className="p-2">Código</th><th className="p-2">Fecha</th><th className="p-2">Correo</th><th className="p-2">Resultado</th></tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((r) => (
                      <tr key={r.line} className="border-t border-slate-100">
                        <td className="p-2">{r.line}</td>
                        <td className="p-2">{r.name}</td>
                        <td className="p-2">{r.documentType} {r.document}</td>
                        <td className="p-2">{r.code || "—"}</td>
                        <td className="p-2 whitespace-nowrap">{r.dateText || "—"}</td>
                        <td className="p-2">{r.email || "—"}</td>
                        <td className={`p-2 ${r.errors.length ? "text-red-600" : "text-emerald-700"}`}>{r.errors.join("; ") || (r.exists ? "Actualiza" : "Nuevo")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.valid > 0 && (
                <div className="flex flex-wrap items-center gap-4">
                  <button type="button" className="btn-brand" onClick={() => { setCommitted(true); submit(commitAction); }}>
                    <Upload className="size-4" />
                    {`Cargar ${preview.valid} ${preview.valid === 1 ? "invitado" : "invitados"}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {committed && (commitPending || !result.message) && (
        <div role="status" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm">
          <Loader2 className="size-5 shrink-0 animate-spin text-slate-500" />
          <div>
            <p className="font-semibold">Cargando {preview.valid.toLocaleString("es-PE")} invitados…</p>
            <p className="text-slate-500">Puede tardar unos segundos. No cierres esta página.</p>
          </div>
        </div>
      )}

      {committed && !commitPending && result.message && (
        result.ok ? (
          <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="flex items-center gap-2 text-lg font-semibold text-emerald-900">
              <CheckCircle2 className="size-5" /> Base de invitados cargada
            </p>
            <p className="mt-1 text-sm text-emerald-800">{result.message}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/admin/eventos/${eventId}/invitados`} className="btn-brand"><Users className="size-4" /> Ver invitados</Link>
              <Link href={`/admin/eventos/${eventId}`} className="btn-ghost">Volver al evento</Link>
              <button type="button" className="btn-ghost" onClick={reset}>Cargar otro Excel</button>
            </div>
          </div>
        ) : (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
            <p className="flex items-center gap-2 font-semibold"><AlertCircle className="size-4" /> {result.message}</p>
            <button type="button" className="btn-ghost mt-3" onClick={() => setCommitted(false)}>Volver a la vista previa</button>
          </div>
        )
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-slate-500">{label}</p>
    </div>
  );
}
