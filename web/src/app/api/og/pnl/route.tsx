import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { boardTracesSvg, loadMonoFonts, MONO_STACK, PCB } from "@/lib/og-theme";

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

  const themeColor = isProfit ? PCB.good : PCB.bad;
  const themeTint = isProfit ? PCB.goodTint : PCB.badTint;
  const pnlFormatted = `${isProfit ? "+" : ""}${pnlNum.toFixed(2)}%`;

  const mascotData = loadBrandPng(isProfit ? "pnl-mascot-profit.png" : "pnl-mascot-loss.png");
  const logoData = loadBrandPng("symbol.png");

  const fonts = await loadMonoFonts();
  const pad = (pos: Record<string, number>) => (
    <div style={{ position: "absolute", width: 12, height: 12, borderRadius: 6, backgroundColor: PCB.copper, ...pos }} />
  );
  const statLabel = { display: "flex", fontSize: 14, color: PCB.secondary, fontWeight: 800, letterSpacing: "0.08em" } as const;
  const stats: [string, string, string][] = [
    [entry ? "ENTRY PRICE" : "TRADER", entry ? `$${entry}` : account, PCB.text],
    [
      !hideNetworth ? "NETWORTH" : "CURRENT PRICE",
      !hideNetworth
        ? `$${usdNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : price
          ? `$${price}`
          : pnlFormatted,
      PCB.text,
    ],
    ["VAULT FLOOR", !hideNetworth ? `${floor} NEAR` : "Floor-backed", PCB.gold],
  ];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", backgroundColor: PCB.board, color: PCB.text, fontFamily: MONO_STACK }}>
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
            padding: "30px 44px",
          }}
        >
          {pad({ top: 8, left: 8 })}
          {pad({ top: 8, right: 8 })}
          {pad({ bottom: 8, left: 8 })}
          {pad({ bottom: 8, right: 8 })}

          {/* header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              {logoData ? <img src={logoData} alt="" width={56} height={28} /> : null}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.05 }}>Floorpad</div>
                <div style={{ display: "flex", fontSize: 15, color: PCB.muted }}>Every meme gets a floor.</div>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                backgroundColor: themeTint,
                border: `2px solid ${themeColor}`,
                padding: "8px 20px",
                borderRadius: 6,
                fontSize: 20,
                fontWeight: 800,
                letterSpacing: "0.08em",
                color: themeColor,
              }}
            >
              {isProfit ? "+ PROFIT" : "- LOSS"}
            </div>
          </div>

          {/* token + PNL readout, mascot */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "12px" }}>
                {tokenIcon ? (
                  <img src={tokenIcon} alt="" width={54} height={54} style={{ borderRadius: 8, border: `2px solid ${PCB.copper}` }} />
                ) : (
                  <div
                    style={{
                      width: "54px",
                      height: "54px",
                      borderRadius: "8px",
                      backgroundColor: PCB.boardDeep,
                      border: `2px solid ${PCB.copper}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 22,
                      fontWeight: 800,
                    }}
                  >
                    {symbol.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", fontSize: 38, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.05 }}>{`$${symbol}`}</div>
                  <div style={{ display: "flex", fontSize: 16, color: PCB.muted }}>{name}</div>
                </div>
              </div>

              {/* multimeter-style PNL readout */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignSelf: "flex-start",
                  padding: "14px 24px 18px",
                  backgroundColor: PCB.boardDeep,
                  border: `2px solid ${PCB.copperDim}`,
                  borderRadius: 10,
                }}
              >
                <div style={statLabel}>PNL</div>
                <div style={{ display: "flex", fontSize: 92, fontWeight: 800, color: themeColor, lineHeight: 1, letterSpacing: "-0.04em" }}>
                  {pnlFormatted}
                </div>
                {!hideNetworth ? (
                  <div style={{ display: "flex", fontSize: 22, fontWeight: 800, color: themeColor, marginTop: 10 }}>
                    {`${pnlGainUsd >= 0 ? "+ $" : "- $"}${absUsdGain.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </div>
                ) : (
                  <div style={{ ...statLabel, marginTop: 10 }}>PNL % ONLY</div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              {mascotData ? <img src={mascotData} alt="" width={250} height={287} /> : null}
            </div>
          </div>

          {/* stats strip */}
          <div style={{ display: "flex", gap: 14, width: "100%" }}>
            {stats.map(([k, v, c]) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  padding: "12px 20px",
                  backgroundColor: PCB.boardDeep,
                  border: `1.5px solid ${PCB.copperDim}`,
                  borderRadius: 8,
                }}
              >
                <div style={statLabel}>{k}</div>
                <div style={{ display: "flex", fontSize: 26, fontWeight: 800, color: c, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: fonts.length ? fonts : undefined,
    },
  );
}
