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
import { Moji, SlabIcon } from "@/components/Brand";
import { FloorRise } from "@/components/FloorRise";

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
      .catch(() => { });
    api<Callout[]>("/calls?limit=20").then(setCalls).catch(() => { });
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
      {/* ---------- split hero: copy left, the rising floor right ---------- */}
      <section className="hero-board">
        <div className="hero-copy">
          <div className="row wrap" style={{ gap: 8 }}>
            <span className={`badge ${NETWORK === "testnet" ? "warn" : "green"}`}>
              {NETWORK === "testnet" ? "Testnet · $100 grad" : `Mainnet · $${gradTargetUsd.toLocaleString()} grad`}
            </span>
            <span className="badge">Zero premint</span>
            <span className="badge desktop-only">No dev allocation</span>
          </div>
          <h1 className="hero-title">
            Every meme gets a <span className="copper">floor</span>.<br />
            Late buyers stop being exit liquidity.
          </h1>
          <p className="hero-sub">
            Fees and quick-flip penalties route into an on-chain NEAR vault you can redeem against at any time.
            Graduated liquidity is locked forever and earns staking yield.
          </p>
          <div className="row wrap hero-actions">
            <Link href="/create" className="btn primary lg">Launch a token</Link>
            <a href="#launches" className="btn ghost lg desktop-only">Browse launches</a>
            <button className="btn ghost lg" onClick={() => setShowGuide(!showGuide)}>
              {showGuide ? "Hide guide" : "How it works"}
            </button>
          </div>

          {/* live board readouts */}
          <div className="readouts">
            <div className="readout">
              <span>Tokens</span>
              <b>{tokens ? `${stats.count}` : <span className="skeleton" style={{ minWidth: 32, minHeight: 18 }} />}</b>
              <em>{tokens ? `${stats.graduated} graduated` : "loading"}</em>
            </div>
            <div className="readout">
              <span>Volume</span>
              <b>{tokens && usd ? fmtUsd(stats.vol) : <span className="skeleton" style={{ minWidth: 48, minHeight: 18 }} />}</b>
              <em>all curves</em>
            </div>
            <div className="readout">
              <span>In floors</span>
              <b className="green">{tokens && usd ? fmtUsd(stats.vault) : <span className="skeleton" style={{ minWidth: 48, minHeight: 18 }} />}</b>
              <em>redeemable</em>
            </div>
            {featured && (
              <Link href={`/token/${featured.token_id}`} className="readout featured-readout">
                <span>{featured.grad_stage === "Curve" ? "Hot" : "Top"}</span>
                <b>${featured.meta.symbol}</b>
                <em>
                  {usd && mcap(featured) ? fmtUsd(mcap(featured)) : "–"} ·{" "}
                  {featured.grad_stage === "Graduated" ? "graduated" : `${progressPct(featured).toFixed(0)}%`}
                </em>
              </Link>
            )}
          </div>
        </div>

        <div className="hero-visual">
          <FloorRise vault={tokens && usd ? fmtUsd(stats.vault) : "--"} />
        </div>
      </section>

      {showGuide && (
        <div className="panel stack" style={{ border: "1.5px solid var(--accent)", gap: 10 }}>
          <div className="row between">
            <strong className="green row" style={{ gap: 8 }}>
              <Moji face="hero" size={22} />
              How Floorpad Works (30s)
            </strong>
            <button className="btn sm ghost" onClick={() => setShowGuide(false)}>Close</button>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
            <div className="panel tight stack" style={{ background: "var(--tertiary)", gap: 4 }}>
              <div className="row" style={{ gap: 6 }}>
                <span className="badge primary">Step 1</span>
                <strong>Fair Curve Launch</strong>
              </div>
              <span className="small muted">
                Zero premint or team allocation. Buy with NEAR on the curve; early wallet caps slow snipers.
              </span>
            </div>
            <div className="panel tight stack" style={{ background: "var(--tertiary)", gap: 4 }}>
              <div className="row" style={{ gap: 6 }}>
                <span className="badge green">Step 2</span>
                <strong>Redeemable Floor</strong>
              </div>
              <span className="small muted">
                40% of trading fees + 100% of quick-flip exit penalties grow the NEAR vault. Burn tokens anytime for your share.
              </span>
            </div>
            <div className="panel tight stack" style={{ background: "var(--tertiary)", gap: 4 }}>
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

      {hasCalls && (
        <section className="section">
          <div className="row between" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Live callouts</h2>
            <Link href="/calls" className="small muted link-chev">All calls <SlabIcon name="chevron" size={12} /></Link>
          </div>
          <div className="scroll-x calls-strip">
            {calls.slice(0, 8).map((c) => (
              <Link key={c.id} href={`/token/${c.token_id}`} className="call-chip">
                <div className="row between">
                  <b>${c.symbol}</b>
                  <span className={c.x_now >= 1 ? "green" : "bad"}>{fmtX(c.x_now)}</span>
                </div>
                <div className="small ellipsis">&ldquo;{c.thesis}&rdquo;</div>
                <div className="xs muted">{c.account} · {ago(c.ts)}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ---------- list (immediately visible above the fold) ---------- */}
      <section className="section" id="launches" style={{ marginTop: 10 }}>
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
              {showTests ? "Hide test" : `Show test (${hiddenTestCount})`}
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

      {/* ---------- how the floor rises: four steps, each a level higher ---------- */}
      <section className="section">
        <h2 className="section-title">How the floor rises</h2>
        <p className="muted small" style={{ marginTop: -4 }}>Where every trade&apos;s fees go, from first buy to locked liquidity.</p>
        <ol className="signal-path">
          <Step n="01" title="Fair curve" body="One transaction deploys token, curve and DAO. No premint, no dev bag; launch-window wallet caps slow snipers." />
          <Step n="02" title="Floor vault" body="40% of trade fees, 100% of quick-flip exit fees and 15% of the graduation raise flow into a NEAR vault. Burn tokens for your share anytime." />
          <Step n="03" title="Sell tax > buy tax" body="On the curve: 1.25% to buy, 2.5% to sell, plus up to 10% for selling within 7 days (also on vault redemptions). Dumping pays holders. After graduation, Ref charges its 0.3% pool fee." />
          <Step n="04" title="Locked yield LP" body="At graduation liquidity moves to Ref Finance, locks forever and earns LiNEAR yield. Lockers vote where it goes (>70% to pass)." />
        </ol>
      </section>
    </>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="sp-step" style={{ "--lvl": Number(n) } as React.CSSProperties}>
      <span className="sp-node">{n}</span>
      <div className="sp-card">
        <b>{title}</b>
        <span>{body}</span>
      </div>
    </li>
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
      </div>
      {/* full-width footer so every card ends on the same row, bonding or graduated */}
      {graduated ? (
        <div className="tc-foot desktop-only-block"><StageBadges t={t} /></div>
      ) : (
        <div className="tc-foot row" style={{ gap: 8 }}>
          <div className="progress" style={{ flex: 1, margin: 0 }}><div style={{ width: `${pct}%` }} /></div>
          <span className="xs muted mono desktop-only">{pct.toFixed(0)}%</span>
        </div>
      )}
    </Link>
  );
}
