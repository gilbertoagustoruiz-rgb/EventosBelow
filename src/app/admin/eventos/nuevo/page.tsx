import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { projectOptions } from "@/lib/projects";
import { EventForm } from "@/components/admin/event-form";

export const metadata = { title: "Nuevo evento" };

export default async function NewEventPage({ searchParams }: { searchParams: Promise<{ proyecto?: string }> }) {
  const viewer = await requireViewer();
  if (!viewer.isPlatformAdmin && viewer.profile !== "COORDINADOR") redirect("/admin");
  const { proyecto } = await searchParams;
  const projects = await projectOptions(viewer);

  if (!projects.length) redirect(viewer.isPlatformAdmin ? "/admin/proyectos" : "/admin");

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" /> Eventos
      </Link>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Crea tu próximo evento</h1>
      <p className="mt-2 leading-relaxed text-slate-600">Elige el cliente y proyecto, completa la información y sube el logo. Después agregarás las fechas, la base de invitados y el personal de apoyo.</p>
      <ol aria-label="Pasos para publicar" className="mt-5 flex flex-wrap gap-2 text-xs font-semibold"><li className="rounded-full bg-indigo-100 px-3 py-2 text-indigo-700">1. Información e imagen</li><li className="rounded-full bg-slate-100 px-3 py-2 text-slate-600">2. Fechas y cupos</li><li className="rounded-full bg-slate-100 px-3 py-2 text-slate-600">3. Invitados y personal</li><li className="rounded-full bg-slate-100 px-3 py-2 text-slate-600">4. Publicar y compartir</li></ol>
      <div className="card mt-6 p-6 sm:p-8">
        <EventForm projects={projects} defaultProjectId={projects.find((p) => p.id === proyecto)?.id} />
      </div>
    </div>
  );
}
