import pg from "pg";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

/**
 * Configuración de conexión compartida por los scripts (misma lógica que src/lib/db.ts).
 *  - ?sslmode=require (DigitalOcean) o host *.render.com (URL externa de Render) → SSL.
 *  - DATABASE_CA_CERT presente → además verifica el certificado.
 */
export function poolConfig() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Falta DATABASE_URL");
  const url = new URL(raw);
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  const wantsSsl = sslmode ? sslmode !== "disable" : /\.render\.com$/i.test(url.hostname);
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  const ssl = wantsSsl ? (ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }) : undefined;
  return { connectionString: url.toString(), ssl };
}

export function createPool() {
  return new pg.Pool({ ...poolConfig(), max: 2 });
}

/** Mismo formato que src/lib/password.ts */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await promisify(scrypt)(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** Registra (o reactiva) al usuario como empleado con perfil ADMINISTRADOR, si existe la tabla. */
export async function registerAdminEmployee(db, userId, email, fullName) {
  const { rows } = await db.query("select to_regclass('public.employees') is not null as ok");
  if (!rows[0].ok) return;
  await db.query(
    `insert into employees (profile, full_name, email, user_id)
     values ('ADMINISTRADOR', coalesce($3, $2), $2, $1)
     on conflict (user_id) do update set profile = 'ADMINISTRADOR', is_active = true`,
    [userId, email, fullName ?? null],
  );
}
