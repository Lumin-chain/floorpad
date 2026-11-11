"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ago,
  isGraduated,
  LINEAR,
  lp,
  nearUsd,
  NETWORK,
  progressPct,
  REF,
  tokenFdvNear,
  vaultNear,
  view,
  YOCTO,
  yoctoToUsd,
  type LaunchConfig,
  type TokenView,
} from "@/lib/near";
import { api, fmtUsd, fmtX, useStream, type Callout } from "@/lib/social";
import { useView } from "@/lib/wallet";
import { Avatar, StageBadges } from "@/components/ui";
import { Mascot } from "@/components/Mascot";
import { Moji, MojiLabel, SlabIcon } from "@/components/Brand";

type Filter = "trending" | "new" | "bonding" | "graduated";
type SortKey = "mcap" | "floor" | "progress" | "holders" | "volume" | "age";

const FILTER_LABEL: Record<Filter, string> = { trending: "Trending", new: "New", bonding: "Bonding", graduated: "Graduated" };
const FILTER_FACE = { trending: "cool", new: "wink", bonding: "hero", graduated: "flag" } as const;

interface RefPoolData {
  token_account_ids: string[];
  amounts: string[];
}

function isDevTestToken(t: TokenView): boolean {
  const hay = `${t.meta.name} ${t.meta.description}`.toLowerCase();
  if (hay.includes("end-to-end test") || hay.includes("e2e moon") || /\be2e\b/.test(hay)) return true;
  // Stale empty launches (>1h old with 0 trades and 0 holders)
  const ageSecs = Math.floor(Date.now() / 1000) - t.created_at;
  return ageSecs > 3600 && t.trade_count === 0 && t.holders === 0;
}

export default function Explore() {
  const { data: tokens, error } = useView(() => lp<TokenView[]>("get_tokens", { from_index: 0, limit: 100 }), [], 10000);
  const { data: cfg } = useView(() => lp<LaunchConfig>("get_config"), [], 0);
  const { data: usd } = useView(() => nearUsd(), [], 60000);
  const { data: linearPriceStr } = useView(() => view<string>(LINEAR, "ft_price"), [], 60000);
  const [refPools, setRefPools] = useState<Record<string, RefPoolData>>({});
  const [chatCounts, setChatCounts] = useState<Record<string, number>>({});
  const [calls, setCalls] = useState<Callout[]>([]);
  const [filter, setFilter] = useState<Filter>("trending");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "mcap", dir: -1 });
  const [q, setQ] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [showTests, setShowTests] = useState(false);

  const linearPrice = linearPriceStr ? BigInt(linearPriceStr) : YOCTO;

  useEffect(() => {
    api<{ token_id: string; n: number }[]>("/trending/chat")
      .then((r) => setChatCounts(Object.fromEntries(r.map((x) => [x.token_id, x.n]))))
      .catch(() => {});
    api<Callout[]>("/calls?limit=20").then(setCalls).catch(() => {});
  }, []);
  useStream("global", { call: (c) => setCalls((xs) => [c as Callout, ...xs].slice(0, 20)) });

  // Fetch live Ref pool reserves for graduated tokens so market caps match token pages exactly
  const gradSignature = (tokens ?? [])
    .filter((t) => isGraduated(t) && t.pool_id !== null)
    .map((t) => `${t.token_id}:${t.pool_id}`)
    .join(",");

  useEffect(() => {
    if (!tokens) return;
    const grads = tokens.filter((t) => isGraduated(t) && t.pool_id !== null);
    if (!grads.length) return;
    let active = true;
    const loadPools = () => {
      Promise.all(
        grads.map(async (t) => {
          const pool = await view<RefPoolData>(REF, "get_pool", { pool_id: t.pool_id }).catch(() => null);
          return [t.token_id, pool] as const;
        }),
      ).then((entries) => {
        if (!active) return;
        const map: Record<string, RefPoolData> = {};
        for (const [id, pool] of entries) {
          if (pool) map[id] = pool;
        }
        setRefPools(map);
      });
    };
    loadPools();
    const id = setInterval(loadPools, 12000);
    return () => {
      active = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradSignature]);

  const toUsd = (y: string | bigint) => (usd ? yoctoToUsd(y, usd) : 0);
  const mcap = (t: TokenView) => toUsd(tokenFdvNear(t, refPools[t.token_id], linearPrice));
  const floorUsd = (t: TokenView) => toUsd(vaultNear(t, linearPrice));

  const deployed = (tokens ?? []).filter((t) => t.deployed);
  const nonTest = deployed.filter((t) => !isDevTestToken(t));
  const hiddenTestCount = deployed.length - nonTest.length;
  const visiblePool = showTests || nonTest.length === 0 ? deployed : nonTest;

  const list = useMemo(() => {
    let l = visiblePool;
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
  }, [visiblePool, filter, q, chatCounts]);

  const featured = useMemo(() => {
    const curveActive = visiblePool.filter((t) => t.grad_stage === "Curve");
    return [...curveActive].sort((a, b) => progressPct(b) - progressPct(a))[0] ?? visiblePool[0];
  }, [visiblePool]);

  const stats = useMemo(() => {
    let vol = 0n;
    let vault = 0n;
    for (const t of visiblePool) {
      vol += BigInt(t.volume_near);
      vault += vaultNear(t, linearPrice);
    }
    return {
      count: visiblePool.length,
      graduated: visiblePool.filter((t) => t.grad_stage === "Graduated").length,
      vol: toUsd(vol),
      vault: toUsd(vault),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePool, usd, linearPrice]);

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
  }, [list, sort, usd, refPools, linearPrice]);

  const th = (key: SortKey, label: string) => (
    <th className="sortable" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}>
      {label} {sort.key === key ? <SlabIcon name={sort.dir === -1 ? "down" : "up"} size={10} /> : null}
    </th>
  );

  const gradTargetUsd = cfg ? cfg.grad_mcap_usd : NETWORK === "testnet" ? 100 : 15000;
  const hasCalls = calls.length > 0;

  return (
    <>
      {/* ---------- unified responsive hero (single h1, mobile + desktop) ---------- */}
      <section className={`grid explore-top ${hasCalls ? "" : "single"}`}>
        <div className="stack">
          <div className="hero-box tagline-row">
            <div>
              <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
                <span className={`badge ${NETWORK === "testnet" ? "warn" : "green"}`}>
                  {NETWORK === "testnet" ? "Testnet Live · Graduation at $100 FDV" : `Mainnet · Graduation at $${gradTargetUsd.toLocaleString()}`}
                </span>
                <span className="xs muted">40% of trade fees back the floor</span>
              </div>
              <h1 className="hero-title">Meme launches where late buyers aren&apos;t exit liquidity.</h1>
              <p className="hero-sub">
                Every token has an on-chain NEAR floor you can always redeem against — funded by trade fees, exit penalties, and LiNEAR staking yield.
              </p>
              <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
                {featured ? (
                  <Link href={`/token/${featured.token_id}`} className="btn primary sm">
                    Trade ${featured.meta.symbol}
                  </Link>
                ) : (
                  <a href="#launches" className="btn primary sm">Explore tokens</a>
                )}
                <Link href="/create" className="btn buy sm">+ Launch a token</Link>
                <button
                  className="btn sm ghost"
                  onClick={() => setShowGuide(!showGuide)}
                >
                  <SlabIcon name="ops" size={14} />
                  <span>{showGuide ? "Hide 30s guide" : "How it works (30s)"}</span>
                </button>
              </div>
            </div>
            <Mascot pose="hero" size={128} blink alt="Floorpad mascot" />
          </div>

          {showGuide && (
            <div className="panel stack" style={{ border: "1.5px solid var(--accent)", gap: 12 }}>
              <div className="row between">
                <strong className="green row" style={{ gap: 8 }}>
                  <Moji face="hero" size={24} />
                  How Floorpad Works (30-Second Guide)
                </strong>
                <button className="btn sm ghost" onClick={() => setShowGuide(false)}>✕ Close</button>
              </div>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                <div className="panel tight stack" style={{ background: "var(--tertiary)", gap: 6 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="badge primary">Step 1</span>
                    <strong>Fair Curve Launch</strong>
                  </div>
                  <span className="small muted">
                    Zero premint and zero team tokens. Buy with NEAR on the curve; early per-wallet limits slow down snipers.
                  </span>
                </div>
                <div className="panel tight stack" style={{ background: "var(--tertiary)", gap: 6 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="badge green">Step 2</span>
                    <strong>Redeemable Floor</strong>
                  </div>
                  <span className="small muted">
                    40% of trading fees + 100% of quick-flip exit penalties grow the NEAR vault. Burn your tokens anytime for your vault share.
                  </span>
                </div>
                <div className="panel tight stack" style={{ background: "var(--tertiary)", gap: 6 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="badge violet">Step 3</span>
                    <strong>Locked Ref Pool</strong>
                  </div>
                  <span className="small muted">
                    At ${gradTargetUsd.toLocaleString()} ({NETWORK}), liquidity locks permanently on Ref Finance and earns staking yield voted on by lockers.
                  </span>
                </div>
              </div>
            </div>
          )}

          {featured && <Featured t={featured} mcapUsd={mcap(featured)} floorUsd={floorUsd(featured)} readyUsd={Boolean(usd)} />}

          <div className="grid stats-4">
            <div className="stat">
              <div className="k">Active tokens</div>
              <div className="v">{tokens ? stats.count : <span className="skeleton" />}</div>
            </div>
            <div className="stat">
              <div className="k">Graduated</div>
              <div className="v">{tokens ? stats.graduated : <span className="skeleton" />}</div>
            </div>
            <div className="stat">
              <div className="k">Total volume</div>
              <div className="v">{tokens && usd ? fmtUsd(stats.vol) : <span className="skeleton" />}</div>
            </div>
            <div className="stat">
              <div className="k">Backed in floors</div>
              <div className="v green">{tokens && usd ? fmtUsd(stats.vault) : <span className="skeleton" />}</div>
            </div>
          </div>

          <div className="pillars scroll-x scroll-cue mobile-only-block" style={{ display: undefined }}>
            <Pillars />
          </div>
        </div>

        {hasCalls && (
          <aside className="panel rail desktop-only-grid" style={{ display: "flex" }}>
            <div className="row between">
              <h2 style={{ margin: 0 }}><MojiLabel face="cool">Live callouts</MojiLabel></h2>
              <Link href="/calls" className="small muted link-chev">All <SlabIcon name="chevron" size={12} /></Link>
            </div>
            <div className="rail-list">
              {calls.slice(0, 6).map((c) => (
                <Link key={c.id} href={`/token/${c.token_id}`} className="rail-item">
                  <div className="row between">
                    <b>${c.symbol}</b>
                    <span className={c.x_now >= 1 ? "green" : "bad"}>{fmtX(c.x_now)}</span>
                  </div>
                  <div className="small ellipsis">“{c.thesis}”</div>
                  <div className="xs muted">{c.account} · at {fmtUsd(c.mcap_usd)} · {ago(c.ts)}</div>
                </Link>
              ))}
            </div>
          </aside>
        )}
      </section>

      {hasCalls && (
        <section className="section tight mobile-only-block">
          <div className="row between" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}><MojiLabel face="cool">Live callouts</MojiLabel></h2>
            <Link href="/calls" className="small muted link-chev">See all <SlabIcon name="chevron" size={12} /></Link>
          </div>
          <div className="scroll-x scroll-cue calls-strip">
            {calls.map((c) => (
              <Link key={c.id} href={`/token/${c.token_id}`} className="call-chip">
                <b>${c.symbol}</b>
                <span className={c.x_now >= 1 ? "green" : "bad"}>{fmtX(c.x_now)}</span>
                <span className="muted xs">{c.account.split(".")[0]} · {ago(c.ts)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ---------- list ---------- */}
      <section className="section" id="launches">
        <div className="toolbar">
          <div className="seg scroll-x scroll-cue" role="tablist" aria-label="Filter launches">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
              <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                <span className="moji-label"><Moji face={FILTER_FACE[f]} size={18} />{FILTER_LABEL[f]}</span>
              </button>
            ))}
          </div>
          <input className="input search" placeholder="Search name or ticker" value={q} onChange={(e) => setQ(e.target.value)} />
          {hiddenTestCount > 0 && (
            <button className={`btn sm ${showTests ? "primary" : "ghost"}`} onClick={() => setShowTests((s) => !s)}>
              {showTests ? "Hide test tokens" : `Show test (${hiddenTestCount})`}
            </button>
          )}
          <div className="spacer desktop-only" />
          <div className="seg desktop-only" aria-label="View">
            <button className={viewMode === "grid" ? "active" : ""} onClick={() => setViewMode("grid")}><SlabIcon name="grid" size={14} /> Cards</button>
            <button className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")}><SlabIcon name="rows" size={14} /> Table</button>
          </div>
        </div>

        {error && <div className="notice warn">Could not load tokens: {error}</div>}
        {!tokens && !error && (
          <div className="grid cards">
            {[0, 1, 2].map((i) => (
              <div key={i} className="panel stack" style={{ minHeight: 132 }}>
                <div className="row" style={{ gap: 12 }}>
                  <span className="skeleton" style={{ width: 60, height: 60, borderRadius: 10 }} />
                  <div className="stack" style={{ flex: 1, gap: 8 }}>
                    <span className="skeleton" style={{ width: "60%", height: 18 }} />
                    <span className="skeleton" style={{ width: "90%", height: 14 }} />
                  </div>
                </div>
                <span className="skeleton" style={{ width: "100%", height: 10 }} />
              </div>
            ))}
          </div>
        )}
        {tokens && list.length === 0 && (
          <div className="empty mascot-empty">
            <Mascot pose="flag" size={110} motion="peek" alt="Launch mascot" />
            <span>No tokens match this filter. <Link href="/create" className="green link-chev">Launch the next one <SlabIcon name="chevron" size={12} /></Link></span>
          </div>
        )}

        {viewMode === "table" && list.length > 0 ? (
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
                          <div className="xs muted">by {t.creator}</div>
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
      <div className="pillar"><b>Redeemable floor</b><span>40% of trade fees, 100% of exit fees, and 15% of graduation back the vault.</span></div>
      <div className="pillar"><b>Sell tax &gt; buy tax</b><span>1.25% buy, 2.5% sell, plus up to 10% for quick flips (decays to 0% in 7d).</span></div>
      <div className="pillar"><b>Locked yield LP</b><span>Graduated liquidity stays locked in Ref Finance earning LiNEAR staking rewards.</span></div>
      <div className="pillar"><b>Holder DAO</b><span>Token lockers vote on yield splits and proposals (&gt;70% approval threshold).</span></div>
    </>
  );
}

function Featured({ t, mcapUsd, floorUsd, readyUsd }: { t: TokenView; mcapUsd: number; floorUsd: number; readyUsd: boolean }) {
  const pct = progressPct(t);
  return (
    <Link href={`/token/${t.token_id}`} className="featured">
      <Avatar t={t} lg />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="xs green" style={{ fontWeight: 700, letterSpacing: ".04em" }}>
          <span className="row" style={{ gap: 6 }}><Moji face={t.grad_stage === "Curve" ? "hero" : "wink"} size={18} />{t.grad_stage === "Curve" ? "CLOSEST TO GRADUATION" : "FEATURED TOKEN"}</span>
        </div>
        <div className="row between" style={{ alignItems: "baseline" }}>
          <h2 className="ellipsis" style={{ margin: "2px 0" }}>{t.meta.name} <span className="muted">${t.meta.symbol}</span></h2>
          <b className="mono" style={{ fontSize: "1.25rem" }}>{readyUsd && mcapUsd ? fmtUsd(mcapUsd) : "–"}</b>
        </div>
        <p className="muted small ellipsis" style={{ margin: "0 0 8px" }}>{t.meta.description}</p>
        <div className="progress big"><div style={{ width: `${pct}%` }} /></div>
        <div className="row between small muted">
          <span>{pct.toFixed(1)}% bonded · graduates at ${t.grad_mcap_usd.toLocaleString()}</span>
          <span>{t.holders} holders · floor <span className="green">{readyUsd && floorUsd ? fmtUsd(floorUsd) : "–"}</span></span>
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
          <b className="tc-mcap mono">{mcapUsd ? fmtUsd(mcapUsd) : "–"}</b>
        </div>
        <div className="tc-desc small muted desktop-only-block">{t.meta.description || "No description."}</div>
        <div className="row between xs muted">
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
