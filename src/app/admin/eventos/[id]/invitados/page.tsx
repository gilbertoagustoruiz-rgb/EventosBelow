import Link from "next/link";
import { CheckCircle2, FileSpreadsheet, Search } from "lucide-react";
import { requireEvent } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { formatDayShort } from "@/lib/format";
import { ConfirmButton } from "@/components/admin/ui";
import { deleteInvitee } from "./actions";
import { InviteeForm } from "./form";

export const dynamic = "force-dynamic";
const PAGE = 200;

export default async function InviteesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ id }, { q }] = await Promise.all([params, searchParams]);
  const { event } = await requireEvent(id, "admin");
  const term = (q ?? "").trim().slice(0, 60);

  const totals = await queryOne<{ total: number; confirmed: number }>(
    `select count(*)::int as total,
            count(*) filter (where exists (select 1 from registrations r where r.invitee_id = i.id and r.status <> 'CANCELADO'))::int as confirmed
       from invitees i where i.event_id = $1`,
    [id],
  );
  const rows = await query<{
    id: string; full_name: string; document_type: string; document_number: string; employee_code: string | null;
    email: string | null; company: string | null; event_day: string | null; status: string | null;
  }>(
    `select i.id, i.full_name, i.document_type, i.document_number, i.employee_code, i.email, i.company,
            d.event_day::text, r.status
       from invitees i
       left join lateral (
         select r.event_date_id, r.status from registrations r
          where r.invitee_id = i.id and r.status <> 'CANCELADO' order by r.created_at desc limit 1
       ) r on true
       left join event_dates d on d.id = r.event_date_id
      where i.event_id = $1
        and ($2 = '' or i.full_name ilike '%' || $2 || '%' or i.document_number ilike $2 || '%'
             or i.employee_code ilike $2 || '%' or i.email ilike '%' || $2 || '%')
      order by i.full_name
      limit ${PAGE}`,
    [id, term],
  );

  return (
    <main className="space-y-6">
      <Link href={`/admin/eventos/${id}`} className="text-sm text-indigo-700 underline">Volver al evento</Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Base de invitados</h1>
          <p className="mt-1 text-slate-600">
            {event.name} · {totals?.total ?? 0} invitados · {totals?.confirmed ?? 0} confirmaron su día
          </p>
        </div>
        <Link href={`/admin/eventos/${id}/importar`} className="btn-dark">
          <FileSpreadsheet className="size-4" /> Cargar Excel
        </Link>
      </div>

      <section className="card p-6">
        <h2 className="mb-4 font-semibold">Agregar invitado</h2>
        <InviteeForm eventId={id} />
      </section>

      <section className="card overflow-hidden">
        <form className="flex gap-2 border-b border-slate-100 p-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input name="q" defaultValue={term} className="input pl-9" placeholder="Buscar por nombre, documento, código o correo" />
          </div>
          <button className="btn-ghost">Buscar</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="p-3">Nombre</th>
                <th className="p-3">Documento</th>
                <th className="p-3">Código</th>
                <th className="p-3">Correo</th>
                <th className="p-3">Confirmación</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-3 font-medium">{r.full_name}{r.company && <span className="block text-xs font-normal text-slate-500">{r.company}</span>}</td>
                  <td className="p-3">{r.document_type} {r.document_number}</td>
                  <td className="p-3">{r.employee_code ?? "—"}</td>
                  <td className="p-3">{r.email ?? <span className="text-slate-400">Sin correo</span>}</td>
                  <td className="p-3">
                    {r.event_day ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-4" /> {formatDayShort(r.event_day)}</span>
                    ) : (
                      <span className="text-slate-400">Pendiente</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <form action={deleteInvitee}>
                      <input type="hidden" name="eventId" value={id} />
                      <input type="hidden" name="inviteeId" value={r.id} />
                      <ConfirmButton message={`¿Quitar a ${r.full_name} de la base? Si ya confirmó, su inscripción se conserva.`}>Quitar</ConfirmButton>
                    </form>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">{term ? "Sin resultados." : "Aún no hay invitados. Carga un Excel o agrégalos uno a uno."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length === PAGE && <p className="border-t border-slate-100 p-3 text-center text-xs text-slate-500">Se muestran los primeros {PAGE}. Usa la búsqueda para encontrar a alguien.</p>}
      </section>
    </main>
  );
}
