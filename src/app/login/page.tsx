import { LoginForm } from "./login-form";
import Link from "next/link";
import { ArrowLeft, CalendarDays } from "lucide-react";

export const metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Solo rutas internas, para evitar open-redirects
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/admin";

  return (
    <main className="grid min-h-dvh place-items-center bg-[radial-gradient(ellipse_at_top,#e0e7ff,transparent_65%)] px-4 py-10">
      <div className="w-full max-w-md">
      <Link href="/" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-600 hover:text-indigo-700"><ArrowLeft className="size-4" /> Volver a los eventos</Link>
      <div className="card p-6 sm:p-9">
        <span className="mb-6 grid size-12 place-items-center rounded-2xl bg-indigo-600 text-white"><CalendarDays className="size-6" /></span>
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Eventos Below · Administración</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Bienvenido de nuevo</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">Ingresa con la cuenta de tu equipo para organizar eventos y gestionar las inscripciones.</p>
        <LoginForm next={safeNext} />
      </div>
      <p className="mt-6 text-center text-sm text-slate-500">¿Vienes como asistente? <Link href="/" className="font-semibold text-indigo-700 underline underline-offset-4">Inscríbete sin crear una cuenta</Link></p>
      </div>
    </main>
  );
}
