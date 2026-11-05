/** Límite por proceso. Al llenarse rechaza claves nuevas sin borrar bloqueos vigentes. */
export function createRateLimiter(limit: number, windowMs: number, maxKeys = 5000) {
  const entries = new Map<string, { count: number; until: number }>();
  return {
    consume(key: string, now = Date.now()): boolean {
      for (const [k, entry] of entries) {
        if (entry.until <= now) entries.delete(k);
      }
      const entry = entries.get(key);
      if (entry) {
        if (entry.count >= limit) return false;
        entry.count++;
        return true;
      }
      if (entries.size >= maxKeys) return false;
      entries.set(key, { count: 1, until: now + windowMs });
      return true;
    },
    reset(key: string) { entries.delete(key); },
  };
}
