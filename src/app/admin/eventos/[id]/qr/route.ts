import QRCode from "qrcode";
import sharp from "sharp";
import { requireEvent } from "@/lib/auth";
import { appUrl, readableOn } from "@/lib/format";
import { fileName, loadLogo } from "@/lib/report-xlsx";

export const dynamic = "force-dynamic";

const SIZE = 2048; // px del PNG en alta definición
const LOGO_SHARE = 0.24; // el recuadro del logo ocupa el 24% del ancho (la corrección H tolera ~30%)

/**
 * GET /admin/eventos/:id/qr?formato=png|svg[&descargar=1]
 * QR del enlace de confirmación con el logo del evento al centro.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event } = await requireEvent(id, "admin");
  const url = new URL(req.url);
  const format = url.searchParams.get("formato") === "svg" ? "svg" : "png";
  const download = url.searchParams.has("descargar");
  const link = appUrl(`/evento/${event.slug}`);

  // Módulos en el color del evento si es oscuro (buen contraste para leer); si no, casi negro
  const brand = /^#[0-9a-f]{6}$/i.test(event.primary_color) ? event.primary_color : "#0f172a";
  const dark = readableOn(brand) === "#ffffff" ? brand : "#0f172a";

  const qrSvg = await QRCode.toString(link, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 4,
    color: { dark, light: "#ffffff" },
  });
  const viewBox = Number(qrSvg.match(/viewBox="0 0 (\d+) \d+"/)?.[1] ?? 0);

  const logo = await loadLogo(event.logo_url);
  let svg = qrSvg;
  if (logo && viewBox) {
    // Recuadro blanco redondeado al centro, alineado a la cuadrícula de módulos
    const box = Math.round(viewBox * LOGO_SHARE) | 1;
    const pos = (viewBox - box) / 2;
    const pad = box * 0.12;
    const inner = box - pad * 2;
    const scale = Math.min(inner / logo.width, inner / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    const href = `data:image/png;base64,${logo.buffer.toString("base64")}`;
    const badge =
      `<rect x="${pos}" y="${pos}" width="${box}" height="${box}" rx="${box * 0.16}" fill="#ffffff"/>` +
      `<image href="${href}" x="${(viewBox - w) / 2}" y="${(viewBox - h) / 2}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
    svg = qrSvg.replace("</svg>", `${badge}</svg>`);
  }
  svg = svg.replace("<svg ", `<svg width="${SIZE}" height="${SIZE}" `);

  const name = `QR-${fileName(event.name)}`;
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (download) headers["Content-Disposition"] = `attachment; filename="${name}.${format}"`;

  if (format === "svg") {
    return new Response(svg, { headers: { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" } });
  }
  const png = await sharp(Buffer.from(svg), { density: 300 }).resize(SIZE, SIZE).png({ compressionLevel: 9 }).toBuffer();
  return new Response(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png" } });
}
