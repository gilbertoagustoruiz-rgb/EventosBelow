"use client";

let ctx: AudioContext | null = null;

/** Beep + vibración para que el anfitrión no tenga que mirar la pantalla. */
export function feedback(kind: "ok" | "error") {
  try {
    navigator.vibrate?.(kind === "ok" ? 80 : [120, 80, 120]);
  } catch {}
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = kind === "ok" ? 880 : 220;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (kind === "ok" ? 0.15 : 0.35));
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

/** Acepta el token crudo o una URL de ticket (…/ticket/<token>) */
export function extractToken(text: string): string | null {
  const m = text.trim().match(/([a-f0-9]{32})(?:[/?#]|$)/i);
  return m ? m[1].toLowerCase() : null;
}
