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
  type MechEvent,
  type TokenView,
  type Trade,
} from "@/lib/near";
import { getCandles, getIndexedTrades, isSocialConfigured, useStream, type Candle } from "@/lib/social";
import { useView } from "@/lib/wallet";
import type { TokenCtx } from "@/app/token/[id]/page";
import { TokenChart } from "./TokenChart";
import { stakeOf } from "@/lib/stake";

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

/**
 * Protocol events shown in the trades list. `unit` says what the logged amount is:
 * tokens (burns) or the token's staking token, stNEAR or LiNEAR (harvested pool fees, staking yield).
 */
const PROTOCOL_ROW: Record<string, { label: string; tone: string; unit: "tok" | "lin"; hint: string }> = {
  lp_harvest_burn: { label: "LP BURN", tone: "warn", unit: "tok", hint: "Token side of the harvested pool fees, burned" },
  lp_harvest: { label: "LP HARVEST", tone: "green", unit: "lin", hint: "Staked-NEAR side of the harvested pool fees, added to the floor" },
  epoch: { label: "YIELD", tone: "green", unit: "lin", hint: "Staking yield paid out this epoch" },
  yield_funded: { label: "YIELD BOOST", tone: "green", unit: "lin", hint: "Staked NEAR contributed to holder rewards" },
  tax_burn: { label: "TAX BURN", tone: "warn", unit: "tok", hint: "DEX tax burned" },
  buyback_burn: { label: "BUYBACK", tone: "warn", unit: "tok", hint: "Tokens bought back and burned" },
  graduation_burn: { label: "GRAD BURN", tone: "warn", unit: "tok", hint: "Unsold supply burned at graduation" },
  redeem_burn: { label: "REDEEM", tone: "", unit: "tok", hint: "Tokens redeemed at the floor and burned" },
  migration_buys: { label: "QUEUED BUYS", tone: "", unit: "tok", hint: "Buys queued during migration, filled on Rhea" },
};

type Row = { kind: "trade"; ts: number; tr: Trade } | { kind: "event"; ts: number; ev: MechEvent };

export function TradesTable({ t, trades: given, limit = 50 }: { t: TokenView; trades?: Trade[]; limit?: number }) {
  const fetched = useTrades(t);
  const trades = given ?? fetched;
  const [filter, setFilter] = useState<"all" | "buy" | "sell" | "protocol">("all");
  const { data: mech } = useView(() => lp<MechEvent[]>("get_mech_log", { token_id: t.token_id, limit: 100 }), [t.token_id, t.mech_count], 30000);

  const events = useMemo(
    () => (mech ?? []).filter((e) => PROTOCOL_ROW[e.kind] && BigInt(e.amount || "0") > 0n),
    [mech],
  );

  const rows = useMemo<Row[]>(() => {
    const tr: Row[] = (trades ?? [])
      .filter((x) => (filter === "buy" ? x.is_buy : filter === "sell" ? !x.is_buy : filter === "all"))
      .map((x) => ({ kind: "trade", ts: x.ts, tr: x }));
    const ev: Row[] = filter === "all" || filter === "protocol" ? events.map((e) => ({ kind: "event", ts: e.ts, ev: e })) : [];
    return [...tr, ...ev].sort((a, b) => b.ts - a.ts);
  }, [trades, events, filter]);

  const nTrades = rows.filter((r) => r.kind === "trade").length;
  const nEvents = rows.length - nTrades;

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
            <button className={filter === "protocol" ? "active" : ""} onClick={() => setFilter("protocol")} title="LP burns, harvests, yield and other protocol events">
              Burns &amp; yield
            </button>
          </div>
        </div>
        <span className="small muted mono">
          {nTrades > 0 || filter !== "protocol" ? `${nTrades} trades` : ""}
          {nTrades > 0 && nEvents > 0 ? " · " : ""}
          {nEvents > 0 ? `${nEvents} protocol events` : ""}
        </span>
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
            {rows.slice(0, limit).map((r, i) => {
              if (r.kind === "event") {
                const st = PROTOCOL_ROW[r.ev.kind];
                return (
                  <tr key={`e${i}`} className="protocol-row" title={st.hint}>
                    <td>
                      <span className={`badge ${st.tone}`}>{st.label}</span>
                    </td>
                    <td className="muted">–</td>
                    <td className="mono">{st.unit === "lin" ? `${fmtNear(r.ev.amount, 3)} ${stakeOf(t).symbol}` : <span className="muted">–</span>}</td>
                    <td className="mono">{st.unit === "tok" ? fmtTok(r.ev.amount, 0) : <span className="muted">–</span>}</td>
                    <td className="mono small ellipsis" style={{ maxWidth: 130 }} title={r.ev.account ?? LAUNCHPAD}>
                      {r.ev.account && r.ev.account !== LAUNCHPAD ? r.ev.account : <span className="badge">Floorpad protocol</span>}
                    </td>
                    <td className="muted nowrap">{ago(r.ts)}</td>
                  </tr>
                );
              }
              const tr = r.tr;
              const p =
                tr.v_tokens && BigInt(tr.v_tokens) > 0n
                  ? pricePerToken(BigInt(tr.v_near), BigInt(tr.v_tokens))
                  : (Number(BigInt(tr.near) / 10n ** 18n) / 1e6) / Math.max(0.000001, Number(BigInt(tr.tokens) / 10n ** 18n));
              return (
                <tr key={`t${i}`}>
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 18 }}>
                  {filter === "protocol" ? "No burns or harvests yet. They appear here as the protocol runs." : "No trades found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
