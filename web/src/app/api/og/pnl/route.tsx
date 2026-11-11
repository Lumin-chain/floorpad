import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

async function fetchTokenMetaEdge(tokenId: string): Promise<{ name?: string; symbol?: string; icon?: string | null } | null> {
  if (!tokenId) return null;
  try {
    const rpc = process.env.NEXT_PUBLIC_RPC || "https://rpc.testnet.fastnear.com";
    const launchpad = process.env.NEXT_PUBLIC_LAUNCHPAD || "fplpmwbbcg00.testnet";
    const argsBase64 = btoa(JSON.stringify({ token_id: tokenId }));
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "query",
        params: {
          request_type: "call_function",
          finality: "optimistic",
          account_id: launchpad,
          method_name: "get_token",
          args_base64: argsBase64,
        },
      }),
      signal: AbortSignal.timeout(1500),
    });
    const j = await res.json();
    if (j.result?.result) {
      const bytes = new Uint8Array(j.result.result);
      const text = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(text);
      return parsed?.meta || null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const { searchParams, origin } = url;
  const tokenId = searchParams.get("token") || "";
  const meta = tokenId ? await fetchTokenMetaEdge(tokenId) : null;

  const symbol = searchParams.get("symbol") || meta?.symbol || "TOKEN";
  const name = searchParams.get("name") || meta?.name || symbol;
  const tokenIcon = meta?.icon && (meta.icon.startsWith("http") || meta.icon.startsWith("data:image/")) ? meta.icon : null;

  const pnlStr = searchParams.get("pnl") || "100";
  const floor = searchParams.get("floor") || "10.0";
  const usdStr = searchParams.get("usd") || "36.0";
  const entry = searchParams.get("entry") || "";
  const price = searchParams.get("price") || "";
  const account = searchParams.get("account") || "trader.near";
  const hideNetworth = searchParams.get("hideNetworth") === "1" || searchParams.get("hideNetworth") === "true";

  const pnlNum = parseFloat(pnlStr) || 0;
  const usdNum = parseFloat(usdStr) || 0;
  const isProfit = !pnlStr.startsWith("-") && pnlNum >= 0;

  const costBasisUsd = pnlNum > -99 ? usdNum / (1 + pnlNum / 100) : usdNum;
  const pnlGainUsd = pnlNum === 0 ? 0 : usdNum - costBasisUsd;
  const absUsdGain = Math.abs(pnlGainUsd);

  const bgBorder = isProfit ? "rgba(0, 255, 163, 0.45)" : "rgba(255, 59, 92, 0.45)";
  const themeColor = isProfit ? "#00ffa3" : "#ff3b5c";
  const pnlFormatted = `${isProfit ? "+" : ""}${pnlNum.toFixed(2)}%`;

  const mascotUrl = `${origin}/brand/${isProfit ? "pnl-mascot-profit.png" : "pnl-mascot-loss.png"}`;
  const logoUrl = `${origin}/brand/symbol.png`;

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
            ? "radial-gradient(circle at 80% 42%, rgba(0, 255, 163, 0.16) 0%, transparent 58%), linear-gradient(135deg, #071710 0%, #0b1c14 40%, #040c07 100%)"
            : "radial-gradient(circle at 80% 42%, rgba(255, 59, 92, 0.16) 0%, transparent 58%), linear-gradient(135deg, #19080b 0%, #1d0c10 40%, #0d0406 100%)",
          padding: "40px 54px",
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          border: `3px solid ${bgBorder}`,
        }}
      >
        {/* Top Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="" style={{ height: 28, width: 56 }} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 900,
                  letterSpacing: "-0.02em",
                  color: "#ffffff",
                  lineHeight: 1.05,
                }}
              >
                Floorpad
              </div>
              <div style={{ fontSize: 15, color: "rgba(255, 255, 255, 0.45)", fontWeight: 500 }}>
                The floor only goes up.
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              backgroundColor: isProfit ? "rgba(0, 255, 163, 0.12)" : "rgba(255, 59, 92, 0.12)",
              border: `1.5px solid ${isProfit ? "rgba(0, 255, 163, 0.55)" : "rgba(255, 59, 92, 0.55)"}`,
              padding: "9px 22px",
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
            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "10px" }}>
              {tokenIcon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={tokenIcon}
                  alt=""
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 27,
                    objectFit: "cover",
                    border: "2px solid rgba(255, 255, 255, 0.25)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "54px",
                    height: "54px",
                    borderRadius: "27px",
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
                  {symbol.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 38, fontWeight: 900, color: "#ffffff", letterSpacing: "-0.02em", lineHeight: 1.05 }}>
                  ${symbol}
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "rgba(255, 255, 255, 0.55)" }}>
                  {name}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 18, fontWeight: 700, color: "rgba(255, 255, 255, 0.5)", marginTop: "6px", marginBottom: "2px" }}>
              PNL
            </div>
            <div
              style={{
                fontSize: 96,
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
                  marginTop: "14px",
                  width: "fit-content",
                }}
              >
                <span>👛</span>
                <span>{pnlGainUsd >= 0 ? "+ $" : "- $"}{absUsdGain.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
                  marginTop: "14px",
                  width: "fit-content",
                }}
              >
                <span>🔒 PNL % ONLY</span>
              </div>
            )}
          </div>

          {/* Right: Mascot Artwork */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mascotUrl} alt="" style={{ width: 280, height: 320, objectFit: "contain" }} />
          </div>
        </div>

        {/* Bottom Docked Stats Bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            border: `1.5px solid ${isProfit ? "rgba(0, 255, 163, 0.25)" : "rgba(255, 59, 92, 0.25)"}`,
            borderRadius: "18px",
            padding: "16px 28px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.45)", fontWeight: 700 }}>
              🪙 Entry Price
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#ffffff", marginTop: 2 }}>
              {entry ? `$${entry}` : account}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.45)", fontWeight: 700 }}>
              {!hideNetworth ? "💼 Networth" : "🎯 Current Price"}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#ffffff", marginTop: 2 }}>
              {!hideNetworth
                ? `$${usdNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : price
                  ? `$${price}`
                  : pnlFormatted}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.45)", fontWeight: 700 }}>
              🛡️ Guaranteed Floor
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: themeColor, marginTop: 2 }}>
              {!hideNetworth ? `${floor} NEAR` : "Floor-Backed"}
            </div>
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
