import Link from "next/link";
import { CalendarPlus, FolderKanban } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { ConfirmButton } from "@/components/admin/ui";
import { toggleProject } from "./actions";
import { ProjectForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proyectos" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  await requireAdmin();
  const { cliente } = await searchParams;
  const tenants = await query<{ id: string; name: string; slug: string }>(
    "select id, name, slug from tenants where is_active order by name",
  );
  const projects = await query<{
    id: string; name: string; description: string | null; is_active: boolean;
    tenant_id: string; tenant_name: string; events: number;
  }>(
    `select p.id, p.name, p.description, p.is_active, p.tenant_id, t.name as tenant_name,
            (select count(*) from events e where e.project_id = p.id)::int as events
       from projects p join tenants t on t.id = p.tenant_id
      order by t.name, p.is_active desc, p.name`,
  );
  const grouped = tenants
    .map((t) => ({ tenant: t, list: projects.filter((p) => p.tenant_id === t.id) }))
    .filter((g) => g.list.length);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Proyectos</h1>
        <p className="mt-2 text-slate-600">Cada cliente agrupa sus eventos en proyectos: Cliente → Proyecto → Eventos.</p>
      </div>

      <section className="card p-6">
        <h2 className="mb-4 font-semibold">Nuevo proyecto</h2>
        {tenants.length ? (
          <ProjectForm tenants={tenants} defaultTenantId={tenants.find((t) => t.slug === cliente)?.id} />
        ) : (
          <p className="text-sm text-slate-600">Primero <Link href="/admin/clientes" className="text-indigo-700 underline">crea un cliente</Link>.</p>
        )}
      </section>

      {grouped.map(({ tenant, list }) => (
        <section key={tenant.id} className="space-y-3">
          <h2 className="text-lg font-semibold">{tenant.name}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {list.map((p) => (
              <article key={p.id} className={`card p-5 ${p.is_active ? "" : "opacity-60"}`}>
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100">
                    <FolderKanban className="size-5 text-slate-500" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{p.name}</h3>
                    <p className="text-sm text-slate-500">
                      {p.events} {p.events === 1 ? "evento" : "eventos"}
                      {!p.is_active && " · Archivado"}
                      {p.description && ` · ${p.description}`}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  {p.is_active ? (
                    <Link href={`/admin/eventos/nuevo?proyecto=${p.id}`} className="btn-ghost py-2">
                      <CalendarPlus className="size-4" /> Nuevo evento
                    </Link>
                  ) : <span />}
                  <form action={toggleProject}>
                    <input type="hidden" name="projectId" value={p.id} />
                    {p.is_active ? (
                      <ConfirmButton message={`¿Archivar «${p.name}»? Sus eventos se conservan, pero no se podrán crear nuevos en él.`} className="text-sm text-slate-500 hover:underline">Archivar</ConfirmButton>
                    ) : (
                      <button className="text-sm font-medium text-indigo-700 hover:underline">Reactivar</button>
                    )}
                  </form>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
