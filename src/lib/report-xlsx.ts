import "server-only";
import ExcelJS from "exceljs";
import { queryOne } from "@/lib/db";
import { readableOn } from "@/lib/format";

/* -----------------------------------------------------------------------------
 * Reportes Excel con la identidad del cliente: logo del evento en cada hoja,
 * encabezados con el color del evento y filas alternadas en un tono claro.
 * --------------------------------------------------------------------------- */

export interface Brand {
  eventName: string;
  clientName: string;
  color: string; // #rrggbb
  logo: { buffer: Buffer; width: number; height: number } | null;
}

const argb = (hex: string) => "FF" + hex.replace("#", "").toUpperCase();

/** Mezcla el color con blanco (0 = color, 1 = blanco). */
function tint(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, "0");
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

/** Carga el logo (tabla assets o URL pública) como PNG para incrustarlo. Si falla, el reporte sale sin logo. */
export async function loadLogo(logoUrl: string | null): Promise<Brand["logo"]> {
  if (!logoUrl) return null;
  try {
    let data: Buffer | null = null;
    const asset = logoUrl.match(/\/api\/assets\/([0-9a-f-]{36})/i);
    if (asset) {
      const row = await queryOne<{ data: Buffer }>("select data from assets where id = $1", [asset[1]]);
      data = row?.data ?? null;
    } else if (/^https:\/\//.test(logoUrl)) {
      const res = await fetch(logoUrl, { signal: AbortSignal.timeout(8000) });
      if (res.ok) data = Buffer.from(await res.arrayBuffer());
    }
    if (!data) return null;
    const sharp = (await import("sharp")).default;
    const { data: png, info } = await sharp(data)
      .resize({ height: 160, width: 480, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { buffer: png, width: info.width, height: info.height };
  } catch (err) {
    console.error("[report] no se pudo cargar el logo", err);
    return null;
  }
}

export interface SheetSpec<T> {
  name: string;
  title: string;
  columns: { header: string; width: number; value: (row: T) => string | number | null; align?: "center" | "right" }[];
  rows: T[];
  empty?: string;
}

const HEADER_ROW = 6;

/** Agrega una hoja con logo, título, encabezados de color, filtros y paneles fijos. */
export function addBrandedSheet<T>(wb: ExcelJS.Workbook, brand: Brand, spec: SheetSpec<T>, subtitle: string) {
  const ws = wb.addWorksheet(spec.name, {
    views: [{ state: "frozen", ySplit: HEADER_ROW, showGridLines: false }],
    properties: { tabColor: { argb: argb(brand.color) } },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  ws.columns = spec.columns.map((c) => ({ width: c.width }));
  const lastCol = spec.columns.length;
  const fg = argb(readableOn(brand.color));
  const brandFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(brand.color) } };
  const zebra: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(tint(brand.color, 0.9)) } };

  // Banda superior: logo a la izquierda y títulos al lado
  for (let r = 1; r <= 4; r++) ws.getRow(r).height = 18;
  ws.getRow(5).height = 6;
  let textCol = 1;
  if (brand.logo) {
    const h = 64;
    const w = Math.round((brand.logo.width / brand.logo.height) * h);
    const id = wb.addImage({ buffer: brand.logo.buffer as never, extension: "png" });
    ws.addImage(id, { tl: { col: 0.15, row: 0.25 }, ext: { width: w, height: h }, editAs: "oneCell" });
    // Ancho que ocupa el logo, en columnas (≈ 7 px por unidad de ancho)
    let px = 0;
    while (textCol <= lastCol && px < w + 16) px += (spec.columns[textCol - 1].width ?? 10) * 7, textCol++;
    textCol = Math.min(textCol, Math.max(1, lastCol - 1));
  }
  const title = ws.getCell(1, textCol);
  title.value = spec.title;
  title.font = { bold: true, size: 16, color: { argb: argb(brand.color) } };
  const ev = ws.getCell(2, textCol);
  ev.value = brand.eventName;
  ev.font = { bold: true, size: 12, color: { argb: "FF0F172A" } };
  const sub = ws.getCell(3, textCol);
  sub.value = subtitle;
  sub.font = { size: 10, color: { argb: "FF64748B" } };
  // Línea de color bajo la banda
  for (let c = 1; c <= lastCol; c++) ws.getCell(5, c).fill = brandFill;

  const header = ws.getRow(HEADER_ROW);
  spec.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.fill = brandFill;
    cell.font = { bold: true, color: { argb: fg } };
    cell.alignment = { vertical: "middle", horizontal: c.align ?? "left", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: argb(brand.color) } } };
  });
  header.height = 30;

  spec.rows.forEach((row, i) => {
    const r = ws.getRow(HEADER_ROW + 1 + i);
    spec.columns.forEach((c, j) => {
      const cell = r.getCell(j + 1);
      cell.value = c.value(row) ?? "";
      cell.alignment = { vertical: "middle", horizontal: c.align ?? "left" };
      if (i % 2 === 1) cell.fill = zebra;
      cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } };
    });
  });
  if (spec.rows.length === 0 && spec.empty) {
    const cell = ws.getCell(HEADER_ROW + 1, 1);
    cell.value = spec.empty;
    cell.font = { italic: true, color: { argb: "FF64748B" } };
  }
  if (spec.rows.length) {
    ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW + spec.rows.length, column: lastCol } };
  }
  ws.headerFooter.oddFooter = `&L${brand.eventName.replace(/&/g, "&&")}&RPágina &P de &N`;
  return ws;
}

/** Nombre de archivo seguro. */
export function fileName(base: string) {
  return base.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
