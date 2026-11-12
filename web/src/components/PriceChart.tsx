"use client";

import { useEffect, useMemo, useState } from "react";
import {
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

function useTrades(t: TokenView) {
  const [liveTrades, setLiveTrades] = useState<Trade[]>([]);
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
          })),
        );
      }
    });
  }, [t.token_id, t.trade_count]);

  // Stream new trades live via SSE
  useStream(isSocialConfigured() ? `token:${t.token_id}` : null, {
    trade: (data: unknown) => {
      const tr = data as { ts: number; account: string; is_buy: number; near: string; tokens: string; v_near: string; v_tokens: string };
      if (!tr || !tr.near) return;
      const parsed: Trade = {
        ts: tr.ts,
        account: tr.account,
        is_buy: Boolean(tr.is_buy),
        near: tr.near,
        tokens: tr.tokens,
        v_near: tr.v_near,
        v_tokens: tr.v_tokens,
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

/** Pro Price Chart: Candlestick (OHLCV) + Line modes with live stream and Floor Vault level. */
export function PriceChart({ t, linearPrice }: TokenCtx) {
  const trades = useTrades(t);
  const [mode, setMode] = useState<"candles" | "line">("candles");
  const [tf, setTf] = useState<Timeframe>("5m");
  const [serverCandles, setServerCandles] = useState<Candle[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Fetch Ref pool if token has graduated to Rhea/Ref Finance
  const { data: refPool } = useView(
    t.grad_stage === "Graduated" && t.pool_id !== null
      ? () => view<{ token_account_ids: string[]; amounts: string[]; total_fee: number }>(REF, "get_pool", { pool_id: t.pool_id })
      : null,
    [t.token_id, t.pool_id],
    6000,
  );

  // Fetch indexed candles from server
  useEffect(() => {
    if (!isSocialConfigured()) return;
    let active = true;
    getCandles(t.token_id, tf, 80).then((c) => {
      if (active && c && c.length > 0) setServerCandles(c);
    });
    return () => {
      active = false;
    };
  }, [t.token_id, tf, t.trade_count, trades?.length]);

  const now = tokenSpotPrice(t, refPool, linearPrice);
  const floor = floorPrice(t, linearPrice);

  // Fallback: build candles locally from trade ring buffer if server has no candles yet
  const candles: Candle[] = useMemo(() => {
    if (serverCandles.length > 0) return serverCandles;
    if (!trades || trades.length === 0) {
      const curTime = Math.floor(Date.now() / 1000);
      return [{ time: curTime, open: now, high: now, low: now, close: now, volume: 0, trades: 1 }];
    }
    const bucketSecs = TF_SECS[tf];
    const sorted = [...trades].sort((a, b) => a.ts - b.ts);
    const map = new Map<number, Candle>();

    for (const tr of sorted) {
      const bucket = Math.floor(tr.ts / bucketSecs) * bucketSecs;
      const p =
        tr.v_tokens && BigInt(tr.v_tokens) > 0n
          ? pricePerToken(BigInt(tr.v_near), BigInt(tr.v_tokens))
          : (Number(BigInt(tr.near) / 10n ** 18n) / 1e6) / Math.max(0.000001, Number(BigInt(tr.tokens) / 10n ** 18n));
      const volNear = Number(BigInt(tr.near) / 10n ** 18n) / 1e6;
      const existing = map.get(bucket);
      if (!existing) {
        map.set(bucket, { time: bucket, open: p, high: p, low: p, close: p, volume: volNear, trades: 1 });
      } else {
        existing.high = Math.max(existing.high, p);
        existing.low = Math.min(existing.low, p);
        existing.close = p;
        existing.volume += volNear;
        existing.trades += 1;
      }
    }
    const list = Array.from(map.values()).sort((a, b) => a.time - b.time);
    return list.length > 0 ? list : [{ time: Math.floor(Date.now() / 1000), open: now, high: now, low: now, close: now, volume: 0, trades: 1 }];
  }, [serverCandles, trades, tf, now]);

  // Dimensions
  const W = 680;
  const H = 280;
  const PAD_TOP = 14;
  const PAD_BOTTOM = 46; // space for volume bars
  const P = 14;

  const minPrice = Math.min(...candles.map((c) => c.low), floor * 0.95);
  const maxPrice = Math.max(...candles.map((c) => c.high), floor * 1.05, now * 1.05) * 1.05 || 1;
  const maxVol = Math.max(...candles.map((c) => c.volume), 0.1);

  const priceHeight = H - PAD_TOP - PAD_BOTTOM;
  const scaleY = (p: number) => PAD_TOP + priceHeight - ((p - minPrice) / (maxPrice - minPrice || 1)) * priceHeight;
  const scaleX = (i: number) => P + (i / Math.max(1, candles.length - 1)) * (W - 2 * P);
  const candleW = Math.max(2, Math.min(18, (W - 2 * P) / Math.max(1, candles.length) * 0.7));

  // Floor position
  const yFloor = scaleY(floor);

  // Line mode points
  const linePts = candles.map((c, i) => `${i ? "L" : "M"}${scaleX(i).toFixed(1)},${scaleY(c.close).toFixed(1)}`).join(" ");
  const lineArea = `${linePts} L${scaleX(candles.length - 1)},${PAD_TOP + priceHeight} L${scaleX(0)},${PAD_TOP + priceHeight} Z`;

  const activeCandle = hoverIndex !== null && candles[hoverIndex] ? candles[hoverIndex] : candles[candles.length - 1];
  const sparse = candles.length < 3;
  const effectiveMode = sparse ? "line" : mode;
  const linePtsClean =
    candles.length === 1
      ? `M${P},${scaleY(candles[0].close).toFixed(1)} L${W - P},${scaleY(candles[0].close).toFixed(1)}`
      : linePts;
  const lineAreaClean =
    candles.length === 1
      ? `${linePtsClean} L${W - P},${PAD_TOP + priceHeight} L${P},${PAD_TOP + priceHeight} Z`
      : lineArea;

  return (
    <div className="panel chart-panel stack" style={{ gap: 12 }}>
      {/* Chart Header */}
      <div className="row between wrap">
        <div className="row wrap" style={{ gap: 12 }}>
          <h2 style={{ margin: 0 }}>Price vs Floor</h2>
          <div className="seg">
            <button className={effectiveMode === "candles" ? "active" : ""} disabled={sparse} title={sparse ? "Needs at least 3 time buckets for candles" : undefined} onClick={() => setMode("candles")}>Candles</button>
            <button className={effectiveMode === "line" ? "active" : ""} onClick={() => setMode("line")}>Line</button>
          </div>
          <div className="seg">
            {TIMEFRAMES.map((item) => (
              <button key={item} className={tf === item ? "active" : ""} onClick={() => setTf(item)}>{item}</button>
            ))}
          </div>
        </div>

        <div className="row wrap" style={{ gap: 12 }}>
          <span className="small">
            Spot <strong className="green">{fmtPrice(now)} N</strong>
          </span>
          <span className="small">
            Floor <strong style={{ color: "#22C55E" }}>{fmtPrice(floor)} N</strong>
          </span>
        </div>
      </div>

      {sparse && (
        <div className="xs muted">
          Early trade history ({candles.length} bucket{candles.length === 1 ? "" : "s"} on {tf}) — showing price line vs floor.
        </div>
      )}

      {/* OHLC Bar Info with fixed minHeight to eliminate layout shift */}
      <div className="row wrap small mono" style={{ gap: 14, minHeight: 28, color: "var(--muted)", background: "var(--panel-2)", padding: "4px 10px", borderRadius: 8, alignItems: "center" }}>
        {activeCandle ? (
          <>
            <span>O: <strong style={{ color: "var(--text)" }}>{fmtPrice(activeCandle.open)}</strong></span>
            <span>H: <strong style={{ color: "var(--text)" }}>{fmtPrice(activeCandle.high)}</strong></span>
            <span>L: <strong style={{ color: "var(--text)" }}>{fmtPrice(activeCandle.low)}</strong></span>
            <span>C: <strong style={{ color: activeCandle.close >= activeCandle.open ? "#22C55E" : "#EF4444" }}>{fmtPrice(activeCandle.close)}</strong></span>
            <span>Vol: <strong style={{ color: "var(--text)" }}>{activeCandle.volume.toFixed(2)} N</strong></span>
            <span className="muted nowrap">{ago(activeCandle.time)}</span>
          </>
        ) : (
          <span>Loading candle metrics…</span>
        )}
      </div>

      {/* SVG Canvas */}
      <div style={{ position: "relative", width: "100%" }}>
        <svg
          className="chart"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Price candlestick and floor chart"
          style={{ width: "100%", height: 280, overflow: "visible" }}
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width;
            const idx = Math.round(relX * (candles.length - 1));
            setHoverIndex(Math.max(0, Math.min(candles.length - 1, idx)));
          }}
        >
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Floor vault backing zone */}
          <rect
            x={P}
            y={Math.min(H - PAD_BOTTOM, Math.max(PAD_TOP, yFloor))}
            width={W - 2 * P}
            height={Math.max(0, H - PAD_BOTTOM - Math.min(H - PAD_BOTTOM, Math.max(PAD_TOP, yFloor)))}
            fill="#16A34A"
            opacity="0.1"
          />

          {/* Floor vault horizontal dashed boundary */}
          <line
            x1={P}
            x2={W - P}
            y1={yFloor}
            y2={yFloor}
            stroke="#22C55E"
            strokeDasharray="5 4"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
          <text x={W - P - 6} y={Math.max(PAD_TOP + 12, yFloor - 4)} textAnchor="end" fill="#22C55E" fontSize="12" className="mono">
            Vault Floor: {fmtPrice(floor)} N
          </text>

          {/* Line Mode */}
          {effectiveMode === "line" && (
            <>
              <path d={lineAreaClean} fill="url(#areaGrad)" />
              <path d={linePtsClean} fill="none" stroke="#3B82F6" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </>
          )}

          {/* Candlestick Mode */}
          {effectiveMode === "candles" &&
            candles.map((c, i) => {
              const cx = scaleX(i);
              const yOpen = scaleY(c.open);
              const yClose = scaleY(c.close);
              const yHigh = scaleY(c.high);
              const yLow = scaleY(c.low);
              const isBull = c.close >= c.open;
              const color = isBull ? "#22C55E" : "#EF4444";

              const bodyTop = Math.min(yOpen, yClose);
              const bodyHeight = Math.max(1.5, Math.abs(yClose - yOpen));

              // Volume bar
              const volBarH = (c.volume / maxVol) * (PAD_BOTTOM - 8);
              const volY = H - volBarH;

              return (
                <g key={i}>
                  {/* Volume bar */}
                  <rect
                    x={cx - candleW / 2}
                    y={volY}
                    width={candleW}
                    height={volBarH}
                    fill={color}
                    opacity="0.3"
                  />
                  {/* Wick */}
                  <line
                    x1={cx}
                    x2={cx}
                    y1={yHigh}
                    y2={yLow}
                    stroke={color}
                    strokeWidth="1.2"
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* Candle Body */}
                  <rect
                    x={cx - candleW / 2}
                    y={bodyTop}
                    width={candleW}
                    height={bodyHeight}
                    fill={color}
                    rx="1"
                  />
                </g>
              );
            })}

          {/* Crosshair indicator */}
          {hoverIndex !== null && (
            <line
              x1={scaleX(hoverIndex)}
              x2={scaleX(hoverIndex)}
              y1={PAD_TOP}
              y2={H}
              stroke="#6B7280"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
          )}
        </svg>
      </div>
    </div>
  );
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
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E", display: "inline-block" }} />
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
                  <td className="mono small ellipsis" style={{ maxWidth: 130 }}>
                    {tr.account}
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
