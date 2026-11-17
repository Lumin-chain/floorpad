"use client";

/**
 * Token chart: TradingView lightweight-charts candles + volume, the live floor, every trade marked
 * where it happened (buys as mascot heads sized by NEAR spent, sells as red dots) and the
 * protocol's own events (burns, LP harvests, buybacks, graduation) from the on-chain mech log.
 *
 * Data: candles and trades come from the trade index, which reads curve trades and Ref swaps from
 * the chain; protocol events come straight from the launchpad (`get_mech_log`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { fmtNear, fmtPrice, lp, type MechEvent, type TokenView, type Trade } from "@/lib/near";
import { getCandles, isSocialConfigured, type Candle } from "@/lib/social";
import { useView, useWallet } from "@/lib/wallet";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
const TF_SECS: Record<Timeframe, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };

const UP = "#3fbf8a";
const DOWN = "#e5655b";
const FLOOR = "#7fd6a8";

/** Protocol events worth showing on the chart, with a label and colour. */
const EVENT_STYLE: Record<string, { label: string; color: string }> = {
  graduation_burn: { label: "🎓 Graduated", color: "#e6c14a" },
  lp_harvest_burn: { label: "🔥 LP burn", color: "#f0907a" },
  tax_burn: { label: "🔥 Tax burn", color: "#f0907a" },
  buyback_burn: { label: "🔥 Buyback", color: "#f0907a" },
  redeem_burn: { label: "🧱 Redeem", color: FLOOR },
  lp_harvest: { label: "💧 Harvest", color: "#7fb8e6" },
  yield_funded: { label: "💧 Yield", color: "#7fb8e6" },
  agent_funded: { label: "🤖 Agent", color: "#c9a7f0" },
  epoch: { label: "💧 Yield", color: "#7fb8e6" },
};

const tradePrice = (tr: Trade) =>
  tr.price && tr.price > 0
    ? tr.price
    : Number(BigInt(tr.near) / 10n ** 18n) / 1e6 / Math.max(1e-9, Number(BigInt(tr.tokens) / 10n ** 12n) / 1e6);
const shortAccountId = (a: string) => (a.length > 22 ? `${a.slice(0, 14)}…${a.split(".").pop()}` : a);
const tradeNear = (tr: Trade) => Number(BigInt(tr.near) / 10n ** 18n) / 1e6;
/** Mascot head size by NEAR spent: 16px for dust up to 34px for whales. */
const headSize = (near: number) => Math.round(Math.max(16, Math.min(34, 14 + Math.sqrt(near) * 4)));

function buildCandles(trades: Trade[], tf: Timeframe): Candle[] {
  const secs = TF_SECS[tf];
  const map = new Map<number, Candle>();
  for (const tr of [...trades].sort((a, b) => a.ts - b.ts)) {
    const b = Math.floor(tr.ts / secs) * secs;
    const p = tradePrice(tr);
    const c = map.get(b);
    if (!c) map.set(b, { time: b, open: p, high: p, low: p, close: p, volume: tradeNear(tr), trades: 1 });
    else {
      c.high = Math.max(c.high, p);
      c.low = Math.min(c.low, p);
      c.close = p;
      c.volume += tradeNear(tr);
      c.trades++;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

interface Hover {
  c: Candle;
}

export function TokenChart({ t, trades, spot, floor }: { t: TokenView; trades: Trade[] | null; spot: number; floor: number }) {
  const { accountId } = useWallet();
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const floorLineRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]> | null>(null);
  const [tf, setTf] = useState<Timeframe>("5m");
  const [showTrades, setShowTrades] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [server, setServer] = useState<Candle[]>([]);
  const [hover, setHover] = useState<Hover | null>(null);
  const [frame, setFrame] = useState(0); // bumps when the visible range/size changes so heads re-position

  // ---------- data ----------
  useEffect(() => {
    if (!isSocialConfigured()) return;
    let on = true;
    getCandles(t.token_id, tf, 300).then((c) => on && setServer(c ?? []));
    return () => {
      on = false;
    };
  }, [t.token_id, tf, trades?.length]);

  const { data: mech } = useView(() => lp<MechEvent[]>("get_mech_log", { token_id: t.token_id, limit: 100 }), [t.token_id, t.mech_count], 30000);

  const candles = useMemo(() => {
    const base = server.length > 0 ? server : buildCandles(trades ?? [], tf);
    if (base.length === 0) {
      const now = Math.floor(Date.now() / 1000);
      return spot > 0 ? [{ time: Math.floor(now / TF_SECS[tf]) * TF_SECS[tf], open: spot, high: spot, low: spot, close: spot, volume: 0, trades: 0 }] : [];
    }
    return base;
  }, [server, trades, tf, spot]);

  // ---------- chart setup ----------
  useEffect(() => {
    if (!box.current) return;
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9fb8ad", fontFamily: "inherit" },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.05)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.24 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      handleScale: { axisPressedMouseMove: true },
    });
    const candlesS = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      priceFormat: { type: "custom", minMove: 1e-12, formatter: (p: number) => fmtPrice(p) },
    });
    const vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.86, bottom: 0 }, visible: false });
    chartRef.current = chart;
    candleRef.current = candlesS;
    volRef.current = vol;

    const bump = () => setFrame((n) => n + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(bump);
    chart.subscribeCrosshairMove((param) => {
      const d = param.time !== undefined ? param.seriesData.get(candlesS) : undefined;
      if (!d || !("open" in d)) return setHover(null);
      const time = param.time as number;
      const o = d as unknown as { open: number; high: number; low: number; close: number };
      setHover({ c: { time, open: o.open, high: o.high, low: o.low, close: o.close, volume: 0, trades: 0 } });
    });
    const ro = new ResizeObserver(bump);
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      floorLineRef.current = null;
    };
  }, []);

  // ---------- data -> chart ----------
  useEffect(() => {
    const cs = candleRef.current;
    const vs = volRef.current;
    if (!cs || !vs) return;
    cs.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    vs.setData(
      candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "rgba(63,191,138,0.22)" : "rgba(229,101,91,0.22)" })),
    );
    setFrame((n) => n + 1);
  }, [candles]);

  useEffect(() => {
    if (!chartRef.current || candles.length === 0) return;
    chartRef.current.timeScale().fitContent();
  }, [tf, candles.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // floor line
  useEffect(() => {
    const cs = candleRef.current;
    if (!cs) return;
    if (floorLineRef.current) cs.removePriceLine(floorLineRef.current);
    floorLineRef.current =
      floor > 0
        ? cs.createPriceLine({ price: floor, color: FLOOR, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Floor" })
        : null;
  }, [floor, candles]);

  // protocol events as built-in markers (snapped to the bar they happened in)
  useEffect(() => {
    const cs = candleRef.current;
    if (!cs) return;
    if (!showEvents || !mech?.length || candles.length === 0) return cs.setMarkers([]);
    const secs = TF_SECS[tf];
    const first = candles[0].time;
    const perBar = new Map<number, Map<string, number>>();
    for (const e of mech) {
      const style = EVENT_STYLE[e.kind];
      if (!style || e.ts < first || (e.kind === "epoch" && e.amount === "0")) continue;
      const bar = Math.floor(e.ts / secs) * secs;
      const m = perBar.get(bar) ?? new Map<string, number>();
      m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
      perBar.set(bar, m);
    }
    const barTimes = new Set(candles.map((c) => c.time));
    const markers: SeriesMarker<Time>[] = [];
    for (const [bar, kinds] of [...perBar.entries()].sort((a, b) => a[0] - b[0])) {
      // markers must sit on an existing bar: use the nearest bar at or before the event
      let tBar = bar;
      if (!barTimes.has(tBar)) {
        const prev = candles.filter((c) => c.time <= bar).pop();
        if (!prev) continue;
        tBar = prev.time;
      }
      const [kind, n] = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0];
      const st = EVENT_STYLE[kind];
      const extra = [...kinds.values()].reduce((a, b) => a + b, 0) - 1;
      markers.push({ time: tBar as UTCTimestamp, position: "belowBar", color: st.color, shape: "circle", text: `${st.label}${n > 1 || extra > 0 ? ` ×${n + extra}` : ""}` });
    }
    cs.setMarkers(markers);
  }, [mech, showEvents, candles, tf]);

  // ---------- trade heads (HTML overlay positioned on the chart) ----------
  const heads = useMemo(() => {
    const chart = chartRef.current;
    const cs = candleRef.current;
    if (!showTrades || !chart || !cs || !trades?.length || candles.length === 0) return [];
    const secs = TF_SECS[tf];
    const first = candles[0].time;
    const ts = chart.timeScale();
    const out: { key: string; x: number; y: number; size: number; tr: Trade; mine: boolean }[] = [];
    for (const tr of trades.slice(0, 250)) {
      if (tr.ts < first) continue;
      const bar = Math.floor(tr.ts / secs) * secs;
      const x = ts.timeToCoordinate(bar as UTCTimestamp);
      const y = cs.priceToCoordinate(tradePrice(tr));
      if (x === null || y === null) continue;
      const size = tr.is_buy ? headSize(tradeNear(tr)) : 9;
      out.push({ key: `${tr.ts}:${tr.account}:${tr.tokens}`, x, y, size, tr, mine: tr.account === accountId });
    }
    return out;
  }, [trades, candles, tf, showTrades, frame, accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- header numbers ----------
  const last = candles[candles.length - 1];
  const firstC = candles[0];
  const change = firstC && last && firstC.open > 0 ? ((last.close - firstC.open) / firstC.open) * 100 : 0;
  const vsFloor = floor > 0 && spot > 0 ? spot / floor : null;
  const shown = hover?.c ?? last;
  const vol24 = useMemo(() => {
    const since = Date.now() / 1000 - 86400;
    return (trades ?? []).filter((tr) => tr.ts >= since).reduce((s, tr) => s + tradeNear(tr), 0);
  }, [trades]);

  return (
    <div className="panel token-chart">
      <div className="tc-head">
        <div className="tc-price">
          <b className="mono">{fmtPrice(spot)} N</b>
          <span className={change >= 0 ? "green" : "red"}>
            {change >= 0 ? "+" : ""}
            {change.toFixed(change > 999 ? 0 : 2)}%
          </span>
          <span className="small muted">
            Floor <b className="green mono">{fmtPrice(floor)} N</b>
            {vsFloor ? ` · price ${vsFloor >= 1 ? `${vsFloor >= 100 ? Math.round(vsFloor).toLocaleString() : vsFloor.toFixed(1)}× floor` : "below floor"}` : ""}
            {` · 24h vol ${fmtNear(BigInt(Math.round(vol24 * 1e6)) * 10n ** 18n, 2)} N`}
          </span>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <div className="seg">
            {TIMEFRAMES.map((x) => (
              <button key={x} className={tf === x ? "active" : ""} onClick={() => setTf(x)}>
                {x}
              </button>
            ))}
          </div>
          <div className="seg">
            <button className={showTrades ? "active" : ""} onClick={() => setShowTrades((v) => !v)} title="Show every buy and sell">
              Trades
            </button>
            <button className={showEvents ? "active" : ""} onClick={() => setShowEvents((v) => !v)} title="Burns, harvests, buybacks, graduation">
              Events
            </button>
          </div>
        </div>
      </div>
      {shown && (
        <div className="tc-ohlc small mono">
          O <b>{fmtPrice(shown.open)}</b> H <b>{fmtPrice(shown.high)}</b> L <b>{fmtPrice(shown.low)}</b> C{" "}
          <b className={shown.close >= shown.open ? "green" : "red"}>{fmtPrice(shown.close)}</b>
        </div>
      )}
      <div className="tc-canvas" ref={box}>
        <div className="tc-heads" aria-hidden>
          {heads.map((h) =>
            h.tr.is_buy ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={h.key}
                className={`tc-head-buy${h.mine ? " mine" : ""}`}
                src={`/brand/graded/moji/face-${h.size >= 28 ? "cool" : "wink"}.webp`}
                alt=""
                title={`BUY ${tradeNear(h.tr).toFixed(3)} NEAR by ${shortAccountId(h.tr.account)} at ${fmtPrice(tradePrice(h.tr))}`}
                style={{ left: h.x - h.size / 2, top: h.y - h.size / 2, width: h.size, height: h.size }}
              />
            ) : (
              <span
                key={h.key}
                className={`tc-dot-sell${h.mine ? " mine" : ""}`}
                title={`SELL ${tradeNear(h.tr).toFixed(3)} NEAR by ${shortAccountId(h.tr.account)} at ${fmtPrice(tradePrice(h.tr))}`}
                style={{ left: h.x - h.size / 2, top: h.y - h.size / 2, width: h.size, height: h.size }}
              />
            ),
          )}
        </div>
      </div>
      <div className="tc-legend small muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/graded/moji/face-wink.webp" alt="" width={14} height={14} /> buy (bigger = more NEAR) · <span className="tc-dot-sell inline" /> sell ·{" "}
        <span className="green">- - Floor</span> · 🔥 burns · 💧 harvests · 🎓 graduation
        {accountId ? " · ringed = your trades" : ""}
      </div>
    </div>
  );
}
