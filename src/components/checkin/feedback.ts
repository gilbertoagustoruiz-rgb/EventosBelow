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

export type ScanInput = { token: string } | { codes: string[] };

/**
 * Interpreta lo leído por la cámara, una pistola lectora o el teclado:
 *  - QR del ticket (token o URL …/ticket/<token>)
 *  - DNI peruano: 8 dígitos; 9 dígitos (DNI + dígito verificador); zona MRZ del DNIe
 *    ("I<PER12345678<…"); o el PDF417 / código de barras con el número dentro
 *  - Código de trabajador (Id RH, fotocheck)
 * Devuelve los candidatos en orden de probabilidad; el servidor usa el primero que exista.
 */
export function parseScan(raw: string): ScanInput | null {
  const text = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!text) return null;
  const token = extractToken(text);
  if (token) return { token };

  const codes: string[] = [];
  const add = (v: string | undefined) => {
    const c = v?.trim();
    if (c && c.length >= 3 && c.length <= 40 && !codes.includes(c)) codes.push(c);
  };
  const compact = text.toUpperCase().replace(/[\s.-]/g, "");

  // MRZ del DNI electrónico: tipo I, país PER y el número de documento
  add(text.toUpperCase().match(/I[<A-Z]?PER(\d{8})/)?.[1]);
  if (/^\d{8}$/.test(compact)) add(compact);
  else if (/^\d{9}$/.test(compact)) {
    add(compact.slice(0, 8)); // DNI + dígito verificador
    add(compact);
  }
  // Lecturas largas (PDF417, Code 128…): bloques de 8 dígitos (o 9 = DNI + verificador) son DNI posibles.
  // Los que parecen fechas (aaaammdd, p. ej. nacimiento) van al final para no confundirlos con otro DNI.
  if (compact.length > 9) {
    const runs = [...text.matchAll(/(?<!\d)(\d{8,9})(?!\d)/g)].map((m) => m[1].slice(0, 8));
    const isDate = (v: string) => /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(v);
    runs.filter((v) => !isDate(v)).forEach(add);
    runs.filter(isDate).forEach(add);
  }
  // Código corto (Id RH, código de vendedor) tal como vino
  if (text.length <= 40) add(text);
  return codes.length ? { codes: codes.slice(0, 6) } : null;
}
