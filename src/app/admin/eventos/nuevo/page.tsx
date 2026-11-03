import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { adminTenantIds, requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EventForm } from "@/components/admin/event-form";

export const metadata = { title: "Nuevo evento" };

export default async function NewEventPage() {
  const viewer = await requireViewer();
  const supabase = await createClient();

  let query = supabase.from("tenants").select("id, name").eq("is_active", true).order("name");
  if (!viewer.isPlatformAdmin) query = query.in("id", adminTenantIds(viewer));
  const { data: tenants } = await query;

  if (!tenants?.length) redirect(viewer.isPlatformAdmin ? "/admin/clientes" : "/admin");

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
