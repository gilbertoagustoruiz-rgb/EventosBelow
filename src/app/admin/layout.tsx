import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { logout } from "@/app/login/actions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  // Los anfitriones solo acreditan: van directo al check-in
  if (!viewer.isPlatformAdmin && !viewer.memberships.some((m) => m.role === "CLIENT_ADMIN")) redirect("/login");

  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
          <Link href="/admin" className="font-bold tracking-tight">
            Eventos <span className="text-indigo-600">Below</span>
          </Link>
          <nav className="flex gap-1 text-sm">
            <Link href="/admin" className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">Eventos</Link>
            {viewer.isPlatformAdmin || viewer.memberships.some((m) => m.role === "CLIENT_ADMIN") ? (
              <Link href="/admin/clientes" className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                {viewer.isPlatformAdmin ? "Clientes" : "Equipo"}
              </Link>
            ) : null}
            <Link href="/admin/promotores" className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">Promotores</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-slate-500 sm:inline">{viewer.email}</span>
            {viewer.isPlatformAdmin && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">SuperAdmin</span>}
            <Link href="/cuenta" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Cambiar contraseña">
              <KeyRound className="size-4" />
            </Link>
            <form action={logout}>
              <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Cerrar sesión">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
