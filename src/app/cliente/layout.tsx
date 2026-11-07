import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { adminTenantIds, requireViewer } from "@/lib/auth";
import { logout } from "@/app/login/actions";

export const metadata = { title: { absolute: "Portal del cliente" }, robots: { index: false } };

/** Portal de solo lectura para el perfil Cliente (el administrador y el coordinador también pueden verlo). */
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  const isClient = viewer.profile === "CLIENTE" && !viewer.isPlatformAdmin;
  if (!isClient && !viewer.isPlatformAdmin && adminTenantIds(viewer).length === 0) redirect("/login");
  const company = isClient ? viewer.clientTenants.map((t) => t.tenant_name).join(" · ") : "Vista del cliente";

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/cliente" className="min-w-0">
            <span className="block truncate font-bold tracking-tight">{company}</span>
            <span className="block text-xs text-slate-500">Seguimiento de eventos</span>
          </Link>
          <div className="ml-auto flex items-center gap-1 text-sm">
            <span className="mr-2 hidden text-slate-500 sm:inline">{viewer.fullName ?? viewer.email ?? viewer.username}</span>
            {!isClient && <Link href="/admin" className="rounded-lg px-3 py-2 text-indigo-700 hover:bg-indigo-50">Volver al panel</Link>}
            <Link href="/cuenta" className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-slate-600 hover:bg-slate-100" aria-label="Mi cuenta y contraseña">
              <KeyRound className="size-4" />
              <span className="hidden sm:inline">Mi cuenta</span>
            </Link>
            <form action={logout}>
              <button className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-slate-600 hover:bg-slate-100" aria-label="Cerrar sesión">
                <LogOut className="size-4" />
                <span className="hidden sm:inline">Salir</span>
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
