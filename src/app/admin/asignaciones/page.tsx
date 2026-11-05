import Link from "next/link";
import { Building2, X } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { ConfirmButton } from "@/components/admin/ui";
import { AssignForm } from "./form";
import { unassignEmployee } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Asignaciones" };

type Emp = { id: string; profile: "COORDINADOR" | "PROMOTOR"; full_name: string; document_number: string | null; email: string | null };

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  await requireAdmin();
  const { cliente } = await searchParams;

  const [tenants, employees, links] = await Promise.all([
    query<{ id: string; name: string; slug: string; events: number }>(
      `select t.id, t.name, t.slug, (select count(*) from events e where e.tenant_id = t.id)::int as events
         from tenants t where t.is_active order by t.name`,
    ),
    query<Emp>(
      `select id, profile, full_name, document_number, email
         from employees where is_active and profile in ('COORDINADOR', 'PROMOTOR') order by full_name`,
    ),
    query<{ employee_id: string; tenant_id: string }>(
      `select ec.employee_id, ec.tenant_id from employee_clients ec
         join employees e on e.id = ec.employee_id and e.is_active`,
    ),
  ]);

  const shown = cliente ? tenants.filter((t) => t.slug === cliente) : tenants;
  const byTenant = (tenantId: string, profile: Emp["profile"]) => {
    const ids = new Set(links.filter((l) => l.tenant_id === tenantId).map((l) => l.employee_id));
    const all = employees.filter((e) => e.profile === profile);
    return { assigned: all.filter((e) => ids.has(e.id)), available: all.filter((e) => !ids.has(e.id)) };
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Asignaciones</h1>
        <p className="mt-2 text-slate-600">
          Asigna coordinadores y promotores a cada cliente. Un coordinador solo gestiona los eventos de sus clientes y,
          en cada evento, elige promotores entre los asignados aquí.
        </p>
        {cliente && (
          <Link href="/admin/asignaciones" className="mt-3 inline-block text-sm text-indigo-700 underline">Ver todos los clientes</Link>
        )}
      </div>

      {tenants.length === 0 && (
        <div className="card p-8 text-center text-slate-500">
          Primero crea un cliente en <Link href="/admin/clientes" className="text-indigo-700 underline">Clientes</Link>.
        </div>
      )}

      {shown.map((t) => {
        const coord = byTenant(t.id, "COORDINADOR");
        const prom = byTenant(t.id, "PROMOTOR");
        return (
          <section key={t.id} className="card p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-slate-100"><Building2 className="size-5 text-slate-500" /></span>
              <div>
                <h2 className="font-semibold">{t.name}</h2>
                <p className="text-sm text-slate-500">{t.events} evento(s)</p>
              </div>
            </div>

            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              {[
                { title: "Coordinadores", label: "Coordinadores", group: coord, hint: "Sin coordinador: nadie del cliente puede organizar sus eventos." },
                { title: "Promotores", label: "Promotores", group: prom, hint: "Sin promotores: los coordinadores no podrán seleccionar ninguno." },
              ].map(({ title, label, group, hint }) => (
                <div key={title} className="rounded-xl border border-slate-200 p-4">
                  <h3 className="text-sm font-semibold">
                    {title} <span className="font-normal text-slate-400">({group.assigned.length})</span>
                  </h3>
                  <ul className="mt-2 divide-y divide-slate-100 text-sm">
                    {group.assigned.map((e) => (
                      <li key={e.id} className="flex items-center gap-2 py-2">
                        <span className="min-w-0 flex-1 truncate">
                          {e.full_name}
                          <span className="text-slate-400"> · {e.email ?? e.document_number}</span>
                        </span>
                        <form action={unassignEmployee}>
                          <input type="hidden" name="tenantId" value={t.id} />
                          <input type="hidden" name="employeeId" value={e.id} />
                          <ConfirmButton
                            message={`¿Quitar a ${e.full_name} de ${t.name}?${e.profile === "PROMOTOR" ? " Sus enlaces en eventos de este cliente dejarán de funcionar." : " Perderá el acceso a los eventos de este cliente."}`}
                            className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <X className="size-4" />
                            <span className="sr-only">Quitar a {e.full_name}</span>
                          </ConfirmButton>
                        </form>
                      </li>
                    ))}
                    {group.assigned.length === 0 && <li className="py-2 text-xs text-amber-700">{hint}</li>}
                  </ul>
                  <div className="mt-3">
                    <AssignForm
                      tenantId={t.id}
                      label={label}
                      options={group.available.map((e) => ({ id: e.id, full_name: e.full_name, detail: e.email ?? e.document_number ?? "" }))}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
