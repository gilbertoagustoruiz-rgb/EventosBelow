import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayIn } from "@/lib/format";
import type { EventDate, EventRow, PublicDateOption } from "@/lib/types";

const PUBLIC_EVENT_FIELDS =
  "id, name, slug, description, venue, logo_url, primary_color, companion_mode, timezone, is_published, registration_open";

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
  | "timezone"
  | "is_published"
  | "registration_open"
>;

/** Evento publicado por slug, con campos públicos solamente. */
export async function getPublicEvent(slug: string) {
  const db = createAdminClient();
  const { data } = await db
    .from("events")
    .select(PUBLIC_EVENT_FIELDS)
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle<PublicEvent>();
  return data;
}

/** Fechas futuras (o de hoy) con cupos restantes. */
export async function getPublicDates(event: Pick<PublicEvent, "id" | "timezone">): Promise<PublicDateOption[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("event_dates")
    .select("id, event_day, starts_at, ends_at, label, capacity, registered_count")
    .eq("event_id", event.id)
    .gte("event_day", todayIn(event.timezone))
    .order("event_day")
    .order("starts_at")
    .returns<EventDate[]>();

  return (data ?? []).map(({ registered_count, ...d }) => ({
    ...d,
    remaining: Math.max(0, d.capacity - registered_count),
  }));
}
