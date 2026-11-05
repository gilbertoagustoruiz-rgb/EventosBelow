#!/usr/bin/env node
// Crea (o actualiza) un SuperAdmin de la plataforma.
// Uso:  npm run create-admin -- correo@empresa.com "Contraseña segura" "Nombre Apellido"
// En App Platform: pestaña Console del componente web, y ejecutar el mismo comando.
import { createPool, hashPassword, registerAdminEmployee } from "./db.mjs";

const [emailArg, password, fullName] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();

if (!email || !/^\S+@\S+\.\S+$/.test(email) || !password || password.length < 10) {
  console.error('Uso: npm run create-admin -- correo@empresa.com "contraseña (mín. 10 caracteres)" "Nombre"');
  process.exit(1);
}

const passwordHash = await hashPassword(password);

const pool = createPool();
try {
  const { rows } = await pool.query(
    `insert into users (email, full_name, password_hash, is_platform_admin)
     values ($1, $2, $3, true)
     on conflict (email) do update
       set password_hash = excluded.password_hash,
           is_platform_admin = true,
           full_name = coalesce(excluded.full_name, users.full_name)
     returning id, (xmax = 0) as created`,
    [email, fullName ?? null, passwordHash],
  );
  await registerAdminEmployee(pool, rows[0].id, email, fullName);
  console.log(rows[0].created ? `SuperAdmin creado: ${email}` : `SuperAdmin actualizado: ${email}`);
} finally {
  await pool.end();
}
