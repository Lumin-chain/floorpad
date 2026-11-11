"use client";

import Link from "next/link";
import { useState } from "react";
import { SlabIcon } from "@/components/Brand";

interface PnlClientViewProps {
  id: string;
  symbol: string;
  name?: string;
  icon?: string | null;
  pnl: number;
  floorNear: number;
  usdVal: number;
  entryPrice?: number;
  currentPrice?: number;
  account: string;
  refParam: string;
  initialHideNetworth: boolean;
}

export function PnlClientView({
  id,
  symbol,
  name,
  icon,
  pnl,
  floorNear,
  usdVal,
  entryPrice,
  currentPrice,
  account,
  refParam,
  initialHideNetworth,
}: PnlClientViewProps) {
  const [showNetworth, setShowNetworth] = useState(!initialHideNetworth);
  const [copiedLink, setCopiedLink] = useState(false);
  const isProfit = pnl >= 0;

  const cardBorder = isProfit ? "rgba(0, 255, 163, 0.45)" : "rgba(255, 59, 92, 0.45)";
  const cardGlow = isProfit ? "rgba(0, 255, 163, 0.2)" : "rgba(255, 59, 92, 0.2)";
  const pnlColor = isProfit ? "#00ffa3" : "#ff3b5c";
  const costBasisUsd = pnl > -99 ? usdVal / (1 + pnl / 100) : usdVal;
  const pnlGainUsd = pnl === 0 ? 0 : usdVal - costBasisUsd;
  const absUsd = Math.abs(pnlGainUsd);

  const buildShareUrl = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const params = new URLSearchParams();
    params.set("symbol", symbol);
    if (name) params.set("name", name);
    params.set("pnl", String(pnl));
    if (account) params.set("account", account);
    params.set("floor", floorNear.toFixed(2));
    params.set("usd", usdVal.toFixed(2));
    if (entryPrice) params.set("entry", entryPrice.toFixed(4));
    if (currentPrice) params.set("price", currentPrice.toFixed(4));
    if (!showNetworth) params.set("hideNetworth", "1");
    if (refParam.startsWith("?ref=")) params.set("ref", refParam.slice(5));
    return `${origin}/pnl/${id}?${params.toString()}`;
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(buildShareUrl());
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const shareOnX = () => {
    const shareUrl = buildShareUrl();
    const text = isProfit
      ? `🚀 Up +${pnl.toFixed(2)}% on ${name || symbol} ($${symbol}) on @usefloorpad_! 📈\n\n🛡️ Rising floor vault · Locked Ref LP\n\nView card:`
      : `Holding ${name || symbol} ($${symbol}) on @usefloorpad_! 📉\n\n🛡️ Backed by the redeemable rising floor vault\n\nView card:`;
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`,
      "_blank",
      "width=550,height=440",
    );
  };

  return (
    <div className="section stack" style={{ maxWidth: 840, margin: "24px auto", padding: "0 14px", gap: 16 }}>
      {/* Privacy Control Bar */}
      <div className="panel row between wrap" style={{ gap: 12 }}>
        <div>
          <strong style={{ fontSize: "0.95rem" }}>Display Preferences</strong>
          <div className="small muted">Choose whether to show your networth ($) or only your PNL percentage (%)</div>
        </div>
        <div className="seg">
          <button
            className={showNetworth ? "active" : ""}
            onClick={() => setShowNetworth(true)}
          >
            Show Networth ($)
          </button>
          <button
            className={!showNetworth ? "active" : ""}
            onClick={() => setShowNetworth(false)}
          >
            🔒 PNL % Only
          </button>
        </div>
      </div>

      {/* Main High-Res PNL Card Container */}
      <div
        className="panel stack"
        style={{
          background: isProfit
            ? "linear-gradient(135deg, #071710 0%, #0b1c14 40%, #040c07 100%)"
            : "linear-gradient(135deg, #19080b 0%, #1d0c10 40%, #0d0406 100%)",
          border: `2px solid ${cardBorder}`,
          borderRadius: 16,
          padding: "28px 32px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Top Header Row */}
        <div className="row between wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12, alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/symbol.png" alt="" style={{ height: 26, width: "auto" }} />
            <div>
              <span style={{ fontSize: 28, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em" }}>
                Floorpad
              </span>
              <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.45)", marginTop: -2 }}>
                The floor only goes up.
              </div>
            </div>
          </div>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: isProfit ? "rgba(0, 255, 163, 0.12)" : "rgba(255, 59, 92, 0.12)",
              border: `1.5px solid ${isProfit ? "rgba(0, 255, 163, 0.55)" : "rgba(255, 59, 92, 0.55)"}`,
              padding: "8px 20px",
              borderRadius: 24,
              color: pnlColor,
              fontWeight: 800,
              fontSize: 16,
            }}
          >
            {isProfit ? "↗ Profit" : "↘ Loss"}
          </div>
        </div>

        {/* Center Row: Token Info, Hero PNL & Mascot Artwork */}
        <div className="row between wrap" style={{ margin: "28px 0 20px", alignItems: "center", position: "relative" }}>
          {/* Left Column: Token + PNL */}
          <div className="stack" style={{ gap: 8, zIndex: 2 }}>
            {/* Token Badge */}
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              {icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={icon}
                  alt={name || symbol}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: "2px solid rgba(255,255,255,0.22)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: isProfit ? "rgba(0, 255, 163, 0.2)" : "rgba(255, 59, 92, 0.2)",
                    border: `2px solid ${cardBorder}`,
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 800,
                    fontSize: 18,
                    color: "#fff",
                  }}
                >
                  {symbol.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <div style={{ fontSize: 32, fontWeight: 900, color: "#fff", letterSpacing: "-0.01em", lineHeight: 1.1 }}>
                  ${symbol} <span style={{ fontSize: 18, opacity: 0.5 }}>⌄</span>
                </div>
                {name && (
                  <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255, 255, 255, 0.55)", marginTop: 2 }}>
                    {name}
                  </div>
                )}
              </div>
            </div>

            {/* PNL Label */}
            <div style={{ fontSize: 16, fontWeight: 700, color: "rgba(255, 255, 255, 0.6)", marginTop: 12 }}>
              PNL
            </div>

            {/* Hero Percentage */}
            <div
              style={{
                fontSize: 76,
                fontWeight: 900,
                color: pnlColor,
                lineHeight: 1,
                letterSpacing: "-0.03em",
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
              }}
            >
              {isProfit ? `+${pnl.toFixed(2)}%` : `${pnl.toFixed(2)}%`}
            </div>

            {/* Networth Pill or Percentage-Only Pill */}
            {showNetworth ? (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: isProfit ? "rgba(0, 255, 163, 0.12)" : "rgba(255, 59, 92, 0.12)",
                  border: `1px solid ${isProfit ? "rgba(0, 255, 163, 0.35)" : "rgba(255, 59, 92, 0.35)"}`,
                  padding: "8px 18px",
                  borderRadius: 20,
                  color: isProfit ? "#00ffa3" : "#ff6688",
                  fontFamily: "monospace",
                  fontWeight: 800,
                  fontSize: 18,
                  marginTop: 6,
                  width: "fit-content",
                }}
              >
                <span>👛</span>
                <span>
                  {pnlGainUsd >= 0 ? "+ $" : "- $"}
                  {absUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            ) : (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "rgba(255, 255, 255, 0.06)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  padding: "6px 14px",
                  borderRadius: 16,
                  color: "rgba(255, 255, 255, 0.6)",
                  fontWeight: 700,
                  fontSize: 13,
                  marginTop: 6,
                  width: "fit-content",
                }}
              >
                <span>🔒 PNL % ONLY (NETWORTH HIDDEN)</span>
              </div>
            )}
          </div>

          {/* Right Column: Mascot Artwork */}
          <div style={{ flex: "none", zIndex: 1 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={isProfit ? "/brand/pnl-mascot-profit.png" : "/brand/pnl-mascot-loss.png"}
              alt=""
              style={{
                width: 280,
                height: "auto",
                display: "block",
                filter: `drop-shadow(0 0 25px ${cardGlow})`,
              }}
            />
          </div>
        </div>

        {/* Bottom Docked Stats Bar */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.5)",
            border: `1px solid ${isProfit ? "rgba(0, 255, 163, 0.25)" : "rgba(255, 59, 92, 0.25)"}`,
            borderRadius: 18,
            padding: "16px 24px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255, 255, 255, 0.45)" }}>
              🪙 Entry Price
            </div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginTop: 2 }}>
              {entryPrice ? `$${entryPrice.toFixed(4)}` : "On-Chain"}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255, 255, 255, 0.45)" }}>
              {showNetworth ? "💼 Position Networth" : "🎯 Current Price"}
            </div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginTop: 2 }}>
              {showNetworth
                ? `$${usdVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : currentPrice
                  ? `$${currentPrice.toFixed(4)}`
                  : `${isProfit ? "+" : ""}${pnl.toFixed(2)}%`}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255, 255, 255, 0.45)" }}>
              🛡️ Guaranteed Floor
            </div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: isProfit ? "#00ffa3" : "#ff8888", marginTop: 2 }}>
              {showNetworth ? `${floorNear.toFixed(2)} NEAR` : "Floor-Backed"}
            </div>
          </div>
        </div>
      </div>

      {/* Action CTA Bar */}
      <div className="row between wrap" style={{ gap: 12 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn sm" onClick={copyShareLink}>
            <SlabIcon name="share" size={13} /> {copiedLink ? "Link Copied!" : "Copy Share Link"}
          </button>
          <button
            className="btn sm"
            onClick={shareOnX}
          >
            Share on X
          </button>
        </div>
        <Link href={`/token/${id}${refParam}`} className="btn primary lg" style={{ gap: 8 }}>
          <span>Trade ${symbol} on Floorpad</span>
          <SlabIcon name="launch" size={14} />
        </Link>
      </div>
    </div>
  );
}
