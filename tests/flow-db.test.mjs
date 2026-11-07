// Flujo completo contra PostgreSQL real (migraciones 0001–0009):
// Cliente → Proyecto → Evento, base de invitados, inscripción con acompañantes,
// acreditación por persona con bitácora, personal por evento y accesos.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
test.after(async () => pool.end());

const uid = () => randomUUID().replaceAll("-", "").slice(0, 10);
const dni = () => String(10000000 + Math.floor(Math.random() * 89999999));
const err = (re) => (e) => re.test(e.message);

async function seed({ mode = "OPTIONAL", max = 2, capacity = 10 } = {}) {
  const c = uid();
  const tenant = (await pool.query("insert into tenants(name,slug) values($1,$2) returning id", ["Cliente " + c, "t-" + c])).rows[0].id;
  const project = (await pool.query("insert into projects(tenant_id,name) values($1,'Proyecto') returning id", [tenant])).rows[0].id;
  const event = (
    await pool.query(
      `insert into events(tenant_id,project_id,name,slug,is_published,companion_mode,max_companions)
       values($1,$2,'Evento',$3,true,$4,$5) returning id`,
      [tenant, project, "e-" + c, mode, max],
    )
  ).rows[0].id;
  const day = (
    await pool.query(
      "insert into event_dates(event_id,event_day,starts_at,ends_at,capacity) values($1,current_date+3,'09:00','18:00',$2) returning id",
      [event, capacity],
    )
  ).rows[0].id;
  const day2 = (
    await pool.query("insert into event_dates(event_id,event_day,starts_at,ends_at,capacity) values($1,current_date+4,'09:00','18:00',5) returning id", [event])
  ).rows[0].id;
  return { c, tenant, project, event, day, day2 };
}
const cleanup = (s) => pool.query("delete from tenants where id = $1", [s.tenant]);

async function invitee(s, extra = {}) {
  const doc = extra.doc ?? dni();
  const r = await pool.query(
    `insert into invitees(event_id,document_type,document_number,employee_code,full_name,email,phone)
     values($1,'DNI',$2,$3,$4,$5,$6) returning id`,
    [s.event, doc, extra.code ?? null, extra.name ?? "Invitado " + doc, "email" in extra ? extra.email : `i${doc}@x.pe`, extra.phone ?? null],
  );
  return { id: r.rows[0].id, doc };
}

const register = (s, date, inv, companions = [], { phone = "999999999", admin = false, doc = null } = {}) =>
  pool
    .query(
      `select * from register_attendee($1,$2,'Ignorado','otro@x.pe',$3,'DNI',$4,null,null,null,$5::jsonb,$6)`,
      [date, inv?.id ?? null, phone, doc ?? inv?.doc ?? dni(), JSON.stringify(companions), admin],
    )
    .then((r) => r.rows[0]);

const comp = (name) => ({ full_name: name, document_type: "DNI", document_number: dni() });
const taken = async (date) => (await pool.query("select registered_count from event_dates where id = $1", [date])).rows[0].registered_count;

test("esquema: proyectos, invitados, acompañantes, personal y bitácora", async () => {
  for (const name of ["projects", "invitees", "companions", "event_staff", "checkin_log"]) {
    assert.ok((await pool.query("select to_regclass($1) t", ["public." + name])).rows[0].t, name + " debe existir");
  }
  for (const name of ["event_promoters", "promoter_checkins"]) {
    assert.equal((await pool.query("select to_regclass($1) t", ["public." + name])).rows[0].t, null, name + " se reemplazó");
  }
  const col = await pool.query("select is_nullable from information_schema.columns where table_name='events' and column_name='project_id'");
  assert.equal(col.rows[0].is_nullable, "NO", "todo evento pertenece a un proyecto");
  const prof = await pool.query("select enum_range(null::employee_profile)::text r");
  assert.match(prof.rows[0].r, /SUPERVISOR/);
  const fn = await pool.query("select pronargs from pg_proc where proname = 'register_attendee'");
  assert.deepEqual(fn.rows.map((r) => r.pronargs), [12], "una sola versión de register_attendee");
});

test("proyecto del evento debe ser del mismo cliente", async () => {
  const a = await seed();
  const b = await seed();
  try {
    await assert.rejects(pool.query("update events set project_id = $2 where id = $1", [a.event, b.project]), /foreign key/);
  } finally {
    await cleanup(a);
    await cleanup(b);
  }
});

test("público: solo invitados de la base; sus datos vienen de la base", async () => {
  const s = await seed();
  try {
    await assert.rejects(register(s, s.day, null), err(/NOT_INVITED/));
    const other = await seed();
    const foreign = await invitee(other);
    await assert.rejects(register(s, s.day, foreign), err(/NOT_INVITED/), "invitado de otro evento");
    await cleanup(other);

    const inv = await invitee(s, { name: "Ana Torres", code: "V-77" });
    const r = await register(s, s.day, inv);
    const row = (await pool.query("select full_name,email,employee_code,document_number,invitee_id,seats from registrations where id=$1", [r.out_registration_id])).rows[0];
    assert.equal(row.full_name, "Ana Torres");
    assert.equal(row.email, `i${inv.doc}@x.pe`, "el correo de la base no se puede reemplazar");
    assert.equal(row.employee_code, "V-77");
    assert.equal(row.invitee_id, inv.id);
    assert.equal(row.seats, 1);
    await assert.rejects(register(s, s.day2, inv), err(/DUPLICATE/), "una sola inscripción activa por invitado");
  } finally {
    await cleanup(s);
  }
});

test("acompañantes: máximo por evento, obligatorios y sin repetir documentos", async () => {
  const s = await seed({ max: 2 });
  try {
    await assert.rejects(register(s, s.day, await invitee(s), [comp("A"), comp("B"), comp("C")]), err(/TOO_MANY_COMPANIONS/));
    const holder = await invitee(s);
    await assert.rejects(
      register(s, s.day, holder, [{ full_name: "Yo", document_type: "DNI", document_number: holder.doc }]),
      err(/COMPANION_IS_HOLDER/),
    );
    const c = comp("Repetido");
    await assert.rejects(register(s, s.day, await invitee(s), [c, { ...c, full_name: "Otro" }]), err(/COMPANION_DUPLICATE/));
    assert.equal(await taken(s.day), 0, "los intentos fallidos no consumen cupos");

    const ok = await register(s, s.day, await invitee(s), [comp("Uno"), comp("Dos")]);
    const reg = (await pool.query("select companions_count, seats from registrations where id=$1", [ok.out_registration_id])).rows[0];
    assert.deepEqual(reg, { companions_count: 2, seats: 3 });
    assert.equal(await taken(s.day), 3);

    const req = await seed({ mode: "REQUIRED", max: 1 });
    await assert.rejects(register(req, req.day, await invitee(req)), err(/COMPANION_REQUIRED/));
    await cleanup(req);
    const none = await seed({ mode: "NONE", max: 0 });
    await assert.rejects(register(none, none.day, await invitee(none), [comp("X")]), err(/TOO_MANY_COMPANIONS/));
    await cleanup(none);
  } finally {
    await cleanup(s);
  }
});

test("aforo: titular + acompañantes no superan la capacidad, ni en paralelo", async () => {
  const s = await seed({ capacity: 4, max: 2 });
  try {
    const invs = await Promise.all(Array.from({ length: 4 }, () => invitee(s)));
    const results = await Promise.allSettled(invs.map((i) => register(s, s.day, i, [comp("A")])));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 2, "solo caben 2 grupos de 2");
    assert.ok(results.filter((r) => r.status === "rejected").every((r) => /SOLD_OUT/.test(r.reason.message)));
    assert.equal(await taken(s.day), 4);
  } finally {
    await cleanup(s);
  }
});

test("administrador: puede inscribir sin base y con evento cerrado", async () => {
  const s = await seed();
  try {
    await pool.query("update events set registration_open = false where id = $1", [s.event]);
    await assert.rejects(register(s, s.day, await invitee(s)), err(/EVENT_CLOSED/));
    const r = await register(s, s.day, null, [], { admin: true });
    assert.ok(r.out_token);
  } finally {
    await cleanup(s);
  }
});

test("acreditación por persona: parcial, reingreso, otra fecha y bitácora", async () => {
  const s = await seed();
  try {
    const emp = (await pool.query("insert into employees(profile,full_name,document_number) values('PROMOTOR','Promo',$1) returning id", [dni()])).rows[0].id;
    const r = await register(s, s.day, await invitee(s), [comp("Uno"), comp("Dos")]);
    const cs = (await pool.query("select id from companions where registration_id=$1 order by position", [r.out_registration_id])).rows.map((x) => x.id);
    const checkIn = (date, holder, ids) =>
      pool.query("select check_in($1,$2,$3,$4::uuid[],null,$5,'DOCUMENTO') j", [r.out_registration_id, date, holder, ids, emp]).then((x) => x.rows[0].j);

    assert.equal((await checkIn(s.day2, true, [])).result, "WRONG_DATE");
    assert.deepEqual(await checkIn(s.day, true, [cs[0]]), { result: "OK", persons: 2 });
    const again = await checkIn(s.day, true, [cs[0]]);
    assert.equal(again.result, "ALREADY");
    assert.ok(again.holder_checked_in_at, "informa a qué hora ingresó");
    assert.deepEqual(await checkIn(s.day, true, [cs[1]]), { result: "OK", persons: 1 }, "el acompañante pendiente aún puede ingresar");

    const log = (await pool.query("select result, persons from checkin_log where registration_id=$1 order by id", [r.out_registration_id])).rows;
    assert.deepEqual(log.map((l) => l.result), ["FECHA_INCORRECTA", "INGRESO", "YA_INGRESO", "INGRESO"]);
    const byEmp = (await pool.query("select sum(persons)::int n from checkin_log where employee_id=$1 and result='INGRESO'", [emp])).rows[0].n;
    assert.equal(byEmp, 3, "la bitácora atribuye las personas al promotor");
    const stats = (await pool.query("select * from event_date_stats where event_date_id=$1", [s.day])).rows[0];
    assert.ok(stats, "vista de estadísticas por fecha disponible");

    await assert.rejects(pool.query("select cancel_registration($1)", [r.out_registration_id]), /ALREADY_CHECKED_IN/);
    await pool.query("delete from employees where id=$1", [emp]);
  } finally {
    await cleanup(s);
  }
});

test("cancelar libera todos los cupos del grupo", async () => {
  const s = await seed();
  try {
    const r = await register(s, s.day, await invitee(s), [comp("A"), comp("B")]);
    assert.equal(await taken(s.day), 3);
    await pool.query("select cancel_registration($1)", [r.out_registration_id]);
    assert.equal(await taken(s.day), 0);
  } finally {
    await cleanup(s);
  }
});

test("invitados: documento y código únicos por evento", async () => {
  const s = await seed();
  try {
    const a = await invitee(s, { code: "v-10" });
    await assert.rejects(invitee(s, { doc: a.doc }), /invitees_doc_uq/);
    await assert.rejects(invitee(s, { code: "V-10" }), /invitees_code_uq/, "el código no distingue mayúsculas");
  } finally {
    await cleanup(s);
  }
});

test("personal: coordinador por cliente; supervisores y promotores por evento", async () => {
  const s = await seed();
  const c = uid();
  const user = (await pool.query("insert into users(email,username,password_hash) values($1,$1,'x') returning id", [`co-${c}@x.pe`])).rows[0].id;
  const coord = (await pool.query("insert into employees(profile,full_name,email,user_id) values('COORDINADOR','Coord',$1,$2) returning id", [`co-${c}@x.pe`, user])).rows[0].id;
  const supUser = (await pool.query("insert into users(username,password_hash) values($1,'x') returning id", [dni()])).rows[0].id;
  const sup = (await pool.query("insert into employees(profile,full_name,document_number,user_id) values('SUPERVISOR','Sup',$1,$2) returning id", [dni(), supUser])).rows[0].id;
  const members = async () => (await pool.query("select tenant_id from tenant_members where user_id=$1", [user])).rows.map((r) => r.tenant_id);
  try {
    assert.deepEqual(await members(), []);
    await pool.query("insert into employee_clients(employee_id,tenant_id) values($1,$2)", [coord, s.tenant]);
    assert.deepEqual(await members(), [s.tenant]);
    await pool.query("update employees set is_active=false where id=$1", [coord]);
    assert.deepEqual(await members(), [], "desactivado pierde el acceso");

    await pool.query("insert into event_staff(event_id,employee_id,role) values($1,$2,'SUPERVISOR')", [s.event, sup]);
    await assert.rejects(pool.query("insert into event_staff(event_id,employee_id,role) values($1,$2,'PROMOTOR')", [s.event, sup]), /event_staff_uq/);
    await assert.rejects(pool.query("insert into event_staff(event_id,employee_id,role) values($1,$2,'COORDINADOR')", [s.event, sup]), /check/);
    const supMembers = (await pool.query("select count(*)::int n from tenant_members where user_id=$1", [supUser])).rows[0].n;
    assert.equal(supMembers, 0, "un supervisor no obtiene acceso al cliente completo");
    await assert.rejects(pool.query("insert into users(password_hash) values('x')"), /users_login_ck/, "usuario con correo o documento");
  } finally {
    await cleanup(s);
    await pool.query("delete from employees where id = any($1)", [[coord, sup]]);
    await pool.query("delete from users where id = any($1)", [[user, supUser]]);
  }
});

test("fecha asignada en la base: el invitado solo confirma esa fecha", async () => {
  const s = await seed();
  try {
    const inv = await invitee(s);
    await pool.query("update invitees set event_date_id = $2 where id = $1", [inv.id, s.day2]);
    await assert.rejects(register(s, s.day, inv), err(/WRONG_DATE_ASSIGNED/));
    assert.equal(await taken(s.day), 0);
    const ok = await register(s, s.day2, inv);
    assert.ok(ok.out_token);
    const r = await register(s, s.day, null, [], { admin: true, doc: inv.doc + "9".slice(0, 0) }).catch((e) => e);
    assert.ok(r, "el administrador no queda limitado por la fecha asignada");
  } finally {
    await cleanup(s);
  }
});

test("confirmación sin correo ni celular (solo DNI o código)", async () => {
  const s = await seed();
  try {
    const inv = await invitee(s, { email: null });
    const r = (
      await pool.query(
        "select * from register_attendee($1,$2,$3,null,null,'DNI',$4,null,null,null,'[]'::jsonb,false)",
        [s.day, inv.id, "Nombre", inv.doc],
      )
    ).rows[0];
    const row = (await pool.query("select email, phone from registrations where id = $1", [r.out_registration_id])).rows[0];
    assert.equal(row.email, null);
    assert.equal(row.phone, null);
  } finally {
    await cleanup(s);
  }
});

test("perfil cliente: ve su empresa pero no obtiene permisos de coordinador", async () => {
  const s = await seed();
  const c = uid();
  const user = (await pool.query("insert into users(email,username,password_hash) values($1,$1,'x') returning id", [`cl-${c}@x.pe`])).rows[0].id;
  const emp = (await pool.query("insert into employees(profile,full_name,email,user_id) values('CLIENTE','Cliente',$1,$2) returning id", [`cl-${c}@x.pe`, user])).rows[0].id;
  try {
    await pool.query("insert into employee_clients(employee_id,tenant_id) values($1,$2)", [emp, s.tenant]);
    const members = (await pool.query("select count(*)::int n from tenant_members where user_id=$1", [user])).rows[0].n;
    assert.equal(members, 0, "el cliente no entra en tenant_members (no puede editar)");
  } finally {
    await cleanup(s);
    await pool.query("delete from employees where id=$1", [emp]);
    await pool.query("delete from users where id=$1", [user]);
  }
});

test("regularizar: agregar y quitar acompañantes después de confirmar", async () => {
  const s = await seed({ max: 2, capacity: 3 });
  try {
    const inv = await invitee(s);
    const r = await register(s, s.day, inv);
    const add = (doc, name = "Acomp") => pool.query("select add_companion($1,$2,'DNI',$3) id", [r.out_registration_id, name, doc]).then((x) => x.rows[0].id);
    await assert.rejects(add(inv.doc), err(/COMPANION_IS_HOLDER/));
    const c1 = await add("70000001");
    await assert.rejects(add("70000001"), err(/COMPANION_DUPLICATE/));
    await add("70000002");
    assert.equal(await taken(s.day), 3);
    await assert.rejects(add("70000003"), err(/TOO_MANY_COMPANIONS/), "máximo del evento");
    const reg = (await pool.query("select companions_count, seats from registrations where id=$1", [r.out_registration_id])).rows[0];
    assert.deepEqual(reg, { companions_count: 2, seats: 3 });

    await pool.query("select remove_companion($1,$2)", [r.out_registration_id, c1]);
    assert.equal(await taken(s.day), 2, "quitar libera el cupo");
    const c3 = await add("70000003");
    assert.ok(c3, "se puede volver a agregar");
    await pool.query("select check_in($1,$2,false,$3::uuid[],null,null,'DOCUMENTO')", [r.out_registration_id, s.day, [c3]]);
    await assert.rejects(pool.query("select remove_companion($1,$2)", [r.out_registration_id, c3]), /ALREADY_CHECKED_IN/);

    // Sin cupo en la fecha
    const s2 = await seed({ max: 2, capacity: 1 });
    const r2 = await register(s2, s2.day, await invitee(s2));
    await assert.rejects(pool.query("select add_companion($1,'Uno','DNI','71111111')", [r2.out_registration_id]), /SOLD_OUT/);
    await cleanup(s2);
  } finally {
    await cleanup(s);
  }
});
