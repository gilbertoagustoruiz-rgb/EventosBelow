import Link from "next/link";
import { requireEvent } from "@/lib/auth";
import { ImportForm } from "./form";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event } = await requireEvent(id, "admin");
  return (
    <main className="space-y-6">
      <Link href={`/admin/eventos/${id}/invitados`} className="text-sm text-indigo-700 underline">Volver a invitados</Link>
      <div>
        <h1 className="text-2xl font-bold">Cargar base de invitados</h1>
        <p className="mt-2 text-slate-600">
          {event.name}: solo las personas de esta base podrán confirmar su asistencia con su DNI o código de vendedor.
          Revisa la vista previa antes de guardar.
        </p>
      </div>
      <section className="card p-6"><ImportForm eventId={id} /></section>
    </main>
  );
}
