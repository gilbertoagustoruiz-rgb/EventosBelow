import type { Metadata, Viewport } from "next";
import { requireEvent } from "@/lib/auth";
import { query } from "@/lib/db";
import { todayIn } from "@/lib/format";
import { CheckinConsole } from "@/components/checkin/checkin-console";
import type { EventDate } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Check-in" };
export const viewport: Viewport = { themeColor: "#020617", maximumScale: 1 };

export default async function CheckinPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { event } = await requireEvent(eventId, "host");
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

  // Fecha activa por defecto: hoy → la próxima → la última
  const today = todayIn(event.timezone);
  const initial =
    dates.find((d) => d.event_day === today) ?? dates.find((d) => d.event_day > today) ?? dates[dates.length - 1];

  return (
    <div className="min-h-dvh bg-slate-950">
      <CheckinConsole
        eventId={event.id}
        eventName={event.name}
        timezone={event.timezone}
        dates={dates}
        initialDateId={initial.id}
      />
    </div>
  );
}
