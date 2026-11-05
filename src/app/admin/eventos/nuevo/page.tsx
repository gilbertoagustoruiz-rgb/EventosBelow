import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { adminTenantIds, requireViewer } from "@/lib/auth";
import { query } from "@/lib/db";
import { EventForm } from "@/components/admin/event-form";

export const metadata = { title: "Nuevo evento" };

export default async function NewEventPage() {
  const viewer = await requireViewer();
  const tenants = await query<{ id: string; name: string }>(
    `select id, name from tenants where is_active and ($1::uuid[] is null or id = any($1)) order by name`,
    [viewer.isPlatformAdmin ? null : adminTenantIds(viewer)],
  );

  if (!tenants.length) redirect(viewer.isPlatformAdmin ? "/admin/clientes" : "/admin");

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" /> Eventos
      </Link>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Crea tu próximo evento</h1>
      <p className="mt-2 leading-relaxed text-slate-600">Completa la información y sube el logo de la empresa. Después podrás agregar las fechas y compartir el enlace de inscripción.</p>
      <ol aria-label="Pasos para publicar" className="mt-5 flex flex-wrap gap-2 text-xs font-semibold"><li className="rounded-full bg-indigo-100 px-3 py-2 text-indigo-700">1. Información e imagen</li><li className="rounded-full bg-slate-100 px-3 py-2 text-slate-600">2. Fechas y cupos</li><li className="rounded-full bg-slate-100 px-3 py-2 text-slate-600">3. Publicar y compartir</li></ol>
      <div className="card mt-6 p-6 sm:p-8">
        <EventForm tenants={tenants} />
      </div>
    </div>
  );
}
