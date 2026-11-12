/**
 * Floorpad theme for server-rendered share images (X preview + PNL card).
 * Mirrors the CSS tokens in globals.css; satori cannot read CSS variables.
 */
export const FP = {
  board: "#0F3B2C",
  boardDeep: "#0A2B20",
  panel: "#0C3226",
  panel2: "#134634",
  line: "#24543F",
  copperDim: "#7A5230",
  copper: "#B87333",
  copperBright: "#D98C53",
  gold: "#E6C14A",
  text: "#EAD0AC",
  muted: "#B8A58A",
  secondary: "#8FA08E",
  good: "#7DD3A8",
  goodTint: "#0E4A35",
  bad: "#F0907A",
  badTint: "#3A2019",
} as const;

/** Faint floor-tile grout lines, laid over the background as an <img> layer. */
export function floorTilesSvg(width: number, height: number): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'><defs><pattern id='t' width='64' height='64' patternUnits='userSpaceOnUse'><path d='M64 0H0V64' fill='none' stroke='#1F4A37' stroke-width='1.5'/></pattern></defs><rect width='100%' height='100%' fill='url(#t)'/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** A floor slab: copper planks with dark joints (satori-safe gradients). */
export const FLOOR_SLAB = `repeating-linear-gradient(90deg, rgba(10,43,32,0) 0px, rgba(10,43,32,0) 46px, rgba(10,43,32,0.55) 46px, rgba(10,43,32,0.55) 48px), linear-gradient(${"#D98C53"}, ${"#B87333"})`;

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
          signal: AbortSignal.timeout(6000),
        }).then((r) => r.text());
        const faces = [...css.matchAll(/font-weight:\s*(\d+);[\s\S]*?src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/g)];
        const fonts = await Promise.all(
          faces.map(async ([, w, url]) => ({
            name: "JetBrains Mono",
            data: await fetch(url, { signal: AbortSignal.timeout(6000) }).then((r) => r.arrayBuffer()),
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
