#!/usr/bin/env node
/**
 * Colour-grades the mascot art into the Floorpad palette so it sits in the page instead of
 * floating over it. Reads public/brand/{mascot-*,pnl-mascot-*,moji/face-*}.png and writes
 * graded copies to public/brand/graded/ (same file names). Re-run after changing the art:
 *
 *   node scripts/grade-mascots.mjs
 *
 * Grade: neon greens pulled toward the palette mint and muted; white sticker outline and
 * highlights turned into cream; pure black lifted to deep green; reds
 * (loss glow, mouths) desaturated. Alpha is untouched.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "brand");
const outDir = path.join(root, "graded");

const CREAM = [234, 208, 172];
const CREAM_HI = [246, 234, 212];
const DEEP = [8, 35, 26];
const MINT_HUE = 152;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

// Every pixel gets the hue grade, then smooth weights blend toward cream (light neutrals)
// and deep green (darks). No hard thresholds, so anti-aliased edges and JPEG-ish noise in
// the whites never speckle.
function grade([r, g, b]) {
  const [h, s, l] = rgbToHsl(r, g, b);
  let out = hueGrade(h, s, l);
  // chroma, not HSL saturation: near-white pixels have tiny chroma but can show high HSL s
  const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

  // white outline + highlights -> cream, keeping shading via lightness
  const wLight = smooth((l - 0.55) / 0.3) * smooth(1 - chroma / 0.32);
  if (wLight > 0) {
    // brightest whites go to a paler cream so gloves and shoes do not read as skin tone
    const target = mix(CREAM, CREAM_HI, smooth((l - 0.78) / 0.18)).map((c) => c * (0.84 + 0.16 * l));
    out = mix(out, target, wLight * 0.92);
  }

  // black linework + glasses -> deep green (no pure black)
  const wDark = smooth(1 - l / 0.24);
  if (wDark > 0) out = mix(out, DEEP, wDark * 0.8);

  return out;
}

function hueGrade(h, s, l) {
  let nh = h, ns = s, nl = l;
  if (h >= 75 && h <= 185) {
    // neon greens -> palette mint: pull hue toward 152, mute, settle brightness
    nh = h + (MINT_HUE - h) * 0.45;
    ns = s * 0.66;
    nl = l * 0.9 + 0.02;
  } else if (h < 25 || h > 330) {
    ns = s * 0.72; // reds (loss glow, mouth)
  } else {
    ns = s * 0.8;
  }
  return hslToRgb(nh, ns, nl);
}

async function run(rel) {
  const src = path.join(root, rel);
  const dst = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const [r, g, b] = grade([data[i], data[i + 1], data[i + 2]]);
    data[i] = Math.round(Math.max(0, Math.min(255, r)));
    data[i + 1] = Math.round(Math.max(0, Math.min(255, g)));
    data[i + 2] = Math.round(Math.max(0, Math.min(255, b)));
  }
  await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toFile(dst);
  console.log("graded", rel);
}

const files = [
  ...fs.readdirSync(root).filter((f) => /^(mascot-|pnl-mascot-).*\.png$/.test(f)),
  ...fs.readdirSync(path.join(root, "moji")).filter((f) => f.endsWith(".png")).map((f) => `moji/${f}`),
];
for (const f of files) await run(f);
