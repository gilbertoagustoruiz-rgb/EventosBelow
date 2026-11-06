import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, MapPin, ArrowRight } from "lucide-react";
import { query } from "@/lib/db";
import { brandStyle, formatDayShort } from "@/lib/format";

export const dynamic = "force-dynamic";
// Marca blanca: la página pública no muestra la plataforma
export const metadata = { title: { absolute: "Confirma tu asistencia" }, robots: { index: false } };

type PublicEvent = {
  id: string;
  name: string;
  slug: string;
  venue: string | null;
  primary_color: string;
  first_day: string | null;
};

/** Con un solo evento abierto va directo a su confirmación; con varios, una lista neutra. */
export default async function Home() {
  const events = await query<PublicEvent>(
    `select e.id, e.name, e.slug, e.venue, e.primary_color, min(d.event_day) as first_day
       from events e
       join event_dates d on d.event_id = e.id
      where e.is_published and e.registration_open
        and d.event_day >= (now() at time zone e.timezone)::date
      group by e.id
      order by first_day, e.name`,
  );
  if (events.length === 1) redirect(`/evento/${events[0].slug}`);

  return (
    <main className="min-h-dvh bg-slate-50">
      <div className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Confirma tu asistencia</h1>
        <p className="mt-2 text-slate-600">
          {events.length ? "Elige tu evento." : "No hay eventos con confirmación abierta en este momento."}
        </p>
        <ul className="mt-6 space-y-3">
          {events.map((e) => (
            <li key={e.id}>
              <Link href={`/evento/${e.slug}`} style={brandStyle(e.primary_color)} className="card flex items-center gap-4 p-4 hover:shadow-md">
                <span className="size-3 shrink-0 rounded-full bg-brand" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{e.name}</span>
                  <span className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-slate-500">
                    {e.first_day && <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" />{formatDayShort(e.first_day)}</span>}
                    {e.venue && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{e.venue}</span>}
                  </span>
                </span>
                <ArrowRight className="size-4 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
