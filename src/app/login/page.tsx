import { LoginForm } from "./login-form";

export const metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Solo rutas internas, para evitar open-redirects
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/admin";

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="card w-full max-w-sm p-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Eventos Below</p>
        <h1 className="mt-1 text-2xl font-bold">Ingresar</h1>
        <p className="mt-1 text-sm text-slate-600">Administradores y anfitriones de acreditación.</p>
        <LoginForm next={safeNext} />
      </div>
    </main>
  );
}
