import Link from "next/link";
import { ChevronRight, ScanLine } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDayShort, todayIn } from "@/lib/format";

export const metadata = { title: "Acreditación" };
export const dynamic = "force-dynamic";

/** Lista de eventos que el anfitrión puede acreditar (RLS filtra por tenant). */
export default async function CheckinIndex() {
  await requireViewer();
  const supabase = await createClient();
  const { data: events } = await supabase
    .from("events")
    .select("id, name, timezone, primary_color, tenants(name), event_dates(event_day)")
    .order("created_at", { ascending: false });

  const list = (events ?? [])
    .map((e) => {
      const today = todayIn(e.timezone);
      const days = (e.event_dates as { event_day: string }[]).map((d) => d.event_day).sort();
      const next = days.find((d) => d >= today);
      return { ...e, next, isToday: next === today };
    })
    .filter((e) => e.next)
    .sort((a, b) => a.next!.localeCompare(b.next!));

  return (
    <main className="mx-auto min-h-dvh max-w-xl bg-slate-950 px-4 py-8 text-white">
      <ScanLine className="size-7 text-emerald-400" />
      <h1 className="mt-3 text-2xl font-bold">Acreditación</h1>
      <p className="mt-1 text-slate-400">Elige el evento que vas a acreditar.</p>

      <ul className="mt-6 space-y-2">
        {list.map((e) => (
          <li key={e.id}>
            <Link href={`/checkin/${e.id}`} className="flex items-center gap-4 rounded-xl bg-white/5 p-4 transition hover:bg-white/10">
              <span className="size-3 shrink-0 rounded-full" style={{ background: e.primary_color }} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{e.name}</p>
                <p className="text-sm text-slate-400">
                  {(e.tenants as unknown as { name: string } | null)?.name} · {formatDayShort(e.next!)}
                </p>
              </div>
              {e.isToday && <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300">Hoy</span>}
              <ChevronRight className="size-5 text-slate-500" />
            </Link>
          </li>
        ))}
        {list.length === 0 && <p className="rounded-xl bg-white/5 p-6 text-center text-slate-400">No tienes eventos próximos asignados.</p>}
      </ul>
    </main>
  );
}
