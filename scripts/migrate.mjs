#!/usr/bin/env node
// Aplica en orden las migraciones de db/migrations que aún no se ejecutaron.
// Uso: DATABASE_URL=... npm run db:migrate
// En DigitalOcean App Platform corre solo antes de cada despliegue (job PRE_DEPLOY).
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createPool } from "./db.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const pool = createPool();
const client = await pool.connect();

try {
  // Evita que dos despliegues migren a la vez
  await client.query("select pg_advisory_lock(727001)");
  await client.query(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);

  const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    process.stdout.write(`→ ${file} … `);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log("ok");
      applied++;
    } catch (err) {
      await client.query("rollback");
      console.log("ERROR");
      throw err;
    }
  }
  console.log(applied ? `${applied} migración(es) aplicada(s).` : "La base de datos ya está al día.");
} finally {
  await client.query("select pg_advisory_unlock(727001)").catch(() => {});
  client.release();
  await pool.end();
}
