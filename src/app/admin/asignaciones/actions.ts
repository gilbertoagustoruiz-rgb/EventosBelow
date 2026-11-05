"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import type { FormState } from "@/app/admin/actions";

const UUID = /^[0-9a-f-]{36}$/i;

function refresh() {
  revalidatePath("/admin/asignaciones");
  revalidatePath("/admin/empleados");
  revalidatePath("/admin/clientes");
}

/** Asigna coordinadores activos a un cliente (supervisores y promotores se agregan por evento). */
export async function assignEmployee(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const tenantId = String(fd.get("tenantId") ?? "");
  const employeeIds = fd.getAll("employeeId").map(String).filter((id) => UUID.test(id));
  if (!UUID.test(tenantId) || employeeIds.length === 0) return { message: "Selecciona al menos un empleado." };

  const valid = await query<{ id: string }>(
    `select id from employees where id = any($1) and is_active and profile = 'COORDINADOR'`,
    [employeeIds],
  );
  if (valid.length === 0) return { message: "Solo se asignan coordinadores activos." };

  await query(
    `insert into employee_clients (employee_id, tenant_id)
     select unnest($1::uuid[]), $2 on conflict do nothing`,
    [valid.map((v) => v.id), tenantId],
  );
  refresh();
  return { ok: true, message: valid.length === 1 ? "Coordinador asignado." : `${valid.length} coordinadores asignados.` };
}

/** Quita la asignación: el coordinador pierde el acceso a los eventos de ese cliente. */
export async function unassignEmployee(fd: FormData) {
  await requireAdmin();
  const tenantId = String(fd.get("tenantId") ?? "");
  const employeeId = String(fd.get("employeeId") ?? "");
  if (!UUID.test(tenantId) || !UUID.test(employeeId)) return;
  await query("delete from employee_clients where employee_id = $1 and tenant_id = $2", [employeeId, tenantId]);
  refresh();
}
