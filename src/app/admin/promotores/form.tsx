"use client";
import {useActionState} from "react";
import {createPromoter,assignPromoter,type PromoterState} from "./actions";
export function PromoterForm({tenants}:{tenants:{id:string;name:string}[]}){
 const [state,action,pending]=useActionState<PromoterState,FormData>(createPromoter,{});
 return <form action={action} className="grid gap-3 sm:grid-cols-2">
 <select name="tenantId" required className="input sm:col-span-2" defaultValue=""><option value="" disabled>Seleccionar cliente</option>{tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
 <input name="fullName" required className="input" placeholder="Nombre completo"/>
 <input name="documentNumber" required className="input" placeholder="DNI / documento"/>
 <input name="phone" className="input" placeholder="Celular (opcional)"/>
 <button disabled={pending||!tenants.length} className="btn-brand">{pending?"Guardando…":"Crear promotor"}</button>
 {state.message&&<p role="status" className="text-sm sm:col-span-2">{state.message}</p>}
 </form>;
}
export function AssignmentForm({eventId,promoters}:{eventId:string;promoters:{id:string;full_name:string;document_number:string}[]}){
 const [state,action,pending]=useActionState<PromoterState,FormData>(assignPromoter,{});
 return <form action={action} className="flex flex-wrap items-center gap-2">
 <input type="hidden" name="eventId" value={eventId}/>
 <select name="promoterId" required defaultValue="" className="input min-w-56 flex-1"><option value="" disabled>Seleccionar promotor registrado</option>{promoters.map(p=><option key={p.id} value={p.id}>{p.full_name} · {p.document_number}</option>)}</select>
 <button className="btn-brand" disabled={pending||!promoters.length}>{pending?"Asignando…":"Asignar"}</button>
 {state.message&&<p role="status" className="w-full text-sm">{state.message}</p>}
 </form>;
}
