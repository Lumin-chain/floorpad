"use client";

import { ago, floorPrice, fmtNear, fmtPrice, fmtTok, lp, pricePerToken, type Trade } from "@/lib/near";
import { useView } from "@/lib/wallet";
import type { TokenCtx } from "@/app/token/[id]/page";

/** Curve price history (from on-chain trade ring buffer) against the current floor. */
export function PriceChart({ t, linearPrice }: TokenCtx) {
  const { data: trades } = useView(() => lp<Trade[]>("get_trades", { token_id: t.token_id, limit: 200 }), [t.token_id, t.trade_count], 10000);
  const pts = [...(trades ?? [])].reverse().map((x) => ({ ts: x.ts, p: pricePerToken(BigInt(x.v_near), BigInt(x.v_tokens)) }));
  const now = pricePerToken(BigInt(t.v_near), BigInt(t.v_tokens));
  if (pts.length === 0) pts.push({ ts: t.created_at, p: now }, { ts: t.created_at, p: now });
  const floor = floorPrice(t, linearPrice);

  const W = 640, H = 260, P = 28;
  const max = Math.max(...pts.map((p) => p.p), floor) * 1.1 || 1;
  const x = (i: number) => P + (i / Math.max(1, pts.length - 1)) * (W - 2 * P);
  const y = (p: number) => H - P - (p / max) * (H - 2 * P);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1)},${H - P} L${x(0)},${H - P} Z`;

  return (
    <div className="panel">
      <div className="row between">
        <h2>Price vs floor</h2>
        <span className="small muted">
          {t.grad_stage === "Graduated" ? "curve history · now trading on Ref" : "bonding curve"}
        </span>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#7cf29a" stopOpacity=".25" />
            <stop offset="1" stopColor="#7cf29a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x={P} y={y(floor)} width={W - 2 * P} height={Math.max(0, H - P - y(floor))} fill="#7cf29a" opacity=".07" />
        <line x1={P} x2={W - P} y1={y(floor)} y2={y(floor)} stroke="#7cf29a" strokeDasharray="5 5" strokeWidth="1.5" />
        <text x={W - P} y={y(floor) - 6} fill="#7cf29a" fontSize="11" textAnchor="end">floor {fmtPrice(floor)} N</text>
        <path d={area} fill="url(#g)" />
        <path d={line} fill="none" stroke="#e8eaed" strokeWidth="2" />
        <text x={P} y={16} fill="#8b93a1" fontSize="11">{fmtPrice(max / 1.1)} N</text>
      </svg>
      <table className="t" style={{ marginTop: 10 }}>
        <thead>
          <tr><th>Side</th><th>NEAR</th><th>Tokens</th><th>Account</th><th>When</th></tr>
        </thead>
        <tbody>
          {(trades ?? []).slice(0, 8).map((tr, i) => (
            <tr key={i}>
              <td className={tr.is_buy ? "green" : "bad"}>{tr.is_buy ? "Buy" : "Sell"}</td>
              <td>{fmtNear(tr.near, 3)}</td>
              <td>{fmtTok(tr.tokens, 0)}</td>
              <td className="mono small">{tr.account}</td>
              <td className="muted">{ago(tr.ts)}</td>
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
