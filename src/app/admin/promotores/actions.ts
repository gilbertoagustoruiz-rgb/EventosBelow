"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAdminTenant, requireViewer } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export interface PromoterState { ok?: boolean; message?: string }
const personSchema=z.object({tenantId:z.string().uuid(),fullName:z.string().trim().min(3).max(120),documentNumber:z.string().trim().min(5).max(20),phone:z.string().trim().max(30).optional()});
const assignmentSchema=z.object({eventId:z.string().uuid(),promoterId:z.string().uuid()});
export async function createPromoter(_:PromoterState,fd:FormData):Promise<PromoterState>{
 const viewer=await requireViewer(), parsed=personSchema.safeParse(Object.fromEntries(fd));
 if(!parsed.success)return {message:"Revisa los datos del promotor y el cliente."};
 const d=parsed.data;
 if(!canAdminTenant(viewer,d.tenantId))return {message:"No autorizado."};
 try{await query("insert into promoters(tenant_id,full_name,document_number,phone) values($1,$2,$3,$4)",[d.tenantId,d.fullName,d.documentNumber,d.phone||null]);}
 catch{return {message:"No se pudo crear. Comprueba que el documento no esté repetido en este cliente."};}
 revalidatePath("/admin/promotores");
 return {ok:true,message:"Promotor creado. Ya puedes asignarlo a eventos."};
}
export async function assignPromoter(_:PromoterState,fd:FormData):Promise<PromoterState>{
 const viewer=await requireViewer(),parsed=assignmentSchema.safeParse(Object.fromEntries(fd));
 if(!parsed.success)return {message:"Selecciona un promotor."};
 const d=parsed.data;
 const row=await queryOne<{tenant_id:string}>(`select e.tenant_id from events e join promoters p on p.tenant_id=e.tenant_id where e.id=$1 and p.id=$2 and p.is_active`,[d.eventId,d.promoterId]);
 if(!row||!canAdminTenant(viewer,row.tenant_id))return {message:"Promotor no autorizado para este evento."};
 try{await query(`insert into event_promoters(event_id,promoter_id,full_name,document_number,phone)
 select $1,p.id,p.full_name,p.document_number,p.phone from promoters p
 where p.id=$2 and p.tenant_id=$3
 on conflict(event_id,document_number) do update set promoter_id=excluded.promoter_id,is_active=true`,[d.eventId,d.promoterId,row.tenant_id]);}
 catch{return {message:"No se pudo asignar al promotor."};}
 revalidatePath("/admin/promotores");revalidatePath("/admin/eventos/"+d.eventId);
 return {ok:true,message:"Promotor asignado. Comparte su enlace exclusivo para este evento."};
}
export async function updatePromoter(fd:FormData){
 const viewer=await requireViewer(),id=fd.get("id"),operation=fd.get("operation");
 if(typeof id!=="string"||!z.string().uuid().safeParse(id).success)return;
 if(!["disable","enable","rotate","remove"].includes(String(operation)))return;
 const p=await queryOne<{tenant_id:string;event_id:string}>(`select e.tenant_id,p.event_id from event_promoters p join events e on e.id=p.event_id where p.id=$1`,[id]);
 if(!p||!canAdminTenant(viewer,p.tenant_id))return;
 if(operation==="rotate")await query("update event_promoters set access_key=replace(gen_random_uuid()::text,'-','') where id=$1",[id]);
 else await query("update event_promoters set is_active=$2 where id=$1",[id,operation==="enable"]);
 revalidatePath("/admin/promotores");revalidatePath("/admin/eventos/"+p.event_id);
}
export async function setPromoterActive(fd:FormData){
 const viewer=await requireViewer(),id=fd.get("id"),active=fd.get("active");
 if(typeof id!=="string"||!z.string().uuid().safeParse(id).success||!["true","false"].includes(String(active)))return;
 const p=await queryOne<{tenant_id:string}>("select tenant_id from promoters where id=$1",[id]);
 if(!p||!canAdminTenant(viewer,p.tenant_id))return;
 await query("update promoters set is_active=$2 where id=$1",[id,active==="true"]);
 revalidatePath("/admin/promotores");
}
