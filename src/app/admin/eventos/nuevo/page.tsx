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
      <h1 className="mt-3 text-2xl font-bold">Nuevo evento</h1>
      <div className="card mt-6 p-6 sm:p-8">
        <EventForm tenants={tenants} />
      </div>
    </div>
  );
}
