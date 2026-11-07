"use client";

import { useRef, useState } from "react";
import { Download, Loader2, QrCode, X } from "lucide-react";

/** Botón "Generar QR": muestra el QR del enlace con el logo del evento y permite descargarlo en alta definición. */
export function GenerateQr({ eventId, eventName, url }: { eventId: string; eventName: string; url: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [stamp, setStamp] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const base = `/admin/eventos/${eventId}/qr`;

  function open() {
    setLoaded(false);
    setStamp(Date.now()); // siempre el logo y color vigentes
    ref.current?.showModal();
  }

  return (
    <>
      <button type="button" onClick={open} className="btn-brand py-2">
        <QrCode className="size-4" /> Generar QR
      </button>
      <dialog
        ref={ref}
        aria-labelledby="qr-title"
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-[min(92vw,28rem)] rounded-2xl p-0 shadow-2xl backdrop:bg-slate-950/50"
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="qr-title" className="text-lg font-semibold">QR de confirmación</h2>
              <p className="text-sm text-slate-500">{eventName}</p>
            </div>
            <button type="button" onClick={() => ref.current?.close()} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
              <X className="size-5" />
            </button>
          </div>
          <div className="relative mt-4 grid aspect-square place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white">
            {!loaded && <Loader2 className="absolute size-8 animate-spin text-slate-300" />}
            {stamp && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${base}?formato=png&v=${stamp}`}
                alt={`Código QR del enlace ${url}`}
                onLoad={() => setLoaded(true)}
                className={`size-full object-contain transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
              />
            )}
          </div>
          <p className="mt-3 break-all text-center font-mono text-xs text-slate-500">{url}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <a href={`${base}?formato=png&descargar=1`} className="btn-brand justify-center py-2.5">
              <Download className="size-4" /> PNG alta definición
            </a>
            <a href={`${base}?formato=svg&descargar=1`} className="btn-ghost justify-center py-2.5">
              <Download className="size-4" /> SVG para imprenta
            </a>
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">
            PNG de 2048 × 2048 px para redes, correos o pantallas; SVG vectorial para afiches y banners de cualquier tamaño.
          </p>
        </div>
      </dialog>
    </>
  );
}
