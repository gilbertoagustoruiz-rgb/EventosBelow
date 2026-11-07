"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CameraOff, Loader2 } from "lucide-react";

interface Props {
  /** Se llama con el texto leído. Lecturas repetidas del mismo código se ignoran por `cooldownMs`. */
  onScan: (text: string) => void;
  /** Mientras está en pausa la cámara sigue activa pero no emite lecturas (evita re-escaneos). */
  paused?: boolean;
  cooldownMs?: number;
}

type CamState = "starting" | "running" | "error";

/**
 * Escáner QR con html5-qrcode. La librería toca `window`, así que se importa
 * dinámicamente dentro del efecto (compatible con SSR de Next.js).
 */
export function QrScanner({ onScan, paused = false, cooldownMs = 3000 }: Props) {
  const regionId = `qr-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [state, setState] = useState<CamState>("starting");
  const [error, setError] = useState<string | null>(null);

  const onScanRef = useRef(onScan);
  const pausedRef = useRef(paused);
  const lastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  onScanRef.current = onScan;
  pausedRef.current = paused;

  useEffect(() => {
    let cancelled = false;
    let scanner: import("html5-qrcode").Html5Qrcode | null = null;

    (async () => {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
      if (cancelled) return;
      scanner = new Html5Qrcode(regionId, {
        // QR del ticket y, además, los códigos del DNI físico (PDF417 / barras)
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.PDF_417,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
        ],
        verbose: false,
      });
      try {
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 12,
            qrbox: (w, h) => {
              const size = Math.floor(Math.min(w, h) * 0.8);
              return { width: size, height: size };
            },
            aspectRatio: 1,
          },
          (text) => {
            if (pausedRef.current) return;
            const now = Date.now();
            if (text === lastRef.current.text && now - lastRef.current.at < cooldownMs) return;
            lastRef.current = { text, at: now };
            onScanRef.current(text);
          },
          () => {
            /* frame sin QR: normal */
          },
        );
        if (cancelled) await scanner.stop().catch(() => {});
        else setState("running");
      } catch (err) {
        if (cancelled) return;
        setState("error");
        const msg = String(err);
        setError(
          /NotAllowed|Permission/i.test(msg)
            ? "Permiso de cámara denegado. Habilítalo en el navegador o usa la búsqueda manual."
            : /NotFound|no camera/i.test(msg)
              ? "No se encontró una cámara en este dispositivo."
              : "No se pudo iniciar la cámara. Se requiere HTTPS o localhost.",
        );
      }
    })();

    return () => {
      cancelled = true;
      if (scanner?.isScanning) {
        scanner
          .stop()
          .then(() => scanner?.clear())
          .catch(() => {});
      }
    };
  }, [regionId, cooldownMs]);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-slate-900">
      <div id={regionId} className="size-full [&_video]:!size-full [&_video]:object-cover" />

      {state === "starting" && (
        <div className="absolute inset-0 grid place-items-center text-slate-300">
          <Loader2 className="size-8 animate-spin" />
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-slate-200">
          <CameraOff className="size-10" />
          <p className="text-sm">{error}</p>
        </div>
      )}
      {state === "running" && paused && <div className="absolute inset-0 bg-slate-900/60" />}
    </div>
  );
}
