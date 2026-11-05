import { queryOne } from "@/lib/db";

/** Sirve imágenes guardadas en la tabla assets (logos cuando no hay Spaces). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  const row = await queryOne<{ content_type: string; data: Buffer }>(
    "select content_type, data from assets where id = $1",
    [id],
  );
  if (!row) return new Response("Not found", { status: 404 });

  // Cada subida crea un id nuevo, así que la respuesta nunca cambia: caché de un año
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.content_type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
