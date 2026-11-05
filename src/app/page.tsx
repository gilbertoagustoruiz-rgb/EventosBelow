import Link from "next/link";
import { CalendarDays, MapPin, ArrowRight, LockKeyhole, Ticket } from "lucide-react";
import { query } from "@/lib/db";
import { formatDayShort } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Inscripción a eventos | Eventos Below",
  description: "Registra tus datos y selecciona el día de tu evento.",
};

type PublicEvent = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  venue: string | null;
  primary_color: string;
  first_day: string | null;
  available_dates: number;
  remaining: number;
};

export default async function Home() {
  const events = await query<PublicEvent>(
    `select e.id, e.name, e.slug, e.description, e.venue, e.primary_color,
            min(d.event_day) as first_day,
            count(d.id)::int as available_dates,
            coalesce(sum(greatest(0, d.capacity - d.registered_count)), 0)::int as remaining
       from events e
       join event_dates d on d.event_id = e.id
      where e.is_published = true
        and e.registration_open = true
        and d.event_day >= (now() at time zone e.timezone)::date
      group by e.id
     having coalesce(sum(greatest(0, d.capacity - d.registered_count)), 0) > 0
      order by first_day, e.name`
  );

  return (
    <main className="min-h-dvh bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-8 sm:py-20">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">Eventos Below</p>
          <Link href="/login" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-indigo-700">
            <LockKeyhole className="size-4" /> Acceso personal autorizado
          </Link>
        </div>
        <div className="mt-14 max-w-2xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700">
            <Ticket className="size-4" /> Inscripción de participantes
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">Regístrate para tu próximo evento</h1>
          <p className="mt-5 text-lg leading-relaxed text-slate-600">
            Selecciona un evento, elige el día en que asistirás y completa tus datos. No necesitas crear una cuenta.
          </p>
        </div>
        <section className="mt-12" aria-labelledby="available-events">
          <h2 id="available-events" className="text-xl font-semibold text-slate-900">Eventos con inscripciones abiertas</h2>
          {events.length === 0 ? (
            <div className="card mt-5 p-10 text-center">
              <CalendarDays className="mx-auto size-9 text-slate-400" />
              <p className="mt-4 font-semibold">No hay eventos disponibles por ahora</p>
              <p className="mt-2 text-sm text-slate-500">Vuelve pronto para consultar las próximas fechas de inscripción.</p>
            </div>
          ) : (
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              {events.map((event) => (
                <article key={event.id} className="card overflow-hidden">
                  <div className="h-1.5" style={{ backgroundColor: event.primary_color }} />
                  <div className="p-6">
                    <h3 className="text-xl font-bold text-slate-950">{event.name}</h3>
                    {event.description && <p className="mt-2 line-clamp-3 text-sm text-slate-600">{event.description}</p>}
                    <div className="mt-5 space-y-2 text-sm text-slate-600">
                      {event.first_day && <p className="flex items-center gap-2"><CalendarDays className="size-4" /> Desde {formatDayShort(event.first_day)} · {event.available_dates} {event.available_dates === 1 ? "fecha" : "fechas"}</p>}
                      {event.venue && <p className="flex items-center gap-2"><MapPin className="size-4" /> {event.venue}</p>}
                      <p className="font-medium text-emerald-700">{event.remaining} {event.remaining === 1 ? "cupo disponible" : "cupos disponibles"}</p>
                    </div>
                    <Link href={`/evento/${event.slug}`} className="btn-brand mt-6 w-full">
                      Seleccionar día y registrarme <ArrowRight className="size-4" />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <p className="mt-12 text-center text-xs text-slate-400">Plataforma de inscripciones · Eventos Below</p>
      </div>
    </main>
  );
}
