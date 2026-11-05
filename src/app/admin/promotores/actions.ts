"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAdminTenant, requireViewer } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export interface PromoterState { ok?: boolean; message?: string }
const schema = z.object({
 eventId: z.string().uuid(), fullName: z.string().trim().min(3).max(120),
 documentNumber: z.string().trim().min(5).max(20),
 phone: z.string().trim().max(30).optional(),
});
export async function createPromoter(_: PromoterState, fd: FormData): Promise<PromoterState> {
 const viewer = await requireViewer();
 const parsed = schema.safeParse(Object.fromEntries(fd));
 if (!parsed.success) return { message: "Revisa nombre, documento y evento." };
 const d = parsed.data;
 const event = await queryOne<{ tenant_id: string }>("select tenant_id from events where id = $1", [d.eventId]);
 if (!event || !canAdminTenant(viewer, event.tenant_id)) return { message: "No autorizado." };
 try {
  await query("insert into event_promoters (event_id, full_name, document_number, phone) values ($1,$2,$3,$4)",
   [d.eventId,d.fullName,d.documentNumber,d.phone || null]);
 } catch { return { message: "No se pudo crear. Comprueba que el documento no esté repetido en el evento." }; }
 revalidatePath("/admin/promotores");
 return { ok: true, message: "Promotor creado. Comparte únicamente su enlace individual." };
}
export async function updatePromoter(fd: FormData) {
 const viewer = await requireViewer();
 const id = fd.get("id"), operation = fd.get("operation");
 if (typeof id !== "string" || !z.string().uuid().safeParse(id).success) return;
 if (operation !== "disable" && operation !== "enable" && operation !== "rotate") return;
 const p = await queryOne<{tenant_id:string}>("select e.tenant_id from event_promoters p join events e on e.id=p.event_id where p.id=$1",[id]);
 if (!p || !canAdminTenant(viewer,p.tenant_id)) return;
 if (operation === "rotate") await query("update event_promoters set access_key=replace(gen_random_uuid()::text,'-','') where id=$1",[id]);
 else await query("update event_promoters set is_active=$2 where id=$1",[id,operation === "enable"]);
 revalidatePath("/admin/promotores");
}
