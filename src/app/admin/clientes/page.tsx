import Link from "next/link";
import { Building2, CalendarDays, UserCog, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { TenantForm } from "@/components/admin/tenant-forms";
import type { Tenant } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clientes" };

export default async function TenantsPage() {
  await requireAdmin();
  const tenants = await query<Tenant & { coordinators: number; promoters: number; events: number }>(
    `select t.*,
            count(*) filter (where e.profile = 'COORDINADOR' and e.is_active)::int as coordinators,
            count(*) filter (where e.profile = 'PROMOTOR' and e.is_active)::int as promoters,
            (select count(*) from events ev where ev.tenant_id = t.id)::int as events
       from tenants t
       left join employee_clients ec on ec.tenant_id = t.id
       left join employees e on e.id = ec.employee_id
      group by t.id
      order by t.name`,
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Clientes</h1>
        <p className="mt-2 text-slate-600">Empresas para las que Below organiza eventos. Su personal se asigna en Asignaciones.</p>
      </div>

      <section className="card p-6">
        <h2 className="mb-4 font-semibold">Nuevo cliente</h2>
        <TenantForm />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {tenants.map((t) => (
          <article key={t.id} className="card p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100">
                <Building2 className="size-5 text-slate-500" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{t.name}</h2>
                <p className="truncate text-sm text-slate-500">
                  {[t.tax_id && `RUC ${t.tax_id}`, t.contact_name, t.contact_email].filter(Boolean).join(" · ") || t.slug}
                </p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              <Stat icon={<UserCog className="size-4" />} label="Coordinadores" value={t.coordinators} warn={t.coordinators === 0} />
              <Stat icon={<Users className="size-4" />} label="Promotores" value={t.promoters} warn={t.promoters === 0} />
              <Stat icon={<CalendarDays className="size-4" />} label="Eventos" value={t.events} />
            </dl>
            <Link href={`/admin/asignaciones?cliente=${t.slug}`} className="btn-ghost mt-4 w-full py-2">
              Gestionar asignaciones
            </Link>
          </article>
        ))}
        {tenants.length === 0 && <p className="card p-8 text-center text-slate-500 sm:col-span-2">Aún no hay clientes.</p>}
      </section>
    </div>
  );
}

function Stat({ icon, label, value, warn }: { icon: React.ReactNode; label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded-xl p-2 ${warn ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-700"}`}>
      <dt className="flex items-center justify-center gap-1 text-xs">{icon}{label}</dt>
      <dd className="text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );
}
