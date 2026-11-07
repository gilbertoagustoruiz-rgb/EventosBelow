"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, CalendarDays, FileSpreadsheet, FolderKanban, Network, ScanLine, ShieldCheck, Users } from "lucide-react";

/** Menú según perfil: el administrador ve la configuración; coordinador y supervisor, sus eventos y acreditación. */
export function AdminNavigation({ platformAdmin, reports = platformAdmin }: { platformAdmin: boolean; reports?: boolean }) {
  const pathname = usePathname();
  const at = (prefix: string) => pathname.startsWith(prefix);
  const links = [
    { href: "/admin", label: platformAdmin ? "Eventos" : "Mis eventos", icon: CalendarDays, active: pathname === "/admin" || at("/admin/eventos") },
    ...(platformAdmin
      ? [
          { href: "/admin/clientes", label: "Clientes", icon: Building2, active: at("/admin/clientes") },
          { href: "/admin/proyectos", label: "Proyectos", icon: FolderKanban, active: at("/admin/proyectos") },
          { href: "/admin/empleados", label: "Empleados", icon: Users, active: at("/admin/empleados") },
          { href: "/admin/asignaciones", label: "Coordinadores", icon: Network, active: at("/admin/asignaciones") },
          { href: "/admin/perfiles", label: "Perfiles", icon: ShieldCheck, active: at("/admin/perfiles") },
        ]
      : []),
    ...(reports ? [{ href: "/admin/reportes", label: "Reportes", icon: FileSpreadsheet, active: at("/admin/reportes") }] : []),
    { href: "/checkin", label: "Acreditar asistentes", icon: ScanLine, active: false },
  ];
  return <nav aria-label="Administración" className="flex gap-2 overflow-x-auto pb-1">
    {links.map(({ href, label, icon: Icon, active }) => <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${active ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}><Icon className="size-4" />{label}</Link>)}
  </nav>;
}
