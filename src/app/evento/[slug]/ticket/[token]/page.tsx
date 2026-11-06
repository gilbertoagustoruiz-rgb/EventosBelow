import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Mail } from "lucide-react";
import { queryOne } from "@/lib/db";
import type { DocumentType, RegistrationStatus } from "@/lib/types";
import { brandStyle } from "@/lib/format";
import { TicketCard, type TicketData } from "@/components/registration/ticket-card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Tu ticket" }, robots: { index: false } };

type Props = {
  params: Promise<{ slug: string; token: string }>;
  searchParams: Promise<{ nuevo?: string; ya?: string }>;
};

export default async function TicketPage({ params, searchParams }: Props) {
  const [{ slug, token }, { nuevo, ya }] = await Promise.all([params, searchParams]);
  if (!/^[a-f0-9]{32}$/.test(token)) notFound();

  const r = await queryOne<{
    token: string;
    status: RegistrationStatus;
    full_name: string;
    email: string | null;
    document_type: DocumentType;
    document_number: string;
    company: string | null;
    companions: { full_name: string; checked_in: boolean }[];
    holder_checked_in_at: string | null;
    slug: string;
    name: string;
    venue: string | null;
    logo_url: string | null;
    primary_color: string;
    event_day: string;
    starts_at: string;
    ends_at: string;
    label: string | null;
  }>(
    `select r.token, r.status, r.full_name, r.email, r.document_type, r.document_number, r.company,
            r.holder_checked_in_at,
            coalesce((select json_agg(json_build_object('full_name', c.full_name, 'checked_in', c.checked_in_at is not null) order by c.position)
                        from companions c where c.registration_id = r.id), '[]') as companions,
            e.slug, e.name, e.venue, e.logo_url, e.primary_color,
            d.event_day, d.starts_at::text, d.ends_at::text, d.label
       from registrations r
       join events e on e.id = r.event_id
       join event_dates d on d.id = r.event_date_id
      where r.token = $1 and e.slug = $2`,
    [token, slug],
  );
  if (!r) notFound();

  const event = { slug: r.slug, name: r.name, venue: r.venue, logo_url: r.logo_url, primary_color: r.primary_color };
  const date = { event_day: r.event_day, starts_at: r.starts_at, ends_at: r.ends_at, label: r.label };

  const ticket: TicketData = {
    token: r.token,
    status: r.status,
    fullName: r.full_name,
    documentType: r.document_type,
    documentNumber: r.document_number,
    company: r.company,
    companions: r.companions.map((c) => ({ fullName: c.full_name, checkedIn: c.checked_in })),
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
  const maskedEmail = r.email?.replace(/^(.)[^@]*/, "$1***") ?? null;

  return (
    <div style={brandStyle(event.primary_color)} className="min-h-dvh bg-slate-100 px-4 py-10">
      {(nuevo || ya) && (
        <div className="no-print mx-auto mb-8 max-w-md text-center">
          <CheckCircle2 className="mx-auto size-14 text-emerald-600" />
          <h1 className="mt-3 text-2xl font-bold">{ya ? "Ya confirmaste tu asistencia" : "¡Asistencia confirmada!"}</h1>
          {nuevo && maskedEmail && (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-slate-600">
              <Mail className="size-4" /> También enviamos tu ticket a {maskedEmail}
            </p>
          )}
          <p className="mt-2 text-sm text-slate-500">Guarda este código o toma una captura: lo escanearán en el ingreso. También puedes ingresar con tu DNI.</p>
        </div>
      )}
      <TicketCard ticket={ticket} />
      <p className="no-print mt-8 text-center text-sm">
        <Link href={`/evento/${event.slug}`} className="text-slate-500 underline-offset-4 hover:underline">
          Volver
        </Link>
      </p>
    </div>
  );
}
