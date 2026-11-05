// Empleados, asignaciones y promotores (migraciones 0004–0007) contra PostgreSQL real.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
test.after(async () => pool.end());

const code = () => randomUUID().replaceAll("-", "").slice(0, 10);
const dni = () => String(10000000 + Math.floor(Math.random() * 89999999));

async function seed() {
  const c = code();
  const tenant = (await pool.query("insert into tenants(name,slug) values($1,$2) returning id", ["Cliente " + c, "t-" + c])).rows[0].id;
  const other = (await pool.query("insert into tenants(name,slug) values($1,$2) returning id", ["Otro " + c, "o-" + c])).rows[0].id;
  const event = (await pool.query("insert into events(tenant_id,name,slug,is_published) values($1,'Evento',$2,true) returning id", [tenant, "e-" + c])).rows[0].id;
  const user = (await pool.query("insert into users(email,password_hash) values($1,'x') returning id", [`coord-${c}@x.pe`])).rows[0].id;
  const coord = (await pool.query("insert into employees(profile,full_name,email,user_id) values('COORDINADOR','Coord',$1,$2) returning id", [`coord-${c}@x.pe`, user])).rows[0].id;
  const promoter = (await pool.query("insert into employees(profile,full_name,document_number) values('PROMOTOR','Promo',$1) returning id", [dni()])).rows[0].id;
  return { tenant, other, event, user, coord, promoter };
}
async function cleanup(s) {
  await pool.query("delete from tenants where id = any($1)", [[s.tenant, s.other]]);
  await pool.query("delete from employees where id = any($1)", [[s.coord, s.promoter]]);
  await pool.query("delete from users where id = $1", [s.user]);
}
const members = async (s) =>
  (await pool.query("select tenant_id from tenant_members where user_id = $1", [s.user])).rows.map((r) => r.tenant_id);

test("esquema: directorio único, asignaciones y vista de miembros", async () => {
  for (const name of ["employees", "employee_clients", "event_promoters", "promoter_checkins"]) {
    const r = await pool.query("select to_regclass($1) as t", ["public." + name]);
    assert.ok(r.rows[0].t, name + " debe existir");
  }
  const kind = await pool.query("select relkind from pg_class where relname = 'tenant_members'");
  assert.equal(kind.rows[0].relkind, "v", "tenant_members es una vista derivada de las asignaciones");
  assert.equal((await pool.query("select to_regclass('public.promoters') as t")).rows[0].t, null, "promoters se unificó en employees");
  const idx = await pool.query("select indexdef from pg_indexes where tablename = 'event_promoters'");
  assert.ok(idx.rows.some((x) => x.indexdef.includes("(event_id, employee_id)")));
});

test("promotor exige documento y no se repite en el directorio", async () => {
  await assert.rejects(pool.query("insert into employees(profile,full_name) values('PROMOTOR','Sin doc')"), /employees_promoter_document_ck/);
  const d = dni();
  await pool.query("insert into employees(profile,full_name,document_number) values('PROMOTOR','Uno',$1)", [d]);
  try {
    await assert.rejects(pool.query("insert into employees(profile,full_name,document_number) values('PROMOTOR','Dos',$1)", [d]), /employees_document_uq/);
  } finally {
    await pool.query("delete from employees where document_number = $1", [d]);
  }
});

test("coordinador: accede solo a clientes asignados y mientras esté activo", async () => {
  const s = await seed();
  try {
    assert.deepEqual(await members(s), [], "sin asignación no tiene acceso");
    await pool.query("insert into employee_clients(employee_id,tenant_id) values($1,$2)", [s.coord, s.tenant]);
    assert.deepEqual(await members(s), [s.tenant], "asignado a un cliente: accede solo a ese");
    await pool.query("update employees set is_active = false where id = $1", [s.coord]);
    assert.deepEqual(await members(s), [], "desactivado: pierde el acceso");
    await pool.query("update employees set is_active = true where id = $1", [s.coord]);
    await pool.query("delete from employee_clients where employee_id = $1", [s.coord]);
    assert.deepEqual(await members(s), [], "desasignado: pierde el acceso");
  } finally {
    await cleanup(s);
  }
});

test("promotores no generan acceso al panel aunque estén asignados", async () => {
  const s = await seed();
  try {
    await pool.query("insert into employee_clients(employee_id,tenant_id) values($1,$2)", [s.promoter, s.tenant]);
    const r = await pool.query("select count(*)::int n from tenant_members m join employees e on e.user_id = m.user_id where e.id = $1", [s.promoter]);
    assert.equal(r.rows[0].n, 0);
  } finally {
    await cleanup(s);
  }
});

test("auditoría: identidad del promotor y tipo de ingreso; se borra en cascada", async () => {
  const s = await seed();
  try {
    const date = (await pool.query("insert into event_dates(event_id,event_day,starts_at,ends_at,capacity) values($1,current_date+3,'09:00','18:00',5) returning id", [s.event])).rows[0].id;
    const reg = (await pool.query("select out_registration_id from register_attendee($1,'Asistente','a@x.pe','999999999','DNI',$2,null,null,false,null,null,null)", [date, dni()])).rows[0].out_registration_id;
    const ep = (await pool.query("insert into event_promoters(event_id,employee_id) values($1,$2) returning id, access_key", [s.event, s.promoter])).rows[0];
    assert.match(ep.access_key, /^[a-f0-9]{32}$/);
    await pool.query("insert into promoter_checkins(promoter_id,registration_id,target) values($1,$2,'HOLDER')", [ep.id, reg]);
    await assert.rejects(pool.query("insert into promoter_checkins(promoter_id,registration_id,target) values($1,$2,'OTRO')", [ep.id, reg]));
    await pool.query("delete from tenants where id = $1", [s.tenant]); // evento → inscripciones → auditoría
    const left = await pool.query("select count(*)::int n from promoter_checkins where promoter_id = $1", [ep.id]);
    assert.equal(left.rows[0].n, 0);
  } finally {
    await cleanup(s);
  }
});
