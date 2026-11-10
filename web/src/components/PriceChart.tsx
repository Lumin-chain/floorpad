"use client";

import { ago, floorPrice, fmtNear, fmtPrice, fmtTok, lp, pricePerToken, type TokenView, type Trade } from "@/lib/near";
import { useView } from "@/lib/wallet";
import type { TokenCtx } from "@/app/token/[id]/page";

function useTrades(t: TokenView) {
  return useView(() => lp<Trade[]>("get_trades", { token_id: t.token_id, limit: 200 }), [t.token_id, t.trade_count], 10000).data;
}

/** Curve price history (from the on-chain trade ring buffer) against the current floor. */
export function PriceChart({ t, linearPrice }: TokenCtx) {
  const trades = useTrades(t);
  const pts = [...(trades ?? [])].reverse().map((x) => ({ ts: x.ts, p: pricePerToken(BigInt(x.v_near), BigInt(x.v_tokens)) }));
  const now = pricePerToken(BigInt(t.v_near), BigInt(t.v_tokens));
  if (pts.length === 0) pts.push({ ts: t.created_at, p: now }, { ts: t.created_at, p: now });
  const floor = floorPrice(t, linearPrice);

  const W = 640, H = 260, P = 10;
  const max = Math.max(...pts.map((p) => p.p), floor) * 1.1 || 1;
  const x = (i: number) => P + (i / Math.max(1, pts.length - 1)) * (W - 2 * P);
  const y = (p: number) => H - P - (p / max) * (H - 2 * P);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1)},${H - P} L${x(0)},${H - P} Z`;

  return (
    <div className="panel chart-panel">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Price vs floor</h2>
        <span className="small muted">{fmtPrice(now)} N · floor {fmtPrice(floor)} N</span>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Price history versus floor">
        <defs>
          <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#7cf29a" stopOpacity=".25" />
            <stop offset="1" stopColor="#7cf29a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x={P} y={y(floor)} width={W - 2 * P} height={Math.max(0, H - P - y(floor))} fill="#7cf29a" opacity=".08" />
        <line x1={P} x2={W - P} y1={y(floor)} y2={y(floor)} stroke="#7cf29a" strokeDasharray="5 5" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path d={area} fill="url(#g)" />
        <path d={line} fill="none" stroke="#e8eaed" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="desktop-only-block">
        <TradesTable t={t} trades={trades} limit={8} />
      </div>
    </div>
  );
}

export function TradesTable({ t, trades: given, limit = 50 }: { t: TokenView; trades?: Trade[]; limit?: number }) {
  const fetched = useTrades(t);
  const trades = given ?? fetched;
  return (
    <div className="table-scroll">
      <table className="t" style={{ marginTop: 10 }}>
        <thead>
          <tr><th>Side</th><th>NEAR</th><th>Tokens</th><th>Account</th><th>When</th></tr>
        </thead>
        <tbody>
          {(trades ?? []).slice(0, limit).map((tr, i) => (
            <tr key={i}>
              <td className={tr.is_buy ? "green" : "bad"}>{tr.is_buy ? "Buy" : "Sell"}</td>
              <td>{fmtNear(tr.near, 3)}</td>
              <td>{fmtTok(tr.tokens, 0)}</td>
              <td className="mono small ellipsis" style={{ maxWidth: 120 }}>{tr.account}</td>
              <td className="muted nowrap">{ago(tr.ts)}</td>
            </tr>
          ))}
          {trades?.length === 0 && (
            <tr><td colSpan={5} className="muted">No trades yet. Be the first.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
