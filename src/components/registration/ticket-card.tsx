"use client";

import { useRef } from "react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { CalendarDays, CheckCircle2, Clock, Download, MapPin, Printer, User, UserPlus } from "lucide-react";
import { formatDay, formatTime } from "@/lib/format";
import { DOCUMENT_LABELS } from "@/lib/validation";
import type { DocumentType, RegistrationStatus } from "@/lib/types";

export interface TicketData {
  token: string;
  status: RegistrationStatus;
  fullName: string;
  documentType: DocumentType;
  documentNumber: string;
  company: string | null;
  companions: { fullName: string; checkedIn: boolean }[];
  eventName: string;
  venue: string | null;
  logoUrl: string | null;
  day: string;
  startsAt: string;
  endsAt: string;
  dateLabel: string | null;
  holderCheckedIn: boolean;
}

/** Ticket digital con QR. El QR contiene solo el token (32 hex), nunca datos personales. */
export function TicketCard({ ticket }: { ticket: TicketData }) {
  const canvasWrap = useRef<HTMLDivElement>(null);
  const code = ticket.token.slice(0, 8).toUpperCase();
  const cancelled = ticket.status === "CANCELADO";

  function downloadPng() {
    const canvas = canvasWrap.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `ticket-${code}.png`;
    a.click();
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <article className="overflow-hidden rounded-3xl bg-white shadow-xl ring-1 ring-slate-200">
        <div className="bg-brand px-6 py-5 text-brand-fg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest opacity-80">Ticket de acceso</p>
              <h2 className="mt-1 text-xl font-bold leading-tight">{ticket.eventName}</h2>
            </div>
            {ticket.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ticket.logoUrl} alt="" className="h-10 w-auto max-w-[96px] rounded bg-white/95 object-contain p-1" />
            )}
          </div>
        </div>

        <div className="space-y-3 px-6 pt-5 text-sm">
          <Row icon={<CalendarDays />}>
            <span>{formatDay(ticket.day)}</span>
            {ticket.dateLabel && <span className="text-slate-500"> · {ticket.dateLabel}</span>}
          </Row>
          <Row icon={<Clock />}>
            {formatTime(ticket.startsAt)} – {formatTime(ticket.endsAt)}
          </Row>
          {ticket.venue && <Row icon={<MapPin />}>{ticket.venue}</Row>}
        </div>

        {/* Perforación */}
        <div className="relative my-5 flex items-center" aria-hidden>
          <span className="-ml-3 size-6 rounded-full bg-slate-100" />
          <span className="flex-1 border-t-2 border-dashed border-slate-200" />
          <span className="-mr-3 size-6 rounded-full bg-slate-100" />
        </div>

        <div className="flex flex-col items-center px-6">
          <div className={`relative rounded-2xl border border-slate-200 p-3 ${cancelled ? "opacity-20" : ""}`}>
            <QRCodeSVG value={ticket.token} size={220} level="M" marginSize={1} />
          </div>
          {cancelled && <p className="mt-3 font-semibold text-red-600">Registro cancelado</p>}
          {ticket.holderCheckedIn && !cancelled && (
            <p className="mt-3 flex items-center gap-1.5 font-medium text-emerald-700">
              <CheckCircle2 className="size-4" /> Ingreso registrado
            </p>
          )}
          <p className="mt-2 font-mono text-sm tracking-[0.3em] text-slate-500">{code}</p>
        </div>

        <div className="mt-5 space-y-3 border-t border-slate-100 bg-slate-50 px-6 py-5 text-sm">
          <Row icon={<User />}>
            <span className="font-semibold">{ticket.fullName}</span>
            <span className="block text-slate-500">
              {DOCUMENT_LABELS[ticket.documentType]} {ticket.documentNumber}
              {ticket.company && ` · ${ticket.company}`}
            </span>
          </Row>
          {ticket.companions.map((c, i) => (
            <Row key={i} icon={<UserPlus />}>
              <span className="text-slate-500">Acompañante{ticket.companions.length > 1 ? ` ${i + 1}` : ""}: </span>
              <span className="font-medium">{c.fullName}</span>
              {c.checkedIn && <CheckCircle2 className="ml-1.5 inline size-3.5 text-emerald-600" aria-label="Ingresó" />}
            </Row>
          ))}
        </div>
      </article>

      <p className="no-print mt-5 rounded-xl border border-slate-200 bg-white p-4 text-center text-sm leading-relaxed text-slate-600">{cancelled ? "Este ticket fue cancelado. Contacta al organizador si necesitas ayuda." : "Guarda tu QR y preséntalo junto con tu documento al llegar al evento."}</p>
      <div className="no-print mt-4 grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={downloadPng} className="btn-ghost" disabled={cancelled}>
          <Download className="size-4" /> Descargar QR
        </button>
        <button type="button" onClick={() => window.print()} className="btn-ghost">
          <Printer className="size-4" /> Imprimir
        </button>
      </div>

      {/* Canvas oculto en alta resolución para la descarga */}
      <div ref={canvasWrap} className="hidden" aria-hidden>
        <QRCodeCanvas value={ticket.token} size={720} level="M" marginSize={2} />
      </div>
    </div>
  );
}

function Row({ icon, children }: { icon: React.ReactElement; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-slate-400 [&>svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
