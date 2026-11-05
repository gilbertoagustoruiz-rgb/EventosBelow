import Link from "next/link";
import {notFound} from "next/navigation";
import {requireViewer,adminTenantIds} from "@/lib/auth";
import {query} from "@/lib/db";
import {PromoterForm} from "./form";
import {setPromoterActive} from "./actions";
export const dynamic="force-dynamic";
export const metadata={title:"Promotores de Evento"};
export default async function PromotersPage(){
 const viewer=await requireViewer(),ids=viewer.isPlatformAdmin?null:adminTenantIds(viewer);
 if(ids&&ids.length===0)notFound();
 const tenants=await query<{id:string;name:string}>("select id,name from tenants where ($1::uuid[] is null or id=any($1)) order by name",[ids]);
 const people=await query<{id:string;full_name:string;document_number:string;phone:string|null;is_active:boolean;tenant_name:string;event_count:number}>(`
 select p.id,p.full_name,p.document_number,p.phone,p.is_active,t.name tenant_name,
 count(ep.id)::int event_count from promoters p join tenants t on t.id=p.tenant_id
 left join event_promoters ep on ep.promoter_id=p.id
 where ($1::uuid[] is null or p.tenant_id=any($1))
 group by p.id,t.name order by t.name,p.full_name`,[ids]);
 return <div className="space-y-6">
 <div><h1 className="text-2xl font-bold">Promotores de Evento</h1><p className="text-slate-600">Registra cada promotor una sola vez. Después asígnalo desde la página del evento.</p></div>
 <section className="card p-6"><h2 className="mb-4 font-semibold">Nuevo promotor</h2><PromoterForm tenants={tenants}/></section>
 <section className="card p-6"><h2 className="mb-4 font-semibold">Directorio de promotores</h2>
 {people.length===0&&<p className="text-sm text-slate-500">Aún no hay promotores.</p>}
 <div className="divide-y">{people.map(p=><div key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
 <div><p className="font-semibold">{p.full_name} · {p.is_active?"Activo":"Inactivo"}</p><p className="text-slate-600">{p.tenant_name} · {p.document_number}{p.phone?" · "+p.phone:""} · {p.event_count} evento(s)</p></div>
 <form action={setPromoterActive}><input type="hidden" name="id" value={p.id}/><input type="hidden" name="active" value={String(!p.is_active)}/><button className="btn-ghost">{p.is_active?"Desactivar":"Activar"}</button></form>
 </div>)}</div></section>
 <Link href="/admin" className="text-sm text-indigo-700 underline">Ir a Mis eventos para asignar promotores</Link>
 </div>;
}
