"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LAUNCHPAD,
  ago,
  floorPrice,
  fmtNear,
  fmtPrice,
  fmtTok,
  lp,
  pricePerToken,
  REF,
  tokenSpotPrice,
  view,
  type TokenView,
  type Trade,
} from "@/lib/near";
import { getCandles, getIndexedTrades, isSocialConfigured, useStream, type Candle } from "@/lib/social";
import { useView } from "@/lib/wallet";
import type { TokenCtx } from "@/app/token/[id]/page";
import { TokenChart } from "./TokenChart";

function useTrades(t: TokenView) {
  const [liveTrades, setLiveTrades] = useState<Trade[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(h);
  }, []);
  const fetched = useView(() => lp<Trade[]>("get_trades", { token_id: t.token_id, limit: 200 }), [t.token_id, t.trade_count], 8000).data;
  const [serverTrades, setServerTrades] = useState<Trade[]>([]);

  // Fetch server indexed trades (captures Ref Finance pool trades for graduated tokens)
  useEffect(() => {
    if (!isSocialConfigured()) return;
    getIndexedTrades(t.token_id, 100).then((res) => {
      if (res && res.length > 0) {
        setServerTrades(
          res.map((r) => ({
            ts: r.ts,
            account: r.account,
            is_buy: Boolean(r.is_buy),
            near: r.near,
            tokens: r.tokens,
            v_near: r.v_near,
            v_tokens: r.v_tokens,
            price: r.price,
          })),
        );
      }
    });
    // graduated tokens trade on Ref without bumping trade_count, so refresh on a timer too
  }, [t.token_id, t.trade_count, tick]);

  // Stream new trades live via SSE
  useStream(isSocialConfigured() ? `token:${t.token_id}` : null, {
    trade: (data: unknown) => {
      const tr = data as { ts: number; account: string; is_buy: number; near: string; tokens: string; v_near: string; v_tokens: string; price?: number };
      if (!tr || !tr.near) return;
      const parsed: Trade = {
        ts: tr.ts,
        account: tr.account,
        is_buy: Boolean(tr.is_buy),
        near: tr.near,
        tokens: tr.tokens,
        v_near: tr.v_near,
        v_tokens: tr.v_tokens,
        price: tr.price,
      };
      setLiveTrades((prev) => [parsed, ...prev.slice(0, 199)]);
    },
  });

  return useMemo(() => {
    if (!fetched && serverTrades.length === 0 && liveTrades.length === 0) return null;
    const combined = [...liveTrades, ...serverTrades, ...(fetched ?? [])];
    const seen = new Set<string>();
    const unique: Trade[] = [];
    for (const tr of combined) {
      const k = `${tr.ts}:${tr.account}:${tr.near}:${tr.tokens}`;
      if (!seen.has(k)) {
        seen.add(k);
        unique.push(tr);
      }
    }
    return unique;
  }, [fetched, serverTrades, liveTrades]);
}

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "1d"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const TF_SECS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "1d": 86400,
};

/** Token chart: candles, volume, floor, every trade and protocol events (see TokenChart). */
export function PriceChart({ t, linearPrice }: TokenCtx) {
  const trades = useTrades(t);
  const { data: refPool } = useView(
    t.grad_stage === "Graduated" && t.pool_id !== null
      ? () => view<{ token_account_ids: string[]; amounts: string[]; total_fee: number }>(REF, "get_pool", { pool_id: t.pool_id })
      : null,
    [t.token_id, t.pool_id],
    6000,
  );
  return <TokenChart t={t} trades={trades} spot={tokenSpotPrice(t, refPool, linearPrice)} floor={floorPrice(t, linearPrice)} />;
}

export function TradesTable({ t, trades: given, limit = 50 }: { t: TokenView; trades?: Trade[]; limit?: number }) {
  const fetched = useTrades(t);
  const trades = given ?? fetched;
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("all");

  const filtered = useMemo(() => {
    if (!trades) return [];
    if (filter === "buy") return trades.filter((x) => x.is_buy);
    if (filter === "sell") return trades.filter((x) => !x.is_buy);
    return trades;
  }, [trades, filter]);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row between wrap">
        <div className="row" style={{ gap: 8 }}>
          <span className="badge green" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#7DD3A8", display: "inline-block" }} />
            Live Tape
          </span>
          <div className="seg">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
            <button className={filter === "buy" ? "active" : ""} onClick={() => setFilter("buy")}>Buys</button>
            <button className={filter === "sell" ? "active" : ""} onClick={() => setFilter("sell")}>Sells</button>
          </div>
        </div>
        <span className="small muted mono">{filtered.length} trades recorded</span>
      </div>

      <div className="table-scroll">
        <table className="t">
          <thead>
            <tr>
              <th>Side</th>
              <th>Price (N)</th>
              <th>NEAR</th>
              <th>Tokens</th>
              <th>Account</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((tr, i) => {
              const p =
                tr.v_tokens && BigInt(tr.v_tokens) > 0n
                  ? pricePerToken(BigInt(tr.v_near), BigInt(tr.v_tokens))
                  : (Number(BigInt(tr.near) / 10n ** 18n) / 1e6) / Math.max(0.000001, Number(BigInt(tr.tokens) / 10n ** 18n));
              return (
                <tr key={i}>
                  <td className={tr.is_buy ? "green" : "bad"}>
                    <strong>{tr.is_buy ? "BUY" : "SELL"}</strong>
                  </td>
                  <td className="mono">{fmtPrice(p)}</td>
                  <td className="mono">{fmtNear(tr.near, 3)}</td>
                  <td className="mono">{fmtTok(tr.tokens, 0)}</td>
                  <td className="mono small ellipsis" style={{ maxWidth: 130 }} title={tr.account}>
                    {tr.account === LAUNCHPAD ? (
                      // Protocol activity (old DEX-tax swaps; since the burn-only upgrade the protocol never sells).
                      <span className="badge">Floorpad protocol</span>
                    ) : (
                      tr.account
                    )}
                  </td>
                  <td className="muted nowrap">{ago(tr.ts)}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 18 }}>
                  No trades found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
