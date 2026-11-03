import QRCode from "qrcode";

/** PNG del QR para el correo de confirmación (los clientes de correo no ejecutan JS). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/.test(token)) return new Response("Not found", { status: 404 });

  const png = await QRCode.toBuffer(token, { type: "png", width: 440, margin: 1, errorCorrectionLevel: "M" });
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
