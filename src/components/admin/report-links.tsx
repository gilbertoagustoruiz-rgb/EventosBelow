import { CalendarCheck2, DoorOpen, Download } from "lucide-react";

/** Botones de descarga de las bases del evento (Excel con logo y colores del cliente). */
export function ReportLinks({ eventId, confirmed, entered }: { eventId: string; confirmed: number; entered: number }) {
  const items = [
    {
      href: `/admin/eventos/${eventId}/reportes/confirmacion`,
      icon: <CalendarCheck2 className="size-5" />,
      title: "Base de confirmación",
      hint: `${confirmed} ${confirmed === 1 ? "confirmado" : "confirmados"} · resumen por fecha, confirmados y pendientes`,
    },
    {
      href: `/admin/eventos/${eventId}/reportes/asistencia`,
      icon: <DoorOpen className="size-5" />,
      title: "Base de asistencia",
      hint: `${entered} ${entered === 1 ? "persona ingresó" : "personas ingresaron"} · resumen, asistentes con hora y quién acreditó, no asistieron`,
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((i) => (
        <a key={i.href} href={i.href} download className="group flex items-start gap-3 rounded-xl border border-slate-200 p-4 transition hover:border-brand hover:bg-brand/5">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand text-brand-fg">{i.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 font-semibold">{i.title} <Download className="size-4 text-slate-400 group-hover:text-brand" /></span>
            <span className="mt-0.5 block text-xs text-slate-500">{i.hint}</span>
          </span>
        </a>
      ))}
    </div>
  );
}
