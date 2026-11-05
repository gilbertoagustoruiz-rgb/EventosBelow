"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Building2, ScanLine } from "lucide-react";

export function AdminNavigation({ platformAdmin }: { platformAdmin: boolean }) {
  const pathname = usePathname();
  const links = [
    { href: "/admin", label: "Mis eventos", icon: CalendarDays, active: pathname === "/admin" || pathname.startsWith("/admin/eventos") },
    { href: "/admin/clientes", label: platformAdmin ? "Clientes y equipo" : "Mi equipo", icon: Building2, active: pathname.startsWith("/admin/clientes") },
    { href: "/checkin", label: "Acreditar asistentes", icon: ScanLine, active: false },
  ];
  return <nav aria-label="Administración" className="flex gap-2 overflow-x-auto pb-1">
    {links.map(({ href, label, icon: Icon, active }) => <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${active ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}><Icon className="size-4" />{label}</Link>)}
  </nav>;
}
