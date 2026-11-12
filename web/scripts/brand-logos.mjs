#!/usr/bin/env node
/**
 * Builds the logo variants for the brand kit from the master PNGs in public/brand/.
 * The mark's shape is never redrawn; only its colours are remapped:
 *
 *   lockup-primary  mint mark + cream "Floor" + mint "pad"   (on deep green)
 *   lockup-cream    one-colour cream                         (on photos / busy or dark backgrounds)
 *   lockup-green    one-colour deep green                    (on cream / light backgrounds)
 *   symbol-mint / symbol-cream / symbol-green                (the mark alone)
 *
 * Output: public/brand/kit/*.png (transparent). Re-run after changing the masters:
 *   node scripts/brand-logos.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "brand");
const out = path.join(root, "kit");
fs.mkdirSync(out, { recursive: true });

const CREAM = [234, 208, 172];
const DEEP = [15, 59, 44];

/** recolour every pixel; `pick(r,g,b)` returns the new rgb. Alpha is kept. */
async function recolor(src, dst, pick, scale = 2) {
  const img = sharp(path.join(root, src)).ensureAlpha();
  const meta = await img.metadata();
  // upscale with a smooth kernel first so the mark stays clean at kit sizes
  const { data, info } = await img
    .resize({ width: meta.width * scale, kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const [r, g, b] = pick(data[i], data[i + 1], data[i + 2]);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toFile(path.join(out, dst));
  console.log("wrote", dst, `${info.width}x${info.height}`);
}

// white "Floor" -> cream; the mint stays mint
const primary = (r, g, b) => {
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  if (chroma < 40) {
    const l = (r + g + b) / 3 / 255;
    return CREAM.map((c) => Math.round(c * (0.75 + 0.25 * l)));
  }
  return [r, g, b];
};
const solid = (rgb) => () => rgb;

await recolor("lockup.png", "lockup-primary.png", primary);
await recolor("lockup.png", "lockup-cream.png", solid(CREAM));
await recolor("lockup.png", "lockup-green.png", solid(DEEP));
await recolor("symbol.png", "symbol-mint.png", (r, g, b) => [r, g, b], 3);
await recolor("symbol.png", "symbol-cream.png", solid(CREAM), 3);
await recolor("symbol.png", "symbol-green.png", solid(DEEP), 3);
