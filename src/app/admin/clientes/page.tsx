import { notFound } from "next/navigation";
import { Building2, Trash2 } from "lucide-react";
import { adminTenantIds, requireViewer } from "@/lib/auth";
import { query } from "@/lib/db";
import { MemberForm, ResetPasswordButton, TenantForm } from "@/components/admin/tenant-forms";
import { ConfirmButton } from "@/components/admin/ui";
import { removeMember } from "../actions";
import type { MemberRole, Tenant } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clientes" };

export default async function TenantsPage() {
  const viewer = await requireViewer();
  const filter = viewer.isPlatformAdmin ? null : adminTenantIds(viewer);
  if (filter && filter.length === 0) notFound();

  const tenants = await query<Tenant>(
    "select * from tenants where ($1::uuid[] is null or id = any($1)) order by name",
    [filter],
  );
  const members = await query<{
    tenant_id: string;
    user_id: string;
    role: MemberRole;
    email: string;
    full_name: string | null;
    must_change_password: boolean;
    last_login_at: string | null;
  }>(
    `select m.tenant_id, m.user_id, m.role, u.email, u.full_name, u.must_change_password, u.last_login_at
       from tenant_members m join users u on u.id = m.user_id
      where m.tenant_id = any($1)
      order by u.email`,
    [tenants.map((t) => t.id)],
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{viewer.isPlatformAdmin ? "Clientes" : "Equipo"}</h1>
        <p className="text-slate-600">Clientes y coordinadores de BELOW GROUP. La acreditación funciona sin login mediante enlaces.</p>
      </div>

      {viewer.isPlatformAdmin && (
        <section className="card p-6">
          <h2 className="mb-4 font-semibold">Nuevo cliente</h2>
          <TenantForm />
        </section>
      )}

      {tenants.map((t) => {
        const ms = members.filter((m) => m.tenant_id === t.id);
        return (
          <section key={t.id} className="card p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-slate-100">
                <Building2 className="size-5 text-slate-500" />
              </span>
              <div>
                <h2 className="font-semibold">{t.name}</h2>
                <p className="text-sm text-slate-500">
                  {[t.tax_id && `RUC ${t.tax_id}`, t.contact_name, t.contact_email].filter(Boolean).join(" · ") || t.slug}
                </p>
              </div>
            </div>

            <ul className="mt-5 divide-y divide-slate-100 text-sm">
              {ms.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{m.full_name ? `${m.full_name} · ` : ""}{m.email}</p>
                    {m.must_change_password && <p className="text-xs text-amber-700">Aún no cambia su contraseña temporal</p>}
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {m.role === "CLIENT_ADMIN" ? "Coordinador" : "Acceso anterior (anfitrión)"}
                  </span>
                  {m.user_id !== viewer.userId && (
                    <>
                      <ResetPasswordButton tenantId={t.id} userId={m.user_id} />
                      <form action={removeMember}>
                        <input type="hidden" name="tenantId" value={t.id} />
                        <input type="hidden" name="userId" value={m.user_id} />
                        <ConfirmButton message="¿Quitar el acceso de este usuario?" className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="size-4" />
                        </ConfirmButton>
                      </form>
                    </>
                  )}
                </li>
              ))}
              {ms.length === 0 && <li className="py-2.5 text-slate-500">Sin usuarios asignados.</li>}
            </ul>

            <div className="mt-4">
              <MemberForm tenantId={t.id} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
