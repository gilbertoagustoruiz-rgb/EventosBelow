import Link from "next/link";
import { requireEvent } from "@/lib/auth";
import { query } from "@/lib/db";
import { ImportForm } from "./form";
export const dynamic="force-dynamic";
export default async function ImportPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 await requireEvent(id,"admin");
 const dates=await query<{id:string;event_day:string;label:string|null}>("select id,event_day,label from event_dates where event_id=$1 order by event_day",[id]);
 return <main className="space-y-6"><Link href={`/admin/eventos/${id}`} className="text-sm text-indigo-700 underline">Volver al evento</Link><div><h1 className="text-2xl font-bold">Importación inteligente de inscripciones</h1><p className="mt-2 text-slate-600">Carga tu Excel, revisa los resultados y confirma antes de guardar. No modifica inscripciones existentes.</p></div>{dates.length?<section className="card p-6"><ImportForm eventId={id} dates={dates.map(d=>({id:d.id,label:d.event_day+(d.label?" · "+d.label:"")}))}/></section>:<p>Primero agrega una fecha al evento para importar asistentes.</p>}</main>;
}
