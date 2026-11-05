import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { AdminNavigation } from "@/components/admin/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  // Solo administradores generales y coordinadores con clientes asignados
  if (!viewer.isPlatformAdmin && viewer.memberships.length === 0) redirect("/login");

  return (
    <div className="min-h-dvh">
      <a href="#admin-content" className="sr-only z-50 rounded-lg bg-white p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Ir al contenido</a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <Link href="/admin" className="font-bold tracking-tight">
            Eventos <span className="text-indigo-600">Below</span>
          </Link>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-slate-500 sm:inline">{viewer.email}</span>
            <span className="hidden rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 sm:inline">{viewer.isPlatformAdmin ? "Administrador general" : "Coordinador"}</span>
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
        <div className="mx-auto max-w-6xl px-4 pb-3 sm:px-6"><AdminNavigation platformAdmin={viewer.isPlatformAdmin} /></div>
      </header>
      <main id="admin-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
