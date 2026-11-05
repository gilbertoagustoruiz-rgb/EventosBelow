"use client";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto grid min-h-[70dvh] max-w-lg place-content-center px-6 py-12 text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-50 text-amber-700"><RefreshCw className="size-7" /></span><h1 className="mt-5 text-2xl font-bold">No pudimos cargar esta página</h1><p className="mt-3 leading-relaxed text-slate-600">Puede ser una interrupción temporal. Revisa tu conexión y vuelve a intentarlo. Si acababas de inscribirte, revisa tu correo antes de repetir el registro.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><button onClick={reset} className="btn-dark">Volver a intentar</button><Link href="/" className="btn-ghost">Ir al inicio</Link></div></main>;
}
