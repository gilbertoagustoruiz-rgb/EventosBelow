export default function Loading() {
  return <div role="status" className="mx-auto max-w-5xl animate-pulse px-4 py-12"><span className="sr-only">Cargando, espera un momento…</span><div className="h-8 w-52 rounded-lg bg-slate-200" /><div className="mt-4 h-4 w-72 max-w-full rounded bg-slate-100" /><div className="mt-8 grid gap-4 sm:grid-cols-2">{[0,1].map((n) => <div key={n} className="h-56 rounded-2xl border border-slate-200 bg-white" />)}</div></div>;
}
