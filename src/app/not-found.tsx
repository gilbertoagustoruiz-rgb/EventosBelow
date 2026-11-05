import Link from "next/link";
import { SearchX } from "lucide-react";
export default function NotFound() {
  return <main className="mx-auto grid min-h-[75dvh] max-w-lg place-content-center px-6 py-12 text-center"><SearchX className="mx-auto size-12 text-indigo-400" /><p className="mt-5 text-xs font-bold uppercase tracking-widest text-slate-500">Página no disponible</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Vamos a encontrar tu camino</h1><p className="mt-4 leading-relaxed text-slate-600">El enlace puede haber cambiado o requerir otro acceso. Si recibiste una invitación, pide al organizador que confirme el enlace.</p><Link href="/" className="btn-dark mx-auto mt-6">Ver eventos disponibles</Link></main>;
}
