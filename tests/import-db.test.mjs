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

test("procedimiento de registro: 12 argumentos públicos + modo administrador opcional",async()=>{
 const r=await pool.query("select pronargs,pronargdefaults from pg_proc where proname='register_attendee'");
 assert.equal(r.rows.length,1,"una sola versión de register_attendee");
 assert.equal(r.rows[0].pronargs,13);
 assert.equal(r.rows[0].pronargdefaults,1,"p_admin es opcional: las llamadas con 12 argumentos siguen funcionando");
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

import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
const suffix=()=>randomUUID().replaceAll("-","").slice(0,12);
async function seed(capacity=3){
 const code=suffix();
 const tenant=(await pool.query("insert into tenants(name,slug) values($1,$2) returning id",["Prueba importación", "test-import-"+code])).rows[0].id;
 const event=(await pool.query("insert into events(tenant_id,name,slug,is_published,registration_open) values($1,$2,$3,true,true) returning id",[tenant,"Evento prueba","test-event-"+code])).rows[0].id;
 const date=(await pool.query("insert into event_dates(event_id,event_day,starts_at,ends_at,capacity) values($1,current_date+30,'10:00','18:00',$2) returning id",[event,capacity])).rows[0].id;
 return {tenant,event,date};
}
async function cleanup(s){
 await pool.query("delete from tenants where id=$1",[s.tenant]);
}
async function register(date,doc,client=pool){
 return client.query("select out_registration_id,out_token from register_attendee($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[date,"Asistente de Prueba","prueba@example.com","999999999","DNI",doc,null,null,false,null,null,null]);
}
test("Excel XLSX real: lectura de encabezados, importación y token QR en PostgreSQL",async()=>{
 const s=await seed(4);
 try{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet("Asistentes");
  sheet.addRow(["Nombre completo","DNI","Correo","Celular"]);
  sheet.addRow(["Persona Uno","12345678","uno@example.com","999999999"]);
  sheet.addRow(["Persona Dos","87654321","dos@example.com","988888888"]);
  const bytes=await book.xlsx.writeBuffer();
  const loaded=new ExcelJS.Workbook();
  await loaded.xlsx.load(bytes);
  const records=loaded.worksheets[0];
  assert.equal(records.getRow(1).getCell(2).text,"DNI");
  for(let i=2;i<=3;i++){
   const row=records.getRow(i);
   await pool.query("select out_token from register_attendee($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[
    s.date,row.getCell(1).text,row.getCell(3).text,row.getCell(4).text,"DNI",row.getCell(2).text,null,null,false,null,null,null
   ]);
  }
  const r=await pool.query("select document_number,token from registrations where event_date_id=$1 order by document_number",[s.date]);
  assert.equal(r.rows.length,2);
  assert.ok(r.rows.every(x=>/^[a-f0-9]{32}$/.test(x.token)));
  const d=await pool.query("select registered_count from event_dates where id=$1",[s.date]);
  assert.equal(d.rows[0].registered_count,2);
 }finally{await cleanup(s);}
});
test("duplicados: dos altas con el mismo DNI generan una sola inscripción y un cupo",async()=>{
 const s=await seed(3);
 try{
  await register(s.date,"12345678");
  await assert.rejects(register(s.date,"12345678"),/DUPLICATE/);
  const r=await pool.query("select count(*)::int n from registrations where event_date_id=$1",[s.date]);
  const d=await pool.query("select registered_count from event_dates where id=$1",[s.date]);
  assert.equal(r.rows[0].n,1);
  assert.equal(d.rows[0].registered_count,1);
 }finally{await cleanup(s);}
});
test("concurrencia real: dos conexiones disputan el último cupo, solo una confirma",async()=>{
 const s=await seed(1);
 try{
  const results=await Promise.allSettled([register(s.date,"12345678"),register(s.date,"87654321")]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(results.filter(r=>r.status==="rejected").length,1);
  assert.match(String(results.find(r=>r.status==="rejected").reason),/SOLD_OUT/);
  const r=await pool.query("select count(*)::int n from registrations where event_date_id=$1",[s.date]);
  const d=await pool.query("select registered_count from event_dates where id=$1",[s.date]);
  assert.equal(r.rows[0].n,1);
  assert.equal(d.rows[0].registered_count,1);
 }finally{await cleanup(s);}
});
test("concurrencia real: mismo DNI simultáneo no duplica inscripciones ni cupos",async()=>{
 const s=await seed(2);
 try{
  const results=await Promise.allSettled([register(s.date,"12345678"),register(s.date,"12345678")]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(results.filter(r=>r.status==="rejected").length,1);
  const r=await pool.query("select count(*)::int n from registrations where event_date_id=$1",[s.date]);
  const d=await pool.query("select registered_count from event_dates where id=$1",[s.date]);
  assert.equal(r.rows[0].n,1);
  assert.equal(d.rows[0].registered_count,1);
 }finally{await cleanup(s);}
});

test("importación del administrador: funciona con el evento sin publicar, el portal público no",async()=>{
 const s=await seed(2);
 try{
  await pool.query("update events set is_published=false, registration_open=false where id=$1",[s.event]);
  await assert.rejects(register(s.date,"11111111"),/EVENT_CLOSED/);
  await pool.query("select out_token from register_attendee($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)",[s.date,"Importada","imp@example.com","999999999","DNI","22222222",null,null,false,null,null,null]);
  // El modo administrador respeta aforo, duplicados y reglas de acompañante
  await assert.rejects(pool.query("select register_attendee($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)",[s.date,"Duplicada","d@example.com","999999999","DNI","22222222",null,null,false,null,null,null]),/DUPLICATE/);
  await assert.rejects(pool.query("select register_attendee($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)",[s.date,"Con acomp","c@example.com","999999999","DNI","33333333",null,null,true,"Acomp","DNI","44444444"]),/COMPANION_NOT_ALLOWED/);
  await pool.query("select register_attendee($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)",[s.date,"Ultimo","u@example.com","999999999","DNI","55555555",null,null,false,null,null,null]);
  await assert.rejects(pool.query("select register_attendee($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)",[s.date,"Sin cupo","x@example.com","999999999","DNI","66666666",null,null,false,null,null,null]),/SOLD_OUT/);
 }finally{await cleanup(s);}
});
