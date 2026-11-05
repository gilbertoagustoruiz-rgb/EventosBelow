import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import type { Profile } from "@/lib/profiles";
import type { EventRow, MemberRole, StaffRole } from "@/lib/types";

export interface Membership {
  tenant_id: string;
  role: MemberRole;
  tenant_name: string;
}

export interface StaffAssignment {
  event_id: string;
  role: StaffRole;
}

export interface Viewer {
  userId: string;
  email: string | null;
  username: string | null;
  fullName: string | null;
  isPlatformAdmin: boolean;
  mustChangePassword: boolean;
  /** Empleado vinculado al usuario (null para usuarios antiguos sin ficha) */
  employeeId: string | null;
  profile: Profile | null;
  /** Clientes donde es coordinador */
  memberships: Membership[];
  /** Eventos donde es personal de apoyo (supervisor o promotor) */
  staff: StaffAssignment[];
}

/** Usuario actual + perfil, clientes y eventos asignados. Cacheado por request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;

  const user = await queryOne<{
    id: string;
    email: string | null;
    username: string | null;
    full_name: string | null;
    is_platform_admin: boolean;
    must_change_password: boolean;
    password_changed_at: string;
    employee_id: string | null;
    profile: Profile | null;
    employee_active: boolean | null;
  }>(
    `select u.id, u.email, u.username, u.full_name, u.is_platform_admin, u.must_change_password, u.password_changed_at,
            e.id as employee_id, e.profile, e.is_active as employee_active
       from users u left join employees e on e.user_id = u.id
      where u.id = $1 and u.is_active`,
    [session.userId],
  );
  if (!user) return null;
  // Un cambio de contraseña invalida las sesiones emitidas antes
  if (session.issuedAt * 1000 < new Date(user.password_changed_at).getTime() - 1000) return null;
  // Un empleado desactivado pierde el acceso al instante
  if (user.employee_id && !user.employee_active) return null;

  const [memberships, staff] = await Promise.all([
    query<Membership>(
      `select m.tenant_id, m.role, t.name as tenant_name
         from tenant_members m join tenants t on t.id = m.tenant_id
        where m.user_id = $1 and t.is_active
        order by t.name`,
      [user.id],
    ),
    user.employee_id
      ? query<StaffAssignment>(
          "select event_id, role from event_staff where employee_id = $1 and is_active",
          [user.employee_id],
        )
      : Promise.resolve([] as StaffAssignment[]),
  ]);

  const profile: Profile | null = user.is_platform_admin ? "ADMINISTRADOR" : user.profile;
  // Sin perfil de personal (usuario sin ficha) solo entra si es coordinador de algún cliente
  if (!user.is_platform_admin && !profile && memberships.length === 0) return null;
  // Un coordinador sin clientes asignados no tiene acceso
  if (profile === "COORDINADOR" && memberships.length === 0) return null;

  return {
    userId: user.id,
    email: user.email,
    username: user.username,
    fullName: user.full_name,
    isPlatformAdmin: user.is_platform_admin,
    mustChangePassword: user.must_change_password,
    employeeId: user.employee_id,
    profile: profile ?? (memberships.length ? "COORDINADOR" : null),
    memberships,
    staff,
  };
});

export async function requireViewer() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.mustChangePassword) redirect("/cuenta?primera=1");
  return viewer;
}

/** Solo el administrador general (Below Trade): clientes, proyectos, empleados, asignaciones y perfiles. */
export async function requireAdmin() {
  const viewer = await requireViewer();
  if (!viewer.isPlatformAdmin) notFound();
  return viewer;
}

export function canAdminTenant(viewer: Viewer, tenantId: string) {
  return viewer.isPlatformAdmin || viewer.memberships.some((m) => m.tenant_id === tenantId && m.role === "CLIENT_ADMIN");
}

/** Tenants donde el usuario es coordinador */
export function adminTenantIds(viewer: Viewer) {
  return viewer.memberships.filter((m) => m.role === "CLIENT_ADMIN").map((m) => m.tenant_id);
}

/**
 * Filtro SQL de tenants visibles. null = sin filtro (administrador).
 * Uso: where ($1::uuid[] is null or tenant_id = any($1))
 */
export function visibleTenantFilter(viewer: Viewer): string[] | null {
  return viewer.isPlatformAdmin ? null : viewer.memberships.map((m) => m.tenant_id);
}

/** Qué puede hacer el usuario en un evento. */
export type EventAccess = "manage" | "supervise" | "checkin";

export function eventAccess(viewer: Viewer, event: Pick<EventRow, "id" | "tenant_id">): EventAccess | null {
  if (canAdminTenant(viewer, event.tenant_id)) return "manage";
  const staff = viewer.staff.find((s) => s.event_id === event.id);
  if (staff?.role === "SUPERVISOR") return "supervise";
  if (staff?.role === "PROMOTOR") return "checkin";
  return null;
}

const LEVEL_RANK: Record<EventAccess, number> = { checkin: 1, supervise: 2, manage: 3 };
const REQUIRED: Record<"admin" | "supervise" | "host", EventAccess> = {
  admin: "manage", // administrador o coordinador del cliente
  supervise: "supervise", // + supervisor del evento
  host: "checkin", // + promotor del evento
};

/** Carga un evento verificando que el usuario tenga el nivel de acceso pedido. */
export async function requireEvent(eventId: string, level: "admin" | "supervise" | "host") {
  const viewer = await requireViewer();
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) notFound();
  const event = await queryOne<EventRow>("select * from events where id = $1", [eventId]);
  if (!event) notFound();

  const access = eventAccess(viewer, event);
  if (!access || LEVEL_RANK[access] < LEVEL_RANK[REQUIRED[level]]) notFound();

  return { viewer, event, access };
}

const CHECKIN_KEY = /^[a-f0-9]{32}$/;

/**
 * Acceso al check-in: con el enlace general del evento (sin sesión) o con sesión de
 * administrador, coordinador, supervisor o promotor del evento.
 * Devuelve null si el enlace no existe o fue regenerado, para que la consola lo informe.
 */
export async function checkinAccess(eventId: string, key?: string | null) {
  if (key) {
    if (!CHECKIN_KEY.test(key) || !/^[0-9a-f-]{36}$/i.test(eventId)) return null;
    const event = await queryOne<EventRow>("select * from events where id = $1 and checkin_key = $2", [eventId, key]);
    return event ? { event, userId: null as string | null, employeeId: null as string | null } : null;
  }
  const viewer = await getViewer();
  if (!viewer || viewer.mustChangePassword || !/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  const event = await queryOne<EventRow>("select * from events where id = $1", [eventId]);
  if (!event || !eventAccess(viewer, event)) return null;
  return { event, userId: viewer.userId as string | null, employeeId: viewer.employeeId };
}

/** Evento por su enlace general de acreditación (o null). */
export async function eventByCheckinKey(key: string) {
  if (!CHECKIN_KEY.test(key)) return null;
  return queryOne<EventRow>("select * from events where checkin_key = $1", [key]);
}

/** Inicio según perfil: el promotor va directo a acreditar. */
export function homeFor(viewer: Pick<Viewer, "profile">) {
  return viewer.profile === "PROMOTOR" ? "/checkin" : "/admin";
}
