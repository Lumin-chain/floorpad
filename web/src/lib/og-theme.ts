/**
 * Shared PCB theme for server-rendered share images (X preview + PNL card).
 * Mirrors the CSS tokens in globals.css; satori cannot read CSS variables.
 */
export const PCB = {
  board: "#0F3B2C",
  boardDeep: "#0A2B20",
  panel: "#0C3226",
  line: "#24543F",
  copperDim: "#7A5230",
  copper: "#B87333",
  copperBright: "#D98C53",
  gold: "#E6C14A",
  silver: "#C0C0C0",
  text: "#EAD0AC",
  muted: "#B8A58A",
  secondary: "#8FA08E",
  good: "#7DD3A8",
  goodTint: "#0E4A35",
  bad: "#F0907A",
  badTint: "#3A2019",
} as const;

/** Faint copper routing + vias, tiled over the board as an <img> layer. */
export function boardTracesSvg(width: number, height: number): string {
  const tile = `<path d='M0 40h90l30 30h80l20-20h100'/><path d='M40 0v60l40 40v90l-30 30v100'/><path d='M320 180h-70l-30 30h-90l-40 40H0'/><path d='M250 320v-60l-30-30v-70l30-30V0'/><g fill='#4E5232' stroke='none'><circle cx='120' cy='70' r='3.5'/><circle cx='80' cy='100' r='3.5'/><circle cx='220' cy='210' r='3.5'/><circle cx='250' cy='130' r='3.5'/></g>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'><defs><pattern id='t' width='320' height='320' patternUnits='userSpaceOnUse'><g fill='none' stroke='#2F4B31' stroke-width='2'>${tile}</g></pattern></defs><rect width='100%' height='100%' fill='url(#t)'/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 800; style: "normal" };
let fontCache: Promise<OgFont[]> | null = null;

/**
 * JetBrains Mono (400 + 800) for the share images. Fetched once per server process from
 * Google Fonts (TTF, which satori can parse); on any failure the images fall back to the
 * built-in sans font instead of erroring.
 */
export function loadMonoFonts(): Promise<OgFont[]> {
  if (!fontCache) {
    fontCache = (async () => {
      try {
        const css = await fetch("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;800", {
          signal: AbortSignal.timeout(2500),
        }).then((r) => r.text());
        const faces = [...css.matchAll(/font-weight:\s*(\d+);[\s\S]*?src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/g)];
        const fonts = await Promise.all(
          faces.map(async ([, w, url]) => ({
            name: "JetBrains Mono",
            data: await fetch(url, { signal: AbortSignal.timeout(2500) }).then((r) => r.arrayBuffer()),
            weight: (Number(w) >= 700 ? 800 : 400) as 400 | 800,
            style: "normal" as const,
          })),
        );
        return fonts;
      } catch {
        fontCache = null; // retry on the next request
        return [];
      }
    })();
  }
  return fontCache;
}

export const MONO_STACK = "'JetBrains Mono', monospace";
