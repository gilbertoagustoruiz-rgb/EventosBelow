"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import { getViewer } from "@/lib/auth";

export interface LoginState {
  error?: string;
}

// Límite simple de intentos fallidos (por proceso): 8 cada 15 min por correo+IP
const attempts = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;

// Hash de relleno para que un correo inexistente tarde lo mismo que uno real
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86);

function safeNext(next: unknown) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/admin";
}

export async function login(_: LoginState, fd: FormData): Promise<LoginState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${email}|${ip}`;
  const now = Date.now();

  const a = attempts.get(key);
  if (a && a.until > now && a.count >= MAX_FAILS) {
    return { error: "Demasiados intentos. Espera unos minutos e inténtalo otra vez." };
  }

  const user = await queryOne<{ id: string; password_hash: string; must_change_password: boolean }>(
    "select id, password_hash, must_change_password from users where email = $1 and is_active",
    [email],
  );
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);

  if (!user || !ok) {
    const prev = a && a.until > now ? a.count : 0;
    attempts.set(key, { count: prev + 1, until: now + WINDOW_MS });
    return { error: "Correo o contraseña incorrectos." };
  }

  attempts.delete(key);
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

  redirect(viewer.isPlatformAdmin || viewer.memberships.some((m) => m.role === "CLIENT_ADMIN") ? "/admin" : "/checkin");
}
