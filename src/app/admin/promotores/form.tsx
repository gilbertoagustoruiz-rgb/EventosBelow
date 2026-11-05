"use client";
import { useActionState } from "react";
import { createPromoter, type PromoterState } from "./actions";
export function PromoterForm({ events }: { events: {id:string;name:string}[] }) {
 const [state,action,pending] = useActionState<PromoterState,FormData>(createPromoter,{});
 return <form action={action} className="grid gap-3 sm:grid-cols-2">
  <select name="eventId" required className="input sm:col-span-2" defaultValue=""><option value="" disabled>Seleccionar evento</option>{events.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select>
  <input name="fullName" required className="input" placeholder="Nombre completo del promotor"/>
  <input name="documentNumber" required className="input" placeholder="DNI / documento"/>
  <input name="phone" className="input" placeholder="Celular (opcional)"/>
  <button disabled={pending || !events.length} className="btn-brand">{pending?"Guardando…":"Crear promotor"}</button>
  {state.message && <p role="status" className="text-sm sm:col-span-2">{state.message}</p>}
 </form>;
}
