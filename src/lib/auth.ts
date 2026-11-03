import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EventRow, MemberRole } from "@/lib/types";

export interface Membership {
  tenant_id: string;
  role: MemberRole;
  tenant_name: string;
}

export interface Viewer {
  userId: string;
  email: string;
  isPlatformAdmin: boolean;
  memberships: Membership[];
}

/** Usuario actual + sus roles. Cacheado por request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: admin }, { data: members }] = await Promise.all([
    supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
    supabase.from("tenant_members").select("tenant_id, role, tenants(name)").eq("user_id", user.id),
  ]);

  return {
    userId: user.id,
    email: user.email ?? "",
    isPlatformAdmin: Boolean(admin),
    memberships: (members ?? []).map((m) => ({
      tenant_id: m.tenant_id as string,
      role: m.role as MemberRole,
      tenant_name: (m.tenants as unknown as { name: string } | null)?.name ?? "",
    })),
  };
});

export async function requireViewer() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
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

/** Tenants donde el usuario puede crear eventos */
export function adminTenantIds(viewer: Viewer) {
  return viewer.memberships.filter((m) => m.role === "CLIENT_ADMIN").map((m) => m.tenant_id);
}

/**
 * Carga un evento verificando permisos. RLS ya filtra lo que no le pertenece;
 * aquí además distinguimos admin vs anfitrión.
 */
export async function requireEvent(eventId: string, level: "admin" | "host") {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("*").eq("id", eventId).maybeSingle<EventRow>();
  if (!event) notFound();

  const allowed = level === "admin" ? canAdminTenant(viewer, event.tenant_id) : canHostTenant(viewer, event.tenant_id);
  if (!allowed) notFound();

  return { viewer, supabase, event };
}
