import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { PROFILES, PROFILE_ORDER, type Profile } from "@/lib/profiles";
import { ConfirmButton } from "@/components/admin/ui";
import { EditEmployee, EmployeeForm, ResetPassword } from "./forms";
import { setEmployeeActive } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Empleados" };

type Row = {
  id: string;
  profile: Profile;
  full_name: string;
  document_type: string;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  user_id: string | null;
  is_active: boolean;
  must_change_password: boolean | null;
  last_login_at: string | null;
  clients: string[] | null;
  events: number;
};

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ perfil?: string; q?: string }> }) {
  const viewer = await requireAdmin();
  const { perfil, q } = await searchParams;
  const profile = PROFILE_ORDER.includes(perfil as Profile) ? (perfil as Profile) : null;
  const term = q?.trim() || null;

  const [tenants, employees, counts] = await Promise.all([
    query<{ id: string; name: string }>("select id, name from tenants where is_active order by name"),
    query<Row>(
      `select e.id, e.profile, e.full_name, e.document_type, e.document_number, e.email, e.phone, e.user_id, e.is_active,
              u.must_change_password, u.last_login_at,
              array_remove(array_agg(distinct t.name), null) as clients,
              (select count(*) from event_promoters ep where ep.employee_id = e.id and ep.is_active)::int as events
         from employees e
         left join users u on u.id = e.user_id
         left join employee_clients ec on ec.employee_id = e.id
         left join tenants t on t.id = ec.tenant_id
        where ($1::employee_profile is null or e.profile = $1)
          and ($2::text is null or e.full_name ilike '%' || $2 || '%' or e.document_number ilike $2 || '%' or e.email ilike '%' || $2 || '%')
        group by e.id, u.must_change_password, u.last_login_at
        order by e.is_active desc, e.profile, e.full_name`,
      [profile, term],
    ),
    query<{ profile: Profile; n: number }>("select profile, count(*)::int n from employees where is_active group by profile"),
  ]);
  const countOf = (p: Profile) => counts.find((c) => c.profile === p)?.n ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Empleados</h1>
        <p className="mt-2 text-slate-600">
          Directorio único del personal de Below. Los administradores y coordinadores ingresan con correo y contraseña;
          los promotores acreditan con el enlace que reciben en cada evento.
        </p>
      </div>

      <section className="card p-6">
        <h2 className="mb-4 font-semibold">Nuevo empleado</h2>
        <EmployeeForm tenants={tenants} />
      </section>

      <section className="card p-6">
        <div className="flex flex-wrap items-center gap-2">
          <FilterLink label={`Todos (${counts.reduce((n, c) => n + c.n, 0)})`} href="/admin/empleados" active={!profile} />
          {PROFILE_ORDER.map((p) => (
            <FilterLink key={p} label={`${PROFILES[p].label} (${countOf(p)})`} href={`/admin/empleados?perfil=${p}`} active={profile === p} />
          ))}
          <form className="ml-auto">
            {profile && <input type="hidden" name="perfil" value={profile} />}
            <input name="q" defaultValue={term ?? ""} placeholder="Buscar nombre, DNI o correo" className="input py-2" />
          </form>
        </div>

        <ul className="mt-4 divide-y divide-slate-100">
          {employees.map((e) => (
            <li key={e.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 py-3 text-sm ${e.is_active ? "" : "opacity-60"}`}>
              <div className="min-w-56 flex-1">
                <p className="font-semibold">
                  {e.full_name}
                  {!e.is_active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Inactivo</span>}
                </p>
                <p className="text-slate-500">
                  {[e.document_number && `${e.document_type} ${e.document_number}`, e.email, e.phone].filter(Boolean).join(" · ") || "—"}
                </p>
                <p className="text-xs text-slate-500">
                  {e.profile === "ADMINISTRADOR"
                    ? "Acceso a todos los clientes"
                    : e.clients?.length
                      ? `Clientes: ${e.clients.join(", ")}`
                      : "Sin clientes asignados"}
                  {e.profile === "PROMOTOR" && ` · ${e.events} evento(s) activos`}
                  {e.user_id && e.must_change_password && " · aún no cambia su contraseña temporal"}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge[e.profile]}`}>{PROFILES[e.profile].label}</span>
              <EditEmployee employee={e} />
              {e.user_id && e.user_id !== viewer.userId && e.is_active && <ResetPassword id={e.id} />}
              {e.user_id !== viewer.userId && (
                <form action={setEmployeeActive}>
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="active" value={String(!e.is_active)} />
                  {e.is_active ? (
                    <ConfirmButton
                      message={`¿Desactivar a ${e.full_name}? ${e.user_id ? "Perderá el acceso al panel" : "Sus enlaces de acreditación dejarán de funcionar"} de inmediato.`}
                      className="min-h-9 rounded-lg px-2 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      Desactivar
                    </ConfirmButton>
                  ) : (
                    <button className="min-h-9 rounded-lg px-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">Reactivar</button>
                  )}
                </form>
              )}
            </li>
          ))}
          {employees.length === 0 && <li className="py-6 text-center text-slate-500">No hay empleados con ese filtro.</li>}
        </ul>
      </section>
    </div>
  );
}

const badge: Record<Profile, string> = {
  ADMINISTRADOR: "bg-indigo-50 text-indigo-700",
  COORDINADOR: "bg-sky-50 text-sky-700",
  PROMOTOR: "bg-emerald-50 text-emerald-700",
};

function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
    >
      {label}
    </Link>
  );
}
