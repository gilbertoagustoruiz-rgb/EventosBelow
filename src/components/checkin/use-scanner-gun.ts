"use client";

import { useEffect, useRef } from "react";

/**
 * Pistolas lectoras (USB o Bluetooth en modo teclado): "teclean" el código muy rápido y
 * terminan con Enter o Tab. Se escucha en toda la página para que funcionen en cualquier
 * modo sin tocar la pantalla. Lo que se escribe a mano en un campo de texto se respeta.
 */
export function useScannerGun(onRead: (text: string) => void, enabled = true) {
  const cb = useRef(onRead);
  cb.current = onRead;

  useEffect(() => {
    if (!enabled) return;
    let buffer = "";
    let last = 0;
    let fast = 0; // teclas seguidas a ritmo de lector
    let idle: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      const text = buffer;
      const burst = fast;
      buffer = "";
      fast = 0;
      if (text.length >= 4 && burst >= Math.min(6, text.length - 1)) cb.current(text);
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // En campos de texto manda el teclado (el campo de DNI ya interpreta lecturas de pistola)
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const now = performance.now();
      if (e.key === "Enter" || e.key === "Tab") {
        if (buffer) {
          e.preventDefault();
          flush();
        }
        return;
      }
      if (e.key.length !== 1) return;
      if (now - last > 80) {
        buffer = "";
        fast = 0;
      } else fast++;
      last = now;
      buffer += e.key;
      // Lectores configurados sin Enter: cerramos al quedar en silencio
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => buffer.length >= 8 && flush(), 150);
    };

    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (idle) clearTimeout(idle);
    };
  }, [enabled]);
}
