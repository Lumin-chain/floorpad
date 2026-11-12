"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtPrice, lp, pricePerToken, safeImageSrc, type TokenView, type Trade } from "@/lib/near";
import { getIndexedTrades } from "@/lib/social";
import { useWallet } from "@/lib/wallet";
import { SlabIcon, Moji } from "./Brand";

interface PnlModalProps {
  t: TokenView;
  balance: bigint;
  holdingSince: number | null;
  spotPriceNear: number;
  floorPriceNear: number;
  nearUsd: number;
  onClose: () => void;
}

export function PnlModal({
  t,
  balance,
  holdingSince,
  spotPriceNear,
  floorPriceNear,
  nearUsd,
  onClose,
}: PnlModalProps) {
  const { accountId, setToast } = useWallet();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Position calculations
  const usdPrice = nearUsd || 3.6;
  const tokensNum = Number(balance / 10n ** 14n) / 1e4;
  const currentValNear = tokensNum * spotPriceNear;
  const currentValUsd = currentValNear * usdPrice;
  const floorValNear = tokensNum * floorPriceNear;

  const [userTrades, setUserTrades] = useState<Trade[]>([]);
  const [showNetworth, setShowNetworth] = useState<boolean>(true);

  // Fetch user's real buy trades for this token to calculate actual average entry price
  useEffect(() => {
    if (!accountId) return;
    let active = true;
    Promise.all([
      lp<Trade[]>("get_trades", { token_id: t.token_id, limit: 200 }).catch(() => [] as Trade[]),
      getIndexedTrades(t.token_id, 200).catch(() => []),
    ]).then(([chainTrades, indexed]) => {
      if (!active) return;
      const mappedIndexed: Trade[] = (indexed || []).map((r) => ({
        ts: r.ts,
        account: r.account,
        is_buy: Boolean(r.is_buy),
        near: r.near,
        tokens: r.tokens,
        v_near: r.v_near,
        v_tokens: r.v_tokens,
      }));
      const combined = [...(chainTrades || []), ...mappedIndexed].filter(
        (tr) => tr.account === accountId && tr.is_buy,
      );
      const seen = new Set<string>();
      const unique: Trade[] = [];
      for (const tr of combined) {
        const key = `${Math.floor(tr.ts)}-${tr.near}-${tr.tokens}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(tr);
        }
      }
      setUserTrades(unique);
    });
    return () => {
      active = false;
    };
  }, [t.token_id, accountId]);

  const { entryPriceNear, pnlPct } = useMemo(() => {
    let totalBuyNear = 0n;
    let totalBuyTokens = 0n;
    for (const tr of userTrades) {
      try {
        totalBuyNear += BigInt(tr.near);
        totalBuyTokens += BigInt(tr.tokens);
      } catch {
        // ignore malformed trade record
      }
    }

    const realEntry =
      totalBuyTokens > 0n
        ? pricePerToken(totalBuyNear, totalBuyTokens)
        : floorPriceNear > 0
          ? floorPriceNear
          : spotPriceNear;

    const pct =
      realEntry > 0
        ? ((spotPriceNear - realEntry) / realEntry) * 100
        : 0;

    return { entryPriceNear: realEntry, pnlPct: pct };
  }, [userTrades, floorPriceNear, spotPriceNear]);

  const entryPriceUsd = entryPriceNear * usdPrice;
  const spotPriceUsd = spotPriceNear * usdPrice;
  const isProfit = pnlPct >= 0;

  // Render high-res 1200x675 card on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = 1200;
    const height = 675;
    canvas.width = width;
    canvas.height = height;

    // Load assets
    const symbolImg = new Image();
    symbolImg.src = "/brand/symbol.png";

    const mascotImg = new Image();
    mascotImg.src = isProfit ? "/brand/pnl-mascot-profit.png" : "/brand/pnl-mascot-loss.png";

    let tokenIconImg: HTMLImageElement | null = null;
    const safeIcon = safeImageSrc(t.meta.icon);
    if (safeIcon) {
      tokenIconImg = new Image();
      if (safeIcon.startsWith("https://")) tokenIconImg.crossOrigin = "anonymous";
      tokenIconImg.src = safeIcon;
    }

    const render = () => {
      // Clear
      ctx.clearRect(0, 0, width, height);

      // Deep void background
      ctx.fillStyle = "#060809";
      ctx.fillRect(0, 0, width, height);

      // Card bounding box
      const cardX = 35;
      const cardY = 35;
      const cardW = width - 70;
      const cardH = height - 70;
      const cardR = 28;

      // Card Background Gradient
      const cardGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
      if (isProfit) {
        cardGrad.addColorStop(0, "#071710");
        cardGrad.addColorStop(0.4, "#0b1c14");
        cardGrad.addColorStop(1, "#040c07");
      } else {
        cardGrad.addColorStop(0, "#19080b");
        cardGrad.addColorStop(0.4, "#1d0c10");
        cardGrad.addColorStop(1, "#0d0406");
      }

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardW, cardH, cardR);
      ctx.fillStyle = cardGrad;
      ctx.fill();

      // Card Glowing Border
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = isProfit ? "rgba(0, 255, 163, 0.45)" : "rgba(255, 59, 92, 0.45)";
      ctx.shadowColor = isProfit ? "rgba(0, 255, 163, 0.35)" : "rgba(255, 59, 92, 0.35)";
      ctx.shadowBlur = 20;
      ctx.stroke();
      ctx.restore();

      // Decorative radial background glow behind mascot
      const glowGrad = ctx.createRadialGradient(cardX + cardW - 220, cardY + 260, 20, cardX + cardW - 220, cardY + 260, 320);
      if (isProfit) {
        glowGrad.addColorStop(0, "rgba(0, 255, 163, 0.22)");
        glowGrad.addColorStop(1, "rgba(0, 255, 163, 0)");
      } else {
        glowGrad.addColorStop(0, "rgba(255, 59, 92, 0.22)");
        glowGrad.addColorStop(1, "rgba(255, 59, 92, 0)");
      }
      ctx.fillStyle = glowGrad;
      ctx.fillRect(cardX, cardY, cardW, cardH);

      // Top Left Header: Logo + Brand + Tagline
      if (symbolImg.complete && symbolImg.naturalWidth > 0) {
        ctx.drawImage(symbolImg, 75, 72, 48, 24);
      }
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 36px 'Space Grotesk', system-ui, sans-serif";
      ctx.fillText("Floorpad", 136, 94);

      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.font = "600 17px system-ui, sans-serif";
      ctx.fillText("The floor only goes up.", 138, 118);

      // Top Right: Profit / Loss Badge Pill
      const badgeW = 145;
      const badgeH = 46;
      const badgeX = cardX + cardW - badgeW - 40;
      const badgeY = 70;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 23);
      ctx.fillStyle = isProfit ? "rgba(0, 255, 163, 0.12)" : "rgba(255, 59, 92, 0.12)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = isProfit ? "rgba(0, 255, 163, 0.55)" : "rgba(255, 59, 92, 0.55)";
      ctx.stroke();

      ctx.fillStyle = isProfit ? "#00ffa3" : "#ff3b5c";
      ctx.font = "bold 20px system-ui, sans-serif";
      const badgeText = isProfit ? "↗  Profit" : "↘  Loss";
      ctx.fillText(badgeText, badgeX + 26, badgeY + 30);
      ctx.restore();

      // Token Icon, Symbol & Name Header
      const tokenY = 195;
      if (tokenIconImg && tokenIconImg.complete && tokenIconImg.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(102, tokenY, 28, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(tokenIconImg, 74, tokenY - 28, 56, 56);
        ctx.restore();

        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(102, tokenY, 28, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Fallback token avatar circle
        ctx.beginPath();
        ctx.arc(102, tokenY, 28, 0, Math.PI * 2);
        ctx.fillStyle = isProfit ? "rgba(0, 255, 163, 0.2)" : "rgba(255, 59, 92, 0.2)";
        ctx.fill();
        ctx.strokeStyle = isProfit ? "rgba(0, 255, 163, 0.45)" : "rgba(255, 59, 92, 0.45)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 22px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(t.meta.symbol.slice(0, 2).toUpperCase(), 102, tokenY + 8);
        ctx.textAlign = "left";
      }

      const symbolLabel = `$${t.meta.symbol}`;
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 36px 'Space Grotesk', system-ui, sans-serif";
      ctx.fillText(symbolLabel, 144, tokenY + 4);

      const symW = ctx.measureText(symbolLabel).width;
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.font = "600 18px system-ui, sans-serif";
      ctx.fillText(t.meta.name.slice(0, 26), 144, tokenY + 28);

      // Chevron accent next to symbol
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.font = "22px system-ui, sans-serif";
      ctx.fillText("⌄", 144 + symW + 10, tokenY + 2);

      // Hero PNL Label
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.font = "bold 22px system-ui, sans-serif";
      ctx.fillText("PNL", 75, 268);

      // Hero Huge Percentage
      const sign = isProfit ? "+" : "";
      const pnlDisplay = `${sign}${pnlPct.toFixed(2)}%`;
      ctx.fillStyle = isProfit ? "#00ffa3" : "#ff3b5c";
      ctx.font = "900 84px 'Space Grotesk', system-ui, sans-serif";
      ctx.fillText(pnlDisplay, 75, 348);

      // Networth Wallet Pill (Toggled by user)
      if (showNetworth) {
        const pnlUsdGain = tokensNum * (spotPriceNear - entryPriceNear) * usdPrice;
        const absUsdGain = Math.abs(pnlUsdGain);
        const gainText = `${pnlUsdGain >= 0 ? "+ $" : "- $"}${absUsdGain.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        ctx.save();
        ctx.font = "bold 20px monospace";
        const pillText = `👛 ${gainText}`;
        const pillW = Math.max(190, ctx.measureText(pillText).width + 38);
        const pillH = 44;
        const pillX = 75;
        const pillY = 376;

        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 22);
        ctx.fillStyle = isProfit ? "rgba(0, 255, 163, 0.12)" : "rgba(255, 59, 92, 0.12)";
        ctx.fill();
        ctx.strokeStyle = isProfit ? "rgba(0, 255, 163, 0.35)" : "rgba(255, 59, 92, 0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = isProfit ? "#00ffa3" : "#ff5577";
        ctx.fillText(pillText, pillX + 18, pillY + 29);
        ctx.restore();
      } else {
        // Percentage Only indicator pill
        ctx.save();
        ctx.font = "bold 15px system-ui, sans-serif";
        const pctLabel = "🔒 PNL % ONLY";
        const pillW = Math.max(165, ctx.measureText(pctLabel).width + 34);
        const pillH = 38;
        const pillX = 75;
        const pillY = 380;

        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 19);
        ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        ctx.fillText(pctLabel, pillX + 16, pillY + 24);
        ctx.restore();
      }

      // Draw Mascot Artwork (Right side)
      if (mascotImg.complete && mascotImg.naturalWidth > 0) {
        ctx.drawImage(mascotImg, cardX + cardW - 385, cardY + 115, 340, 340);
      }

      // Bottom Metrics Bar (Docked Container)
      const barX = 65;
      const barY = cardY + cardH - 120;
      const barW = cardW - 60;
      const barH = 92;
      const barR = 18;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, barH, barR);
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = isProfit ? "rgba(0, 255, 163, 0.25)" : "rgba(255, 59, 92, 0.25)";
      ctx.stroke();

      // Divider lines
      const colW = barW / 3;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(barX + colW, barY + 14);
      ctx.lineTo(barX + colW, barY + barH - 14);
      ctx.moveTo(barX + colW * 2, barY + 14);
      ctx.lineTo(barX + colW * 2, barY + barH - 14);
      ctx.stroke();

      // Col 1: Entry Price
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.font = "600 16px system-ui, sans-serif";
      ctx.fillText("🪙  Entry Price", barX + 28, barY + 36);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 25px monospace";
      ctx.fillText(`$${entryPriceUsd.toFixed(4)}`, barX + 28, barY + 68);

      // Col 2: Current Price (or Position Networth when shown)
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.font = "600 16px system-ui, sans-serif";
      ctx.fillText(showNetworth ? "💼  Networth" : "🎯  Current Price", barX + colW + 28, barY + 36);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 25px monospace";
      ctx.fillText(
        showNetworth
          ? `$${currentValUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : `$${spotPriceUsd.toFixed(4)}`,
        barX + colW + 28,
        barY + 68,
      );

      // Col 3: Guaranteed Floor Backing (Floorpad USP)
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.font = "600 16px system-ui, sans-serif";
      ctx.fillText("🛡️  Guaranteed Floor", barX + colW * 2 + 28, barY + 36);

      ctx.fillStyle = isProfit ? "#00ffa3" : "#ff8888";
      ctx.font = "bold 25px monospace";
      ctx.fillText(
        showNetworth ? `${floorValNear.toFixed(2)} N` : `${fmtPrice(floorPriceNear)} N`,
        barX + colW * 2 + 28,
        barY + 68,
      );

      ctx.restore();
    };

    symbolImg.onload = render;
    mascotImg.onload = render;
    if (tokenIconImg) tokenIconImg.onload = render;
    render();
  }, [t, balance, spotPriceNear, floorPriceNear, entryPriceNear, usdPrice, isProfit, pnlPct, showNetworth, tokensNum, currentValUsd, entryPriceUsd, spotPriceUsd, floorValNear]);

  // Download image as PNG
  const downloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setDownloading(true);
    const roundedPnl = pnlPct.toFixed(2);
    const link = document.createElement("a");
    link.download = `Floorpad-${t.meta.symbol}-${isProfit ? "Profit" : "Loss"}-${roundedPnl}pct.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    setDownloading(false);
    setToast({ kind: "ok", text: "PNL card downloaded!" });
  };

  // Copy image to clipboard
  const copyImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        setCopied(true);
        setToast({ kind: "ok", text: "PNL card copied! Paste directly on X or Telegram." });
        setTimeout(() => setCopied(false), 3000);
      });
    } catch {
      downloadPng();
    }
  };

  // Share on X (Twitter)
  const shareToX = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://web-production-964c7668.up.railway.app";
    const refParam = accountId ? `&ref=${encodeURIComponent(accountId)}` : "";
    const hideNetworthParam = !showNetworth ? "&hideNetworth=1" : "";
    const pnlParam = pnlPct.toFixed(2);

    const shareUrl = `${origin}/pnl/${t.token_id}?symbol=${encodeURIComponent(t.meta.symbol)}&name=${encodeURIComponent(t.meta.name)}&pnl=${pnlParam}&account=${encodeURIComponent(accountId || "")}&floor=${floorValNear.toFixed(2)}&usd=${currentValUsd.toFixed(2)}&entry=${entryPriceUsd.toFixed(4)}&price=${spotPriceUsd.toFixed(4)}${hideNetworthParam}${refParam}`;

    const text = isProfit
      ? `🚀 Up +${pnlParam}% on $${t.meta.symbol} on @usefloorpad_! 📈\n\n🛡️ Floor vault only rises\n🔒 100% LP locked in Ref Finance earning staking yield\n🏛️ Holder DAO\n\nView my position:`
      : `Holding $${t.meta.symbol} (${pnlParam}%) on @usefloorpad_! 📉\n\n🛡️ Backed by the redeemable rising floor vault\n🔒 Locked LP\n\nView my position:`;

    const tweetUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(tweetUrl, "_blank", "noopener,noreferrer,width=550,height=440");
  };

  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
    >
      <div
        className="panel stack"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 760,
          width: "100%",
          maxHeight: "94vh",
          overflowY: "auto",
          background: "var(--panel)",
          border: "1px solid var(--line-strong)",
          padding: 20,
          borderRadius: 12,
        }}
      >
        {/* Modal Header */}
        <div className="row between">
          <div className="row" style={{ gap: 10 }}>
            <Moji face={isProfit ? "hero" : "cool"} size={28} />
            <div>
              <h2 style={{ margin: 0 }}>
                Your {isProfit ? "Profit" : "Loss"} Card
              </h2>
              <span className="small muted">
                Verified on-chain performance for <b>${t.meta.symbol}</b>
              </span>
            </div>
          </div>
          <button className="btn sm ghost" onClick={onClose}>✕</button>
        </div>

        {/* Live Canvas Card Preview */}
        <div
          style={{
            width: "100%",
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid var(--line-strong)",
            background: "#060809",
            marginTop: 12,
          }}
        >
          <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block" }} />
        </div>

        {/* Privacy Toggle: Show Networth vs Percentage Only */}
        <div
          className="row between wrap"
          style={{
            gap: 10,
            marginTop: 14,
            background: "var(--tertiary)",
            padding: 12,
            borderRadius: 10,
            border: "1px solid var(--line)",
          }}
        >
          <div>
            <strong className="small">Display Networth Amount</strong>
            <div className="small muted">
              Show dollar value ($) or hide networth to display percentage only (%)
            </div>
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
              🔒 Percentage Only (%)
            </button>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="row wrap between" style={{ marginTop: 12, gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={copyImage}>
              <SlabIcon name="share" size={14} /> {copied ? "Copied!" : "Copy Image"}
            </button>
            <button className="btn sm" onClick={downloadPng} disabled={downloading}>
              <SlabIcon name="external" size={14} /> Download PNG
            </button>
          </div>
          <button
            className="btn primary"
            onClick={shareToX}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              style={{ marginRight: 4 }}
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Share on X
          </button>
        </div>
      </div>
    </div>
  );
}
