import Link from "next/link";
import { Check, KeyRound, Link2, X } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { PROFILES, PROFILE_ORDER, hasLogin, type Profile } from "@/lib/profiles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Perfiles" };

export default async function ProfilesPage() {
  await requireAdmin();
  const counts = await query<{ profile: Profile; active: number; total: number }>(
    `select profile, count(*) filter (where is_active)::int as active, count(*)::int as total
       from employees group by profile`,
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Perfiles</h1>
        <p className="mt-2 text-slate-600">
          Cada empleado tiene uno de estos perfiles. Los permisos son fijos; el perfil se elige al crear el empleado.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {PROFILE_ORDER.map((p) => {
          const info = PROFILES[p];
          const c = counts.find((x) => x.profile === p);
          return (
            <section key={p} className="card flex flex-col p-6">
              <h2 className="text-lg font-semibold">{info.label}</h2>
              <p className="mt-1 text-sm text-slate-600">{info.summary}</p>
              <p className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                {hasLogin(p) ? <KeyRound className="size-4" /> : <Link2 className="size-4" />} {info.access}
              </p>

              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Puede</h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {info.can.map((item) => (
                  <li key={item} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{item}</li>
                ))}
              </ul>
              {info.cannot.length > 0 && (
                <>
                  <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">No puede</h3>
                  <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
                    {info.cannot.map((item) => (
                      <li key={item} className="flex gap-2"><X className="mt-0.5 size-4 shrink-0 text-red-500" />{item}</li>
                    ))}
                  </ul>
                </>
              )}

              <Link href={`/admin/empleados?perfil=${p}`} className="mt-auto pt-6 text-sm font-medium text-indigo-700">
                {c?.active ?? 0} activos{c && c.total > c.active ? ` · ${c.total - c.active} inactivos` : ""} → ver empleados
              </Link>
            </section>
          );
        })}
      </div>
    </div>
  );
}
