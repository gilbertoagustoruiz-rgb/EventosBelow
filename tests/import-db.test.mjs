import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
test.after(async()=>pool.end());

test("esquema de inscripciones y fechas disponible para importar",async()=>{
 const r=await pool.query("select to_regclass('public.registrations') as registrations,to_regclass('public.event_dates') as event_dates");
 assert.ok(r.rows[0].registrations);
 assert.ok(r.rows[0].event_dates);
 const c=await pool.query("select column_name from information_schema.columns where table_name='registrations'");
 for(const name of ["event_id","event_date_id","document_type","document_number","token","status","full_name","email","phone"])
  assert.ok(c.rows.some(x=>x.column_name===name),name);
});

test("procedimiento de registro que genera token existe con 12 argumentos",async()=>{
 const r=await pool.query("select oid::regprocedure::text as signature,pronargs from pg_proc where proname='register_attendee'");
 assert.ok(r.rows.some(x=>x.pronargs===12),"register_attendee requiere 12 parámetros");
});

test("transacciones con savepoints revierten registros de prueba sin tocar inscripciones",async()=>{
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  await client.query("CREATE TEMP TABLE import_test_rows(id integer primary key) ON COMMIT DROP");
  await client.query("SAVEPOINT row1");
  await client.query("INSERT INTO import_test_rows VALUES(1)");
  await client.query("ROLLBACK TO SAVEPOINT row1");
  const r=await client.query("SELECT count(*)::int AS n FROM import_test_rows");
  assert.equal(r.rows[0].n,0);
  await client.query("ROLLBACK");
 }finally{client.release();}
});

test("dos transacciones simultáneas mantienen aislamiento en PostgreSQL",async()=>{
 const [a,b]=await Promise.all([pool.connect(),pool.connect()]);
 try{
  await Promise.all([a.query("BEGIN"),b.query("BEGIN")]);
  const result=await Promise.all([a.query("SELECT txid_current() AS tx"),b.query("SELECT txid_current() AS tx")]);
  assert.notEqual(result[0].rows[0].tx,result[1].rows[0].tx);
 }finally{
  await Promise.allSettled([a.query("ROLLBACK"),b.query("ROLLBACK")]);
  a.release();b.release();
 }
});
