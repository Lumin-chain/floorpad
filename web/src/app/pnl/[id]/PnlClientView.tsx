"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SlabIcon } from "@/components/Brand";
import { priceParam } from "@/lib/near";

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

  const [cardLoaded, setCardLoaded] = useState(false);
  const cardUrl = useMemo(() => {
    const q = new URLSearchParams({
      token: id,
      symbol,
      name: name || symbol,
      pnl: String(pnl),
      account,
      floor: floorNear.toFixed(2),
      usd: usdVal.toFixed(2),
      entry: entryPrice ? priceParam(entryPrice) : "",
      price: currentPrice ? priceParam(currentPrice) : "",
    });
    if (!showNetworth) q.set("hideNetworth", "1");
    return `/api/og/pnl?${q.toString()}`;
  }, [id, symbol, name, pnl, account, floorNear, usdVal, entryPrice, currentPrice, showNetworth]);
  useEffect(() => setCardLoaded(false), [cardUrl]);

  const buildShareUrl = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const params = new URLSearchParams();
    params.set("symbol", symbol);
    if (name) params.set("name", name);
    params.set("pnl", String(pnl));
    if (account) params.set("account", account);
    params.set("floor", floorNear.toFixed(2));
    params.set("usd", usdVal.toFixed(2));
    if (entryPrice) params.set("entry", priceParam(entryPrice));
    if (currentPrice) params.set("price", priceParam(currentPrice));
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
      "noopener,noreferrer,width=550,height=440",
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

      {/* The same server-rendered card that X shows for this link */}
      <div
        style={{
          width: "100%",
          aspectRatio: "1200 / 630",
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid var(--line-strong)",
          background: "var(--bg)",
          position: "relative",
        }}
      >
        {!cardLoaded && <span className="skeleton" style={{ position: "absolute", inset: 0, borderRadius: 0 }} />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cardUrl}
          alt={`${symbol} PNL card`}
          onLoad={() => setCardLoaded(true)}
          style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
        />
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
