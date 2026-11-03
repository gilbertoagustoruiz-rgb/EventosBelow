const LOCALE = "es-PE";

/** "2026-11-20" → "jueves, 20 de noviembre de 2026" (sin desfase de zona horaria) */
export function formatDay(day: string, opts: Intl.DateTimeFormatOptions = {}) {
  const [y, m, d] = day.split("-").map(Number);
  const text = new Intl.DateTimeFormat(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
    ...opts,
  }).format(new Date(Date.UTC(y, m - 1, d)));
  // Solo la primera letra en mayúscula: "Martes, 17 de noviembre de 2026"
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDayShort(day: string) {
  return formatDay(day, { weekday: "short", day: "numeric", month: "short", year: undefined });
}

/** "09:00:00" → "09:00" */
export function formatTime(t: string) {
  return t.slice(0, 5);
}

export function formatDateTime(iso: string | null, timeZone = "America/Lima") {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export function formatClock(iso: string | null, timeZone = "America/Lima") {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria del evento */
export function todayIn(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

/** Color de texto legible sobre el color de marca */
export function readableOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? "#0f172a" : "#ffffff";
}

export function brandStyle(hex: string) {
  return { "--brand": hex, "--brand-fg": readableOn(hex) } as React.CSSProperties;
}

/** URL pública: NEXT_PUBLIC_APP_URL → URL automática de Render → localhost */
export function appUrl(path = "") {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}
