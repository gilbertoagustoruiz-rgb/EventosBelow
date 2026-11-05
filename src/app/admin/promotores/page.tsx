import { requireViewer, adminTenantIds } from "@/lib/auth";
import { query } from "@/lib/db";
import { PromoterForm } from "./form";
import { updatePromoter } from "./actions";
export const dynamic = "force-dynamic";
export const metadata = { title: "Promotores de Evento" };
export default async function PromotersPage() {
 const viewer=await requireViewer();
 const ids=viewer.isPlatformAdmin?null:adminTenantIds(viewer);
 const events=await query<{id:string;name:string}>("select id,name from events where ($1::uuid[] is null or tenant_id=any($1)) order by name",[ids]);
 const promoters=await query<{id:string;full_name:string;document_number:string;phone:string|null;is_active:boolean;access_key:string;event_name:string}>(
  `select p.id,p.full_name,p.document_number,p.phone,p.is_active,p.access_key,e.name as event_name
   from event_promoters p join events e on e.id=p.event_id
   where ($1::uuid[] is null or e.tenant_id=any($1))
   order by e.name,p.full_name`,[ids]);
 return <div className="space-y-6"><div><h1 className="text-2xl font-bold">Promotores de Evento</h1><p className="text-slate-600">Cada promotor tiene un enlace exclusivo para escanear QR y acreditar asistentes sin login.</p></div>
 <section className="card p-6"><h2 className="mb-4 font-semibold">Nuevo promotor</h2><PromoterForm events={events}/></section>
 <section className="card space-y-4 p-6"><h2 className="font-semibold">Promotores asignados</h2>
 {promoters.length===0&&<p className="text-sm text-slate-500">Aún no hay promotores.</p>}
 {promoters.map(p=><div key={p.id} className="space-y-2 border-t pt-4 text-sm">
 <p className="font-semibold">{p.full_name} · {p.is_active?"Activo":"Inactivo"}</p>
 <p className="text-slate-600">{p.event_name} · Documento: {p.document_number}{p.phone?" · "+p.phone:""}</p>
 {p.is_active&&<a className="break-all text-indigo-700 underline" href={`/promotor/${p.access_key}`} target="_blank" rel="noreferrer">Abrir enlace individual de acreditación</a>}
 <div className="flex flex-wrap gap-2">
 <form action={updatePromoter}><input type="hidden" name="id" value={p.id}/><button name="operation" value={p.is_active?"disable":"enable"} className="btn-ghost">{p.is_active?"Desactivar":"Activar"}</button></form>
 <form action={updatePromoter}><input type="hidden" name="id" value={p.id}/><button name="operation" value="rotate" className="btn-ghost">Regenerar enlace</button></form>
 </div></div>)}</section></div>;
}
