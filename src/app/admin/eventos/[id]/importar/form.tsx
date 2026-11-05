"use client";

import { startTransition, useActionState, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
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

      {analyzed && !previewPending && preview.message && (
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
              {preview.valid > 0 && !committed && (
                <div className="flex flex-wrap items-center gap-4">
                  <button type="button" className="btn-brand" disabled={commitPending} onClick={() => { setCommitted(true); submit(commitAction); }}>
                    {commitPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    {commitPending ? "Cargando…" : `Cargar ${preview.valid} ${preview.valid === 1 ? "invitado" : "invitados"}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {committed && !commitPending && result.message && (
        <p role="status" className={`flex items-start gap-2 rounded-xl p-3 text-sm font-medium ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {result.ok && <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
          <span>
            {result.message}
          </span>
        </p>
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
