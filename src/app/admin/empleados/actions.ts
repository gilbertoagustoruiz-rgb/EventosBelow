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
    profile: z.enum(["ADMINISTRADOR", "COORDINADOR", "SUPERVISOR", "PROMOTOR"], { message: "Elige un perfil" }),
    fullName: z.string().trim().min(3, "Ingresa el nombre completo").max(120),
    documentType: z.enum(DOCUMENT_TYPES),
    documentNumber: optional(20).transform((v) => v?.toUpperCase().replace(/[\s.-]/g, "")),
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Correo no válido")]).optional(),
    phone: optional(30),
  })
  .superRefine((d, ctx) => {
    const staff = d.profile === "SUPERVISOR" || d.profile === "PROMOTOR";
    if (staff && !d.documentNumber) {
      ctx.addIssue({ code: "custom", path: ["documentNumber"], message: "El documento es obligatorio: con él ingresa" });
    }
    if (!staff && !d.email) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "El correo es obligatorio: con él ingresa al panel" });
    }
    if (d.documentType === "DNI" && d.documentNumber && !/^\d{8}$/.test(d.documentNumber)) {
      ctx.addIssue({ code: "custom", path: ["documentNumber"], message: "El DNI debe tener 8 dígitos" });
    }
  });

/** Usuario de acceso: el documento (si tiene) o el correo. Puede ingresar con cualquiera de los dos. */
const usernameFor = (doc: string | null | undefined, email: string | null | undefined) => (doc ? doc.toLowerCase() : email!);

/**
 * Crea (o reutiliza) el usuario de un empleado con contraseña temporal.
 * Devuelve el id y la contraseña temporal si se generó una nueva.
 */
async function ensureUser(
  client: import("pg").PoolClient,
  e: { fullName: string; email: string | null; documentNumber: string | null; isAdmin: boolean },
) {
  const username = usernameFor(e.documentNumber, e.email);
  const existing = (
    await client.query<{ id: string; linked: boolean }>(
      `select u.id, exists (select 1 from employees em where em.user_id = u.id) as linked
         from users u where ($1::text is not null and u.email = $1) or u.username = $2
        limit 1`,
      [e.email, username],
    )
  ).rows[0];
  if (existing?.linked) throw new FieldError(e.email ? "email" : "documentNumber", "Ese correo o documento ya tiene un acceso de otro empleado");
  if (existing) {
    await client.query("update users set is_platform_admin = $2, is_active = true, full_name = $3 where id = $1", [
      existing.id, e.isAdmin, e.fullName,
    ]);
    return { userId: existing.id, tempPassword: undefined };
  }
  const tempPassword = temporaryPassword();
  const userId = (
    await client.query<{ id: string }>(
      `insert into users (email, username, full_name, password_hash, is_platform_admin, must_change_password)
       values ($1, $2, $3, $4, $5, true) returning id`,
      [e.email, username, e.fullName, await hashPassword(tempPassword), e.isAdmin],
    )
  ).rows[0].id;
  return { userId, tempPassword };
}

/** Crea un empleado con su acceso (correo o DNI y contraseña temporal). */
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
      const user = await ensureUser(client, {
        fullName: d.fullName, email, documentNumber: d.documentNumber ?? null, isAdmin: d.profile === "ADMINISTRADOR",
      });
      tempPassword = user.tempPassword;

      const employee = (
        await client.query<{ id: string }>(
          `insert into employees (profile, full_name, document_type, document_number, email, phone, user_id)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [d.profile, d.fullName, d.documentType, d.documentNumber ?? null, email, d.phone ?? null, user.userId],
        )
      ).rows[0];

      // Solo los coordinadores se asignan a clientes; supervisores y promotores se agregan por evento
      if (d.profile === "COORDINADOR") {
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
  const login = d.documentNumber && email ? `${email} o DNI ${d.documentNumber}` : (email ?? `DNI ${d.documentNumber}`);
  return {
    ok: true,
    message: tempPassword ? `Empleado creado. Ingresa con ${login}` : `Empleado creado: ${d.fullName}`,
    tempPassword,
  };
}

/** Crea el acceso de un empleado que aún no lo tiene (p. ej. promotores creados antes). */
export async function createEmployeeAccess(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = String(fd.get("id") ?? "");
  if (!UUID.test(id)) return { message: "Datos no válidos." };
  const emp = await queryOne<{ full_name: string; email: string | null; document_number: string | null; user_id: string | null; profile: string }>(
    "select full_name, email, document_number, user_id, profile from employees where id = $1",
    [id],
  );
  if (!emp) return { message: "Empleado no encontrado." };
  if (emp.user_id) return { message: "Este empleado ya tiene acceso." };
  if (!emp.email && !emp.document_number) return { message: "Registra su correo o documento antes de crear el acceso." };

  let tempPassword: string | undefined;
  try {
    await transaction(async (client) => {
      const user = await ensureUser(client, {
        fullName: emp.full_name, email: emp.email, documentNumber: emp.document_number, isAdmin: emp.profile === "ADMINISTRADOR",
      });
      tempPassword = user.tempPassword;
      await client.query("update employees set user_id = $2 where id = $1", [id, user.userId]);
    });
  } catch (err) {
    if (err instanceof FieldError) return { message: err.message };
    console.error("[createEmployeeAccess]", err);
    return { message: "No se pudo crear el acceso." };
  }
  revalidatePath("/admin/empleados");
  return {
    ok: true,
    message: `Acceso creado. Ingresa con ${emp.document_number ? `DNI ${emp.document_number}` : emp.email}`,
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
  if ((current.profile === "PROMOTOR" || current.profile === "SUPERVISOR") && !d.documentNumber) {
    return { fieldErrors: { documentNumber: "El documento es obligatorio: con él ingresa" } };
  }

  try {
    await query(
      `update employees set full_name = $2, document_type = $3, document_number = $4, phone = $5 where id = $1`,
      [d.id, d.fullName, d.documentType, d.documentNumber ?? null, d.phone ?? null],
    );
    // El usuario de acceso sigue al documento (si tiene); el correo no cambia aquí
    if (current.user_id) {
      await query(
        "update users set full_name = $2, username = coalesce($3, email, username) where id = $1",
        [current.user_id, d.fullName, d.documentNumber?.toLowerCase() ?? null],
      );
    }
  } catch (err) {
    if (pgCode(err) === "23505") return { fieldErrors: { documentNumber: "Otro empleado ya tiene ese documento" } };
    return { message: "No se pudo guardar." };
  }
  revalidatePath("/admin/empleados");
  return { ok: true, message: "Cambios guardados." };
}

/** Activar / desactivar. Desactivar quita el acceso y lo retira del personal de sus eventos. */
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
    if (!active) await client.query("update event_staff set is_active = false where employee_id = $1", [id]);
  });
  revalidatePath("/admin/empleados");
  revalidatePath("/admin/asignaciones");
}

/** Nueva contraseña temporal para un empleado con acceso al panel. */
export async function resetEmployeePassword(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = String(fd.get("id") ?? "");
  if (!UUID.test(id)) return { message: "Datos no válidos." };
  const emp = await queryOne<{ user_id: string | null; email: string | null; document_number: string | null }>(
    "select user_id, email, document_number from employees where id = $1",
    [id],
  );
  if (!emp?.user_id) return { message: "Este empleado no tiene acceso con contraseña." };

  const tempPassword = temporaryPassword();
  await query(
    "update users set password_hash = $2, must_change_password = true, password_changed_at = now() where id = $1",
    [emp.user_id, await hashPassword(tempPassword)],
  );
  return { ok: true, message: `Nueva contraseña temporal para ${emp.document_number ? `DNI ${emp.document_number}` : emp.email}`, tempPassword };
}
