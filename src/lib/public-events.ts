import "server-only";
import { query, queryOne } from "@/lib/db";
import type { EventRow, PublicDateOption } from "@/lib/types";

export type PublicEvent = Pick<
  EventRow,
  | "id"
  | "name"
  | "slug"
  | "description"
  | "venue"
  | "logo_url"
  | "primary_color"
  | "companion_mode"
  | "max_companions"
  | "timezone"
  | "is_published"
  | "registration_open"
>;

/** Evento publicado por slug, solo con campos públicos. */
export async function getPublicEvent(slug: string) {
  return queryOne<PublicEvent>(
    `select id, name, slug, description, venue, logo_url, primary_color, companion_mode, max_companions,
            timezone, is_published, registration_open
       from events where slug = $1 and is_published`,
    [slug],
  );
}

/** Fechas de hoy en adelante (en la zona del evento) con cupos restantes. */
export async function getPublicDates(event: Pick<PublicEvent, "id" | "timezone">): Promise<PublicDateOption[]> {
  return query<PublicDateOption>(
    `select id, event_day, starts_at::text, ends_at::text, label, capacity,
            greatest(0, capacity - registered_count) as remaining
       from event_dates
      where event_id = $1 and event_day >= (now() at time zone $2)::date
      order by event_day, starts_at`,
    [event.id, event.timezone],
  );
}
