"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Search, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { addStaff, setStaffActive } from "./staff-actions";
import type { FormState } from "@/app/admin/actions";
import { ConfirmButton, FormMessage, SubmitButton } from "@/components/admin/ui";

export interface StaffMember {
  id: string;
  employee_id: string;
  role: "SUPERVISOR" | "PROMOTOR";
  full_name: string;
  document_number: string | null;
  is_active: boolean;
  has_user: boolean;
  checkins: number;
  persons: number;
  last_at: string | null;
}

export interface StaffCandidate {
  id: string;
  profile: "SUPERVISOR" | "PROMOTOR";
  full_name: string;
  document_number: string | null;
  email: string | null;
}

/** Personal de apoyo del evento. `canManageSupervisors` = coordinador/administrador. */
export function EventStaff({
  eventId,
  staff,
  candidates,
  canManageSupervisors,
}: {
  eventId: string;
  staff: StaffMember[];
  candidates: StaffCandidate[];
  canManageSupervisors: boolean;
}) {
  const groups: { role: StaffMember["role"]; title: string; icon: React.ReactNode; editable: boolean }[] = [
    { role: "SUPERVISOR", title: "Supervisores", icon: <ShieldCheck className="size-4" />, editable: canManageSupervisors },
    { role: "PROMOTOR", title: "Promotores", icon: <Users className="size-4" />, editable: true },
  ];
  return (
    <section id="personal" className="card p-4 sm:p-6">
      <h2 className="text-lg font-semibold">Personal de apoyo</h2>
      <p className="mt-1 text-sm text-slate-500">
        Ingresan con su DNI o correo y contraseña, y solo ven los eventos donde están agregados.
        {canManageSupervisors ? " Los supervisores pueden agregar o quitar promotores." : " Como supervisor, puedes agregar o quitar promotores."}
      </p>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        {groups.map((g) => {
          const members = staff.filter((s) => s.role === g.role);
          const active = members.filter((m) => m.is_active);
          const taken = new Set(active.map((m) => m.employee_id));
          const options = candidates.filter((c) => c.profile === g.role && !taken.has(c.id));
          return (
            <div key={g.role} className="rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                {g.icon} {g.title} <span className="font-normal text-slate-400">({active.length})</span>
              </h3>
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {members.map((m) => (
                  <li key={m.id} className={`flex items-center gap-2 py-2 ${m.is_active ? "" : "opacity-50"}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{m.full_name}</span>
                      <span className="block text-xs text-slate-500">
                        {m.document_number ? `DNI ${m.document_number} · ` : ""}
                        {m.checkins} {m.checkins === 1 ? "ingreso" : "ingresos"} ({m.persons} personas)
                        {!m.has_user && " · sin acceso creado"}
                        {!m.is_active && " · retirado"}
                      </span>
                    </span>
                    {g.editable && (
                      <form action={setStaffActive}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="active" value={String(!m.is_active)} />
                        {m.is_active ? (
                          <ConfirmButton
                            message={`¿Quitar a ${m.full_name} del evento? Dejará de poder acreditar; su gestión se conserva.`}
                            className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <X className="size-4" />
                            <span className="sr-only">Quitar a {m.full_name}</span>
                          </ConfirmButton>
                        ) : (
                          <button className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50">Volver a agregar</button>
                        )}
                      </form>
                    )}
                  </li>
                ))}
                {members.length === 0 && <li className="py-2 text-xs text-amber-700">Aún no hay {g.title.toLowerCase()} en este evento.</li>}
              </ul>
              {g.editable && <AddStaffForm eventId={eventId} role={g.role} options={options} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AddStaffForm({ eventId, role, options }: { eventId: string; role: StaffMember["role"]; options: StaffCandidate[] }) {
  const [state, action] = useActionState<FormState, FormData>(addStaff, {});
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) { ref.current?.reset(); setFilter(""); } }, [state]);
  const term = filter.trim().toLowerCase();
  const shown = term
    ? options.filter((o) => o.full_name.toLowerCase().includes(term) || o.document_number?.includes(term) || o.email?.includes(term))
    : options;
  const label = role === "SUPERVISOR" ? "supervisores" : "promotores";

  return (
    <div className="mt-3 space-y-2">
      {options.length === 0 ? (
        <p className="text-xs text-slate-500">No hay más {label} activos en el directorio. El administrador los crea en Empleados.</p>
      ) : (
        <form ref={ref} action={action} className="space-y-2">
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="role" value={role} />
          {options.length > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} className="input py-2 pl-9" placeholder={`Buscar ${label} por nombre o DNI`} aria-label={`Buscar ${label}`} />
            </div>
          )}
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-100 p-2">
            {shown.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" name="employeeId" value={o.id} className="size-4" />
                <span className="min-w-0 flex-1 truncate">{o.full_name}</span>
                <span className="text-xs text-slate-400">{o.document_number ?? o.email}</span>
              </label>
            ))}
            {shown.length === 0 && <p className="px-2 py-1.5 text-xs text-slate-500">Sin resultados.</p>}
          </div>
          <SubmitButton className="btn-ghost w-full py-2" pendingLabel="Agregando…">
            <UserPlus className="size-4" /> Agregar al evento
          </SubmitButton>
        </form>
      )}
      <FormMessage state={state} />
    </div>
  );
}
