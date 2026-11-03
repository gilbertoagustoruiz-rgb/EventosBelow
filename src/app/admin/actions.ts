"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canAdminTenant, requireEvent, requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { flattenErrors, hexColorSchema, slugSchema } from "@/lib/validation";

export interface FormState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

const isUnique = (e: { code?: string } | null) => e?.code === "23505";

// -------------------------------------------------------------------------------------
// Sesión
// -------------------------------------------------------------------------------------
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

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

  const supabase = await createClient();
  const { error } = await supabase.from("tenants").insert({
    name: d.name,
    slug: d.slug,
    tax_id: d.taxId || null,
    contact_name: d.contactName || null,
    contact_email: d.contactEmail || null,
  });
  if (isUnique(error)) return { fieldErrors: { slug: "Ese identificador ya está en uso" } };
  if (error) return { message: "No se pudo crear el cliente." };

  revalidatePath("/admin/clientes");
  return { ok: true, message: "Cliente creado." };
}

const memberSchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email("Correo no válido"),
  role: z.enum(["CLIENT_ADMIN", "HOST"]),
});

/** Invita (o vincula si ya existe) a un usuario como admin o anfitrión de un cliente. */
export async function inviteMember(_: FormState, fd: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  const parsed = memberSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: flattenErrors(parsed.error) };
  const { tenantId, email, role } = parsed.data;
  if (!canAdminTenant(viewer, tenantId)) return { message: "No autorizado." };

  const admin = createAdminClient();
  let userId: string | undefined;

  const invite = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/login`,
  });
  if (invite.data.user) {
    userId = invite.data.user.id;
  } else {
    // Ya registrado: lo buscamos
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
      if (data.users.length < 200) break;
    }
  }
  if (!userId) return { message: "No se pudo invitar al usuario." };

  const { error } = await admin
    .from("tenant_members")
    .upsert({ tenant_id: tenantId, user_id: userId, role }, { onConflict: "tenant_id,user_id" });
  if (error) return { message: "No se pudo asignar el rol." };

  revalidatePath("/admin/clientes");
  return { ok: true, message: invite.data.user ? `Invitación enviada a ${email}.` : `${email} vinculado.` };
}

export async function removeMember(fd: FormData) {
  const viewer = await requireViewer();
  const tenantId = str(fd, "tenantId")!;
  const userId = str(fd, "userId")!;
  if (!canAdminTenant(viewer, tenantId)) return;
  const supabase = await createClient();
  await supabase.from("tenant_members").delete().eq("tenant_id", tenantId).eq("user_id", userId);
  revalidatePath("/admin/clientes");
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

  const admin = createAdminClient();
  const path = `${eventId}/${Date.now()}.${ext}`;
  const { error } = await admin.storage
    .from("event-logos")
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: "31536000" });
  if (error) return { error: "No se pudo subir el logo." };
  return admin.storage.from("event-logos").getPublicUrl(path).data.publicUrl;
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

  const row = {
    tenant_id: d.tenantId,
    name: d.name,
    slug: d.slug,
    description: d.description || null,
    venue: d.venue || null,
    primary_color: d.primaryColor.toLowerCase(),
    companion_mode: d.companionMode,
    is_published: d.isPublished,
    registration_open: d.registrationOpen,
  };

  const supabase = await createClient();
  let id = eventId;
  if (id) {
    await requireEvent(id, "admin");
    const { error } = await supabase.from("events").update(row).eq("id", id);
    if (isUnique(error)) return { fieldErrors: { slug: "Ese enlace ya lo usa otro evento" } };
    if (error) return { message: "No se pudo guardar el evento." };
  } else {
    const { data, error } = await supabase.from("events").insert(row).select("id").single();
    if (isUnique(error)) return { fieldErrors: { slug: "Ese enlace ya lo usa otro evento" } };
    if (error || !data) return { message: "No se pudo crear el evento." };
    id = data.id as string;
  }

  const logo = fd.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const url = await uploadLogo(id, logo);
    if (typeof url !== "string") return { fieldErrors: { logo: url.error } };
    await supabase.from("events").update({ logo_url: url }).eq("id", id);
  }
  if (fd.get("removeLogo") === "on") {
    await supabase.from("events").update({ logo_url: null }).eq("id", id);
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
  const { supabase } = await requireEvent(d.eventId, "admin");

  const { error } = await supabase.from("event_dates").insert({
    event_id: d.eventId,
    event_day: d.eventDay,
    starts_at: d.startsAt,
    ends_at: d.endsAt,
    label: d.label || null,
    capacity: d.capacity,
  });
  if (isUnique(error)) return { message: "Ya existe una fecha con ese día y hora de inicio." };
  if (error) return { message: "No se pudo agregar la fecha." };

  revalidatePath(`/admin/eventos/${d.eventId}`);
  return { ok: true };
}

export async function updateCapacity(_: FormState, fd: FormData): Promise<FormState> {
  const eventId = str(fd, "eventId")!;
  const dateId = str(fd, "dateId")!;
  const capacity = Number(str(fd, "capacity"));
  if (!Number.isInteger(capacity) || capacity < 1) return { message: "Aforo no válido." };
  const { supabase } = await requireEvent(eventId, "admin");

  const { error } = await supabase.from("event_dates").update({ capacity }).eq("id", dateId).eq("event_id", eventId);
  // event_dates_capacity_ck impide bajar el aforo por debajo de los inscritos
  if (error?.code === "23514") return { message: "El aforo no puede ser menor que los cupos ya ocupados." };
  if (error) return { message: "No se pudo actualizar." };

  revalidatePath(`/admin/eventos/${eventId}`);
  return { ok: true, message: "Aforo actualizado." };
}

export async function deleteEventDate(fd: FormData) {
  const eventId = str(fd, "eventId")!;
  const dateId = str(fd, "dateId")!;
  const { supabase } = await requireEvent(eventId, "admin");
  // La FK con ON DELETE RESTRICT protege fechas con registros
  await supabase.from("event_dates").delete().eq("id", dateId).eq("event_id", eventId).eq("registered_count", 0);
  revalidatePath(`/admin/eventos/${eventId}`);
}

// -------------------------------------------------------------------------------------
// Registros
// -------------------------------------------------------------------------------------
export async function cancelRegistration(fd: FormData) {
  const eventId = str(fd, "eventId")!;
  const registrationId = str(fd, "registrationId")!;
  const { supabase } = await requireEvent(eventId, "admin");
  await supabase.rpc("cancel_registration", { p_registration_id: registrationId });
  revalidatePath(`/admin/eventos/${eventId}`);
}
