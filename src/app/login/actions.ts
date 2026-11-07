"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import { getViewer } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";
import { homeFor } from "@/lib/auth";
import { createRateLimiter } from "@/lib/rate-limit";

export interface LoginState {
  error?: string;
}

// Cuenta antes del trabajo asíncrono para limitar también los intentos simultáneos.
const attempts = createRateLimiter(8, 15 * 60 * 1000);

// Hash de relleno para que un correo inexistente tarde lo mismo que uno real
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86);

export async function login(_: LoginState, fd: FormData): Promise<LoginState> {
  // Usuario: correo o número de documento
  const raw = String(fd.get("email") ?? "").trim().toLowerCase();
  const email = raw.includes("@") ? raw : raw.replace(/[\s.-]/g, "");
  const password = String(fd.get("password") ?? "");
  if (!email || email.length > 254 || !password || password.length > 1024) {
    return { error: "Usuario o contraseña incorrectos." };
  }
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${email}|${ip}`;
  if (!attempts.consume(key)) {
    return { error: "Demasiados intentos. Espera unos minutos e inténtalo otra vez." };
  }

  const user = await queryOne<{ id: string; password_hash: string; must_change_password: boolean; is_platform_admin: boolean }>(
    "select id, password_hash, must_change_password, is_platform_admin from users where (email = $1 or username = $1) and is_active limit 1",
    [email],
  );
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);

  // Administrador, coordinador con clientes, supervisor/promotor activo o usuario cliente con empresa asignada
  const authorized = user && (user.is_platform_admin || !!(await queryOne(
    `select 1 from tenant_members where user_id = $1
     union all
     select 1 from employees where user_id = $1 and is_active and profile in ('SUPERVISOR', 'PROMOTOR')
     union all
     select 1 from employees e join employee_clients ec on ec.employee_id = e.id
      where e.user_id = $1 and e.is_active and e.profile = 'CLIENTE'
     limit 1`,
    [user.id],
  )));
  if (!user || !ok || !authorized) {
    return { error: "Usuario o contraseña incorrectos." };
  }

  attempts.reset(key);
  await query("update users set last_login_at = now() where id = $1", [user.id]);
  (await cookies()).set(SESSION_COOKIE, await signSession(user.id), sessionCookieOptions);

  redirect(user.must_change_password ? "/cuenta?primera=1" : safeNext(fd.get("next")));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export interface PasswordState {
  ok?: boolean;
  error?: string;
}

export async function changePassword(_: PasswordState, fd: FormData): Promise<PasswordState> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  const confirm = String(fd.get("confirm") ?? "");

  if (next.length < 10) return { error: "La nueva contraseña debe tener al menos 10 caracteres." };
  if (next !== confirm) return { error: "Las contraseñas no coinciden." };
  if (next === current) return { error: "La nueva contraseña debe ser distinta de la actual." };

  const row = await queryOne<{ password_hash: string }>("select password_hash from users where id = $1", [viewer.userId]);
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    return { error: "La contraseña actual no es correcta." };
  }

  await query(
    `update users set password_hash = $2, must_change_password = false, password_changed_at = now() where id = $1`,
    [viewer.userId, await hashPassword(next)],
  );
  // Las sesiones anteriores quedan invalidadas: emitimos una nueva para este dispositivo
  (await cookies()).set(SESSION_COOKIE, await signSession(viewer.userId), sessionCookieOptions);

  redirect(homeFor(viewer));
}
