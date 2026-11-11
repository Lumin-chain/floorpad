"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ago, lp, nearUsd, progressPct, vaultNear, yoctoToUsd, type TokenView } from "@/lib/near";
import { api, fmtUsd, fmtX, useStream, type Callout } from "@/lib/social";
import { useView } from "@/lib/wallet";
import { Avatar, StageBadges } from "@/components/ui";
import { Mascot } from "@/components/Mascot";
import { Moji, MojiLabel, SlabIcon } from "@/components/Brand";

type Filter = "trending" | "new" | "bonding" | "graduated";
type SortKey = "mcap" | "floor" | "progress" | "holders" | "volume" | "age";

const FILTER_LABEL: Record<Filter, string> = { trending: "Trending", new: "New", bonding: "Bonding", graduated: "Graduated" };
const FILTER_FACE = { trending: "cool", new: "wink", bonding: "hero", graduated: "flag" } as const;

export default function Explore() {
  const { data: tokens, error } = useView(() => lp<TokenView[]>("get_tokens", { from_index: 0, limit: 100 }), [], 10000);
  const { data: usd } = useView(() => nearUsd(), [], 60000);
  const [chatCounts, setChatCounts] = useState<Record<string, number>>({});
  const [calls, setCalls] = useState<Callout[]>([]);
  const [filter, setFilter] = useState<Filter>("trending");
  const [view, setView] = useState<"grid" | "table">("grid");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "mcap", dir: -1 });
  const [q, setQ] = useState("");
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    api<{ token_id: string; n: number }[]>("/trending/chat")
      .then((r) => setChatCounts(Object.fromEntries(r.map((x) => [x.token_id, x.n]))))
      .catch(() => {});
    api<Callout[]>("/calls?limit=20").then(setCalls).catch(() => {});
  }, []);
  useStream("global", { call: (c) => setCalls((xs) => [c as Callout, ...xs].slice(0, 20)) });

  const toUsd = (y: string | bigint) => (usd ? yoctoToUsd(y, usd) : 0);
  const mcap = (t: TokenView) => toUsd(t.fdv_near);
  const floorUsd = (t: TokenView) => toUsd(vaultNear(t));
  const live = (tokens ?? []).filter((t) => t.deployed);

  const list = useMemo(() => {
    let l = live;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, filter, q, chatCounts]);

  const featured = useMemo(() => {
    const bonding = live.filter((t) => t.grad_stage === "Curve");
    return [...bonding].sort((a, b) => progressPct(b) - progressPct(a))[0] ?? live[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);

  const stats = useMemo(() => {
    let vol = 0n, vault = 0n;
    for (const t of live) {
      vol += BigInt(t.volume_near);
      vault += vaultNear(t);
    }
    return { count: live.length, graduated: live.filter((t) => t.grad_stage === "Graduated").length, vol: toUsd(vol), vault: toUsd(vault) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, usd]);

  const tableRows = useMemo(() => {
    const val: Record<SortKey, (t: TokenView) => number> = {
      mcap,
      floor: floorUsd,
      progress: progressPct,
      holders: (t) => t.holders,
      volume: (t) => toUsd(t.volume_near),
      age: (t) => -t.created_at,
    };
    return [...list].sort((a, b) => (val[sort.key](a) - val[sort.key](b)) * sort.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, sort, usd]);

  const th = (key: SortKey, label: string) => (
    <th className="sortable" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}>
      {label} {sort.key === key ? <SlabIcon name={sort.dir === -1 ? "down" : "up"} size={10} /> : null}
    </th>
  );

  return (
    <>
      {/* ---------- mobile hero ---------- */}
      <section className="hero mobile-only-block">
        <div className="hero-row">
          <h1>Meme launches with a floor that only goes up.</h1>
          <Mascot pose="hero" size={92} blink alt="" />
        </div>
        <div className="pillars scroll-x">
          <Pillars />
        </div>
      </section>
      {calls.length > 0 && (
        <section className="section tight mobile-only-block">
          <div className="row between" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}><MojiLabel face="cool">Live callouts</MojiLabel></h2>
            <Link href="/calls" className="small muted link-chev">See all <SlabIcon name="chevron" size={12} /></Link>
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

      {/* ---------- desktop top: featured + stats + callouts rail ---------- */}
      <section className="explore-top desktop-only-grid">
        <div className="stack">
          <div className="tagline tagline-row">
            <div>
              <h1>Meme launches with a floor that only goes up.</h1>
              <p className="muted">Fair launch, graduate to Ref at ~$15k. Every token gets a redeemable floor, yield-earning LP, a holder DAO, chat, callouts and an AI agent.</p>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn sm ghost row" onClick={() => setShowGuide(!showGuide)} style={{ gap: 6, border: "1px solid var(--line)" }}>
                  <SlabIcon name="ops" size={14} />
                  <span>{showGuide ? "Hide Beginner Guide" : "New Here? How Floorpad Works (30s)"}</span>
                </button>
                <Link href="/docs" className="btn sm ghost row" style={{ gap: 6, color: "var(--muted)" }}>
                  <SlabIcon name="rows" size={14} />
                  <span>Read Full Docs</span>
                </Link>
              </div>
            </div>
            <Mascot pose="hero" size={140} blink alt="" />
          </div>

          {/* Interactive Beginner Explainer */}
          {showGuide && (
            <div className="panel stack" style={{ border: "1.5px solid var(--primary)", gap: 12 }}>
              <div className="row between">
                <strong className="blue row" style={{ gap: 8 }}>
                  <Moji face="hero" size={24} />
                  How Floorpad Works (The 30-Second Guide)
                </strong>
                <button className="btn sm ghost" onClick={() => setShowGuide(false)}>✕ Close</button>
              </div>
              <div className="grid three" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                <div className="panel tight stack" style={{ background: "var(--tertiary)", gap: 6 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="badge primary">Step 1</span>
                    <strong>Fair Launch Curve</strong>
                  </div>
                  <span className="small muted">
                    100% fair bonding curve with no team allocation and no presale. Buy early with NEAR. Instant Trading allows 0-popup speed.
                  </span>
                </div>
                <div className="panel tight stack" style={{ background: "var(--tertiary)", gap: 6 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="badge green">Step 2</span>
                    <strong>The Vault Floor</strong>
                  </div>
                  <span className="small muted">
                    40% of all curve fees + exit fees go into the vault. The floor price can only rise. You can ALWAYS burn your tokens to cash out at the floor.
                  </span>
                </div>
                <div className="panel tight stack" style={{ background: "var(--tertiary)", gap: 6 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="badge violet">Step 3</span>
                    <strong>Ref Finance DEX</strong>
                  </div>
                  <span className="small muted">
                    At $15k mcap, liquidity migrates to Ref Finance. LP is locked forever and earns LiNEAR staking yield, split by holder DAO votes!
                  </span>
                </div>
              </div>
            </div>
          )}
          {featured && <Featured t={featured} mcapUsd={mcap(featured)} floorUsd={floorUsd(featured)} />}
          <div className="grid stats-4">
            <div className="stat"><div className="k">Tokens launched</div><div className="v">{stats.count}</div></div>
            <div className="stat"><div className="k">Graduated</div><div className="v">{stats.graduated}</div></div>
            <div className="stat"><div className="k">Curve volume</div><div className="v">{usd ? fmtUsd(stats.vol) : "–"}</div></div>
            <div className="stat"><div className="k">Locked in floors</div><div className="v green">{usd ? fmtUsd(stats.vault) : "–"}</div></div>
          </div>
        </div>
        <aside className="panel rail">
          <div className="row between">
            <h2 style={{ margin: 0 }}><MojiLabel face="cool">Live callouts</MojiLabel></h2>
            <Link href="/calls" className="small muted link-chev">All <SlabIcon name="chevron" size={12} /></Link>
          </div>
          <div className="rail-list">
            {calls.length === 0 && <div className="muted small">No callouts yet. Call a token from its page.</div>}
            {calls.slice(0, 8).map((c) => (
              <Link key={c.id} href={`/token/${c.token_id}`} className="rail-item">
                <div className="row between">
                  <b>${c.symbol}</b>
                  <span className={c.x_now >= 1 ? "green" : "bad"}>{fmtX(c.x_now)}</span>
                </div>
                <div className="small ellipsis">“{c.thesis}”</div>
                <div className="small muted">{c.account} · at {fmtUsd(c.mcap_usd)} · {ago(c.ts)}</div>
              </Link>
            ))}
          </div>
          <div className="pillars-mini">
            <Pillars />
          </div>
        </aside>
      </section>

      {/* ---------- list ---------- */}
      <section className="section">
        <div className="toolbar">
          <div className="seg scroll-x">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
              <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                <span className="moji-label"><Moji face={FILTER_FACE[f]} size={20} />{FILTER_LABEL[f]}</span>
              </button>
            ))}
          </div>
          <input className="input search" placeholder="Search name or ticker" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="spacer desktop-only" />
          <div className="seg desktop-only" aria-label="View">
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><SlabIcon name="grid" size={14} /> Cards</button>
            <button className={view === "table" ? "active" : ""} onClick={() => setView("table")}><SlabIcon name="rows" size={14} /> Table</button>
          </div>
          <Link href="/create" className="btn primary desktop-only">+ Launch a token</Link>
        </div>

        {error && <div className="notice warn">Could not load tokens: {error}</div>}
        {!tokens && !error && (
          <div className="empty mascot-empty">
            <Mascot pose="cool" size={96} motion="wave" alt="" />
            <span>Loading launches…</span>
          </div>
        )}
        {tokens && list.length === 0 && (
          <div className="empty mascot-empty">
            <Mascot pose="flag" size={120} motion="peek" alt="" />
            <span>No tokens here yet. <Link href="/create" className="green link-chev">Plant the first flag <SlabIcon name="chevron" size={12} /></Link></span>
          </div>
        )}

        {view === "table" && list.length > 0 ? (
          <div className="panel desktop-only-block token-table">
            <table className="t">
              <thead>
                <tr>
                  <th>Token</th>
                  {th("mcap", "Market cap")}
                  {th("floor", "Floor (vault)")}
                  {th("progress", "Bonding")}
                  {th("volume", "Volume")}
                  {th("holders", "Holders")}
                  <th>Chat/h</th>
                  {th("age", "Age")}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((t) => (
                  <tr key={t.token_id} className="click-row" onClick={() => (window.location.href = `/token/${t.token_id}`)}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <Avatar t={t} small />
                        <div style={{ minWidth: 0 }}>
                          <b>{t.meta.name}</b> <span className="muted">${t.meta.symbol}</span>
                          <div className="small muted">by {t.creator}</div>
                        </div>
                      </div>
                    </td>
                    <td><b>{usd ? fmtUsd(mcap(t)) : "–"}</b></td>
                    <td className="green">{usd ? fmtUsd(floorUsd(t)) : "–"}</td>
                    <td style={{ minWidth: 140 }}>
                      {t.grad_stage === "Graduated" ? (
                        <span className="badge green">Graduated</span>
                      ) : (
                        <div className="row" style={{ gap: 8 }}>
                          <div className="progress" style={{ flex: 1, margin: 0 }}><div style={{ width: `${progressPct(t)}%` }} /></div>
                          <span className="small">{progressPct(t).toFixed(0)}%</span>
                        </div>
                      )}
                    </td>
                    <td>{usd ? fmtUsd(toUsd(t.volume_near)) : "–"}</td>
                    <td>{t.holders}</td>
                    <td>{chatCounts[t.token_id] ?? 0}</td>
                    <td className="muted">{ago(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid cards token-list">
            {list.map((t) => (
              <TokenCard key={t.token_id} t={t} mcapUsd={mcap(t)} floorUsd={floorUsd(t)} chat={chatCounts[t.token_id] ?? 0} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Pillars() {
  return (
    <>
      <div className="pillar"><b>Rising floor</b><span>Fees, exit fees and 15% of the raise back every token.</span></div>
      <div className="pillar"><b>Sell tax &gt; buy tax</b><span>1.25% buy, 2.5% sell, plus up to 10% for quick flips.</span></div>
      <div className="pillar"><b>LP earns yield</b><span>Locked forever in a LiNEAR pool.</span></div>
      <div className="pillar"><b>Holder DAO</b><span>Lockers propose; &gt;70% of lock weight to pass.</span></div>
      <div className="pillar"><b>Chat + callouts</b><span>Every call is stamped and tracked.</span></div>
    </>
  );
}

function Featured({ t, mcapUsd, floorUsd }: { t: TokenView; mcapUsd: number; floorUsd: number }) {
  const pct = progressPct(t);
  return (
    <Link href={`/token/${t.token_id}`} className="featured">
      <Avatar t={t} lg />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="small green" style={{ fontWeight: 700, letterSpacing: ".04em" }}>
          <span className="row" style={{ gap: 6 }}><Moji face={t.grad_stage === "Curve" ? "hero" : "wink"} size={20} />{t.grad_stage === "Curve" ? "CLOSEST TO BONDING" : "FEATURED"}</span>
        </div>
        <div className="row between" style={{ alignItems: "baseline" }}>
          <h2 className="ellipsis" style={{ margin: "2px 0" }}>{t.meta.name} <span className="muted">${t.meta.symbol}</span></h2>
          <b style={{ fontSize: "1.3rem" }}>{mcapUsd ? fmtUsd(mcapUsd) : "–"}</b>
        </div>
        <p className="muted small ellipsis" style={{ margin: "0 0 8px" }}>{t.meta.description}</p>
        <div className="progress big"><div style={{ width: `${pct}%` }} /></div>
        <div className="row between small muted">
          <span>{pct.toFixed(1)}% bonded · graduates at ${t.grad_mcap_usd.toLocaleString()}</span>
          <span>{t.holders} holders · floor <span className="green">{floorUsd ? fmtUsd(floorUsd) : "–"}</span></span>
        </div>
      </div>
    </Link>
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
        <div className="tc-desc small muted desktop-only-block">{t.meta.description || "No description."}</div>
        <div className="row between small muted">
          <span className="ellipsis">{t.holders} holders · {chat} chats/h · {ago(t.created_at)}</span>
          <span className="green nowrap">floor {floorUsd ? fmtUsd(floorUsd) : "–"}</span>
        </div>
        {graduated ? (
          <div className="desktop-only-block" style={{ marginTop: 6 }}><StageBadges t={t} /></div>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            <div className="progress" style={{ flex: 1 }}><div style={{ width: `${pct}%` }} /></div>
            <span className="small muted desktop-only">{pct.toFixed(0)}%</span>
          </div>
        )}
      </div>
    </Link>
  );
}
