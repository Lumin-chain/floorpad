"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ago, fmtNear, fmtPrice, fmtTok } from "@/lib/near";
import { getGlobalTrades, useStream, type GlobalTrade } from "@/lib/social";
import { SlabIcon } from "./Brand";

export function TradeTicker() {
  const [trades, setTrades] = useState<GlobalTrade[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Load initial recent trades across the launchpad
  useEffect(() => {
    let active = true;
    getGlobalTrades(20).then((data) => {
      if (active && data && data.length > 0) {
        setTrades(data);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Listen to platform-wide live trade events via SSE
  useStream("global", {
    trade: (data: unknown) => {
      const tr = data as GlobalTrade;
      if (!tr || !tr.token_id || !tr.near) return;

      const key = `${tr.token_id}-${tr.id}-${tr.ts}`;
      setHighlightId(key);
      setTimeout(() => setHighlightId(null), 2500);

      setTrades((prev) => {
        // Prevent duplicate events
        const exists = prev.some(
          (p) => p.token_id === tr.token_id && p.id === tr.id && p.ts === tr.ts,
        );
        if (exists) return prev;
        return [tr, ...prev.slice(0, 24)];
      });
    },
  });

  if (trades.length === 0) return null;

  return (
    <aside className="trade-ticker-bar" aria-label="Live Launchpad Trades">
      <div className="container wide trade-ticker-inner">
        <div className="ticker-label">
          <span className="live-pulse" />
          <span className="ticker-label-text">LIVE TRADES</span>
        </div>

        <div className="ticker-flow-wrap">
          <div className="ticker-track">
            {trades.map((tr) => {
              const key = `${tr.token_id}-${tr.id}-${tr.ts}`;
              const isNew = highlightId === key;
              const sym = tr.symbol || tr.token_id.split(".")[0].toUpperCase();
              const isBuy = Boolean(tr.is_buy);

              return (
                <Link
                  key={key}
                  href={`/token/${tr.token_id}`}
                  className={`ticker-item ${isBuy ? "buy" : "sell"} ${isNew ? "new-entry" : ""}`}
                  title={`Trade by ${tr.account} on $${sym} · Click to view token`}
                >
                  <span className={`ticker-tag ${isBuy ? "buy-tag" : "sell-tag"}`}>
                    {isBuy ? "BUY" : "SELL"}
                  </span>

                  {tr.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={tr.icon} alt="" className="ticker-avatar" />
                  ) : (
                    <span className="ticker-avatar-placeholder">{sym.slice(0, 2)}</span>
                  )}

                  <span className="ticker-sym">${sym}</span>

                  <span className="ticker-amount mono">
                    {isBuy ? "+" : "-"}
                    {fmtNear(tr.near, 2)} N
                  </span>

                  <span className="ticker-account muted mono small ellipsis" style={{ maxWidth: 80 }}>
                    {tr.account}
                  </span>

                  <span className="ticker-time muted small">
                    {ago(tr.ts)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}

