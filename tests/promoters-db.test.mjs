import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
test.after(async () => pool.end());

test("migraciones de promotores y auditoría instaladas", async () => {
 const { rows } = await pool.query("select name from schema_migrations where name = '0004_event_promoters.sql'");
 assert.equal(rows.length, 1);
 for (const table of ["event_promoters", "promoter_checkins"]) {
  const r = await pool.query("select to_regclass($1) as name", ["public." + table]);
  assert.ok(r.rows[0].name, table + " debe existir");
 }
});
test("promotores usan enlaces únicos y pueden revocarse", async () => {
 const r = await pool.query(`select conname from pg_constraint where conrelid='event_promoters'::regclass`);
 assert.ok(r.rows.some(x => x.conname.includes("access_key")));
 const c = await pool.query("select column_name from information_schema.columns where table_name='event_promoters'");
 for(const field of ["event_id","access_key","is_active","document_number"]) assert.ok(c.rows.some(x=>x.column_name===field));
});
test("auditoría conserva identidad, registro y tipo de ingreso", async () => {
 const c = await pool.query("select column_name from information_schema.columns where table_name='promoter_checkins'");
 for(const field of ["promoter_id","registration_id","target","checked_at"]) assert.ok(c.rows.some(x=>x.column_name===field));
 const checks = await pool.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='promoter_checkins'::regclass and contype='c'");
 assert.ok(checks.rows.some(x=>x.definition.includes("HOLDER")&&x.definition.includes("COMPANION")&&x.definition.includes("BOTH")));
});
