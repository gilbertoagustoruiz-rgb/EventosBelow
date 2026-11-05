import pg from "pg";

/**
 * Configuración de conexión compartida por los scripts.
 * DigitalOcean entrega DATABASE_URL con ?sslmode=require y un certificado CA propio.
 *  - Con DATABASE_CA_CERT: verifica el certificado (recomendado).
 *  - Sin él: conexión cifrada sin verificar la CA.
 */
export function poolConfig() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Falta DATABASE_URL");
  const url = new URL(raw);
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  const ssl =
    sslmode && sslmode !== "disable"
      ? ca
        ? { ca, rejectUnauthorized: true }
        : { rejectUnauthorized: false }
      : undefined;
  return { connectionString: url.toString(), ssl };
}

export function createPool() {
  return new pg.Pool({ ...poolConfig(), max: 2 });
}
