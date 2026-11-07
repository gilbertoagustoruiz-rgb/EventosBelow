import { redirect } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { adminTenantIds, requireViewer } from "@/lib/auth";
import { query } from "@/lib/db";
import { brandStyle } from "@/lib/format";
import { ReportLinks } from "@/components/admin/report-links";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reportes" };

/** Bases de confirmación y asistencia de cada evento (administrador y coordinador). */
export default async function ReportsPage() {
  const viewer = await requireViewer();
  if (!viewer.isPlatformAdmin && adminTenantIds(viewer).length === 0) redirect("/admin");
  const events = await query<{
    id: string; name: string; primary_color: string; logo_url: string | null; tenant_name: string; project_name: string;
    confirmed: number; entered: number;
  }>(
    `select e.id, e.name, e.primary_color, e.logo_url, t.name as tenant_name, p.name as project_name,
            (select count(*) from registrations r where r.event_id = e.id and r.status <> 'CANCELADO')::int as confirmed,
            (select count(r.holder_checked_in_at) + coalesce(sum((select count(*) from companions c where c.registration_id = r.id and c.checked_in_at is not null)), 0)
               from registrations r where r.event_id = e.id and r.status <> 'CANCELADO')::int as entered
       from events e
       join tenants t on t.id = e.tenant_id
       join projects p on p.id = e.project_id
      where ($1::uuid[] is null or e.tenant_id = any($1))
      order by e.created_at desc`,
    [viewer.isPlatformAdmin ? null : adminTenantIds(viewer)],
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reportes</h1>
        <p className="mt-2 text-slate-600">
          Descarga en Excel las bases de cada evento. Cada archivo lleva el logo y los colores del evento.
        </p>
      </div>
      {events.map((e) => (
        <section key={e.id} style={brandStyle(e.primary_color)} className="card p-5">
          <div className="mb-4 flex items-center gap-3">
            {e.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={e.logo_url} alt="" className="h-9 w-auto max-w-28 object-contain" />
            ) : (
              <span className="grid size-9 place-items-center rounded-lg bg-brand text-brand-fg"><FileSpreadsheet className="size-4" /></span>
            )}
            <div className="min-w-0">
              <h2 className="truncate font-semibold">{e.name}</h2>
              <p className="text-sm text-slate-500">{e.tenant_name} · {e.project_name}</p>
            </div>
          </div>
          <ReportLinks eventId={e.id} confirmed={e.confirmed} entered={e.entered} />
        </section>
      ))}
      {events.length === 0 && <p className="card p-8 text-center text-slate-500">Aún no hay eventos.</p>}
    </div>
  );
}
