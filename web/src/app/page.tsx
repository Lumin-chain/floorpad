"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { curvePrice, floorPrice, fmtNear, fmtPrice, lp, progressPct, vaultNear, type TokenView } from "@/lib/near";
import { useView } from "@/lib/wallet";
import { Avatar, Kv, StageBadges } from "@/components/ui";

type Filter = "all" | "curve" | "graduated";
type Sort = "new" | "volume" | "floor" | "holders";

export default function Explore() {
  const { data: tokens, error } = useView(() => lp<TokenView[]>("get_tokens", { from_index: 0, limit: 100 }), [], 10000);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("new");
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    let l = (tokens ?? []).filter((t) => t.deployed);
    if (filter === "curve") l = l.filter((t) => t.grad_stage !== "Graduated");
    if (filter === "graduated") l = l.filter((t) => t.grad_stage === "Graduated");
    if (q) {
      const s = q.toLowerCase();
      l = l.filter((t) => t.meta.name.toLowerCase().includes(s) || t.meta.symbol.toLowerCase().includes(s));
    }
    const by: Record<Sort, (a: TokenView, b: TokenView) => number> = {
      new: (a, b) => b.created_at - a.created_at,
      volume: (a, b) => Number(BigInt(b.volume_near) - BigInt(a.volume_near) > 0n) * 2 - 1,
      floor: (a, b) => Number(vaultNear(b) - vaultNear(a) > 0n) * 2 - 1,
      holders: (a, b) => b.holders - a.holders,
    };
    return [...l].sort(by[sort]);
  }, [tokens, filter, sort, q]);

  return (
    <>
      <section className="hero">
        <h1>Meme launches with a floor that only goes up.</h1>
        <p>
          Every Floorpad token has a vault that backs a redeemable floor price. Locked liquidity earns NEAR staking yield,
          and holders vote in their own DAO on where that yield goes: the floor, buybacks, airdrops, their AI agent or
          the treasury.
        </p>
        <div className="pillars">
          <div className="pillar"><b>Redeemable floor</b><span>Fees and exit fees back every token, and redemptions burn supply.</span></div>
          <div className="pillar"><b>LP earns yield</b><span>Graduation pairs against LiNEAR, so locked LP compounds staking rewards.</span></div>
          <div className="pillar"><b>ve-locks</b><span>Lock 7–180 days for 1–4× votes and yield share. Early dumpers pay up to 10%.</span></div>
          <div className="pillar"><b>Holder DAO</b><span>A Sputnik DAO per token, run here. Lock weight is your vote.</span></div>
          <div className="pillar"><b>AI agent</b><span>Holders vote its persona and its budget. With no budget, it stops posting.</span></div>
        </div>
      </section>

      <section className="section">
        <div className="row between wrap" style={{ marginBottom: 14 }}>
          <div className="row wrap">
            <div className="seg">
              {(["all", "curve", "graduated"] as Filter[]).map((f) => (
                <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f === "curve" ? "On curve" : "Graduated"}
                </button>
              ))}
            </div>
            <select className="select" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="new">Newest</option>
              <option value="volume">Volume</option>
              <option value="floor">Vault size</option>
              <option value="holders">Holders</option>
            </select>
          </div>
          <div className="row">
            <input className="input" style={{ width: 220 }} placeholder="Search name or ticker" value={q} onChange={(e) => setQ(e.target.value)} />
            <Link href="/create" className="btn primary">Launch a token</Link>
          </div>
        </div>

        {error && <div className="notice warn">Could not load tokens: {error}</div>}
        {!tokens && !error && <div className="empty">Loading launches…</div>}
        {tokens && list.length === 0 && (
          <div className="empty">
            No tokens yet. <Link href="/create" className="green">Launch the first one →</Link>
          </div>
        )}
        <div className="grid cards">
          {list.map((t) => (
            <TokenCard key={t.token_id} t={t} />
          ))}
        </div>
      </section>
    </>
  );
}

function TokenCard({ t }: { t: TokenView }) {
  const pct = progressPct(t);
  const graduated = t.grad_stage === "Graduated";
  return (
    <Link href={`/token/${t.token_id}`} className="card">
      <div className="card-head">
        <Avatar t={t} />
        <div style={{ minWidth: 0 }}>
          <div className="card-title">{t.meta.name}</div>
          <div className="card-sub">${t.meta.symbol} · by {t.creator}</div>
        </div>
      </div>
      <StageBadges t={t} />
      {!graduated && (
        <>
          <div className="progress"><div style={{ width: `${pct}%` }} /></div>
          <div className="small muted">{pct.toFixed(1)}% of curve sold</div>
        </>
      )}
      <div style={{ marginTop: 8 }}>
        <Kv k="Price" v={graduated ? "on Ref pool" : `${fmtPrice(curvePrice(t))} N`} />
        <Kv k="Floor" v={<span className="green">{fmtPrice(floorPrice(t))} N</span>} />
        <Kv k="Vault" v={`${fmtNear(vaultNear(t), 2)} N`} />
        <Kv k="Holders · lockers" v={`${t.holders} · ${t.stakers}`} />
      </div>
    </Link>
  );
}
