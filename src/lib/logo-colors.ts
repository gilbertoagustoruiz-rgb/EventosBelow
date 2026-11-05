/** Paleta cuantizada: ignora transparencia y prioriza tinta de marca sobre fondos neutros. */
export function logoPalette(pixels: ArrayLike<number>): string[] {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number; saturation: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 192) continue;
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (min > 238) continue;
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    const entry = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, saturation: 0 };
    entry.count++; entry.r += r; entry.g += g; entry.b += b;
    entry.saturation += max === 0 ? 0 : (max - min) / max;
    buckets.set(key, entry);
  }
  const all = [...buckets.values()];
  const total = all.reduce((sum, e) => sum + e.count, 0);
  const colored = all.filter((e) => e.saturation / e.count > 0.2 && e.count >= Math.max(2, total * 0.005));
  const candidates = (colored.length ? colored : all).sort((a, b) =>
    b.count * (1 + b.saturation / b.count) - a.count * (1 + a.saturation / a.count));
  const chosen: number[][] = [];
  for (const e of candidates) {
    const rgb = [e.r, e.g, e.b].map((v) => Math.round(v / e.count));
    if (chosen.some((c) => Math.hypot(...c.map((v, i) => v - rgb[i])) < 65)) continue;
    chosen.push(rgb);
    if (chosen.length === 5) break;
  }
  return chosen.map((rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join(""));
}

/** Procesa únicamente la imagen elegida; no envía el logo a servicios externos. */
export async function extractLogoPalette(file: File): Promise<string[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 160 / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No se pudo analizar el logo");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return logoPalette(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  } finally {
    URL.revokeObjectURL(url);
  }
}
