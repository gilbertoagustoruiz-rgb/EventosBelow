import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { eventByCheckinKey } from "@/lib/auth";
import { query } from "@/lib/db";
import { todayIn } from "@/lib/format";
import { CheckinConsole } from "@/components/checkin/checkin-console";
import type { EventDate } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Acreditación", robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#020617", maximumScale: 1 };

/** Check-in sin login: acceso con el enlace secreto del evento. */
export default async function KeyCheckinPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const event = await eventByCheckinKey(key);
  if (!event) notFound();

  const dates = await query<EventDate>(
    "select * from event_dates where event_id = $1 order by event_day, starts_at",
    [event.id],
  );
  if (dates.length === 0) {
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-950 p-6 text-center text-slate-300">
        Este evento aún no tiene fechas configuradas.
      </main>
    );
  }

  const today = todayIn(event.timezone);
  const initial =
    dates.find((d) => d.event_day === today) ?? dates.find((d) => d.event_day > today) ?? dates[dates.length - 1];

  return (
    <div className="min-h-dvh bg-slate-950">
      <CheckinConsole
        eventId={event.id}
        accessKey={event.checkin_key}
        eventName={event.name}
        timezone={event.timezone}
        dates={dates}
        initialDateId={initial.id}
      />
    </div>
  );
}
