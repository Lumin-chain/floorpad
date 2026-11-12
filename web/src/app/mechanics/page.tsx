"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  fmtNear,
  fmtPrice,
  LAUNCHPAD,
  LINEAR,
  lp,
  REF,
  view,
  YOCTO,
  type LaunchConfig,
  type MechEvent,
  type TokenView,
} from "@/lib/near";
import { fmtUsd } from "@/lib/social";
import { useView } from "@/lib/wallet";
import { Moji, MojiLabel, SlabIcon } from "@/components/Brand";

export default function MechanicsPage() {
  const [tab, setTab] = useState<"simulator" | "security" | "events">("simulator");
  const { data: config } = useView(() => lp<LaunchConfig>("get_config"), [], 0);
  const { data: adminPowers } = useView(() => lp<string[]>("get_admin_powers"), [], 0);
  const { data: tokens } = useView(() => lp<TokenView[]>("get_tokens", { from_index: 0, limit: 20 }), [], 15000);
  const [selectedTokenId, setSelectedTokenId] = useState<string>("");

  const activeTokenId = selectedTokenId || (tokens && tokens[0] ? tokens[0].token_id : "");
  const { data: mechLog } = useView(
    activeTokenId ? () => lp<MechEvent[]>("get_mech_log", { token_id: activeTokenId, limit: 30 }) : null,
    [activeTokenId],
    10000,
  );

  // Simulation state
  const [dailyVolNear, setDailyVolNear] = useState(250);
  const [nearPriceUsd, setNearPriceUsd] = useState(5.5);
  const [avgHoldingDays, setAvgHoldingDays] = useState(3);
  const [redeemRatePct, setRedeemRatePct] = useState(3);
  const [linearAprPct, setLinearAprPct] = useState(8.5);
  const [voteFloorPct, setVoteFloorPct] = useState(50);
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  // 60-day mathematical simulation
  const sim = useMemo(() => {
    const days = 60;
    const initialSupply = 1_000_000_000; // 1 billion tokens
    const curveSupply = 800_000_000; // 80% on curve, 20% seeded into Ref LP
    let currentSupply = initialSupply;
    let vaultNearAcc = 350; // initial curve seed
    let cumulativeVolNear = 0;
    let cumulativeBurnedTokens = 0;
    let cumulativeYieldNear = 0;

    const data: Array<{
      day: number;
      vaultNear: number;
      vaultUsd: number;
      burnedTokens: number;
      burnedPct: number;
      floorPriceNear: number;
      floorPriceUsd: number;
      dailyFeesNear: number;
      dailyYieldNear: number;
      circulatingSupply: number;
    }> = [];

    // Exit fee decay: 3% (or config.max_exit_fee_bps) on day 0 -> 0% after 30 days
    const maxExitBps = Number(config?.max_exit_fee_bps ?? 300);
    const decayDays = Math.max(1, Math.round(Number(config?.exit_decay_secs ?? 2592000) / 86400));
    const exitFeeBps = Math.max(0, Math.round(maxExitBps * (1 - Math.min(avgHoldingDays, decayDays) / decayDays)));

    for (let d = 1; d <= days; d++) {
      cumulativeVolNear += dailyVolNear;
      const buyVol = dailyVolNear * 0.5;
      const sellVol = dailyVolNear * 0.5;

      // Token taxes: 0.50% buy + 1.00% sell (+ decayed exit fee); 1% platform fee goes to treasury
      const buyFee = buyVol * 0.005;
      const sellFee = sellVol * (0.01 + exitFeeBps / 10000);
      const totalFees = buyFee + sellFee;

      // 40% of curve fees go to the floor vault (matches config.fee_vault_bps = 4000)
      const floorCut = totalFees * 0.4;
      vaultNearAcc += floorCut;

      // Staking yield (compounding daily via LiNEAR)
      const dailyYield = vaultNearAcc * (linearAprPct / 100 / 365);
      cumulativeYieldNear += dailyYield;
      // Portion of epoch yield voted back into floor (default 50%)
      vaultNearAcc += dailyYield * (voteFloorPct / 100);

      // Redemptions: burn tokens and take proportional vault share
      const redemptionVol = sellVol * (redeemRatePct / 100);
      const tokensBurnedRedeem = currentSupply > 0 ? (redemptionVol / Math.max(0.0000001, vaultNearAcc / currentSupply)) : 0;
      const effectiveBurn = Math.min(tokensBurnedRedeem, currentSupply * 0.05);

      // Yield buyback & burn: 20% of epoch yield buys back tokens and burns them
      const buybackNear = dailyYield * 0.2;
      const estTokenPrice = Math.max(vaultNearAcc / currentSupply * 1.8, 0.000001);
      const buybackTokens = buybackNear / estTokenPrice;

      const dayBurn = effectiveBurn + buybackTokens;
      cumulativeBurnedTokens += dayBurn;
      currentSupply = Math.max(100_000, currentSupply - dayBurn);

      const floorPriceNear = vaultNearAcc / currentSupply;
      const floorPriceUsd = floorPriceNear * nearPriceUsd;

      data.push({
        day: d,
        vaultNear: vaultNearAcc,
        vaultUsd: vaultNearAcc * nearPriceUsd,
        burnedTokens: cumulativeBurnedTokens,
        burnedPct: (cumulativeBurnedTokens / initialSupply) * 100,
        floorPriceNear,
        floorPriceUsd,
        dailyFeesNear: totalFees,
        dailyYieldNear: dailyYield,
        circulatingSupply: currentSupply,
      });
    }

    return data;
  }, [dailyVolNear, nearPriceUsd, avgHoldingDays, redeemRatePct, linearAprPct, voteFloorPct]);

  const activePoint = hoverDay !== null && sim[hoverDay - 1] ? sim[hoverDay - 1] : sim[sim.length - 1];

  // SVG Chart scaling
  const W = 700;
  const H = 220;
  const P = 24;
  const maxFloorUsd = Math.max(...sim.map((s) => s.floorPriceUsd)) * 1.15 || 0.01;
  const minFloorUsd = Math.min(...sim.map((s) => s.floorPriceUsd)) * 0.85 || 0;
  const maxBurnPct = Math.max(...sim.map((s) => s.burnedPct)) * 1.2 || 1;

  const scaleX = (d: number) => P + ((d - 1) / (sim.length - 1)) * (W - 2 * P);
  const scaleYFloor = (v: number) => H - P - ((v - minFloorUsd) / (maxFloorUsd - minFloorUsd || 1)) * (H - 2 * P);
  const scaleYBurn = (b: number) => H - P - (b / maxBurnPct) * (H - 2 * P);

  const floorPath = sim.map((pt, i) => `${i ? "L" : "M"}${scaleX(pt.day).toFixed(1)},${scaleYFloor(pt.floorPriceUsd).toFixed(1)}`).join(" ");
  const burnPath = sim.map((pt, i) => `${i ? "L" : "M"}${scaleX(pt.day).toFixed(1)},${scaleYBurn(pt.burnedPct).toFixed(1)}`).join(" ");
  const floorArea = `${floorPath} L${scaleX(60)},${H - P} L${scaleX(1)},${H - P} Z`;

  return (
    <div className="stack section" style={{ gap: 28 }}>
      {/* Hero header */}
      <div className="panel stack">
        <div className="row between wrap">
          <div className="row" style={{ gap: 12 }}>
            <Moji face="hero" size={36} />
            <div>
              <h1 className="page-title">Floorpad Mechanics &amp; Simulator</h1>
              <span className="small muted">NEAR Protocol · Bonding curves, vault math, and on-chain parameter checks</span>
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="badge green">100% On-Chain</span>
            <span className="badge">Immutable Config</span>
            <span className="badge sky">Ref MEME/LiNEAR LP Locked</span>
            <span className="badge violet">Sputnik DAO Locks</span>
          </div>
        </div>

        <p className="muted" style={{ marginTop: 8, maxWidth: 860 }}>
          Floorpad pairs a bonding curve with an on-chain <strong className="green">Redeemable Floor Vault</strong> (denominated in NEAR/LiNEAR), a 1% platform fee plus creator/DAO-governed token taxes (default 0.5% buy / 1.0% sell + decaying 3% exit fee over 30 days, enforced on-curve and on graduated DEX pairs), permanent Ref Finance LP locking, and Sputnik DAO lock-weighted yield governance.
        </p>

        <div className="grid four stats" style={{ marginTop: 6 }}>
          <div className="stat">
            <div className="k">User Fund Custody</div>
            <div className="v green">No Admin Drain</div>
            <div className="s">Immutable config parameters</div>
          </div>
          <div className="stat">
            <div className="k">Vault Floor Share</div>
            <div className="v">{(Number(config?.fee_vault_bps ?? 4000) / 100).toFixed(0)}%</div>
            <div className="s">Curve fees + 100% exit fees</div>
          </div>
          <div className="stat">
            <div className="k">LP Locking</div>
            <div className="v">100% Ref Pool</div>
            <div className="s">Held forever by contract</div>
          </div>
          <div className="stat">
            <div className="k">DAO Pass Threshold</div>
            <div className="v" style={{ color: "var(--violet-bright)" }}>&gt; 70%</div>
            <div className="s">Lock-weighted approval</div>
          </div>
        </div>
      </div>

      {/* Mechanics Sub-Navigation */}
      <div className="tabs" style={{ margin: "4px 0 16px" }}>
        <button className={tab === "simulator" ? "active" : ""} onClick={() => setTab("simulator")}>
          <span className="row" style={{ gap: 6 }}><Moji face="hero" size={18} /> 60-Day Simulator</span>
        </button>
        <button className={tab === "security" ? "active" : ""} onClick={() => setTab("security")}>
          <span className="row" style={{ gap: 6 }}><Moji face="cool" size={18} /> On-Chain Parameters &amp; Keys</span>
        </button>
        <button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>
          <span className="row" style={{ gap: 6 }}><Moji face="wink" size={18} /> On-Chain Mechanics Log</span>
        </button>
      </div>

      {/* Tab 1: Interactive 60-Day Floor Growth Simulator */}
      {tab === "simulator" && (
        <div className="panel stack">
          <div className="row between wrap">
          <div>
            <h2><MojiLabel face="hero">Interactive 60-Day Mechanics Simulator</MojiLabel></h2>
            <span className="small muted">
              Simulate how asymmetric taxes, decaying exit fees, redemptions, and LiNEAR staking compound the floor over 60 days.
            </span>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <span className="small"><span style={{ color: "#7DD3A8" }}>●</span> Floor Price ($)</span>
            <span className="small"><span style={{ color: "#E6C14A" }}>●</span> Cumulative Tokens Burned (%)</span>
          </div>
        </div>

        {/* Simulator controls */}
        <div className="grid four stats" style={{ background: "var(--panel-2)", padding: 14, borderRadius: 10 }}>
          <label className="field" style={{ margin: 0 }}>
            <span>Daily Volume ({dailyVolNear} N / {fmtUsd(dailyVolNear * nearPriceUsd)})</span>
            <input
              type="range"
              min={20}
              max={2000}
              step={20}
              value={dailyVolNear}
              onChange={(e) => setDailyVolNear(Number(e.target.value))}
            />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>Avg Holding Duration ({avgHoldingDays} days)</span>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={avgHoldingDays}
              onChange={(e) => setAvgHoldingDays(Number(e.target.value))}
            />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>LiNEAR Staking APR ({linearAprPct}%)</span>
            <input
              type="range"
              min={4}
              max={16}
              step={0.5}
              value={linearAprPct}
              onChange={(e) => setLinearAprPct(Number(e.target.value))}
            />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>DAO Floor Yield Split ({voteFloorPct}%)</span>
            <input
              type="range"
              min={10}
              max={90}
              step={5}
              value={voteFloorPct}
              onChange={(e) => setVoteFloorPct(Number(e.target.value))}
            />
          </label>
        </div>

        {/* SVG Projection Chart */}
        <div style={{ position: "relative", width: "100%", marginTop: 10 }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            style={{ width: "100%", height: 240, overflow: "visible" }}
            onMouseLeave={() => setHoverDay(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = (e.clientX - rect.left) / rect.width;
              const d = Math.round(1 + relX * 59);
              setHoverDay(Math.max(1, Math.min(60, d)));
            }}
          >
            <defs>
              <linearGradient id="floorGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7DD3A8" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#7DD3A8" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => (
              <line
                key={idx}
                x1={P}
                x2={W - P}
                y1={P + pct * (H - 2 * P)}
                y2={P + pct * (H - 2 * P)}
                stroke="var(--line)"
                strokeDasharray="4 4"
              />
            ))}

            {/* Floor fill & lines */}
            <path d={floorArea} fill="url(#floorGrad)" />
            <path d={floorPath} fill="none" stroke="#7DD3A8" strokeWidth="2.5" />
            <path d={burnPath} fill="none" stroke="#E6C14A" strokeWidth="2" strokeDasharray="5 3" />

            {/* Hover point indicator */}
            {hoverDay !== null && activePoint && (
              <>
                <line
                  x1={scaleX(activePoint.day)}
                  x2={scaleX(activePoint.day)}
                  y1={P}
                  y2={H - P}
                  stroke="#B8A58A"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                <circle cx={scaleX(activePoint.day)} cy={scaleYFloor(activePoint.floorPriceUsd)} r="4" fill="#7DD3A8" />
                <circle cx={scaleX(activePoint.day)} cy={scaleYBurn(activePoint.burnedPct)} r="4" fill="#E6C14A" />
              </>
            )}
          </svg>
        </div>

        {/* Active milestone stats card */}
        <div className="panel tight row between wrap" style={{ background: "var(--panel-2)", marginTop: 6 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="badge primary">Day {activePoint.day}</span>
            <span className="small muted">Hover across the chart to inspect any day</span>
          </div>
          <div className="row wrap" style={{ gap: 20 }}>
            <div>
              <span className="small muted">Floor Price: </span>
              <strong className="green">${fmtPrice(activePoint.floorPriceUsd)}</strong>
              <span className="small muted"> ({fmtPrice(activePoint.floorPriceNear)} N)</span>
            </div>
            <div>
              <span className="small muted">Floor Vault Value: </span>
              <strong>{fmtUsd(activePoint.vaultUsd)}</strong>
              <span className="small muted"> ({activePoint.vaultNear.toFixed(1)} N)</span>
            </div>
            <div>
              <span className="small muted">Tokens Burned: </span>
              <strong className="warn">{activePoint.burnedPct.toFixed(2)}%</strong>
              <span className="small muted"> ({(activePoint.burnedTokens / 1e6).toFixed(1)}M tokens)</span>
            </div>
          </div>
        </div>

        {/* Milestone cards */}
        <div className="grid four stats" style={{ marginTop: 10 }}>
          {[1, 14, 30, 60].map((d) => {
            const pt = sim[d - 1];
            return (
              <div key={d} className="stat">
                <div className="k">Day {d} Milestone</div>
                <div className="v green">${fmtPrice(pt.floorPriceUsd)}</div>
                <div className="s">{pt.burnedPct.toFixed(1)}% burned · {fmtUsd(pt.vaultUsd)} vault</div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Tab 2: On-Chain Contract Checks & Immutable Parameter Sheet */}
      {tab === "security" && (
        <div className="stack" style={{ gap: 20 }}>
          <div className="panel stack">
            <div className="row between wrap">
              <h2><MojiLabel face="cool">On-Chain Contract Checks</MojiLabel></h2>
              <span className="badge mono">{LAUNCHPAD}</span>
            </div>
            <p className="small muted">
              Returned by the contract&apos;s <code className="mono">get_admin_powers()</code> view method (this is a self-reported contract view, not a third-party security audit). Testnet keeps an upgrade key during development; production mainnet deploy scripts remove full-access keys (<code className="mono">LOCK=1</code>).
            </p>
            <div className="grid half" style={{ gap: 12 }}>
              {(adminPowers ?? [
                "owner: none (no admin methods; config is immutable after init)",
                "platform fees: accrue in-contract; anyone can sweep them, only to treasury",
                "platform yield cut: claimable LiNEAR credited to treasury",
                "price: read on-chain from Ref; nobody can set it",
                "upgrades: only possible if full-access keys exist (deleted on deploy with LOCK=1)",
              ]).map((power, i) => (
                <div key={i} className="panel tight row" style={{ background: "var(--panel-2)", gap: 10 }}>
                  <span className="green bold">✓</span>
                  <span className="small mono" style={{ wordBreak: "break-word" }}>{power}</span>
                </div>
              ))}
            </div>
          </div>

      {/* Section 3: Immutable Parameter Sheet */}
      <div className="panel stack">
        <div className="row between">
          <h2><MojiLabel face="flag">Immutable Contract Parameter Sheet</MojiLabel></h2>
          <span className="badge">Code is Law</span>
        </div>
        <p className="small muted">
          These parameters are initialized once upon launchpad deployment and cannot be altered by anyone.
        </p>

        <div className="grid cards" style={{ marginTop: 4 }}>
          <div className="panel tight stack" style={{ background: "var(--panel-2)" }}>
            <div className="k">Trading Taxes</div>
            <div className="row between">
              <span className="small">Platform Fee:</span>
              <strong>1.00%</strong>
            </div>
            <div className="row between">
              <span className="small">Default Buy Tax:</span>
              <strong>{(Number(config?.buy_fee_bps ?? 50) / 100).toFixed(2)}%</strong>
            </div>
            <div className="row between">
              <span className="small">Default Sell Tax:</span>
              <strong>{(Number(config?.sell_fee_bps ?? 100) / 100).toFixed(2)}%</strong>
            </div>
            <div className="row between">
              <span className="small">Max Exit Fee:</span>
              <strong>{(Number(config?.max_exit_fee_bps ?? 300) / 100).toFixed(2)}%</strong>
            </div>
            <div className="row between">
              <span className="small">Exit &amp; Tax Decay:</span>
              <span className="muted">{Math.round(Number(config?.exit_decay_secs ?? 2592000) / 86400)} days (linear to 0%)</span>
            </div>
          </div>

          <div className="panel tight stack" style={{ background: "var(--panel-2)" }}>
            <div className="k">Token Tax Split (DAO-Adjustable)</div>
            <div className="row between">
              <span className="small">Floor Vault:</span>
              <strong className="green">{(Number(config?.fee_vault_bps ?? 4000) / 100).toFixed(0)}%</strong>
            </div>
            <div className="row between">
              <span className="small">Creator Cut:</span>
              <strong>{(Number(config?.fee_creator_bps ?? 2500) / 100).toFixed(0)}%</strong>
            </div>
            <div className="row between">
              <span className="small">Buyback &amp; Burn:</span>
              <strong>{(100 - (Number(config?.fee_vault_bps ?? 4000) + Number(config?.fee_creator_bps ?? 2500)) / 100).toFixed(0)}%</strong>
            </div>
            <div className="row between">
              <span className="small">Referral Share:</span>
              <span className="muted">20% of 1% platform fee</span>
            </div>
          </div>

          <div className="panel tight stack" style={{ background: "var(--panel-2)" }}>
            <div className="k">Graduation &amp; Ref LP</div>
            <div className="row between">
              <span className="small">Target Market Cap:</span>
              <strong className="green">~${Number(config?.grad_mcap_usd ?? 25000).toLocaleString()} USD</strong>
            </div>
            <div className="row between">
              <span className="small">Price Source:</span>
              <span className="muted">Ref Pool #4512</span>
            </div>
            <div className="row between">
              <span className="small">Permanent LP:</span>
              <strong className="green">100% Locked</strong>
            </div>
            <div className="row between">
              <span className="small">LP Staking Asset:</span>
              <span>LiNEAR (yield bearing)</span>
            </div>
          </div>

          <div className="panel tight stack" style={{ background: "var(--panel-2)" }}>
            <div className="k">Governance & ve-Locks</div>
            <div className="row between">
              <span className="small">DAO Implementation:</span>
              <span className="mono">Sputnik v2.3.1</span>
            </div>
            <div className="row between">
              <span className="small">Proposal Pass Vote:</span>
              <strong style={{ color: "var(--violet)" }}>&gt; 70% delegated weight</strong>
            </div>
            <div className="row between">
              <span className="small">Lock Range:</span>
              <span>7 to 180 days</span>
            </div>
            <div className="row between">
              <span className="small">Vote Weight Multiplier:</span>
              <span>1.0× to 4.0×</span>
            </div>
          </div>
        </div>
      </div>
      </div>
      )}

      {/* Tab 3: Live On-Chain Mechanics Event Log */}
      {tab === "events" && (
      <div className="panel stack">
        <div className="row between wrap">
          <h2><MojiLabel face="wink">Live Mechanics Event Log</MojiLabel></h2>
          {tokens && tokens.length > 0 && (
            <div className="row" style={{ gap: 8 }}>
              <span className="small muted">Token:</span>
              <select
                className="select"
                style={{ width: "auto" }}
                value={activeTokenId}
                onChange={(e) => setSelectedTokenId(e.target.value)}
              >
                {tokens.map((tok) => (
                  <option key={tok.token_id} value={tok.token_id}>
                    {tok.meta.symbol} ({tok.token_id})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <p className="small muted">
          Public log stored on-chain (<code className="mono">get_mech_log</code>) tracking every burn, redemption, epoch distribution, and floor funding event.
        </p>

        <div className="table-scroll">
          <table className="t">
            <thead>
              <tr>
                <th>Event</th>
                <th>Amount</th>
                <th>Account</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {mechLog && mechLog.length > 0 ? (
                mechLog.map((ev, idx) => (
                  <tr key={idx}>
                    <td>
                      <span className={`badge ${ev.kind.includes("burn") ? "warn" : ev.kind.includes("yield") ? "green" : ""}`}>
                        {ev.kind}
                      </span>
                    </td>
                    <td className="mono">{fmtNear(ev.amount, 3)}</td>
                    <td className="mono small ellipsis" style={{ maxWidth: 160 }}>
                      {ev.account ?? "–"}
                    </td>
                    <td className="muted nowrap">{new Date(ev.ts * 1000).toLocaleString()}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="muted" style={{ textAlign: "center", padding: 20 }}>
                    No mechanics events recorded for this token yet. Events generate automatically during trades, burns, and epoch settlements.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Footer link to contracts */}
      <div className="row between wrap muted small">
        <span>Contracts: <code className="mono">{LAUNCHPAD}</code></span>
        <Link href="/" className="btn sm">Back to Explore</Link>
      </div>
    </div>
  );
}

