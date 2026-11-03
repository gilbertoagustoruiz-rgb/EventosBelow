import { notFound } from "next/navigation";
import { Building2, Trash2 } from "lucide-react";
import { canAdminTenant, requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MemberForm, TenantForm } from "@/components/admin/tenant-forms";
import { ConfirmButton } from "@/components/admin/ui";
import { removeMember } from "../actions";
import type { Tenant } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clientes" };

export default async function TenantsPage() {
  const viewer = await requireViewer();
  const supabase = await createClient();

  const { data } = await supabase.from("tenants").select("*").order("name").returns<Tenant[]>();
  const tenants = (data ?? []).filter((t) => canAdminTenant(viewer, t.id));
  if (!viewer.isPlatformAdmin && tenants.length === 0) notFound();

  const { data: members } = await supabase
    .from("tenant_members")
    .select("tenant_id, user_id, role")
    .in("tenant_id", tenants.map((t) => t.id));

  // Los correos viven en auth.users: se resuelven con service_role tras autorizar
  const emails = new Map<string, string>();
  const ids = new Set((members ?? []).map((m) => m.user_id as string));
  if (ids.size) {
    const admin = createAdminClient();
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
    users.users.forEach((u) => ids.has(u.id) && emails.set(u.id, u.email ?? ""));
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{viewer.isPlatformAdmin ? "Clientes" : "Equipo"}</h1>
        <p className="text-slate-600">Empresas cliente y los usuarios que administran o acreditan sus eventos.</p>
      </div>

      {viewer.isPlatformAdmin && (
        <section className="card p-6">
          <h2 className="mb-4 font-semibold">Nuevo cliente</h2>
          <TenantForm />
        </section>
      )}

      {tenants.map((t) => {
        const ms = (members ?? []).filter((m) => m.tenant_id === t.id);
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
                <li key={m.user_id} className="flex items-center gap-3 py-2.5">
                  <span className="flex-1">{emails.get(m.user_id) ?? m.user_id}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {m.role === "CLIENT_ADMIN" ? "Administrador" : "Anfitrión"}
                  </span>
                  {m.user_id !== viewer.userId && (
                    <form action={removeMember}>
                      <input type="hidden" name="tenantId" value={t.id} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <ConfirmButton message="¿Quitar el acceso de este usuario?" className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="size-4" />
                      </ConfirmButton>
                    </form>
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
