"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { query, queryOne, transaction } from "@/lib/db";
import type { FormState } from "@/app/admin/actions";

const UUID = /^[0-9a-f-]{36}$/i;

function refresh() {
  revalidatePath("/admin/asignaciones");
  revalidatePath("/admin/empleados");
  revalidatePath("/admin/clientes");
}

/** Asigna un coordinador o promotor activo a un cliente. */
export async function assignEmployee(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const tenantId = String(fd.get("tenantId") ?? "");
  const employeeIds = fd.getAll("employeeId").map(String).filter((id) => UUID.test(id));
  if (!UUID.test(tenantId) || employeeIds.length === 0) return { message: "Selecciona al menos un empleado." };

  const valid = await query<{ id: string }>(
    `select id from employees where id = any($1) and is_active and profile in ('COORDINADOR', 'PROMOTOR')`,
    [employeeIds],
  );
  if (valid.length === 0) return { message: "Solo se asignan coordinadores y promotores activos." };

  await query(
    `insert into employee_clients (employee_id, tenant_id)
     select unnest($1::uuid[]), $2 on conflict do nothing`,
    [valid.map((v) => v.id), tenantId],
  );
  refresh();
  return { ok: true, message: valid.length === 1 ? "Empleado asignado." : `${valid.length} empleados asignados.` };
}

/**
 * Quita la asignación. Un coordinador pierde el acceso a ese cliente;
 * un promotor deja de estar disponible y sus enlaces en eventos de ese cliente se desactivan
 * (la auditoría de lo que ya acreditó se conserva).
 */
export async function unassignEmployee(fd: FormData) {
  await requireAdmin();
  const tenantId = String(fd.get("tenantId") ?? "");
  const employeeId = String(fd.get("employeeId") ?? "");
  if (!UUID.test(tenantId) || !UUID.test(employeeId)) return;

  const emp = await queryOne<{ profile: string }>("select profile from employees where id = $1", [employeeId]);
  if (!emp) return;

  await transaction(async (client) => {
    await client.query("delete from employee_clients where employee_id = $1 and tenant_id = $2", [employeeId, tenantId]);
    if (emp.profile === "PROMOTOR") {
      await client.query(
        `update event_promoters ep set is_active = false
           from events e
          where e.id = ep.event_id and e.tenant_id = $2 and ep.employee_id = $1`,
        [employeeId, tenantId],
      );
    }
  });
  refresh();
}
