"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ago, lp, nearUsd, progressPct, vaultNear, yoctoToUsd, type TokenView } from "@/lib/near";
import { api, fmtUsd, fmtX, useStream, type Callout } from "@/lib/social";
import { useView } from "@/lib/wallet";
import { Avatar, StageBadges } from "@/components/ui";

type Filter = "trending" | "new" | "bonding" | "graduated";

export default function Explore() {
  const { data: tokens, error } = useView(() => lp<TokenView[]>("get_tokens", { from_index: 0, limit: 100 }), [], 10000);
  const { data: usd } = useView(() => nearUsd(), [], 60000);
  const [chatCounts, setChatCounts] = useState<Record<string, number>>({});
  const [calls, setCalls] = useState<Callout[]>([]);
  const [filter, setFilter] = useState<Filter>("trending");
  const [q, setQ] = useState("");

  useEffect(() => {
    api<{ token_id: string; n: number }[]>("/trending/chat")
      .then((r) => setChatCounts(Object.fromEntries(r.map((x) => [x.token_id, x.n]))))
      .catch(() => {});
    api<Callout[]>("/calls?limit=20").then(setCalls).catch(() => {});
  }, []);
  useStream("global", { call: (c) => setCalls((xs) => [c as Callout, ...xs].slice(0, 20)) });

  const mcap = (t: TokenView) => (usd ? yoctoToUsd(t.fdv_near, usd) : 0);

  const list = useMemo(() => {
    let l = (tokens ?? []).filter((t) => t.deployed);
    if (filter === "bonding") l = l.filter((t) => t.grad_stage !== "Graduated");
    if (filter === "graduated") l = l.filter((t) => t.grad_stage === "Graduated");
    if (q) {
      const s = q.toLowerCase();
      l = l.filter((t) => t.meta.name.toLowerCase().includes(s) || t.meta.symbol.toLowerCase().includes(s));
    }
    const heat = (t: TokenView) => t.trade_count * 2 + (chatCounts[t.token_id] ?? 0) * 3 + t.holders;
    const sorters: Record<Filter, (a: TokenView, b: TokenView) => number> = {
      trending: (a, b) => heat(b) - heat(a),
      new: (a, b) => b.created_at - a.created_at,
      bonding: (a, b) => progressPct(b) - progressPct(a),
      graduated: (a, b) => b.graduated_at - a.graduated_at,
    };
    return [...l].sort(sorters[filter]);
  }, [tokens, filter, q, chatCounts]);

  return (
    <>
      <section className="hero">
        <h1>Meme launches with a floor that only goes up.</h1>
        <p className="desktop-only-block">
          Fair launch on a bonding curve, graduate to Ref at ~$15k. Every token has a redeemable floor, LP that earns
          staking yield, a holder DAO, live chat, callouts and its own AI agent.
        </p>
        <div className="pillars scroll-x">
          <div className="pillar"><b>Rising floor</b><span>Fees, exit fees and 15% of the raise back every token.</span></div>
          <div className="pillar"><b>Sell tax &gt; buy tax</b><span>1% buy, 2% sell, plus up to 10% for quick flips.</span></div>
          <div className="pillar"><b>LP earns yield</b><span>Locked forever in a LiNEAR pool.</span></div>
          <div className="pillar"><b>Holder DAO</b><span>Lockers propose; &gt;70% of lock weight to pass.</span></div>
          <div className="pillar"><b>Chat + callouts</b><span>Every call is stamped and tracked.</span></div>
        </div>
      </section>

      {calls.length > 0 && (
        <section className="section tight">
          <div className="row between" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>📣 Live callouts</h2>
            <Link href="/calls" className="small muted">See all →</Link>
          </div>
          <div className="scroll-x calls-strip">
            {calls.map((c) => (
              <Link key={c.id} href={`/token/${c.token_id}`} className="call-chip">
                <b>${c.symbol}</b>
                <span className={c.x_now >= 1 ? "green" : "bad"}>{fmtX(c.x_now)}</span>
                <span className="muted small">{c.account.split(".")[0]} · {ago(c.ts)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="toolbar">
          <div className="seg scroll-x">
            {(["trending", "new", "bonding", "graduated"] as Filter[]).map((f) => (
              <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                {{ trending: "🔥 Trending", new: "🆕 New", bonding: "⏳ Bonding", graduated: "🎓 Graduated" }[f]}
              </button>
            ))}
          </div>
          <input className="input search" placeholder="Search name or ticker" value={q} onChange={(e) => setQ(e.target.value)} />
          <Link href="/create" className="btn primary desktop-only">Launch a token</Link>
        </div>

        {error && <div className="notice warn">Could not load tokens: {error}</div>}
        {!tokens && !error && <div className="empty">Loading launches…</div>}
        {tokens && list.length === 0 && (
          <div className="empty">
            No tokens yet. <Link href="/create" className="green">Launch the first one →</Link>
          </div>
        )}
        <div className="grid cards token-list">
          {list.map((t) => (
            <TokenCard key={t.token_id} t={t} mcapUsd={mcap(t)} floorUsd={usd ? yoctoToUsd(vaultNear(t), usd) : 0} chat={chatCounts[t.token_id] ?? 0} />
          ))}
        </div>
      </section>
    </>
  );
}

function TokenCard({ t, mcapUsd, floorUsd, chat }: { t: TokenView; mcapUsd: number; floorUsd: number; chat: number }) {
  const pct = progressPct(t);
  const graduated = t.grad_stage === "Graduated";
  return (
    <Link href={`/token/${t.token_id}`} className="card token-card">
      <Avatar t={t} />
      <div className="tc-body">
        <div className="row between">
          <div className="card-title ellipsis">{t.meta.name} <span className="muted">${t.meta.symbol}</span></div>
          <b className="tc-mcap">{mcapUsd ? fmtUsd(mcapUsd) : "–"}</b>
        </div>
        <div className="row between small muted">
          <span className="ellipsis">{t.holders} holders · {chat} chats/h · {ago(t.created_at)}</span>
          <span className="green nowrap">floor {floorUsd ? fmtUsd(floorUsd) : "–"}</span>
        </div>
        {graduated ? (
          <div className="desktop-only" style={{ marginTop: 6 }}><StageBadges t={t} /></div>
        ) : (
          <div className="progress"><div style={{ width: `${pct}%` }} /></div>
        )}
      </div>
    </Link>
  );
}
