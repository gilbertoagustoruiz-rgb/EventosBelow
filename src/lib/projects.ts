import "server-only";
import { query } from "@/lib/db";
import { visibleTenantFilter, type Viewer } from "@/lib/auth";
import type { ProjectOption } from "@/components/admin/event-form";

/** Proyectos activos de los clientes que el usuario administra (administrador: todos). */
export function projectOptions(viewer: Viewer) {
  return query<ProjectOption>(
    `select p.id, p.name, p.tenant_id, t.name as tenant_name
       from projects p join tenants t on t.id = p.tenant_id
      where p.is_active and t.is_active and ($1::uuid[] is null or p.tenant_id = any($1))
      order by t.name, p.name`,
    [visibleTenantFilter(viewer)],
  );
}
