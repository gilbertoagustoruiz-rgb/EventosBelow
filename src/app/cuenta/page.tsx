import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { getViewer } from "@/lib/auth";
import { PasswordForm } from "./password-form";
import Link from "next/link";

export const metadata = { title: "Mi cuenta" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="card w-full max-w-md p-6 sm:p-8">
        {!viewer.mustChangePassword && <Link href="/admin" className="mb-6 inline-flex min-h-11 items-center text-sm font-medium text-indigo-700">← Volver al panel</Link>}
        <KeyRound className="size-6 text-indigo-600" />
        <h1 className="mt-3 text-2xl font-bold">
          {viewer.mustChangePassword ? "Crea tu contraseña" : "Cambiar contraseña"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {viewer.mustChangePassword
            ? "Ingresaste con una contraseña temporal. Elige una propia para continuar."
            : viewer.email}
        </p>
        <PasswordForm />
      </div>
    </main>
  );
}
