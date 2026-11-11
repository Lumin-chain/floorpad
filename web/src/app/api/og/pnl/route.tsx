import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function loadBrandPng(filename: string): string | null {
  try {
    const filePath = path.join(process.cwd(), "public", "brand", filename);
    const buf = fs.readFileSync(filePath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

const NEAR_ACCOUNT_RE = /^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$/;
const isValidNear = (s: string) => s.length >= 2 && s.length <= 64 && NEAR_ACCOUNT_RE.test(s);

async function fetchTokenMetaSafe(tokenId: string): Promise<{ name?: string; symbol?: string; icon?: string | null } | null> {
  if (!tokenId || !isValidNear(tokenId)) return null;
  try {
    const rpc = process.env.NEXT_PUBLIC_RPC || "https://rpc.testnet.fastnear.com";
    const launchpad = process.env.NEXT_PUBLIC_LAUNCHPAD || "fplpmwbbcg00.testnet";
    const argsBase64 = Buffer.from(JSON.stringify({ token_id: tokenId })).toString("base64");
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
      const parsed = JSON.parse(Buffer.from(j.result.result).toString("utf8"));
      return parsed?.meta || null;
    }
  } catch {
    return null;
  }
  return null;
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "::1" ||
    h.startsWith("fe80:") ||
    h.startsWith("fc") ||
    h.startsWith("fd")
  ) {
    return true;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Strict image check: raster base64 data URI (<=20KB) or public non-private HTTPS URL only (blocks SSRF & SVG parser DoS). */
function isSatoriSupportedImage(src: string | null | undefined): src is string {
  if (!src || src.length > 20_000) return false;
  if (/^data:image\/(png|jpeg|jpg|gif);base64,[A-Za-z0-9+/=]+$/.test(src)) {
    return true;
  }
  if (src.startsWith("https://")) {
    try {
      const u = new URL(src);
      return u.protocol === "https:" && !isPrivateHost(u.hostname) && !u.pathname.toLowerCase().endsWith(".webp");
    } catch {
      return false;
    }
  }
  return false;
}

const finiteNum = (raw: string | null, fb: number, min = -1_000_000_000, max = 1_000_000_000) => {
  if (!raw) return fb;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb;
};
const cleanText = (raw: string | null, fb: string, max: number) =>
  (raw ?? fb).replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max) || fb;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tokenId = searchParams.get("token") || "";
  const meta = tokenId ? await fetchTokenMetaSafe(tokenId) : null;

  const symbol = cleanText(searchParams.get("symbol") || meta?.symbol || null, "TOKEN", 12);
  const name = cleanText(searchParams.get("name") || meta?.name || null, symbol, 40);
  const tokenIcon = isSatoriSupportedImage(meta?.icon) ? meta.icon : null;

  const pnlStr = searchParams.get("pnl") || "100";
  const pnlNum = finiteNum(pnlStr, 0, -100, 1_000_000);
  const floorNum = finiteNum(searchParams.get("floor"), 10, 0, 1_000_000_000);
  const floor = floorNum.toFixed(2);
  const usdNum = finiteNum(searchParams.get("usd"), 36, 0, 1_000_000_000);
  const entry = cleanText(searchParams.get("entry"), "", 16);
  const price = cleanText(searchParams.get("price"), "", 16);
  const account = cleanText(searchParams.get("account"), "trader.near", 64);
  const hideNetworth = searchParams.get("hideNetworth") === "1" || searchParams.get("hideNetworth") === "true";

  const isProfit = !pnlStr.startsWith("-") && pnlNum >= 0;

  const costBasisUsd = pnlNum > -99 ? usdNum / (1 + pnlNum / 100) : usdNum;
  const pnlGainUsd = pnlNum === 0 ? 0 : usdNum - costBasisUsd;
  const absUsdGain = Math.abs(pnlGainUsd);

  const bgBorder = isProfit ? "rgba(0, 255, 163, 0.45)" : "rgba(255, 59, 92, 0.45)";
  const themeColor = isProfit ? "#00ffa3" : "#ff3b5c";
  const pnlFormatted = `${isProfit ? "+" : ""}${pnlNum.toFixed(2)}%`;

  const mascotData = loadBrandPng(isProfit ? "pnl-mascot-profit.png" : "pnl-mascot-loss.png");
  const logoData = loadBrandPng("symbol.png");

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
            ? "linear-gradient(135deg, #071710 0%, #0b1c14 45%, #040c07 100%)"
            : "linear-gradient(135deg, #19080b 0%, #1d0c10 45%, #0d0406 100%)",
          padding: "40px 54px",
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          border: `3px solid ${bgBorder}`,
        }}
      >
        {/* Top Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            {logoData ? <img src={logoData} alt="" width={56} height={28} /> : null}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          {/* Left: Token & Hero PNL */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "10px" }}>
              {tokenIcon ? (
                <img
                  src={tokenIcon}
                  alt=""
                  width={54}
                  height={54}
                  style={{
                    borderRadius: 27,
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
                <div style={{ display: "flex", fontSize: 38, fontWeight: 900, color: "#ffffff", letterSpacing: "-0.02em", lineHeight: 1.05 }}>
                  {`$${symbol}`}
                </div>
                <div style={{ display: "flex", fontSize: 16, fontWeight: 600, color: "rgba(255, 255, 255, 0.55)" }}>
                  {name}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", fontSize: 18, fontWeight: 700, color: "rgba(255, 255, 255, 0.5)", marginTop: "6px", marginBottom: "2px" }}>
              PNL
            </div>
            <div
              style={{
                display: "flex",
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
                  alignSelf: "flex-start",
                  gap: "10px",
                  backgroundColor: isProfit ? "rgba(0, 255, 163, 0.12)" : "rgba(255, 59, 92, 0.12)",
                  border: `1px solid ${isProfit ? "rgba(0, 255, 163, 0.35)" : "rgba(255, 59, 92, 0.35)"}`,
                  padding: "8px 20px",
                  borderRadius: "20px",
                  fontSize: 20,
                  fontWeight: 800,
                  color: themeColor,
                  marginTop: "14px",
                }}
              >
                {`${pnlGainUsd >= 0 ? "+ $" : "- $"}${absUsdGain.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  alignSelf: "flex-start",
                  gap: "8px",
                  backgroundColor: "rgba(255, 255, 255, 0.06)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  padding: "6px 16px",
                  borderRadius: "16px",
                  fontSize: 14,
                  fontWeight: 700,
                  color: "rgba(255, 255, 255, 0.6)",
                  marginTop: "14px",
                }}
              >
                PNL % ONLY
              </div>
            )}
          </div>

          {/* Right: Mascot Artwork */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            {mascotData ? <img src={mascotData} alt="" width={270} height={310} /> : null}
          </div>
        </div>

        {/* Bottom Docked Stats Bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            border: `1.5px solid ${isProfit ? "rgba(0, 255, 163, 0.25)" : "rgba(255, 59, 92, 0.25)"}`,
            borderRadius: "18px",
            padding: "16px 28px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 13, color: "rgba(255, 255, 255, 0.45)", fontWeight: 700 }}>
              Entry Price
            </div>
            <div style={{ display: "flex", fontSize: 24, fontWeight: 800, color: "#ffffff", marginTop: 2 }}>
              {entry ? `$${entry}` : account}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 13, color: "rgba(255, 255, 255, 0.45)", fontWeight: 700 }}>
              {!hideNetworth ? "Networth" : "Current Price"}
            </div>
            <div style={{ display: "flex", fontSize: 24, fontWeight: 800, color: "#ffffff", marginTop: 2 }}>
              {!hideNetworth
                ? `$${usdNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : price
                  ? `$${price}`
                  : pnlFormatted}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 13, color: "rgba(255, 255, 255, 0.45)", fontWeight: 700 }}>
              Guaranteed Floor
            </div>
            <div style={{ display: "flex", fontSize: 24, fontWeight: 800, color: themeColor, marginTop: 2 }}>
              {!hideNetworth ? `${floor} NEAR` : "Floor-Backed"}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
