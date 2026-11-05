import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandStyle } from "@/lib/format";
import { getPublicDates, getPublicEvent } from "@/lib/public-events";
import { EventHeader } from "@/components/registration/event-header";
import { RecoverTicket } from "./recover-ticket";
import { RegistrationForm } from "@/components/registration/registration-form";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const event = await getPublicEvent(slug);
  return event ? { title: `Registro · ${event.name}`, description: event.description ?? undefined } : {};
}

export default async function PublicEventPage({ params }: Params) {
  const { slug } = await params;
  const event = await getPublicEvent(slug);
  if (!event) notFound();

  const dates = await getPublicDates(event);

  return (
    <div style={brandStyle(event.primary_color)} className="min-h-dvh bg-[color-mix(in_srgb,var(--brand)_5%,white)]">
      <EventHeader name={event.name} logoUrl={event.logo_url} venue={event.venue} description={event.description} />
      <main className="mx-auto -mt-12 max-w-3xl px-4 pb-16 sm:px-8">
        <div className="card p-5 sm:p-8">
          {event.registration_open ? (
            <RegistrationForm slug={event.slug} companionMode={event.companion_mode} maxCompanions={event.max_companions} dates={dates} />
          ) : (
            <p className="py-6 text-center text-slate-600">Las inscripciones para este evento están cerradas.</p>
          )}
        </div>
        <RecoverTicket slug={event.slug} />
        <p className="mt-6 text-center text-xs text-slate-400">Plataforma de registro · Eventos Below</p>
      </main>
    </div>
  );
}
