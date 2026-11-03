import Link from "next/link";
import { LayoutDashboard, ScanLine } from "lucide-react";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">Below Trade</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">Eventos Below</h1>
      <p className="mt-3 max-w-xl text-slate-600">
        Registro de asistentes con cupos por fecha, tickets con código QR y acreditación rápida el día del evento.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link href="/admin" className="card group p-6 transition hover:border-indigo-300 hover:shadow-md">
          <LayoutDashboard className="size-6 text-indigo-600" />
          <h2 className="mt-4 font-semibold">Panel de administración</h2>
          <p className="mt-1 text-sm text-slate-600">Clientes, eventos, fechas, aforo y exportación de registros.</p>
        </Link>
        <Link href="/checkin" className="card group p-6 transition hover:border-indigo-300 hover:shadow-md">
          <ScanLine className="size-6 text-indigo-600" />
          <h2 className="mt-4 font-semibold">Acreditación</h2>
          <p className="mt-1 text-sm text-slate-600">Escaneo de QR y búsqueda por DNI, nombre o correo.</p>
        </Link>
      </div>
    </main>
  );
}
