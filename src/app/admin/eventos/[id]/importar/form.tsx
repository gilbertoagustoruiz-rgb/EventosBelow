"use client";

import { startTransition, useActionState, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { commitImport, previewImport, type ImportResult } from "./actions";

const initial: ImportResult = { ok: false, message: "", valid: 0, invalid: 0, duplicates: 0, imported: 0, emailed: 0, preview: [] };

export function ImportForm({ eventId, dates }: { eventId: string; dates: { id: string; label: string }[] }) {
  const [preview, previewAction, previewPending] = useActionState(previewImport, initial);
  const [result, commitAction, commitPending] = useActionState(commitImport, initial);
  const [file, setFile] = useState<File | null>(null);
  const [dateId, setDateId] = useState(dates[0]?.id ?? "");
  const [sendTickets, setSendTickets] = useState(true);
  const [analyzed, setAnalyzed] = useState(false);
  const [committed, setCommitted] = useState(false);

  function submit(action: (fd: FormData) => void) {
    if (!file || !dateId) return;
    const fd = new FormData();
    fd.set("eventId", eventId);
    fd.set("dateId", dateId);
    fd.set("file", file);
    if (sendTickets) fd.set("sendTickets", "on");
    startTransition(() => action(fd));
  }

  const reset = () => {
    setAnalyzed(false);
    setCommitted(false);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-medium">
          Fecha del evento
          <select className="input" value={dateId} onChange={(e) => { setDateId(e.target.value); reset(); }}>
            {dates.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium">
          Archivo Excel (.xlsx, máximo 3 MB)
          <input className="input" type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} />
        </label>
      </div>

      <p className="text-sm text-slate-600">
        La primera fila debe tener los encabezados. Se reconocen variantes de <b>Nombre</b>, <b>DNI/Documento</b>, Correo, Celular,
        Empresa, Cargo y Acompañante. Nombre, documento, correo y celular son obligatorios. El evento puede estar sin publicar.
      </p>

      <button type="button" disabled={!file || !dateId || previewPending} className="btn-dark" onClick={() => { setAnalyzed(true); setCommitted(false); submit(previewAction); }}>
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
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <Stat label="Válidas" value={preview.valid} tone="text-emerald-700" />
                <Stat label="Con errores" value={preview.invalid - preview.duplicates} tone="text-red-600" />
                <Stat label="Ya inscritas" value={preview.duplicates} tone="text-slate-600" />
              </div>
              <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr><th className="p-2">Fila</th><th className="p-2">Nombre</th><th className="p-2">Documento</th><th className="p-2">Resultado</th></tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((r) => (
                      <tr key={r.line} className="border-t border-slate-100">
                        <td className="p-2">{r.line}</td>
                        <td className="p-2">{r.name}{r.companionName && <span className="text-slate-400"> +1</span>}</td>
                        <td className="p-2">{r.documentType} {r.document}</td>
                        <td className={`p-2 ${r.errors.length ? "text-red-600" : "text-emerald-700"}`}>{r.errors.join("; ") || "Válida"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.valid > 0 && !committed && (
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={sendTickets} onChange={(e) => setSendTickets(e.target.checked)} className="size-4" />
                    Enviar el ticket QR por correo a cada persona importada
                  </label>
                  <button type="button" className="btn-brand" disabled={commitPending} onClick={() => { setCommitted(true); submit(commitAction); }}>
                    {commitPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    {commitPending ? "Importando…" : `Importar ${preview.valid} ${preview.valid === 1 ? "fila válida" : "filas válidas"}`}
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
            {result.ok && ` Importadas: ${result.imported}.`}
            {result.ok && result.duplicates > 0 && ` Omitidas por estar ya inscritas: ${result.duplicates}.`}
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
