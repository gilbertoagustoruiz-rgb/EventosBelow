"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canAdminTenant, requireEvent, requireViewer } from "@/lib/auth";
import { pgCode, pgMessage, query, queryOne } from "@/lib/db";
import { hashPassword, temporaryPassword } from "@/lib/password";
import { saveAssetInDb, storageConfigured, uploadPublicFile } from "@/lib/storage";
import { flattenErrors, hexColorSchema, slugSchema } from "@/lib/validation";

export interface FormState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Contraseña temporal de un usuario recién creado (se muestra una sola vez) */
  tempPassword?: string;
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const UUID = /^[0-9a-f-]{36}$/i;

// -------------------------------------------------------------------------------------
// Clientes (tenants) — solo SuperAdmin
// -------------------------------------------------------------------------------------
const tenantSchema = z.object({
  name: z.string().trim().min(2, "Ingresa el nombre"),
  slug: slugSchema,
  taxId: z.string().trim().max(20).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactEmail: z.union([z.literal(""), z.string().trim().email("Correo no válido")]).optional(),
});

export async function createTenant(_: FormState, fd: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  if (!viewer.isPlatformAdmin) return { message: "No autorizado." };

  const parsed = tenantSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: flattenErrors(parsed.error) };
  const d = parsed.data;

  try {
    await query(
      `insert into tenants (name, slug, tax_id, contact_name, contact_email) values ($1, $2, $3, $4, $5)`,
      [d.name, d.slug, d.taxId || null, d.contactName || null, d.contactEmail || null],
    );
  } catch (err) {
    if (pgCode(err) === "23505") return { fieldErrors: { slug: "Ese identificador ya está en uso" } };
    console.error("[createTenant]", err);
    return { message: "No se pudo crear el cliente." };
  }

  revalidatePath("/admin/clientes");
  return { ok: true, message: "Cliente creado." };
}

const memberSchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email("Correo no válido"),
  fullName: z.string().trim().max(120).optional(),
  role: z.literal("CLIENT_ADMIN"),
});

/**
 * Da acceso a un usuario sobre un cliente. Si el correo no existe, crea el usuario
 * con una contraseña temporal que debe cambiar en su primer ingreso.
 */
export async function addMember(_: FormState, fd: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  const parsed = memberSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: flattenErrors(parsed.error) };
  const { tenantId, email, fullName, role } = parsed.data;
  if (!canAdminTenant(viewer, tenantId)) return { message: "No autorizado." };

  let user = await queryOne<{ id: string }>("select id from users where email = $1", [email]);
  let tempPassword: string | undefined;
  if (!user) {
    tempPassword = temporaryPassword();
    user = await queryOne<{ id: string }>(
      `insert into users (email, full_name, password_hash, must_change_password)
       values ($1, $2, $3, true) returning id`,
      [email, fullName || null, await hashPassword(tempPassword)],
    );
  }

  await query(
    `insert into tenant_members (tenant_id, user_id, role) values ($1, $2, $3)
     on conflict (tenant_id, user_id) do update set role = excluded.role`,
    [tenantId, user!.id, role],
  );

  revalidatePath("/admin/clientes");
  return tempPassword
    ? { ok: true, message: `Usuario creado: ${email}`, tempPassword }
    : { ok: true, message: `${email} ya tenía cuenta: se le dio acceso.` };
}

export async function removeMember(fd: FormData) {
  const viewer = await requireViewer();
  const tenantId = str(fd, "tenantId") ?? "";
  const userId = str(fd, "userId") ?? "";
  if (!UUID.test(tenantId) || !UUID.test(userId) || userId === viewer.userId) return;
  if (!canAdminTenant(viewer, tenantId)) return;
  await query("delete from tenant_members where tenant_id = $1 and user_id = $2", [tenantId, userId]);
  revalidatePath("/admin/clientes");
}

/** Genera una nueva contraseña temporal para un miembro (p. ej. si la olvidó). */
export async function resetMemberPassword(_: FormState, fd: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  const tenantId = str(fd, "tenantId") ?? "";
  const userId = str(fd, "userId") ?? "";
  if (!UUID.test(tenantId) || !UUID.test(userId)) return { message: "Datos no válidos." };
  if (!canAdminTenant(viewer, tenantId)) return { message: "No autorizado." };

  // Solo usuarios de ese cliente, y un admin de cliente no puede tocar a un SuperAdmin
  const target = await queryOne<{ email: string; is_platform_admin: boolean }>(
    `select u.email, u.is_platform_admin from users u
       join tenant_members m on m.user_id = u.id and m.tenant_id = $1
      where u.id = $2`,
    [tenantId, userId],
  );
  if (!target || (target.is_platform_admin && !viewer.isPlatformAdmin)) return { message: "No autorizado." };

  const tempPassword = temporaryPassword();
  await query(
    `update users set password_hash = $2, must_change_password = true, password_changed_at = now() where id = $1`,
    [userId, await hashPassword(tempPassword)],
  );
  return { ok: true, message: `Nueva contraseña temporal para ${target.email}`, tempPassword };
}

// -------------------------------------------------------------------------------------
// Eventos
// -------------------------------------------------------------------------------------
const eventSchema = z.object({
  tenantId: z.string().uuid({ message: "Selecciona un cliente" }),
  name: z.string().trim().min(3, "Ingresa el nombre del evento").max(140),
  slug: slugSchema,
  description: z.string().trim().max(2000).optional(),
  venue: z.string().trim().max(200).optional(),
  primaryColor: hexColorSchema,
  companionMode: z.enum(["NONE", "OPTIONAL", "REQUIRED"]),
  isPublished: z.boolean(),
  registrationOpen: z.boolean(),
});

const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const LOGO_MAX = 2 * 1024 * 1024;

async function uploadLogo(eventId: string, file: File): Promise<string | { error: string }> {
  const ext = LOGO_TYPES[file.type];
  if (!ext) return { error: "El logo debe ser PNG, JPG o WEBP." };
  if (file.size > LOGO_MAX) return { error: "El logo no debe superar 2 MB." };
  try {
    const body = new Uint8Array(await file.arrayBuffer());
    // Con Spaces configurado se usa Spaces; si no, la propia base de datos
    return storageConfigured()
      ? await uploadPublicFile(`event-logos/${eventId}/${Date.now()}.${ext}`, body, file.type)
      : await saveAssetInDb(body, file.type);
  } catch (err) {
    console.error("[uploadLogo]", err);
    return { error: "No se pudo subir el logo." };
  }
}

export async function saveEvent(_: FormState, fd: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  const eventId = str(fd, "eventId");

  const parsed = eventSchema.safeParse({
    tenantId: str(fd, "tenantId"),
    name: str(fd, "name"),
    slug: str(fd, "slug"),
    description: str(fd, "description"),
    venue: str(fd, "venue"),
    primaryColor: str(fd, "primaryColor"),
    companionMode: str(fd, "companionMode"),
    isPublished: fd.get("isPublished") === "on",
    registrationOpen: fd.get("registrationOpen") === "on",
  });
  if (!parsed.success) return { fieldErrors: flattenErrors(parsed.error) };
  const d = parsed.data;
  if (!canAdminTenant(viewer, d.tenantId)) return { message: "No autorizado para este cliente." };

  const values = [
    d.name,
    d.slug,
    d.description || null,
    d.venue || null,
    d.primaryColor.toLowerCase(),
    d.companionMode,
    d.isPublished,
    d.registrationOpen,
  ];

  let id = eventId;
  try {
    if (id) {
      const { event } = await requireEvent(id, "admin");
      await query(
        `update events set name = $1, slug = $2, description = $3, venue = $4, primary_color = $5,
                companion_mode = $6, is_published = $7, registration_open = $8
          where id = $9`,
        [...values, event.id],
      );
    } else {
      const row = await queryOne<{ id: string }>(
        `insert into events (name, slug, description, venue, primary_color, companion_mode, is_published, registration_open, tenant_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [...values, d.tenantId],
      );
      id = row!.id;
    }
  } catch (err) {
    if (pgCode(err) === "23505") return { fieldErrors: { slug: "Ese enlace ya lo usa otro evento" } };
    console.error("[saveEvent]", err);
    return { message: "No se pudo guardar el evento." };
  }

  const logo = fd.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const url = await uploadLogo(id, logo);
    if (typeof url !== "string") {
      if (!eventId) redirect(`/admin/eventos/${id}?creado=1&logo=error`);
      return { fieldErrors: { logo: url.error } };
    }
    await query("update events set logo_url = $2 where id = $1", [id, url]);
  } else if (fd.get("removeLogo") === "on") {
    await query("update events set logo_url = null where id = $1", [id]);
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/eventos/${id}`);
  revalidatePath(`/evento/${d.slug}`);
  if (!eventId) redirect(`/admin/eventos/${id}?creado=1`);
  return { ok: true, message: "Cambios guardados." };
}

// -------------------------------------------------------------------------------------
// Fechas y aforo
// -------------------------------------------------------------------------------------
const dateSchema = z
  .object({
    eventId: z.string().uuid(),
    eventDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
    startsAt: z.string().regex(/^\d{2}:\d{2}$/, "Hora no válida"),
    endsAt: z.string().regex(/^\d{2}:\d{2}$/, "Hora no válida"),
    label: z.string().trim().max(80).optional(),
    capacity: z.coerce.number().int().min(1, "Mínimo 1").max(100_000),
  })
  .refine((d) => d.endsAt > d.startsAt, { path: ["endsAt"], message: "Debe ser posterior al inicio" });

export async function addEventDate(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = dateSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: flattenErrors(parsed.error) };
  const d = parsed.data;
  await requireEvent(d.eventId, "admin");

  try {
    await query(
      `insert into event_dates (event_id, event_day, starts_at, ends_at, label, capacity) values ($1, $2, $3, $4, $5, $6)`,
      [d.eventId, d.eventDay, d.startsAt, d.endsAt, d.label || null, d.capacity],
    );
  } catch (err) {
    if (pgCode(err) === "23505") return { message: "Ya existe una fecha con ese día y hora de inicio." };
    console.error("[addEventDate]", err);
    return { message: "No se pudo agregar la fecha." };
  }

  revalidatePath(`/admin/eventos/${d.eventId}`);
  return { ok: true };
}

export async function updateCapacity(_: FormState, fd: FormData): Promise<FormState> {
  const eventId = str(fd, "eventId") ?? "";
  const dateId = str(fd, "dateId") ?? "";
  const capacity = Number(str(fd, "capacity"));
  if (!UUID.test(dateId) || !Number.isInteger(capacity) || capacity < 1 || capacity > 100_000) {
    return { message: "Aforo no válido." };
  }
  await requireEvent(eventId, "admin");

  try {
    await query("update event_dates set capacity = $3 where id = $1 and event_id = $2", [dateId, eventId, capacity]);
  } catch (err) {
    // event_dates_capacity_ck impide bajar el aforo por debajo de los inscritos
    if (pgCode(err) === "23514") return { message: "El aforo no puede ser menor que los cupos ya ocupados." };
    return { message: "No se pudo actualizar." };
  }

  revalidatePath(`/admin/eventos/${eventId}`);
  return { ok: true, message: "Aforo actualizado." };
}

export async function deleteEventDate(fd: FormData) {
  const eventId = str(fd, "eventId") ?? "";
  const dateId = str(fd, "dateId") ?? "";
  if (!UUID.test(dateId)) return;
  await requireEvent(eventId, "admin");
  // Solo fechas sin inscritos (la FK con ON DELETE RESTRICT también lo protege)
  await query("delete from event_dates where id = $1 and event_id = $2 and registered_count = 0", [dateId, eventId]).catch(
    () => {},
  );
  revalidatePath(`/admin/eventos/${eventId}`);
}

// -------------------------------------------------------------------------------------
// Registros
// -------------------------------------------------------------------------------------
export async function cancelRegistration(fd: FormData) {
  const eventId = str(fd, "eventId") ?? "";
  const registrationId = str(fd, "registrationId") ?? "";
  if (!UUID.test(registrationId)) return;
  await requireEvent(eventId, "admin");

  const owns = await queryOne("select 1 from registrations where id = $1 and event_id = $2", [registrationId, eventId]);
  if (!owns) return;
  try {
    await query("select cancel_registration($1)", [registrationId]);
  } catch (err) {
    if (!pgMessage(err).includes("ALREADY_CHECKED_IN")) console.error("[cancelRegistration]", err);
  }
  revalidatePath(`/admin/eventos/${eventId}`);
}

// -------------------------------------------------------------------------------------
// Enlace de acreditación
// -------------------------------------------------------------------------------------
/** Crea un enlace nuevo; el anterior deja de funcionar de inmediato. */
export async function regenerateCheckinKey(fd: FormData) {
  const eventId = str(fd, "eventId") ?? "";
  await requireEvent(eventId, "admin");
  await query("update events set checkin_key = replace(gen_random_uuid()::text, '-', '') where id = $1", [eventId]);
  revalidatePath(`/admin/eventos/${eventId}`);
}
