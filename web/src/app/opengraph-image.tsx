import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { FLOOR_SLAB, floorTilesSvg, FP, loadMonoFonts, MONO_STACK } from "@/lib/og-theme";

export const runtime = "nodejs";
export const alt = "Floorpad · Every meme gets a floor. Late buyers stop being exit liquidity.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function brandPng(name: string): string | null {
  try {
    const p = path.join(process.cwd(), "public", "brand", name);
    return `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
  } catch {
    return null;
  }
}

// the rising floor: each source lays one more slab; same story as the site hero
// "source | share to floor", from the live launchpad config (same as the site hero)
const SLABS = [
  ["BUY FEE 1.5%", "1% + 0.5% TAX"],
  ["SELL FEE 2.0%", "1% + 1.0% TAX"],
  ["EXIT FEE ≤10%", "ALL → FLOOR"],
  ["GRADUATION", "15% → FLOOR"],
  ["LiNEAR YIELD", "BY VOTE"],
];
// frame interior is 1164 x 594
const GROUND_H = 34;
const SLAB_H = 46;
const STACK_W = 340;
const STACK_LEFT = 770;
const STEP = 12;

export default async function OpengraphImage() {
  const symbol = brandPng("symbol.png");
  const mascot = brandPng("graded/mascot-cool.png");
  const fonts = await loadMonoFonts();
  const stackTop = 594 - GROUND_H - SLABS.length * SLAB_H;
  const levelLeft = STACK_LEFT + STACK_W - (SLABS.length - 1) * STEP + 8;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", backgroundColor: FP.board, color: FP.text, fontFamily: MONO_STACK }}>
        <img src={floorTilesSvg(1200, 630)} width={1200} height={630} alt="" style={{ position: "absolute", top: 0, left: 0 }} />

        <div
          style={{
            position: "absolute",
            top: 18,
            left: 18,
            right: 18,
            bottom: 18,
            display: "flex",
            border: `2px solid ${FP.copper}`,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {/* ground floor */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: GROUND_H, backgroundImage: FLOOR_SLAB }} />

          {/* rising slabs, lowest first; each floor set in a little so the stack climbs */}
          {SLABS.map(([label, value], i) => {
            const inset = i * STEP;
            const top = i === SLABS.length - 1;
            return (
              <div
                key={label}
                style={{
                  position: "absolute",
                  left: STACK_LEFT + inset,
                  width: STACK_W - inset * 2,
                  top: 594 - GROUND_H - (i + 1) * SLAB_H,
                  height: SLAB_H - 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 16px",
                  borderRadius: 6,
                  borderTop: `5px solid ${FP.copper}`,
                  backgroundColor: top ? FP.copperBright : FP.panel2,
                  color: top ? FP.board : FP.text,
                  fontSize: 17,
                  fontWeight: 800,
                  letterSpacing: "0.05em",
                }}
              >
                <span>{label}</span>
                <span style={{ color: top ? FP.board : FP.gold }}>{value}</span>
              </div>
            );
          })}

          {/* the mascot stands on the top floor */}
          {mascot && (
            <img src={mascot} width={128} height={123} alt="" style={{ position: "absolute", left: STACK_LEFT + STACK_W / 2 - 64, top: stackTop - 122 }} />
          )}

          {/* floor level marker */}
          <div style={{ position: "absolute", left: levelLeft, top: stackTop - 2, width: 1164 - levelLeft - 24, height: 0, borderTop: `3px dashed ${FP.gold}` }} />
          <div
            style={{
              position: "absolute",
              right: 24,
              top: stackTop - 70,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "6px 14px",
              backgroundColor: FP.boardDeep,
              border: `2px solid ${FP.gold}`,
              borderRadius: 8,
            }}
          >
            <span style={{ fontSize: 13, color: FP.secondary, fontWeight: 800, letterSpacing: "0.1em" }}>FLOOR</span>
            <span style={{ fontSize: 20, color: FP.gold, fontWeight: 800 }}>RISING</span>
          </div>

          {/* copy column */}
          <div style={{ position: "absolute", left: 46, top: 36, width: 690, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {symbol && <img src={symbol} width={56} height={28} alt="" />}
                <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>Floorpad</span>
              </div>
              <div
                style={{
                  display: "flex",
                  border: `2px solid ${FP.gold}`,
                  color: FP.gold,
                  backgroundColor: FP.boardDeep,
                  padding: "5px 14px",
                  borderRadius: 6,
                  fontSize: 17,
                  fontWeight: 800,
                  letterSpacing: "0.06em",
                }}
              >
                NEAR · MEME LAUNCHPAD
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", fontSize: 60, fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.03em", marginTop: 56 }}>
              <span>Every meme gets a&nbsp;</span>
              <span style={{ color: FP.copperBright }}>floor.</span>
            </div>
            <div style={{ display: "flex", fontSize: 26, color: FP.muted, marginTop: 18, lineHeight: 1.4 }}>
              Late buyers stop being exit liquidity: every trade lays another layer under a redeemable NEAR vault.
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 34 }}>
              {[
                ["BUY", "1.5%"],
                ["SELL", "2.0%"],
                ["EXIT FEE", "<=10%"],
                ["PREMINT", "ZERO"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    padding: "9px 16px",
                    backgroundColor: FP.boardDeep,
                    border: `1.5px solid ${FP.copperDim}`,
                    borderRadius: 8,
                  }}
                >
                  <span style={{ fontSize: 13, color: FP.secondary, fontWeight: 800, letterSpacing: "0.08em" }}>{k}</span>
                  <span style={{ fontSize: 24, fontWeight: 800 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ position: "absolute", right: 34, top: 40, display: "flex", fontSize: 20, color: FP.muted, fontWeight: 800 }}>@usefloorpad_</div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
