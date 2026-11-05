"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { pgCode, query, queryOne, transaction } from "@/lib/db";
import { hashPassword, temporaryPassword } from "@/lib/password";
import { flattenErrors, DOCUMENT_TYPES } from "@/lib/validation";
import type { FormState } from "@/app/admin/actions";

const UUID = /^[0-9a-f-]{36}$/i;

const optional = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

const employeeSchema = z
  .object({
    profile: z.enum(["ADMINISTRADOR", "COORDINADOR", "PROMOTOR"], { message: "Elige un perfil" }),
    fullName: z.string().trim().min(3, "Ingresa el nombre completo").max(120),
    documentType: z.enum(DOCUMENT_TYPES),
    documentNumber: optional(20).transform((v) => v?.toUpperCase().replace(/[\s.-]/g, "")),
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Correo no válido")]).optional(),
    phone: optional(30),
  })
  .superRefine((d, ctx) => {
    if (d.profile === "PROMOTOR" && !d.documentNumber) {
      ctx.addIssue({ code: "custom", path: ["documentNumber"], message: "El documento es obligatorio para promotores" });
    }
    if (d.profile !== "PROMOTOR" && !d.email) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "El correo es obligatorio: con él ingresa al panel" });
    }
    if (d.documentType === "DNI" && d.documentNumber && !/^\d{8}$/.test(d.documentNumber)) {
      ctx.addIssue({ code: "custom", path: ["documentNumber"], message: "El DNI debe tener 8 dígitos" });
    }
  });

/** Crea un empleado. Administradores y coordinadores reciben acceso con contraseña temporal. */
export async function createEmployee(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = employeeSchema.safeParse({
    profile: fd.get("profile"),
    fullName: fd.get("fullName"),
    documentType: fd.get("documentType") || "DNI",
    documentNumber: fd.get("documentNumber") ?? "",
    email: fd.get("email") ?? "",
    phone: fd.get("phone") ?? "",
  });
  if (!parsed.success) return { fieldErrors: flattenErrors(parsed.error) };
  const d = parsed.data;
  const tenantIds = fd.getAll("tenantIds").map(String).filter((id) => UUID.test(id));
  const email = d.email || null;

  let tempPassword: string | undefined;
  try {
    await transaction(async (client) => {
      let userId: string | null = null;
      if (d.profile !== "PROMOTOR") {
        const existing = (
          await client.query<{ id: string; is_platform_admin: boolean; linked: boolean }>(
            `select u.id, u.is_platform_admin, exists (select 1 from employees e where e.user_id = u.id) as linked
               from users u where u.email = $1`,
            [email],
          )
        ).rows[0];
        if (existing?.linked) throw new FieldError("email", "Ese correo ya pertenece a otro empleado");
        if (existing) {
          userId = existing.id;
          await client.query("update users set is_platform_admin = $2, is_active = true, full_name = $3 where id = $1", [
            userId,
            d.profile === "ADMINISTRADOR",
            d.fullName,
          ]);
        } else {
          tempPassword = temporaryPassword();
          userId = (
            await client.query<{ id: string }>(
              `insert into users (email, full_name, password_hash, is_platform_admin, must_change_password)
               values ($1, $2, $3, $4, true) returning id`,
              [email, d.fullName, await hashPassword(tempPassword), d.profile === "ADMINISTRADOR"],
            )
          ).rows[0].id;
        }
      }

      const employee = (
        await client.query<{ id: string }>(
          `insert into employees (profile, full_name, document_type, document_number, email, phone, user_id)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [d.profile, d.fullName, d.documentType, d.documentNumber ?? null, email, d.phone ?? null, userId],
        )
      ).rows[0];

      if (d.profile !== "ADMINISTRADOR") {
        for (const tenantId of tenantIds) {
          await client.query("insert into employee_clients (employee_id, tenant_id) values ($1, $2) on conflict do nothing", [
            employee.id,
            tenantId,
          ]);
        }
      }
    });
  } catch (err) {
    if (err instanceof FieldError) return { fieldErrors: { [err.field]: err.message } };
    if (pgCode(err) === "23505") {
      return { message: "Ya existe un empleado con ese documento o correo." };
    }
    console.error("[createEmployee]", err);
    return { message: "No se pudo crear el empleado." };
  }

  revalidatePath("/admin/empleados");
  revalidatePath("/admin/asignaciones");
  return {
    ok: true,
    message: tempPassword ? `Empleado creado. Acceso para ${email}` : `Empleado creado: ${d.fullName}`,
    tempPassword,
  };
}

class FieldError extends Error {
  constructor(public field: string, message: string) {
    super(message);
  }
}

const editSchema = z.object({
  id: z.string().regex(UUID),
  fullName: z.string().trim().min(3, "Ingresa el nombre completo").max(120),
  documentType: z.enum(DOCUMENT_TYPES),
  documentNumber: optional(20).transform((v) => v?.toUpperCase().replace(/[\s.-]/g, "")),
  phone: optional(30),
});

export async function updateEmployee(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = editSchema.safeParse({
    id: fd.get("id"),
    fullName: fd.get("fullName"),
    documentType: fd.get("documentType") || "DNI",
    documentNumber: fd.get("documentNumber") ?? "",
    phone: fd.get("phone") ?? "",
  });
  if (!parsed.success) return { fieldErrors: flattenErrors(parsed.error) };
  const d = parsed.data;

  const current = await queryOne<{ profile: string; user_id: string | null }>("select profile, user_id from employees where id = $1", [d.id]);
  if (!current) return { message: "Empleado no encontrado." };
  if (current.profile === "PROMOTOR" && !d.documentNumber) return { fieldErrors: { documentNumber: "El documento es obligatorio para promotores" } };

  try {
    await query(
      `update employees set full_name = $2, document_type = $3, document_number = $4, phone = $5 where id = $1`,
      [d.id, d.fullName, d.documentType, d.documentNumber ?? null, d.phone ?? null],
    );
    if (current.user_id) await query("update users set full_name = $2 where id = $1", [current.user_id, d.fullName]);
  } catch (err) {
    if (pgCode(err) === "23505") return { fieldErrors: { documentNumber: "Otro empleado ya tiene ese documento" } };
    return { message: "No se pudo guardar." };
  }
  revalidatePath("/admin/empleados");
  return { ok: true, message: "Cambios guardados." };
}

/** Activar / desactivar. Desactivar quita el acceso al panel y deja sin efecto sus enlaces de promotor. */
export async function setEmployeeActive(fd: FormData) {
  const viewer = await requireAdmin();
  const id = String(fd.get("id") ?? "");
  const active = fd.get("active") === "true";
  if (!UUID.test(id)) return;

  const emp = await queryOne<{ user_id: string | null }>("select user_id from employees where id = $1", [id]);
  if (!emp || (emp.user_id === viewer.userId && !active)) return; // no puede desactivarse a sí mismo

  await transaction(async (client) => {
    await client.query("update employees set is_active = $2 where id = $1", [id, active]);
    if (emp.user_id) await client.query("update users set is_active = $2 where id = $1", [emp.user_id, active]);
  });
  revalidatePath("/admin/empleados");
  revalidatePath("/admin/asignaciones");
}

/** Nueva contraseña temporal para un empleado con acceso al panel. */
export async function resetEmployeePassword(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = String(fd.get("id") ?? "");
  if (!UUID.test(id)) return { message: "Datos no válidos." };
  const emp = await queryOne<{ user_id: string | null; email: string | null }>(
    "select user_id, email from employees where id = $1",
    [id],
  );
  if (!emp?.user_id) return { message: "Este empleado no tiene acceso con contraseña." };

  const tempPassword = temporaryPassword();
  await query(
    "update users set password_hash = $2, must_change_password = true, password_changed_at = now() where id = $1",
    [emp.user_id, await hashPassword(tempPassword)],
  );
  return { ok: true, message: `Nueva contraseña temporal para ${emp.email}`, tempPassword };
}
