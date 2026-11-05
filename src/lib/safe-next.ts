/** Solo permite rutas locales; URL normaliza barras invertidas y caracteres de control. */
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || /[\\\u0000-\u0020\u007f]/.test(value)) return "/admin";
  try {
    const base = "https://eventos.invalid";
    const url = new URL(value, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/admin";
  } catch {
    return "/admin";
  }
}
