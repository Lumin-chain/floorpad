"use client";

import { useEffect, useRef, useState } from "react";
import { fmtNear, fmtPrice, fmtTok, type TokenView } from "@/lib/near";
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

  // Calculate position metrics
  const tokensNum = Number(balance / 10n ** 14n) / 1e4;
  const currentValNear = tokensNum * spotPriceNear;
  const currentValUsd = currentValNear * (nearUsd || 3.6);
  const floorValNear = tokensNum * floorPriceNear;
  const floorValUsd = floorValNear * (nearUsd || 3.6);

  // Estimated baseline entry: floor price when launched or holding duration
  const estEntryPrice = floorPriceNear > 0 ? floorPriceNear * 0.7 : spotPriceNear * 0.5;
  const calcPnlPct = estEntryPrice > 0 
    ? Math.round(((spotPriceNear - estEntryPrice) / estEntryPrice) * 100) 
    : 125;
  
  const [pnlMultiplier, setPnlMultiplier] = useState<number>(Math.max(15, calcPnlPct));

  // Render high-res 1200x630 card on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = 1200;
    const height = 630;
    canvas.width = width;
    canvas.height = height;

    // Background gradient: Deep void with neon teal & green accents
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "#080b0c");
    bgGrad.addColorStop(0.5, "#0d1315");
    bgGrad.addColorStop(1, "#050708");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Decorative grid pattern
    ctx.strokeStyle = "rgba(46, 213, 115, 0.04)";
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Outer card border
    ctx.strokeStyle = "rgba(46, 213, 115, 0.3)";
    ctx.lineWidth = 3;
    ctx.strokeRect(30, 30, width - 60, height - 60);

    // Top Header: Floorpad Brand + Mascot Pill
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 32px 'Space Grotesk', system-ui, sans-serif";
    ctx.fillText("FLOORPAD", 70, 95);

    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillText("THE MEMECOIN WITH A RISING FLOOR", 255, 95);

    // Rising Floor Pill (top-right)
    ctx.fillStyle = "rgba(46, 213, 115, 0.15)";
    ctx.strokeStyle = "rgba(46, 213, 115, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(width - 320, 65, 250, 42, 21);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#2ed573";
    ctx.font = "bold 18px monospace";
    ctx.fillText("▲ RISING FLOOR VAULT", width - 295, 92);

    // Token Details Section
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 56px system-ui, sans-serif";
    ctx.fillText(`$${t.meta.symbol}`, 70, 200);

    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.font = "26px system-ui, sans-serif";
    ctx.fillText(t.meta.name, 70, 240);

    // PNL Hero Display (Center-Left)
    const isProfit = pnlMultiplier >= 0;
    ctx.fillStyle = isProfit ? "#2ed573" : "#ff4757";
    ctx.font = "900 110px 'Space Grotesk', system-ui, sans-serif";
    const pnlText = `${isProfit ? "+" : ""}${pnlMultiplier}%`;
    ctx.fillText(pnlText, 70, 370);

    // Subtitle below PNL
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.font = "22px system-ui, sans-serif";
    ctx.fillText(`Holding ${fmtTok(balance.toString(), 0)} $${t.meta.symbol}`, 70, 420);

    // Stats Grid on Right Side
    const rightX = 680;
    
    // Card Box on Right
    ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(rightX - 30, 160, 480, 310, 16);
    ctx.fill();
    ctx.stroke();

    // Metric 1: Current Spot Value
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText("CURRENT POSITION VALUE", rightX, 210);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 34px monospace";
    ctx.fillText(`${currentValNear.toFixed(2)} NEAR ($${currentValUsd.toFixed(2)})`, rightX, 250);

    // Metric 2: Guaranteed Floor Value (Redeemable anytime)
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText("GUARANTEED FLOOR BACKING", rightX, 310);

    ctx.fillStyle = "#2ed573";
    ctx.font = "bold 34px monospace";
    ctx.fillText(`${floorValNear.toFixed(2)} NEAR ($${floorValUsd.toFixed(2)})`, rightX, 350);

    // Metric 3: Spot Price vs Floor Price
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText(
      `Floor Price: ${fmtPrice(floorPriceNear)} N  ·  Spot: ${fmtPrice(spotPriceNear)} N`,
      rightX,
      415
    );

    // Bottom Bar
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fillRect(30, height - 90, width - 60, 60);

    // Caller Account / Ref Link
    const displayAccount = accountId || "trader.near";
    ctx.fillStyle = "#2ed573";
    ctx.font = "bold 20px monospace";
    ctx.fillText(`Trader: ${displayAccount}`, 70, height - 52);

    // Call to action
    ctx.fillStyle = "#ffffff";
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillText("Join fair launch on floorpad.app", width - 390, height - 52);
  }, [t, balance, spotPriceNear, floorPriceNear, nearUsd, accountId, pnlMultiplier]);

  // Download image as PNG
  const downloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setDownloading(true);
    const link = document.createElement("a");
    link.download = `Floorpad-PNL-${t.meta.symbol}-${pnlMultiplier}pct.png`;
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
        setToast({ kind: "ok", text: "Image copied to clipboard! Paste it anywhere on X or Telegram." });
        setTimeout(() => setCopied(false), 3000);
      });
    } catch {
      // Fallback: download
      downloadPng();
    }
  };

  // Share to X (Twitter)
  const shareToX = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://web-production-964c7668.up.railway.app";
    const refParam = accountId ? `&ref=${encodeURIComponent(accountId)}` : "";
    
    // Dynamic Share Page URL which has twitter:card summary_large_image and twitter:image embedded
    const shareUrl = `${origin}/pnl/${t.token_id}?symbol=${encodeURIComponent(t.meta.symbol)}&pnl=${pnlMultiplier}&account=${encodeURIComponent(accountId || "")}&floor=${floorValNear.toFixed(2)}&usd=${currentValUsd.toFixed(2)}${refParam}`;

    const text = `🚀 Up +${pnlMultiplier}% on $${t.meta.symbol} on @Floorpad! 📈\n\n🛡️ Floor vault only rises\n🔒 Ref LP locked forever earning staking yield\n🏛️ Holder DAO\n\nCheck my position & trade:`;
    
    const tweetUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(tweetUrl, "_blank", "width=550,height=420");
  };

  return (
    <div className="sheet-backdrop" onClick={onClose} style={{ display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div 
        className="panel stack" 
        onClick={(e) => e.stopPropagation()} 
        style={{ 
          maxWidth: 720, 
          width: "95vw", 
          maxHeight: "92vh", 
          overflowY: "auto",
          background: "#0d1315", 
          border: "1px solid rgba(46, 213, 115, 0.4)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.8), 0 0 30px rgba(46, 213, 115, 0.15)",
          padding: 24,
          borderRadius: 16
        }}
      >
        <div className="row between">
          <div className="row" style={{ gap: 10 }}>
            <Moji face="hero" size={28} />
            <h2 style={{ margin: 0 }}>Share PNL Card</h2>
          </div>
          <button className="btn sm ghost" onClick={onClose}>✕</button>
        </div>

        <p className="small muted" style={{ margin: "4px 0 12px" }}>
          Share your $<b>{t.meta.symbol}</b> performance on X (Twitter). The floor value shows what you can redeem right now from the vault.
        </p>

        {/* Live Canvas Preview */}
        <div style={{ width: "100%", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", background: "#050708" }}>
          <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block" }} />
        </div>

        {/* Multiplier Adjustment Presets */}
        <div className="row wrap between" style={{ marginTop: 12, gap: 8 }}>
          <span className="small muted">Display PNL:</span>
          <div className="row" style={{ gap: 6 }}>
            {[25, 50, 100, 200, 500].map((pct) => (
              <button
                key={pct}
                className={`btn sm ${pnlMultiplier === pct ? "primary" : "ghost"}`}
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => setPnlMultiplier(pct)}
              >
                +{pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Actions Bar */}
        <div className="row wrap between" style={{ marginTop: 18, gap: 10, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 16 }}>
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
            style={{ 
              background: "#000000", 
              color: "#ffffff", 
              border: "1px solid rgba(255,255,255,0.3)",
              fontWeight: 700 
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 6, verticalAlign: -2 }}>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            Share on X
          </button>
        </div>
      </div>
    </div>
  );
}
