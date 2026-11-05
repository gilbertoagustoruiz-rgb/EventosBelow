import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import type { EventRow, MemberRole } from "@/lib/types";

export interface Membership {
  tenant_id: string;
  role: MemberRole;
  tenant_name: string;
}

export interface Viewer {
  userId: string;
  email: string;
  fullName: string | null;
  isPlatformAdmin: boolean;
  mustChangePassword: boolean;
  memberships: Membership[];
}

/** Usuario actual + sus roles. Cacheado por request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;

  const user = await queryOne<{
    id: string;
    email: string;
    full_name: string | null;
    is_platform_admin: boolean;
    must_change_password: boolean;
    password_changed_at: string;
  }>(
    `select id, email, full_name, is_platform_admin, must_change_password, password_changed_at
       from users where id = $1 and is_active`,
    [session.userId],
  );
  if (!user) return null;
  // Un cambio de contraseña invalida las sesiones emitidas antes
  if (session.issuedAt * 1000 < new Date(user.password_changed_at).getTime() - 1000) return null;

  const memberships = await query<Membership>(
    `select m.tenant_id, m.role, t.name as tenant_name
       from tenant_members m join tenants t on t.id = m.tenant_id
      where m.user_id = $1 and t.is_active
      order by t.name`,
    [user.id],
  );

  return {
    userId: user.id,
    email: user.email,
    fullName: user.full_name,
    isPlatformAdmin: user.is_platform_admin,
    mustChangePassword: user.must_change_password,
    memberships,
  };
});

export async function requireViewer() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.mustChangePassword) redirect("/cuenta?primera=1");
  return viewer;
}

export function canAdminTenant(viewer: Viewer, tenantId: string) {
  return (
    viewer.isPlatformAdmin ||
    viewer.memberships.some((m) => m.tenant_id === tenantId && m.role === "CLIENT_ADMIN")
  );
}

export function canHostTenant(viewer: Viewer, tenantId: string) {
  return viewer.isPlatformAdmin || viewer.memberships.some((m) => m.tenant_id === tenantId);
}

/** Tenants donde el usuario es administrador */
export function adminTenantIds(viewer: Viewer) {
  return viewer.memberships.filter((m) => m.role === "CLIENT_ADMIN").map((m) => m.tenant_id);
}

/**
 * Filtro SQL de tenants visibles. null = sin filtro (SuperAdmin).
 * Uso: where ($1::uuid[] is null or tenant_id = any($1))
 */
export function visibleTenantFilter(viewer: Viewer): string[] | null {
  return viewer.isPlatformAdmin ? null : viewer.memberships.map((m) => m.tenant_id);
}

/** Carga un evento verificando que el usuario tenga el nivel de acceso pedido. */
export async function requireEvent(eventId: string, level: "admin" | "host") {
  const viewer = await requireViewer();
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) notFound();
  const event = await queryOne<EventRow>("select * from events where id = $1", [eventId]);
  if (!event) notFound();

  const allowed = level === "admin" ? canAdminTenant(viewer, event.tenant_id) : canHostTenant(viewer, event.tenant_id);
  if (!allowed) notFound();

  return { viewer, event };
}

const CHECKIN_KEY = /^[a-f0-9]{32}$/;

/**
 * Acceso al check-in: con el enlace secreto del evento (sin sesión) o con sesión de anfitrión.
 * userId es null cuando se entra por enlace.
 */
export async function authorizeCheckin(eventId: string, key?: string | null) {
  if (key) {
    if (!CHECKIN_KEY.test(key) || !/^[0-9a-f-]{36}$/i.test(eventId)) notFound();
    const event = await queryOne<EventRow>("select * from events where id = $1 and checkin_key = $2", [eventId, key]);
    if (!event) notFound();
    return { event, userId: null as string | null };
  }
  const { viewer, event } = await requireEvent(eventId, "host");
  return { event, userId: viewer.userId as string | null };
}

/** Evento por su enlace de acreditación (o null). */
export async function eventByCheckinKey(key: string) {
  if (!CHECKIN_KEY.test(key)) return null;
  return queryOne<EventRow>("select * from events where checkin_key = $1", [key]);
}
