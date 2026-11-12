/**
 * Brand kit: every downloadable brand and social asset, rendered server-side with next/og at its
 * platform's exact size. Shares the share-image theme (og-theme.ts) so the kit, the link preview
 * and the site all draw the same floor motif: tiled background, copper floor planks, and the
 * rising stack of floor slabs (one per source that feeds the vault) with the mascot on top.
 *
 * Served by app/brand/assets/[name]/route.tsx; listed and explained on the /brand page.
 */
import fs from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { FLOOR_SLAB, floorTilesSvg, FP } from "@/lib/og-theme";

export const LOGO_MINT = "#68F09E";

function brandPng(rel: string): string {
  const p = path.join(process.cwd(), "public", "brand", rel);
  return `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
}

/**
 * "source | where it goes". Deliberately no percentages: brand assets stay up for months while
 * fees and splits are set per token and by DAO vote, so the kit names the sources and the
 * /docs page carries the current numbers.
 */
export const FLOOR_SLABS: [string, string][] = [
  ["BUY TAX", "→ FLOOR"],
  ["SELL TAX", "→ FLOOR"],
  ["EXIT FEE", "→ FLOOR"],
  ["GRADUATION", "→ FLOOR"],
  ["LiNEAR YIELD", "BY VOTE"],
];

// ---------- building blocks (all absolutely positioned) ----------

function Board({ w, h, children }: { w: number; h: number; children: React.ReactNode }) {
  return (
    <div style={{ width: w, height: h, display: "flex", position: "relative", backgroundColor: FP.board, color: FP.text, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden" }}>
      <img src={floorTilesSvg(w, h)} width={w} height={h} alt="" style={{ position: "absolute", top: 0, left: 0 }} />
      {children}
    </div>
  );
}

function Planks({ top, h }: { top: number; h: number }) {
  return <div style={{ position: "absolute", left: 0, right: 0, top, height: h, backgroundImage: FLOOR_SLAB }} />;
}

function Stack({
  left,
  base,
  width,
  slabH,
  step,
  font,
  labels = true,
}: {
  left: number;
  base: number;
  width: number;
  slabH: number;
  step: number;
  font: number;
  labels?: boolean;
}) {
  return (
    <>
      {FLOOR_SLABS.map(([label, value], i) => {
        const inset = i * step;
        const top = i === FLOOR_SLABS.length - 1;
        return (
          <div
            key={label}
            style={{
              position: "absolute",
              left: left + inset,
              width: width - inset * 2,
              top: base - (i + 1) * slabH,
              height: slabH - Math.max(3, Math.round(slabH / 12)),
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: `0 ${Math.round(font * 0.9)}px`,
              borderRadius: Math.max(4, Math.round(slabH / 8)),
              borderTop: `${Math.max(3, Math.round(slabH / 10))}px solid ${FP.copper}`,
              backgroundColor: top ? FP.copperBright : FP.panel2,
              color: top ? FP.board : FP.text,
              fontSize: font,
              fontWeight: 800,
              letterSpacing: "0.04em",
            }}
          >
            {labels && <span>{label}</span>}
            {labels && <span style={{ color: top ? FP.board : FP.gold }}>{value}</span>}
          </div>
        );
      })}
    </>
  );
}

/** mascot standing with its feet on y = `stand` */
function MascotOn({ pose, cx, stand, w }: { pose: "cool" | "hero" | "wink" | "flag"; cx: number; stand: number; w: number }) {
  const ratio = { cool: 148 / 154, hero: 220 / 186, wink: 155 / 143, flag: 153 / 187 }[pose];
  const h = Math.round(w * ratio);
  return <img src={brandPng(`graded/mascot-${pose}.png`)} width={w} height={h} alt="" style={{ position: "absolute", left: cx - w / 2, top: stand - h + 2 }} />;
}

function Lockup({ left, top, w }: { left: number; top: number; w: number }) {
  return <img src={brandPng("kit/lockup-primary.png")} width={w} height={Math.round((w * 258) / 1546)} alt="" style={{ position: "absolute", left, top }} />;
}

function Text({ style, children }: { style: Record<string, unknown>; children: React.ReactNode }) {
  return <div style={{ position: "absolute", display: "flex", flexWrap: "wrap", ...style }}>{children}</div>;
}

const floor = <span style={{ color: FP.copperBright }}>floor.</span>;

// ---------- the assets ----------

export interface KitAsset {
  name: string;
  title: string;
  use: string;
  w: number;
  h: number;
  render: () => ReactElement;
}

export const KIT: KitAsset[] = [
  {
    name: "x-header",
    title: "X header",
    use: "X / Twitter profile header. Content sits right of the profile-picture overlap (bottom-left).",
    w: 1500,
    h: 500,
    render: () => (
      <Board w={1500} h={500}>
        <Planks top={452} h={48} />
        <Lockup left={300} top={96} w={520} />
        <Text style={{ left: 300, top: 214, fontSize: 50, fontWeight: 800, letterSpacing: "-0.02em" }}>
          <span>Every meme gets a&nbsp;</span>
          {floor}
        </Text>
        <Text style={{ left: 300, top: 288, width: 640, fontSize: 22, color: FP.muted, lineHeight: 1.45 }}>
          Meme launchpad on NEAR. Every trade lays another layer under a redeemable vault.
        </Text>
        <Text style={{ left: 300, top: 376, fontSize: 20, fontWeight: 800, color: FP.gold, letterSpacing: "0.06em" }}>USEFLOORPAD.FUN</Text>
        <Stack left={1010} base={452} width={400} slabH={44} step={12} font={15} />
        <MascotOn pose="cool" cx={1210} stand={452 - 5 * 44} w={128} />
      </Board>
    ),
  },
  {
    name: "avatar-mascot",
    title: "Profile picture, mascot",
    use: "Default avatar for X, Telegram and Discord. Composed for a circle crop.",
    w: 400,
    h: 400,
    render: () => (
      <Board w={400} h={400}>
        <Planks top={292} h={108} />
        <MascotOn pose="cool" cx={200} stand={294} w={236} />
      </Board>
    ),
  },
  {
    name: "avatar-logo",
    title: "Profile picture, logo",
    use: "Alternative avatar using the mark. Circle-safe.",
    w: 400,
    h: 400,
    render: () => (
      <Board w={400} h={400}>
        <Planks top={300} h={100} />
        <img src={brandPng("kit/symbol-mint.png")} width={250} height={145} alt="" style={{ position: "absolute", left: 75, top: 112 }} />
      </Board>
    ),
  },
  {
    name: "square-post",
    title: "Square post",
    use: "Announcements and feed posts on X, Instagram and Telegram (1080 × 1080).",
    w: 1080,
    h: 1080,
    render: () => (
      <Board w={1080} h={1080}>
        <Planks top={990} h={90} />
        <Lockup left={80} top={80} w={400} />
        <Text style={{ left: 80, top: 200, width: 900, fontSize: 92, fontWeight: 800, lineHeight: 1.05, letterSpacing: "-0.03em" }}>
          <span>Every meme gets a&nbsp;</span>
          {floor}
        </Text>
        <Text style={{ left: 80, top: 432, width: 860, fontSize: 32, color: FP.muted, lineHeight: 1.45 }}>
          Late buyers stop being exit liquidity: every trade lays another layer under a redeemable NEAR vault.
        </Text>
        <Text style={{ left: 80, top: 900, fontSize: 28, fontWeight: 800, color: FP.gold, letterSpacing: "0.06em" }}>USEFLOORPAD.FUN</Text>
        <Stack left={540} base={990} width={460} slabH={56} step={14} font={18} />
        <MascotOn pose="cool" cx={770} stand={990 - 5 * 56} w={170} />
      </Board>
    ),
  },
  {
    name: "story",
    title: "Story",
    use: "Vertical stories and status posts (Instagram, Telegram, WhatsApp), 1080 × 1920.",
    w: 1080,
    h: 1920,
    render: () => (
      <Board w={1080} h={1920}>
        <Planks top={1760} h={160} />
        <Lockup left={270} top={150} w={540} />
        <div style={{ position: "absolute", left: 0, top: 360, width: 1080, display: "flex", flexDirection: "column", alignItems: "center", fontSize: 104, fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.03em" }}>
          <span>Every meme</span>
          <span style={{ display: "flex" }}>
            <span>gets a&nbsp;</span>
            {floor}
          </span>
        </div>
        <Text style={{ left: 120, top: 640, width: 840, fontSize: 36, color: FP.muted, lineHeight: 1.45, justifyContent: "center", textAlign: "center" }}>
          Late buyers stop being exit liquidity. Every trade lays another layer under a redeemable NEAR vault.
        </Text>
        <Text style={{ left: 0, top: 860, width: 1080, fontSize: 34, fontWeight: 800, color: FP.gold, letterSpacing: "0.06em", justifyContent: "center" }}>USEFLOORPAD.FUN</Text>
        <Stack left={200} base={1760} width={680} slabH={76} step={20} font={24} />
        <MascotOn pose="cool" cx={540} stand={1760 - 5 * 76} w={250} />
      </Board>
    ),
  },
  {
    name: "community-banner",
    title: "Community banner",
    use: "Discord server banner and Telegram channel header (960 × 540).",
    w: 960,
    h: 540,
    render: () => (
      <Board w={960} h={540}>
        <Planks top={482} h={58} />
        <Lockup left={56} top={150} w={400} />
        <Text style={{ left: 56, top: 238, width: 470, fontSize: 38, fontWeight: 800, letterSpacing: "-0.02em" }}>
          <span>Every meme gets a&nbsp;</span>
          {floor}
        </Text>
        <Text style={{ left: 56, top: 340, width: 450, fontSize: 18, color: FP.muted, lineHeight: 1.45 }}>
          Launch, trade and redeem against the vault. Holders vote on the yield.
        </Text>
        <Stack left={560} base={482} width={360} slabH={40} step={10} font={13} />
        <MascotOn pose="cool" cx={740} stand={482 - 5 * 40} w={104} />
      </Board>
    ),
  },
  {
    name: "explainer",
    title: "How the floor rises",
    use: "Explainer card for threads, pinned posts and FAQs (1200 × 1200). Evergreen: no fee numbers.",
    w: 1200,
    h: 1200,
    render: () => {
      const steps: [string, string, string][] = [
        ["01", "Fair curve", "One transaction deploys token, curve and DAO. No premint, no dev bag. Launch-window caps slow snipers."],
        ["02", "Floor vault", "A share of every trade's tax, every exit fee and part of the graduation raise flow into a NEAR vault. Burn tokens for your share anytime."],
        ["03", "Sell tax > buy tax", "Selling costs more than buying, and quick flips pay a decaying exit fee into the vault. Dumping pays holders."],
        ["04", "Locked yield LP", "At graduation, liquidity moves to Ref Finance, locks forever and earns LiNEAR yield. Holders vote where it goes."],
      ];
      return (
        <Board w={1200} h={1200}>
          <Planks top={1130} h={70} />
          <Lockup left={80} top={70} w={300} />
          <Text style={{ left: 80, top: 150, fontSize: 70, fontWeight: 800, letterSpacing: "-0.03em" }}>
            <span>How the&nbsp;</span>
            <span style={{ color: FP.copperBright }}>floor</span>
            <span>&nbsp;rises</span>
          </Text>
          <Text style={{ left: 80, top: 250, width: 700, fontSize: 26, color: FP.muted }}>Four steps, each a level higher.</Text>
          {steps.map(([n, title, body], i) => {
            const x = 80 + i * 265;
            const y = 640 - i * 110;
            return (
              <div key={n} style={{ position: "absolute", left: x, top: y, width: 245, display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", height: 14, borderRadius: 3, backgroundImage: FLOOR_SLAB }} />
                <div style={{ display: "flex", marginTop: 18, width: 52, height: 52, alignItems: "center", justifyContent: "center", border: `2px solid ${FP.copper}`, borderRadius: 6, backgroundColor: FP.boardDeep, color: FP.gold, fontSize: 22, fontWeight: 800 }}>{n}</div>
                <div style={{ display: "flex", marginTop: 16, fontSize: 28, fontWeight: 800 }}>{title}</div>
                <div style={{ display: "flex", marginTop: 10, fontSize: 19, color: FP.muted, lineHeight: 1.5 }}>{body}</div>
              </div>
            );
          })}
          <MascotOn pose="cool" cx={80 + 3 * 265 + 122} stand={640 - 3 * 110} w={130} />
          <Text style={{ left: 80, top: 1060, width: 1040, fontSize: 18, color: FP.secondary }}>
            Current fees and splits: usefloorpad.fun/docs. Not financial advice.
          </Text>
        </Board>
      );
    },
  },
  {
    name: "palette",
    title: "Palette card",
    use: "Colour reference for designers and partners (1200 × 630).",
    w: 1200,
    h: 630,
    render: () => {
      const sw: [string, string, string][] = [
        ["Floor Green", "#0F3B2C", "background"],
        ["Deep Green", "#0A2B20", "header, wells"],
        ["Panel", "#134634", "cards, slabs"],
        ["Cream", "#EAD0AC", "text"],
        ["Logo Mint", LOGO_MINT, "logo only"],
        ["Copper", "#B87333", "borders, planks"],
        ["Copper Bright", "#D98C53", "calls to action"],
        ["Gold", "#E6C14A", "highlights"],
        ["Up", "#7DD3A8", "gains, buys"],
        ["Down", "#F0907A", "losses, sells"],
      ];
      const light = (hex: string) => ["#EAD0AC", LOGO_MINT, "#E6C14A", "#7DD3A8", "#F0907A", "#D98C53"].includes(hex);
      return (
        <Board w={1200} h={630}>
          <Planks top={590} h={40} />
          <Text style={{ left: 60, top: 44, fontSize: 40, fontWeight: 800 }}>Floorpad palette</Text>
          {sw.map(([name, hex, role], i) => (
            <div
              key={hex}
              style={{
                position: "absolute",
                left: 60 + (i % 5) * 220,
                top: 130 + Math.floor(i / 5) * 225,
                width: 200,
                height: 200,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                padding: 16,
                borderRadius: 10,
                backgroundColor: hex,
                border: `2px solid ${FP.copperDim}`,
                color: light(hex) ? FP.board : FP.text,
              }}
            >
              <span style={{ fontSize: 20, fontWeight: 800 }}>{name}</span>
              <span style={{ fontSize: 18 }}>{hex}</span>
              <span style={{ fontSize: 14, opacity: 0.8 }}>{role}</span>
            </div>
          ))}
        </Board>
      );
    },
  },
  {
    name: "mascot-sheet",
    title: "Mascot sheet",
    use: "The four poses on their floors, with when to use each (1600 × 900).",
    w: 1600,
    h: 900,
    render: () => {
      const poses: ["cool" | "hero" | "wink" | "flag", string, string][] = [
        ["cool", "Cool", "default, avatars, hero"],
        ["hero", "Hero", "wins, milestones"],
        ["wink", "Wink", "success, confirmations"],
        ["flag", "Flag", "launches, new tokens"],
      ];
      return (
        <Board w={1600} h={900}>
          <Planks top={850} h={50} />
          <Text style={{ left: 70, top: 56, fontSize: 44, fontWeight: 800 }}>The Floorpad brick</Text>
          <Text style={{ left: 70, top: 120, width: 1300, fontSize: 22, color: FP.muted }}>Always standing on a floor. Use the graded art from the brand kit; never recolour, stretch or crop it.</Text>
          {poses.map(([pose, name, use], i) => {
            const cx = 230 + i * 380;
            return (
              <div key={pose} style={{ display: "flex" }}>
                <div style={{ position: "absolute", left: cx - 150, top: 600, width: 300, height: 14, borderRadius: 3, backgroundImage: FLOOR_SLAB }} />
                <MascotOn pose={pose} cx={cx} stand={602} w={pose === "hero" ? 200 : 240} />
                <Text style={{ left: cx - 150, top: 650, width: 300, fontSize: 30, fontWeight: 800, justifyContent: "center" }}>{name}</Text>
                <Text style={{ left: cx - 150, top: 700, width: 300, fontSize: 19, color: FP.muted, justifyContent: "center", textAlign: "center" }}>{use}</Text>
              </div>
            );
          })}
        </Board>
      );
    },
  },
];

export const kitAsset = (name: string) => KIT.find((a) => a.name === name) ?? null;
