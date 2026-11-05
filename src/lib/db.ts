import "server-only";
import pg from "pg";

// DATE se devuelve como "YYYY-MM-DD" (sin desfase de zona horaria)
pg.types.setTypeParser(1082, (v) => v);
// TIMESTAMPTZ como texto ISO (igual que la API anterior; serializable a componentes cliente)
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());
// BIGINT (count(*)) como número
pg.types.setTypeParser(20, (v) => Number(v));

function poolConfig(): pg.PoolConfig {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Falta la variable DATABASE_URL");
  const url = new URL(raw);
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode"); // si se deja, pg ignora la opción ssl de abajo
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  return {
    connectionString: url.toString(),
    ssl:
      sslmode && sslmode !== "disable"
        ? ca
          ? { ca, rejectUnauthorized: true }
          : { rejectUnauthorized: false }
        : undefined,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
  };
}

// Un solo pool por proceso (también entre recargas en desarrollo)
const g = globalThis as unknown as { __pgPool?: pg.Pool };
function pool() {
  g.__pgPool ??= new pg.Pool(poolConfig());
  return g.__pgPool;
}

/** Ejecuta una consulta parametrizada y devuelve las filas. */
export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query(text, params);
  return res.rows as T[];
}

/** Primera fila o null. */
export async function queryOne<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Código de error de PostgreSQL (23505 = único, 23514 = check, P0001 = raise exception). */
export function pgCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

export function pgMessage(err: unknown): string {
  return (err as { message?: string } | null)?.message ?? "";
}
