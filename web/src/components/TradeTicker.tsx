"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ago,
  fmtNear,
  isGraduated,
  LINEAR,
  lp,
  REF,
  safeImageSrc,
  type TokenView,
  type Trade,
  view,
  YOCTO,
} from "@/lib/near";
import { getGlobalTrades, isSocialConfigured, useStream, type GlobalTrade } from "@/lib/social";

const FLOW_LIMIT = 24;

function tradeKey(tr: GlobalTrade) {
  return `${tr.token_id}-${Math.floor(tr.ts)}-${tr.account}-${tr.near}-${tr.tokens}`;
}

export function TradeTicker() {
  const [trades, setTrades] = useState<GlobalTrade[]>([]);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const lastSeenNewestKey = useRef<string | null>(null);

  const mergeTrades = useCallback((incoming: GlobalTrade[], markNewest = false) => {
    if (!incoming.length) return;
    setTrades((prev) => {
      const map = new Map<string, GlobalTrade>();
      for (const item of [...prev, ...incoming]) {
        map.set(tradeKey(item), item);
      }
      // Chronological order: least recent -> most recent (left to right)
      const sorted = Array.from(map.values())
        .sort((a, b) => a.ts - b.ts || a.id - b.id)
        .slice(-FLOW_LIMIT);

      const newest = sorted[sorted.length - 1];
      if (newest) {
        const nk = tradeKey(newest);
        if (markNewest && lastSeenNewestKey.current && lastSeenNewestKey.current !== nk) {
          setHighlightKey(nk);
          setTimeout(() => setHighlightKey((cur) => (cur === nk ? null : cur)), 2600);
        }
        lastSeenNewestKey.current = nk;
      }
      return sorted;
    });
  }, []);

  // Load directly from NEAR RPC as reliable source (plus Social API if configured)
  const fetchAllRecentTrades = useCallback(
    async (markNewest = false) => {
      try {
        const [socialRows, tokens] = await Promise.all([
          isSocialConfigured() ? getGlobalTrades(FLOW_LIMIT) : Promise.resolve([] as GlobalTrade[]),
          lp<TokenView[]>("get_tokens", { from_index: 0, limit: 25 }).catch(() => [] as TokenView[]),
        ]);

        const tokenMap = new Map(tokens.map((t) => [t.token_id, t]));
        const rpcTrades: GlobalTrade[] = [];

        // Pull on-chain curve trades for tokens that have trade activity
        const activeTokens = tokens.filter((t) => t.deployed && t.trade_count > 0).slice(0, 12);
        const perToken = await Promise.all(
          activeTokens.map(async (tok) => {
            const list = await lp<Trade[]>("get_trades", { token_id: tok.token_id, limit: 10 }).catch(() => [] as Trade[]);
            return list.map((tr, i): GlobalTrade => ({
              id: tok.trade_count - i,
              token_id: tok.token_id,
              ts: tr.ts,
              account: tr.account,
              is_buy: tr.is_buy ? 1 : 0,
              near: tr.near,
              tokens: tr.tokens,
              price: 0,
              v_near: tr.v_near,
              v_tokens: tr.v_tokens,
              symbol: tok.meta.symbol,
              icon: tok.meta.icon,
            }));
          }),
        );
        for (const list of perToken) rpcTrades.push(...list);

        // Enrich social rows with fresh token metadata if missing
        const enrichedSocial = (socialRows || []).map((row) => {
          const tok = tokenMap.get(row.token_id);
          return {
            ...row,
            symbol: row.symbol || tok?.meta.symbol || row.token_id.split(".")[0].toUpperCase(),
            icon: row.icon ?? tok?.meta.icon ?? null,
          };
        });

        // Also check graduated Ref pools once for baseline info if social is down
        const gradTokens = tokens.filter((t) => isGraduated(t) && t.pool_id !== null).slice(0, 5);
        if (gradTokens.length > 0 && !isSocialConfigured()) {
          // Ensure pool contract is readable for live awareness (reserved for future pool event hooks)
          await Promise.all(
            gradTokens.map((t) => view(REF, "get_pool", { pool_id: t.pool_id }).catch(() => null)),
          );
          await view<string>(LINEAR, "ft_price").catch(() => YOCTO.toString());
        }

        mergeTrades([...rpcTrades, ...enrichedSocial], markNewest);
      } finally {
        setLoaded(true);
      }
    },
    [mergeTrades],
  );

  // Initial load + 6s RPC sync poll
  useEffect(() => {
    fetchAllRecentTrades(false);
    const interval = setInterval(() => fetchAllRecentTrades(true), 6000);
    return () => clearInterval(interval);
  }, [fetchAllRecentTrades]);

  // Listen for optimistic local browser trade events from TradePanel
  useEffect(() => {
    const onLocalTrade = (e: Event) => {
      const detail = (e as CustomEvent<GlobalTrade>).detail;
      if (detail && detail.token_id) {
        mergeTrades([detail], true);
      }
      setTimeout(() => fetchAllRecentTrades(true), 1500);
    };
    window.addEventListener("floorpad:trade", onLocalTrade);
    return () => window.removeEventListener("floorpad:trade", onLocalTrade);
  }, [mergeTrades, fetchAllRecentTrades]);

  // Listen to SSE live trade stream when Social API is configured
  useStream(isSocialConfigured() ? "global" : null, {
    trade: (data: unknown) => {
      const tr = data as GlobalTrade;
      if (!tr || !tr.token_id || !tr.near) return;
      mergeTrades([tr], true);
    },
  });

  // Auto-scroll to keep the newest (rightmost) trades visible as they push previous events left
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [trades]);

  if (loaded && trades.length === 0) return null;

  const newestTs = trades.length > 0 ? trades[trades.length - 1].ts : 0;
  const isRecentlyLive = newestTs > 0 && Math.floor(Date.now() / 1000) - newestTs <= 900;

  return (
    <aside className="trade-ticker-bar" aria-label="Recent Launchpad Trades">
      <div className="container wide trade-ticker-inner">
        <div className={`ticker-label ${isRecentlyLive ? "" : "stale"}`}>
          {isRecentlyLive && <span className="live-pulse" />}
          <span className="ticker-label-text">{isRecentlyLive ? "LIVE TRADES" : "RECENT TRADES"}</span>
        </div>

        <div className="ticker-flow-wrap" ref={trackRef}>
          {trades.length === 0 ? (
            <div className="ticker-empty small muted">
              Loading recent trades…
            </div>
          ) : (
            <div className="ticker-track">
              {trades.map((tr) => {
                const key = tradeKey(tr);
                const isNew = highlightKey === key;
                const sym = tr.symbol || tr.token_id.split(".")[0].toUpperCase();
                const isBuy = Boolean(tr.is_buy);
                const safeIcon = safeImageSrc(tr.icon);

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

                    {safeIcon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={safeIcon} alt={`$${sym} icon`} className="ticker-avatar" />
                    ) : (
                      <span className="ticker-avatar-placeholder">{sym.slice(0, 2)}</span>
                    )}

                    <span className="ticker-sym">${sym}</span>

                    <span className="ticker-amount mono">
                      {isBuy ? "+" : "-"}
                      {fmtNear(tr.near, 2)} N
                    </span>

                    <span className="ticker-account muted mono small ellipsis" style={{ maxWidth: 88 }}>
                      {tr.account}
                    </span>

                    <span className="ticker-time muted small">
                      {ago(tr.ts)}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
