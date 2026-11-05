import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { todayIn } from "@/lib/format";
import { CheckinConsole } from "@/components/checkin/checkin-console";
import type { EventDate, EventRow } from "@/lib/types";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Promotor de Evento",robots:{index:false,follow:false}};
export default async function PromoterPage({params}:{params:Promise<{key:string}>}){
 const {key}=await params;
 if(!/^[a-f0-9]{32}$/.test(key))notFound();
 const p=await queryOne<{full_name:string;event_id:string}>("select full_name,event_id from event_promoters where access_key=$1 and is_active",[key]);
 if(!p)notFound();
 const event=await queryOne<EventRow>("select * from events where id=$1",[p.event_id]);
 if(!event)notFound();
 const dates=await query<EventDate>("select * from event_dates where event_id=$1 order by event_day,starts_at",[event.id]);
 if(!dates.length)return <main className="p-8">Este evento no tiene fechas configuradas.</main>;
 const today=todayIn(event.timezone);
 const initial=dates.find(d=>d.event_day===today)??dates.find(d=>d.event_day>today)??dates[dates.length-1];
 return <div className="min-h-dvh bg-slate-950"><div className="mx-auto max-w-xl px-4 pt-3 text-sm text-slate-300">Promotor: {p.full_name}</div><CheckinConsole eventId={event.id} accessKey={key} eventName={event.name} timezone={event.timezone} dates={dates} initialDateId={initial.id}/></div>;
}
