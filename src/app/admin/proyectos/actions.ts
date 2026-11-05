"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { pgCode, query } from "@/lib/db";
import { flattenErrors } from "@/lib/validation";
import type { FormState } from "@/app/admin/actions";

const projectSchema = z.object({
  tenantId: z.string().uuid({ message: "Selecciona un cliente" }),
  name: z.string().trim().min(2, "Ingresa el nombre del proyecto").max(120),
  description: z.string().trim().max(500).optional().transform((v) => v || null),
});

export async function createProject(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = projectSchema.safeParse({
    tenantId: fd.get("tenantId"),
    name: fd.get("name"),
    description: fd.get("description") ?? "",
  });
  if (!parsed.success) return { fieldErrors: flattenErrors(parsed.error) };
  const d = parsed.data;
  try {
    await query("insert into projects (tenant_id, name, description) values ($1, $2, $3)", [d.tenantId, d.name, d.description]);
  } catch (e) {
    if (pgCode(e) === "23505") return { fieldErrors: { name: "Ese cliente ya tiene un proyecto con ese nombre" } };
    if (pgCode(e) === "23503") return { fieldErrors: { tenantId: "Cliente no válido" } };
    throw e;
  }
  revalidatePath("/admin/proyectos");
  revalidatePath("/admin/clientes");
  return { ok: true, message: `Proyecto «${d.name}» creado. Ya puedes crear sus eventos.` };
}

export async function toggleProject(fd: FormData) {
  await requireAdmin();
  const id = String(fd.get("projectId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await query("update projects set is_active = not is_active where id = $1", [id]);
  revalidatePath("/admin/proyectos");
}
