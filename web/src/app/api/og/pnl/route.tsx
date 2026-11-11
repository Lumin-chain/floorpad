import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") || "TOKEN";
  const pnlStr = searchParams.get("pnl") || "100";
  const floor = searchParams.get("floor") || "10.0";
  const usd = searchParams.get("usd") || "36.0";
  const account = searchParams.get("account") || "trader.near";
  const hideNetworth = searchParams.get("hideNetworth") === "1" || searchParams.get("hideNetworth") === "true";

  const pnlNum = parseFloat(pnlStr) || 0;
  const isProfit = !pnlStr.startsWith("-") && pnlNum >= 0;

  const bgBorder = isProfit ? "rgba(0, 255, 163, 0.45)" : "rgba(255, 59, 92, 0.45)";
  const themeColor = isProfit ? "#00ffa3" : "#ff3b5c";
  const pnlFormatted = `${isProfit ? "+" : ""}${pnlNum.toFixed(2)}%`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#060809",
          backgroundImage: isProfit
            ? "radial-gradient(circle at 80% 40%, rgba(0, 255, 163, 0.15) 0%, transparent 60%), linear-gradient(135deg, #071710 0%, #0b1c14 40%, #040c07 100%)"
            : "radial-gradient(circle at 80% 40%, rgba(255, 59, 92, 0.15) 0%, transparent 60%), linear-gradient(135deg, #19080b 0%, #1d0c10 40%, #0d0406 100%)",
          padding: "44px 56px",
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          border: `3px solid ${bgBorder}`,
        }}
      >
        {/* Top Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                fontSize: 34,
                fontWeight: 900,
                letterSpacing: "-0.02em",
                color: "#ffffff",
              }}
            >
              Floorpad
            </div>
            <div style={{ fontSize: 16, color: "rgba(255, 255, 255, 0.45)", fontWeight: 500 }}>
              The floor only goes up.
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              backgroundColor: isProfit ? "rgba(0, 255, 163, 0.12)" : "rgba(255, 59, 92, 0.12)",
              border: `1.5px solid ${isProfit ? "rgba(0, 255, 163, 0.55)" : "rgba(255, 59, 92, 0.55)"}`,
              padding: "10px 24px",
              borderRadius: "24px",
              fontSize: 18,
              fontWeight: 800,
              color: themeColor,
            }}
          >
            {isProfit ? "↗  Profit" : "↘  Loss"}
          </div>
        </div>

        {/* Center Content */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {/* Left: Token & Hero PNL */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "12px" }}>
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "28px",
                  backgroundColor: isProfit ? "rgba(0, 255, 163, 0.2)" : "rgba(255, 59, 92, 0.2)",
                  border: `2px solid ${isProfit ? "rgba(0, 255, 163, 0.4)" : "rgba(255, 59, 92, 0.4)"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                  fontWeight: 900,
                  color: "#ffffff",
                }}
              >
                {symbol.slice(0, 2)}
              </div>
              <div style={{ fontSize: 44, fontWeight: 900, color: "#ffffff", letterSpacing: "-0.02em" }}>
                ${symbol}
              </div>
            </div>

            <div style={{ fontSize: 18, fontWeight: 700, color: "rgba(255, 255, 255, 0.5)", marginBottom: "4px" }}>
              PNL
            </div>
            <div
              style={{
                fontSize: 104,
                fontWeight: 900,
                color: themeColor,
                lineHeight: 1,
                letterSpacing: "-0.04em",
              }}
            >
              {pnlFormatted}
            </div>

            {/* Networth pill vs Percentage-Only pill */}
            {!hideNetworth ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  backgroundColor: isProfit ? "rgba(0, 255, 163, 0.12)" : "rgba(255, 59, 92, 0.12)",
                  border: `1px solid ${isProfit ? "rgba(0, 255, 163, 0.35)" : "rgba(255, 59, 92, 0.35)"}`,
                  padding: "8px 20px",
                  borderRadius: "20px",
                  fontSize: 20,
                  fontWeight: 800,
                  color: themeColor,
                  marginTop: "16px",
                  width: "fit-content",
                }}
              >
                <span>👛</span>
                <span>{isProfit ? "+ $" : "- $"}{parseFloat(usd || "0").toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  backgroundColor: "rgba(255, 255, 255, 0.06)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  padding: "6px 16px",
                  borderRadius: "16px",
                  fontSize: 14,
                  fontWeight: 700,
                  color: "rgba(255, 255, 255, 0.6)",
                  marginTop: "16px",
                  width: "fit-content",
                }}
              >
                <span>🔒 PNL % VERIFIED (NETWORTH HIDDEN)</span>
              </div>
            )}
          </div>

          {/* Right: Rising Floor Vault Callout */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              border: `1.5px solid ${isProfit ? "rgba(0, 255, 163, 0.25)" : "rgba(255, 59, 92, 0.25)"}`,
              borderRadius: "24px",
              padding: "28px 36px",
              width: "420px",
              gap: "18px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 14, color: "rgba(255, 255, 255, 0.45)", fontWeight: 700, letterSpacing: "0.04em" }}>
                🛡️ GUARANTEED FLOOR BACKING
              </div>
              <div style={{ fontSize: 32, fontWeight: 900, color: themeColor, marginTop: 4 }}>
                {floor} NEAR
              </div>
              <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.4)", marginTop: 2 }}>
                100% redeemable on-chain anytime
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid rgba(255, 255, 255, 0.08)", paddingTop: "14px" }}>
              <div style={{ fontSize: 14, color: "rgba(255, 255, 255, 0.45)", fontWeight: 700 }}>
                TRADER
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#ffffff", marginTop: 2 }}>
                {account}
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
            paddingTop: "16px",
            fontSize: 18,
          }}
        >
          <div style={{ color: "rgba(255, 255, 255, 0.6)", fontWeight: 600 }}>
            Fair launched on NEAR Protocol · Staking-yield backed
          </div>
          <div style={{ color: themeColor, fontWeight: 800 }}>
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
