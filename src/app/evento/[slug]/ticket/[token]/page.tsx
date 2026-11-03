import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Mail } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { brandStyle } from "@/lib/format";
import { TicketCard, type TicketData } from "@/components/registration/ticket-card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tu ticket", robots: { index: false } };

type Props = {
  params: Promise<{ slug: string; token: string }>;
  searchParams: Promise<{ nuevo?: string }>;
};

export default async function TicketPage({ params, searchParams }: Props) {
  const [{ slug, token }, { nuevo }] = await Promise.all([params, searchParams]);
  if (!/^[a-f0-9]{32}$/.test(token)) notFound();

  const db = createAdminClient();
  const { data: r } = await db
    .from("registrations")
    .select(
      `token, status, full_name, email, document_type, document_number, company, companion_full_name, holder_checked_in_at,
       events!inner(slug, name, venue, logo_url, primary_color),
       event_dates!inner(event_day, starts_at, ends_at, label)`,
    )
    .eq("token", token)
    .eq("events.slug", slug)
    .maybeSingle();
  if (!r) notFound();

  const event = r.events as unknown as { slug: string; name: string; venue: string | null; logo_url: string | null; primary_color: string };
  const date = r.event_dates as unknown as { event_day: string; starts_at: string; ends_at: string; label: string | null };

  const ticket: TicketData = {
    token: r.token,
    status: r.status,
    fullName: r.full_name,
    documentType: r.document_type,
    documentNumber: r.document_number,
    company: r.company,
    companionFullName: r.companion_full_name,
    eventName: event.name,
    venue: event.venue,
    logoUrl: event.logo_url,
    day: date.event_day,
    startsAt: date.starts_at,
    endsAt: date.ends_at,
    dateLabel: date.label,
    holderCheckedIn: Boolean(r.holder_checked_in_at),
  };

  // Enmascara el correo: j***@empresa.com
  const maskedEmail = r.email.replace(/^(.)[^@]*/, "$1***");

  return (
    <div style={brandStyle(event.primary_color)} className="min-h-dvh bg-slate-100 px-4 py-10">
      {nuevo && (
        <div className="no-print mx-auto mb-8 max-w-md text-center">
          <CheckCircle2 className="mx-auto size-14 text-emerald-600" />
          <h1 className="mt-3 text-2xl font-bold">¡Registro confirmado!</h1>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-slate-600">
            <Mail className="size-4" /> Enviamos tu ticket a {maskedEmail}
          </p>
          <p className="mt-1 text-sm text-slate-500">Guarda este código: lo escanearán en el ingreso.</p>
        </div>
      )}
      <TicketCard ticket={ticket} />
      <p className="no-print mt-8 text-center text-sm">
        <Link href={`/evento/${event.slug}`} className="text-slate-500 underline-offset-4 hover:underline">
          Volver al evento
        </Link>
      </p>
    </div>
  );
}
