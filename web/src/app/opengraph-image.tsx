import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { boardTracesSvg, loadMonoFonts, MONO_STACK, PCB } from "@/lib/og-theme";

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

const pad = (pos: Record<string, number>) => (
  <div style={{ position: "absolute", width: 12, height: 12, borderRadius: 6, backgroundColor: PCB.copper, ...pos }} />
);

function Pins({ side }: { side: "left" | "right" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, position: "absolute", top: 34, [side]: -14 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ width: 14, height: 9, backgroundColor: PCB.silver }} />
      ))}
    </div>
  );
}

export default async function OpengraphImage() {
  const symbol = brandPng("symbol.png");
  const mascot = brandPng("mascot-cool.png");
  const fonts = await loadMonoFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: PCB.board,
          color: PCB.text,
          fontFamily: MONO_STACK,
        }}
      >
        <img src={boardTracesSvg(1200, 630)} width={1200} height={630} alt="" style={{ position: "absolute", top: 0, left: 0 }} />

        <div
          style={{
            position: "absolute",
            top: 18,
            left: 18,
            right: 18,
            bottom: 18,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            border: `2px solid ${PCB.copper}`,
            borderRadius: 12,
            padding: "38px 46px",
          }}
        >
          {pad({ top: 8, left: 8 })}
          {pad({ top: 8, right: 8 })}
          {pad({ bottom: 8, left: 8 })}
          {pad({ bottom: 8, right: 8 })}

          {/* header */}
          {/* logo + badge on the left; the top-right corner belongs to the mascot */}
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {symbol && <img src={symbol} width={56} height={28} alt="" />}
              <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>Floorpad</span>
            </div>
            <div
              style={{
                display: "flex",
                border: `2px solid ${PCB.gold}`,
                color: PCB.gold,
                backgroundColor: PCB.boardDeep,
                padding: "6px 16px",
                borderRadius: 6,
                fontSize: 18,
                fontWeight: 800,
                letterSpacing: "0.06em",
              }}
            >
              NEAR · MEME LAUNCHPAD
            </div>
          </div>

          {/* headline + vault chip */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", width: 720 }}>
              <div style={{ display: "flex", flexWrap: "wrap", fontSize: 60, fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.03em" }}>
                <span>Every meme gets a&nbsp;</span>
                <span style={{ color: PCB.copperBright }}>floor.</span>
              </div>
              <div style={{ display: "flex", fontSize: 28, color: PCB.muted, marginTop: 20, lineHeight: 1.4 }}>
                Late buyers stop being exit liquidity: fees and quick-flip penalties back a redeemable NEAR vault.
              </div>
            </div>

            <div style={{ display: "flex", position: "relative", width: 230, height: 250, marginTop: 60 }}>
              <Pins side="left" />
              <Pins side="right" />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 230,
                  height: 190,
                  marginTop: 0,
                  backgroundColor: PCB.boardDeep,
                  border: `2px solid ${PCB.copper}`,
                  borderRadius: 8,
                }}
              >
                <span style={{ fontSize: 16, color: PCB.secondary, fontWeight: 800 }}>U1</span>
                <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1 }}>FLOOR</span>
                <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1 }}>VAULT</span>
                <span style={{ fontSize: 16, color: PCB.good, fontWeight: 800, marginTop: 10 }}>REDEEMABLE</span>
              </div>
              {mascot && (
                <img src={mascot} width={130} height={130} alt="" style={{ position: "absolute", top: -112, left: 70 }} />
              )}
            </div>
          </div>

          {/* readouts */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {[
              ["BUY", "1.25%"],
              ["SELL", "2.5%"],
              ["EXIT FEE", "<=10%"],
              ["PREMINT", "ZERO"],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  padding: "10px 18px",
                  backgroundColor: PCB.boardDeep,
                  border: `1.5px solid ${PCB.copperDim}`,
                  borderRadius: 8,
                }}
              >
                <span style={{ fontSize: 14, color: PCB.secondary, fontWeight: 800, letterSpacing: "0.08em" }}>{k}</span>
                <span style={{ fontSize: 26, fontWeight: 800 }}>{v}</span>
              </div>
            ))}
            <div style={{ display: "flex", marginLeft: "auto", fontSize: 22, color: PCB.muted, fontWeight: 800 }}>@usefloorpad_</div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
