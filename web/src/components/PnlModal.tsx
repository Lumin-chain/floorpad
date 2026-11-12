"use client";

import { useEffect, useMemo, useState } from "react";
import { lp, priceParam, pricePerToken, type TokenView, type Trade } from "@/lib/near";
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

  // The preview, the download and the X card are all the same server-rendered image
  // (/api/og/pnl), so what the trader sees is exactly what gets shared.
  const cardUrl = useMemo(() => {
    const q = new URLSearchParams({
      token: t.token_id,
      symbol: t.meta.symbol,
      name: t.meta.name,
      pnl: pnlPct.toFixed(2),
      account: accountId || "",
      floor: floorValNear.toFixed(2),
      usd: currentValUsd.toFixed(2),
      entry: priceParam(entryPriceUsd),
      price: priceParam(spotPriceUsd),
    });
    if (!showNetworth) q.set("hideNetworth", "1");
    return `/api/og/pnl?${q.toString()}`;
  }, [t, pnlPct, accountId, floorValNear, currentValUsd, entryPriceUsd, spotPriceUsd, showNetworth]);
  const [cardLoaded, setCardLoaded] = useState(false);
  useEffect(() => setCardLoaded(false), [cardUrl]);

  const fetchCard = async (): Promise<Blob> => {
    const res = await fetch(cardUrl);
    if (!res.ok) throw new Error(`card ${res.status}`);
    return res.blob();
  };

  // Download image as PNG
  const downloadPng = async () => {
    setDownloading(true);
    try {
      const blob = await fetchCard();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `Floorpad-${t.meta.symbol}-${isProfit ? "Profit" : "Loss"}-${pnlPct.toFixed(2)}pct.png`;
      link.href = href;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 5000);
      setToast({ kind: "ok", text: "PNL card downloaded!" });
    } catch {
      setToast({ kind: "err", text: "Could not render the PNL card. Try again." });
    } finally {
      setDownloading(false);
    }
  };

  // Copy image to clipboard (falls back to download where clipboard images are unsupported)
  const copyImage = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": fetchCard() })]);
      setCopied(true);
      setToast({ kind: "ok", text: "PNL card copied! Paste directly on X or Telegram." });
      setTimeout(() => setCopied(false), 3000);
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

    const shareUrl = `${origin}/pnl/${t.token_id}?symbol=${encodeURIComponent(t.meta.symbol)}&name=${encodeURIComponent(t.meta.name)}&pnl=${pnlParam}&account=${encodeURIComponent(accountId || "")}&floor=${floorValNear.toFixed(2)}&usd=${currentValUsd.toFixed(2)}&entry=${priceParam(entryPriceUsd)}&price=${priceParam(spotPriceUsd)}${hideNetworthParam}${refParam}`;

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
          <button className="btn sm ghost" onClick={onClose}>Close</button>
        </div>

        {/* Card preview: the exact image that is downloaded and shared */}
        <div
          style={{
            width: "100%",
            aspectRatio: "1200 / 630",
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid var(--line-strong)",
            background: "var(--bg)",
            marginTop: 12,
            position: "relative",
          }}
        >
          {!cardLoaded && <span className="skeleton" style={{ position: "absolute", inset: 0, borderRadius: 0 }} />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cardUrl}
            alt={`${t.meta.symbol} PNL card`}
            onLoad={() => setCardLoaded(true)}
            style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
          />
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
              Percentage Only (%)
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
