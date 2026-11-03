import { NextResponse } from "next/server";
import { getPublicDates, getPublicEvent } from "@/lib/public-events";

export const dynamic = "force-dynamic";

/** Cupos restantes por fecha. El formulario lo consulta periódicamente. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getPublicEvent(slug);
  if (!event) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const dates = await getPublicDates(event);
  return NextResponse.json(
    { open: event.registration_open, dates: dates.map((d) => ({ id: d.id, remaining: d.remaining })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
