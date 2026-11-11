"use client";

import { useState } from "react";
import Link from "next/link";
import { LAUNCHPAD, lp, NETWORK, type LaunchConfig } from "@/lib/near";
import { useView } from "@/lib/wallet";
import { Moji, MojiLabel, SlabIcon } from "@/components/Brand";

const SECTIONS = [
  { id: "overview", title: "1. Overview", icon: "explore" },
  { id: "launch", title: "2. Launch & Anti-Snipe", icon: "launch" },
  { id: "curve", title: "3. Curve & Ref Graduation", icon: "rows" },
  { id: "floor", title: "4. The Rising Floor Vault", icon: "portfolio" },
  { id: "fees", title: "5. Taxes & Decaying Exit Fee", icon: "ops" },
  { id: "dao", title: "6. ve-Locks & Sputnik DAO", icon: "grid" },
  { id: "epochs", title: "7. Epoch Yield & 5-Way Split", icon: "swatch" },
  { id: "trading", title: "8. Instant Trading Console", icon: "chevron" },
  { id: "referrals", title: "9. 20% Referrals Program", icon: "share" },
  { id: "security", title: "10. Zero-Admin & Immutability", icon: "ops" },
  { id: "faq", title: "11. FAQ", icon: "reply" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [viewMode, setViewMode] = useState<"focus" | "all">("focus");
  const { data: cfg } = useView(() => lp<LaunchConfig>("get_config"), [], 0);
  const gradTargetUsd = cfg ? cfg.grad_mcap_usd : NETWORK === "testnet" ? 100 : 15000;

  const curIdx = SECTIONS.findIndex((s) => s.id === activeSection);
  const prevSec = curIdx > 0 ? SECTIONS[curIdx - 1] : null;
  const nextSec = curIdx < SECTIONS.length - 1 ? SECTIONS[curIdx + 1] : null;

  const showSec = (id: SectionId) => viewMode === "all" || activeSection === id;

  return (
    <div className="section stack" style={{ gap: 24 }}>
      {/* Docs Header */}
      <div className="panel stack">
        <div className="row between wrap">
          <div className="row" style={{ gap: 12 }}>
            <Moji face="hero" size={38} />
            <div>
              <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Floorpad Documentation</h1>
              <span className="small muted">Complete A-Z guide to mechanics, tokenomics, and governance</span>
            </div>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <div className="seg">
              <button className={viewMode === "focus" ? "active" : ""} onClick={() => setViewMode("focus")}>
                Chapter Focus
              </button>
              <button className={viewMode === "all" ? "active" : ""} onClick={() => setViewMode("all")}>
                All Chapters
              </button>
            </div>
            <Link href="/mechanics" className="btn sm">
              <SlabIcon name="ops" size={14} /> Interactive Simulator
            </Link>
            <span className="badge green">{NETWORK}</span>
          </div>
        </div>
      </div>

      {/* Mobile Chapter Selector */}
      <div className="scroll-x mobile-only" style={{ paddingBottom: 4 }}>
        {SECTIONS.map((sec) => (
          <button
            key={sec.id}
            className={`btn sm ${activeSection === sec.id ? "primary" : "ghost"}`}
            onClick={() => setActiveSection(sec.id)}
          >
            {sec.title}
          </button>
        ))}
      </div>

      <div className="docs-layout">
        {/* Sticky Sidebar Navigation */}
        <div className="panel tight stack desktop-only" style={{ position: "sticky", top: 72, gap: 4 }}>
          <div className="k" style={{ marginBottom: 6 }}>Documentation</div>
          {SECTIONS.map((sec) => (
            <button
              key={sec.id}
              className="btn sm ghost row"
              style={{
                justifyContent: "flex-start",
                textAlign: "left",
                width: "100%",
                padding: "8px 10px",
                border: "none",
                background: activeSection === sec.id ? "#132247" : "transparent",
                color: activeSection === sec.id ? "#FFFFFF" : "var(--muted)",
                fontWeight: activeSection === sec.id ? 700 : 600,
              }}
              onClick={() => {
                setActiveSection(sec.id);
                document.getElementById(sec.id)?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              <SlabIcon name={sec.icon as any} size={14} />
              <span>{sec.title}</span>
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="stack" style={{ gap: 20 }}>
          {/* Section 1: Overview */}
          {showSec("overview") && (
          <div id="overview" className="panel stack">
            <h2><MojiLabel face="cool">1. What is Floorpad?</MojiLabel></h2>
            <p>
              <strong>Floorpad</strong> is a next-generation meme coin launchpad on the NEAR blockchain designed to solve the structural flaws of traditional bonding curves (such as pump.fun, LetsBonk, or four.meme).
            </p>
            <p className="muted">
              In conventional launchpads, late buyers inevitably become exit liquidity, dev allocations lead to rug-pulls, and liquidity post-graduation sits idle. Floorpad introduces:
            </p>
            <div className="grid half stats">
              <div className="stat">
                <div className="k">The Floor Vault</div>
                <div className="v green">Rises in NEAR</div>
                <div className="s">Redeem tokens for vault share anytime</div>
              </div>
              <div className="stat">
                <div className="k">Asymmetric Taxes</div>
                <div className="v">1.25% / 2.5%</div>
                <div className="s">Plus decaying 10% exit fee</div>
              </div>
              <div className="stat">
                <div className="k">Ref Finance LP</div>
                <div className="v">100% Locked</div>
                <div className="s">Paired with LiNEAR to earn staking yield</div>
              </div>
              <div className="stat">
                <div className="k">Sputnik DAO</div>
                <div className="v" style={{ color: "var(--violet-bright)" }}>&gt; 70% Pass Threshold</div>
                <div className="s">Lock-weighted approval required</div>
              </div>
            </div>
          </div>
          )}

          {/* Section 2: Launch & Anti-Snipe */}
          {showSec("launch") && (
          <div id="launch" className="panel stack">
            <h2><MojiLabel face="wink">2. Token Launch &amp; Fair-Launch Protection</MojiLabel></h2>
            <p>
              Anyone can launch a token with a single transaction. The launch transaction atomically:
            </p>
            <ul className="muted small stack" style={{ paddingLeft: 20 }}>
              <li>Deploys an immutable <strong>NEP-141 token subaccount</strong> (e.g. <code>symbol.floorpad.near</code>).</li>
              <li>Initializes a dedicated <strong>Sputnik DAO v2.3.1 contract</strong> (e.g. <code>symbol-dao.floorpad.near</code>).</li>
              <li>Opens the bonding curve with total supply of <strong>1,000,000,000 tokens</strong> (760M on curve, 240M for LP).</li>
              <li><strong>Zero Premint &amp; Zero Dev Allocation:</strong> The creator owns 0 tokens upon launch and must buy on the curve alongside everyone else.</li>
            </ul>

            <h3>Anti-Snipe Protection</h3>
            <p className="muted small">
              To prevent sniper bots from dominating the launch block, a strict <strong>20,000,000 token cap (2% of supply)</strong> is enforced per wallet during the first 120 seconds. Any buy attempt exceeding this cap is automatically rejected by the smart contract.
            </p>
          </div>
          )}

          {/* Section 3: Curve & Ref Graduation */}
          {showSec("curve") && (
          <div id="curve" className="panel stack">
            <h2><MojiLabel face="hero">3. The Bonding Curve &amp; Graduation to Ref Finance</MojiLabel></h2>
            <p>
              The bonding curve uses a virtual reserve constant-product model (<code>x · y = k</code>) with 1,160,000,000 virtual tokens.
            </p>
            <h3>Live Dynamic Sizing via On-Chain Price</h3>
            <p className="muted small">
              Virtual reserves scale dynamically using the live NEAR/USD price (read on-chain from Ref pool #4512 on mainnet, or keeper price feed on testnet) so launches currently graduate at <strong>${gradTargetUsd.toLocaleString()} USD FDV</strong> ({NETWORK} setting; mainnet target ~$15,000 USD).
            </p>

            <h3>Zero-Slippage Smooth Migration onto Ref Finance</h3>
            <p className="muted small">
              When all 760,000,000 curve tokens are sold out:
            </p>
            <ol className="muted small stack" style={{ paddingLeft: 20 }}>
              <li><strong>Ref Pool Creation:</strong> The launchpad creates a Ref Finance <code>MEME/LiNEAR</code> pool.</li>
              <li><strong>Staking Yield:</strong> The raised liquidity is staked into LiNEAR so it generates continuous staking yield.</li>
              <li><strong>Price Continuity:</strong> The Ref pool opens at the <strong>exact same price as the final curve trade</strong>. The token does not pump or dump on migration—its market cap is continuous.</li>
              <li><strong>Permanent 100% LP Lock:</strong> 100% of the Ref LP shares are permanently held by the launchpad contract. They can never be withdrawn or rug-pulled.</li>
              <li><strong>Unused LP Burn:</strong> Any unused LP tokens from the 240M reserve are permanently burned on-chain.</li>
            </ol>
          </div>
          )}

          {/* Section 4: The Rising Floor Vault */}
          {showSec("floor") && (
          <div id="floor" className="panel stack">
            <h2><MojiLabel face="cool">4. The Redeemable Floor Vault</MojiLabel></h2>
            <p>
              Every Floorpad token is backed by an on-chain <strong>Floor Vault</strong> holding NEAR (before graduation) and yield-bearing LiNEAR (after graduation).
            </p>
            <h3>Why the Floor Vault Grows in NEAR / LiNEAR Terms</h3>
            <p className="muted small">
              Floor price is calculated as:
            </p>
            <div className="panel tight mono small" style={{ background: "var(--panel-2)", textAlign: "center" }}>
              Floor Price (NEAR) = Vault Backing / Circulating Supply (Total Supply − Burned)
            </div>
            <p className="muted small">
              The floor vault grows in NEAR / LiNEAR from:
            </p>
            <ul className="muted small stack" style={{ paddingLeft: 20 }}>
              <li><strong>40% of all trading fees</strong> (25% goes to creator, 35% to platform) + <strong>100% of quick-flip exit penalties</strong>.</li>
              <li><strong>15% of the curve graduation raise</strong>.</li>
              <li><strong>Continuous staking rewards</strong> from LiNEAR compounding (when allocated to floor).</li>
              <li><strong>Token Redemptions:</strong> Holders can burn their tokens anytime to redeem their exact pro-rata share of the vault. Redemptions keep the 2% fee + exit fee inside the vault, raising the remaining NEAR backing per token.</li>
            </ul>
          </div>
          )}

          {/* Section 5: Taxes & Exit Fees */}
          {showSec("fees") && (
          <div id="fees" className="panel stack">
            <h2><MojiLabel face="flag">5. Taxes &amp; Decaying Exit Fees</MojiLabel></h2>
            <p>
              Floorpad employs an asymmetric fee model that rewards holding and penalizes rapid dumping:
            </p>
            <div className="grid half">
              <div className="panel tight stack" style={{ background: "var(--panel-2)" }}>
                <b>Buy Fee: 1.25%</b>
                <span className="small muted">Low entry friction. 40% goes to the floor vault, 25% to creator (half instant, half DAO-escrowed), 35% to platform.</span>
              </div>
              <div className="panel tight stack" style={{ background: "var(--panel-2)" }}>
                <b>Sell Fee: 2.50% + Decaying Exit Fee</b>
                <span className="small muted">Same 40% vault / 25% creator / 35% platform split on base fee, plus 100% of the exit fee straight to the vault.</span>
              </div>
            </div>

            <h3>Holding Age &amp; Decaying Exit Fee</h3>
            <p className="muted small">
              The token contract tracks the weighted-average acquisition timestamp (<code>ft_holding_since</code>) of every holder:
            </p>
            <ul className="muted small stack" style={{ paddingLeft: 20 }}>
              <li><strong>Day 0 (Instant dump):</strong> 10.00% exit fee.</li>
              <li><strong>Day 3.5:</strong> 5.00% exit fee.</li>
              <li><strong>Day 7+:</strong> 0.00% exit fee (completely free of exit penalty).</li>
            </ul>
            <p className="muted small">
              100% of all exit fees collected are deposited directly into the Floor Vault to benefit remaining holders.
            </p>
          </div>
          )}

          {/* Section 6: ve-Locks & Sputnik DAO */}
          {showSec("dao") && (
          <div id="dao" className="panel stack">
            <h2><MojiLabel face="cool">6. ve-Locks &amp; Sputnik DAO v2.3.1 Governance</MojiLabel></h2>
            <p>
              Floorpad integrates official Sputnik DAO v2.3.1 contracts deployed by global bytecode hash (<code>DtHZA1mUmGYeScEaUoUZYQGGFHSMpnjMCvkr5U9hJXuF</code>).
            </p>
            <h3>ve-Lock Voting Multipliers</h3>
            <p className="muted small">
              Holders lock their tokens in the launchpad to receive voting weight in the token&apos;s DAO:
            </p>
            <div className="grid four stats">
              <div className="stat">
                <div className="k">7 Days Lock</div>
                <div className="v">1.0×</div>
                <div className="s">Base vote weight</div>
              </div>
              <div className="stat">
                <div className="k">30 Days Lock</div>
                <div className="v">1.5×</div>
                <div className="s">Multiplier</div>
              </div>
              <div className="stat">
                <div className="k">90 Days Lock</div>
                <div className="v">2.5×</div>
                <div className="s">Multiplier</div>
              </div>
              <div className="stat">
                <div className="k">180 Days Lock</div>
                <div className="v green">4.0×</div>
                <div className="s">Maximum weight</div>
              </div>
            </div>

            <h3>Strict &gt; 70% Pass Threshold</h3>
            <p className="muted small">
              To protect against flash-loan governance attacks and hostile takeovers, proposals require a strict <strong>&gt; 70% delegated vote weight</strong> to pass (&gt; 80% for policy changes). Non-lockers cannot propose or vote.
            </p>
          </div>
          )}

          {/* Section 7: Epoch Yield & 5-Way Split */}
          {showSec("epochs") && (
          <div id="epochs" className="panel stack">
            <h2><MojiLabel face="hero">7. Epoch Staking Yield &amp; The 5-Way Split</MojiLabel></h2>
            <p>
              After graduation, the locked Ref LP continuously generates LiNEAR staking rewards. Every epoch (30 days on mainnet, 1 hour on testnet), holders vote on how to distribute the yield:
            </p>
            <div className="grid cards" style={{ marginTop: 8 }}>
              <div className="panel tight" style={{ background: "var(--panel-2)" }}>
                <b className="green">1. Floor Vault</b>
                <p className="small muted" style={{ margin: "4px 0 0" }}>Compounds yield directly into the redeemable floor, increasing the minimum value of every token.</p>
              </div>
              <div className="panel tight" style={{ background: "var(--panel-2)" }}>
                <b className="warn">2. Buyback &amp; Burn</b>
                <p className="small muted" style={{ margin: "4px 0 0" }}>Automatically purchases tokens on Ref Finance and burns them forever on-chain.</p>
              </div>
              <div className="panel tight" style={{ background: "var(--panel-2)" }}>
                <b>3. Airdrop to Lockers</b>
                <p className="small muted" style={{ margin: "4px 0 0" }}>Distributes claimable LiNEAR dividends directly to ve-locked token holders.</p>
              </div>
              <div className="panel tight" style={{ background: "var(--panel-2)" }}>
                <b style={{ color: "var(--sky)" }}>4. AI Agent Budget</b>
                <p className="small muted" style={{ margin: "4px 0 0" }}>Funds on-chain inference and posting credits for the token&apos;s community AI agent.</p>
              </div>
              <div className="panel tight" style={{ background: "var(--panel-2)" }}>
                <b style={{ color: "var(--violet)" }}>5. DAO Treasury</b>
                <p className="small muted" style={{ margin: "4px 0 0" }}>Funds community bounties, marketing initiatives, and developer grants approved by DAO vote.</p>
              </div>
            </div>
          </div>
          )}

          {/* Section 8: Instant Trading Console */}
          {showSec("trading") && (
          <div id="trading" className="panel stack">
            <h2><MojiLabel face="wink">8. High-Speed Instant Trading Console</MojiLabel></h2>
            <p>
              Traditional Web3 trading requires wallet popups and confirmations on every trade. Floorpad introduces synchronous in-contract instant trading (<code>trading.rs</code>):
            </p>
            <ul className="muted small stack" style={{ paddingLeft: 20 }}>
              <li><strong>Deposit Once:</strong> Deposit NEAR into your trading balance via <code>deposit_trading()</code>.</li>
              <li><strong>Instant Quick Buys &amp; Sells:</strong> Call non-payable <code>quick_buy</code> and <code>quick_sell</code> methods synchronously with <strong>zero wallet popups</strong>.</li>
              <li><strong>Custody Holding Age:</strong> Tokens bought via the instant console are held safely in custody while tracking their exact acquisition age, ensuring full decaying exit fee discounts apply.</li>
              <li><strong>Withdraw Anytime:</strong> Withdraw your NEAR or move custody tokens to your wallet with 1 yocto deposit at any time.</li>
            </ul>
          </div>
          )}

          {/* Section 9: Referrals Program */}
          {showSec("referrals") && (
          <div id="referrals" className="panel stack">
            <h2><MojiLabel face="cool">9. 20% Referrals Program</MojiLabel></h2>
            <p>
              Every user has a personalized referral link: <code>/token/[id]?ref=your-account.near</code>.
            </p>
            <p className="muted small">
              Whenever someone trades through your referral link, <strong>20% of the platform trading fee</strong> is credited instantly and directly to your claimable balance on-chain. Referrals are tracked on a 30-day first-touch attribution window.
            </p>
          </div>
          )}

          {/* Section 10: Admin Controls & Key Status */}
          {showSec("security") && (
          <div id="security" className="panel stack">
            <h2><MojiLabel face="cool">10. Contract Controls &amp; Immutability</MojiLabel></h2>
            <p>
              The launchpad contract separates treasury fee collection from user assets and has no admin methods to withdraw user funds, vault principal, or LP shares:
            </p>
            <ul className="muted small stack" style={{ paddingLeft: 20 }}>
              <li><strong>Immutable Parameters:</strong> Contract configuration is set at deployment with no runtime <code>set_config</code> method.</li>
              <li><strong>No Withdrawal Backdoors:</strong> The deployer cannot move vault backing, locked LP, or user custody balances.</li>
              <li><strong>Key Lock Status:</strong> Production mainnet deployments remove full-access keys (<code>LOCK=1</code>) so code upgrades become permanently impossible. During active testnet development, an upgrade key may remain present until testnet testing concludes.</li>
              <li><strong>Transparent Checks:</strong> Calling the on-chain view function <code>get_admin_powers()</code> lists these contract restrictions publicly.</li>
            </ul>
          </div>
          )}

          {/* Section 11: FAQ */}
          {showSec("faq") && (
          <div id="faq" className="panel stack">
            <h2><MojiLabel face="flag">11. Frequently Asked Questions (FAQ)</MojiLabel></h2>
            <div className="stack" style={{ gap: 12 }}>
              <div className="panel tight stack" style={{ background: "var(--panel-2)" }}>
                <b>Can the dev or creator rug-pull?</b>
                <span className="small muted">
                  Creators receive zero free premint tokens, and 100% of graduated Ref Finance LP is held by the launchpad contract rather than the creator. Meme tokens remain volatile and risky on the open market.
                </span>
              </div>
              <div className="panel tight stack" style={{ background: "var(--panel-2)" }}>
                <b>Can the floor price ever drop?</b>
                <span className="small muted">
                  Not in NEAR / LiNEAR terms. Because the vault only receives inflows and redemptions keep fees in the vault while burning supply, the NEAR backing per remaining token is non-decreasing. However, the <strong>USD value fluctuates with NEAR&apos;s market price</strong>, and open-market pool price trades independently.
                </span>
              </div>
              <div className="panel tight stack" style={{ background: "var(--panel-2)" }}>
                <b>Where does the Ref Finance LP yield go?</b>
                <span className="small muted">
                  The LP is paired with LiNEAR, which accrues staking yield. This yield is distributed every epoch according to the ve-lock holder vote.
                </span>
              </div>
              <div className="panel tight stack" style={{ background: "var(--panel-2)" }}>
                <b>What happens if a DAO proposal doesn&apos;t reach 70%?</b>
                <span className="small muted">
                  It fails. Floorpad prioritizes security and community consensus over ease of proposal passing.
                </span>
              </div>
            </div>
          </div>
          )}

          {/* Chapter Next / Previous Navigator */}
          {viewMode === "focus" && (
            <div className="row between wrap" style={{ marginTop: 12 }}>
              {prevSec ? (
                <button
                  className="btn ghost row"
                  onClick={() => {
                    setActiveSection(prevSec.id);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  style={{ gap: 6 }}
                >
                  <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
                    <SlabIcon name="chevron" size={14} />
                  </span>
                  <span>{prevSec.title}</span>
                </button>
              ) : <div />}
              {nextSec && (
                <button
                  className="btn primary row"
                  onClick={() => {
                    setActiveSection(nextSec.id);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  style={{ gap: 6 }}
                >
                  <span>{nextSec.title}</span>
                  <SlabIcon name="chevron" size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
