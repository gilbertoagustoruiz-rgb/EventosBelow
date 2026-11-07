"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/** Refresca los datos del servidor cada `seconds` mientras la pestaña está visible. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [at, setAt] = useState(() => new Date());
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        setAt(new Date());
      }
    };
    const id = setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds]);
  return (
    <button
      type="button"
      onClick={() => { router.refresh(); setAt(new Date()); }}
      className="btn-ghost py-2"
      title={`Se actualiza cada ${seconds} s`}
    >
      <RefreshCw className="size-4" />
      Actualizado {at.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}
    </button>
  );
}
