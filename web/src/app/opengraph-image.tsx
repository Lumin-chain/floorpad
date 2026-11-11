import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Floorpad · Meme launches where late buyers aren't exit liquidity";
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

export default function OpengraphImage() {
  const symbol = brandPng("symbol.png");
  const mascot = brandPng("mascot-hero.png");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#0B0D10",
          color: "#F9FAFB",
          padding: "56px 64px",
          border: "4px solid #16A34A",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {symbol && <img src={symbol} width={52} height={26} alt="" />}
            <span style={{ fontSize: 34, fontWeight: 900, letterSpacing: "-0.03em" }}>Floorpad</span>
          </div>
          <div
            style={{
              backgroundColor: "#0B2616",
              border: "2px solid #16A34A",
              color: "#4ADE80",
              padding: "8px 20px",
              borderRadius: 99,
              fontSize: 20,
              fontWeight: 800,
            }}
          >
            NEAR Protocol Launchpad
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 760 }}>
            <div style={{ fontSize: 58, fontWeight: 900, lineHeight: 1.08, letterSpacing: "-0.03em" }}>
              Meme launches with a redeemable floor.
            </div>
            <div style={{ fontSize: 26, color: "#9CA3AF", marginTop: 22, lineHeight: 1.4 }}>
              40% of trading fees back the NEAR vault floor · 100% locked yield LP · Holder DAO governance.
            </div>
          </div>
          {mascot && <img src={mascot} width={220} height={220} alt="" />}
        </div>

        <div style={{ display: "flex", gap: 20, fontSize: 20, color: "#9CA3AF", fontWeight: 700 }}>
          <span style={{ color: "#4ADE80" }}>1.25% Buy / 2.5% Sell</span>
          <span>•</span>
          <span>Zero Premint</span>
          <span>•</span>
          <span>@usefloorpad_</span>
        </div>
      </div>
    ),
    { ...size },
  );
}

