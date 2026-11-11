import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") || "TOKEN";
  const pnl = searchParams.get("pnl") || "100";
  const floor = searchParams.get("floor") || "10.0";
  const usd = searchParams.get("usd") || "36.0";
  const account = searchParams.get("account") || "trader.near";

  const isProfit = !pnl.startsWith("-");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#080b0c",
          backgroundImage: "linear-gradient(to bottom right, #080b0c, #0d1315, #050708)",
          padding: "50px 70px",
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          border: "4px solid rgba(46, 213, 115, 0.3)",
        }}
      >
        {/* Top Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                fontSize: 32,
                fontWeight: 900,
                letterSpacing: "0.05em",
                color: "#2ed573",
              }}
            >
              FLOORPAD
            </div>
            <div style={{ fontSize: 18, color: "rgba(255, 255, 255, 0.5)", fontWeight: 500 }}>
              THE MEMECOIN WITH A RISING FLOOR
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              backgroundColor: "rgba(46, 213, 115, 0.15)",
              border: "1.5px solid rgba(46, 213, 115, 0.5)",
              padding: "8px 20px",
              borderRadius: "20px",
              fontSize: 16,
              fontWeight: 700,
              color: "#2ed573",
            }}
          >
            ▲ RISING FLOOR VAULT
          </div>
        </div>

        {/* Center Content */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {/* Left: Token & Hero PNL */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 60, fontWeight: 900, color: "#ffffff", marginBottom: 8 }}>
              ${symbol}
            </div>
            <div
              style={{
                fontSize: 110,
                fontWeight: 900,
                color: isProfit ? "#2ed573" : "#ff4757",
                lineHeight: 1,
                letterSpacing: "-0.03em",
              }}
            >
              {isProfit ? `+${pnl}%` : `${pnl}%`}
            </div>
            <div style={{ fontSize: 22, color: "rgba(255, 255, 255, 0.7)", marginTop: 16 }}>
              Fair launched on NEAR Protocol
            </div>
          </div>

          {/* Right: Metrics Box */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              backgroundColor: "rgba(255, 255, 255, 0.04)",
              border: "1.5px solid rgba(255, 255, 255, 0.12)",
              borderRadius: "20px",
              padding: "30px 40px",
              width: "440px",
              gap: "20px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 15, color: "rgba(255, 255, 255, 0.5)", fontWeight: 600 }}>
                CURRENT POSITION
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#ffffff", marginTop: 4 }}>
                ${usd} USD
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 15, color: "rgba(255, 255, 255, 0.5)", fontWeight: 600 }}>
                GUARANTEED FLOOR BACKING
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#2ed573", marginTop: 4 }}>
                {floor} NEAR
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid rgba(255, 255, 255, 0.1)",
            paddingTop: "20px",
            fontSize: 20,
          }}
        >
          <div style={{ color: "#2ed573", fontWeight: 700, fontFamily: "monospace" }}>
            Trader: {account}
          </div>
          <div style={{ color: "rgba(255, 255, 255, 0.8)", fontWeight: 600 }}>
            Trade on floorpad.app
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
