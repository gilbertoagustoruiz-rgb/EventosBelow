"use server";

import { z } from "zod";
import { query } from "@/lib/db";
import { sendConfirmationEmail } from "@/lib/email";
import { createRateLimiter } from "@/lib/rate-limit";

export interface RecoveryState { message?: string }
const inputSchema = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), email: z.string().trim().toLowerCase().email().max(254) });
const GENERIC = "Si encontramos una inscripción con ese correo, recibirás el enlace de tu QR. Revisa también spam.";
const attempts = createRateLimiter(1, 60_000);

export async function resendTicket(_: RecoveryState, fd: FormData): Promise<RecoveryState> {
  const parsed = inputSchema.safeParse({ slug: fd.get("slug"), email: fd.get("email") });
  if (!parsed.success) return { message: "Ingresa un correo electrónico válido." };
  const { slug, email } = parsed.data;
  const key = slug + ":" + email;
  if (!attempts.consume(key)) return { message: GENERIC };
  const records = await query<{
    token: string; full_name: string; name: string; venue: string | null;
    primary_color: string; event_day: string; starts_at: string; ends_at: string;
    companion_full_name: string | null;
  }>(
    `select r.token, r.full_name, e.name, e.venue, e.primary_color,
            d.event_day::text, d.starts_at::text, d.ends_at::text, r.companion_full_name
       from registrations r
       join events e on e.id = r.event_id
       join event_dates d on d.id = r.event_date_id
      where e.slug = $1 and lower(r.email) = $2 and r.status <> 'CANCELADO'
      order by r.created_at desc limit 5`,
    [slug, email],
  );
  for (const r of records) {
    await sendConfirmationEmail({
      to: email, fullName: r.full_name, eventName: r.name, eventSlug: slug,
      venue: r.venue, brandColor: r.primary_color, day: r.event_day,
      startsAt: r.starts_at, endsAt: r.ends_at, token: r.token,
      companionName: r.companion_full_name,
    });
  }
  return { message: GENERIC };
}
