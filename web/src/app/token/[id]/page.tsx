"use client";

import { use, useEffect, useState } from "react";
import {
  floorPrice,
  fmtNear,
  fmtPrice,
  fmtTok,
  isGraduated,
  LINEAR,
  lp,
  nearUsd,
  NETWORK,
  pricePerToken,
  progressPct,
  REF,
  safeExternalUrl,
  safeTelegramUrl,
  safeTwitterUrl,
  tokenFdvNear,
  tokenSpotPrice,
  vaultNear,
  view,
  yoctoToUsd,
  type TokenView,
} from "@/lib/near";
import { fmtUsd } from "@/lib/social";
import { useView, useWallet } from "@/lib/wallet";
import { Avatar, StageBadges } from "@/components/ui";
import { TradePanel } from "@/components/TradePanel";
import { PriceChart, TradesTable } from "@/components/PriceChart";
import { VaultPanel } from "@/components/VaultPanel";
import { LockPanel } from "@/components/LockPanel";
import { DaoPanel } from "@/components/DaoPanel";
import { TreasuryPanel } from "@/components/TreasuryPanel";
import { AgentPanel } from "@/components/AgentPanel";
import { OpsBar } from "@/components/OpsBar";
import { Chat } from "@/components/Chat";
import { TokenCallouts } from "@/components/Callouts";
import { useIsDesktop } from "@/lib/media";
import { Moji, MojiLabel, SlabIcon } from "@/components/Brand";
import { PnlModal } from "@/components/PnlModal";

const TABS = ["Chat", "Calls", "Trades", "Floor", "Lock & vote", "DAO", "Treasury", "Agent"] as const;
type Tab = (typeof TABS)[number];

function ShareButton({ tokenId }: { tokenId: string }) {
  const { accountId, setToast } = useWallet();
  const share = async () => {
    const url = `${window.location.origin}/token/${tokenId}${accountId ? `?ref=${accountId}` : ""}`;
    try {
      if (navigator.share) await navigator.share({ url });
      else await navigator.clipboard.writeText(url);
      setToast({ kind: "ok", text: accountId ? "Ref link copied: you earn 20% of platform fees on trades it brings" : "Link copied" });
    } catch {
      /* dismissed */
    }
  };
  return <button className="btn sm" onClick={share} title="Share with your referral code"><SlabIcon name="share" size={14} /> Share</button>;
}

export interface TokenCtx {
  t: TokenView;
  linearPrice: bigint;
  balance: bigint;
  holdingSince: number | null;
  reload: () => void;
}

export default function TokenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { accountId } = useWallet();
  const desktop = useIsDesktop();
  const [tab, setTab] = useState<Tab>("Chat");
  // On desktop chat is docked beside the chart, so the tab row starts at Trades.
  useEffect(() => {
    if (desktop && tab === "Chat") setTab("Trades");
  }, [desktop, tab]);
  const tabs = TABS.filter((x) => !(desktop && x === "Chat"));
  const [sheet, setSheet] = useState<null | "buy" | "sell">(null);
  const tok = useView(() => lp<TokenView | null>("get_token", { token_id: id }), [id], 6000);
  const price = useView(() => view<string>(LINEAR, "ft_price"), [], 60000);
  const usd = useView(() => nearUsd(), [], 60000);
  const bal = useView(
    accountId ? () => view<string>(id, "ft_balance_of", { account_id: accountId }) : null,
    [id, accountId],
    8000,
  );
  const since = useView(
    accountId ? () => view<string | null>(id, "ft_holding_since", { account_id: accountId }) : null,
    [id, accountId],
    15000,
  );
  const isGrad = tok.data ? isGraduated(tok.data) && tok.data.pool_id !== null : false;
  const poolId = tok.data?.pool_id ?? null;
  const refPool = useView(
    isGrad && poolId !== null
      ? () => view<{ token_account_ids: string[]; amounts: string[]; total_fee: number }>(REF, "get_pool", { pool_id: poolId })
      : null,
    [id, poolId, isGrad],
    6000,
  );

  const [showPnl, setShowPnl] = useState(false);

  useEffect(() => {
    if (tok.data?.meta?.symbol) {
      document.title = `$${tok.data.meta.symbol} · Floorpad`;
    }
  }, [tok.data?.meta?.symbol]);

  useEffect(() => {
    document.body.style.overflow = sheet ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sheet]);

  const t = tok.data;
  if (tok.data === null) return <div className="empty section">Token not found.</div>;
  if (!t) return <div className="empty section">{tok.error ?? "Loading…"}</div>;

  const linearPrice = BigInt(price.data ?? (t.last_linear_price !== "0" ? t.last_linear_price : "1000000000000000000000000"));
  const nearUsdPrice = usd.data ?? 0;
  const ctx: TokenCtx = {
    t,
    linearPrice,
    balance: BigInt(bal.data ?? "0"),
    holdingSince: since.data ? Number(since.data) : null,
    reload: () => {
      tok.reload();
      bal.reload();
      since.reload();
    },
  };
  const graduated = isGraduated(t);
  const spotPriceNear = tokenSpotPrice(t, refPool.data, linearPrice);
  const realFdvNear = tokenFdvNear(t, refPool.data, linearPrice);
  const mcapUsd = yoctoToUsd(realFdvNear.toString(), nearUsdPrice);
  const gradUsd = yoctoToUsd(t.grad_fdv_near, nearUsdPrice);
  const pct = progressPct(t);
  const webHref = safeExternalUrl(t.meta.website);
  const xHref = safeTwitterUrl(t.meta.twitter);
  const tgHref = safeTelegramUrl(t.meta.telegram);
  const links = [
    webHref && { href: webHref, label: "Web" },
    xHref && { href: xHref, label: "X" },
    tgHref && { href: tgHref, label: "TG" },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <div className="token-page">
      <div className="token-head">
        <Avatar t={t} lg />
        <div className="token-head-info">
          <h1 className="token-title ellipsis">
            {t.meta.name} <span className="muted">${t.meta.symbol}</span>
          </h1>
          <div className="row wrap" style={{ gap: 6 }}>
            <StageBadges t={t} />
            {links.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="badge">
                {l.label} <SlabIcon name="external" size={10} />
              </a>
            ))}
          </div>
        </div>
        <div className="row desktop-only token-head-actions">
          <ShareButton tokenId={t.token_id} />
          <button
            className="btn sm"
            onClick={() => setShowPnl(true)}
            title="Share PNL Card on X"
          >
            <SlabIcon name="share" size={14} /> PNL Card
          </button>
          <OpsBar t={t} reload={ctx.reload} menu />
        </div>
        <div className="mobile-only row token-head-actions">
          <ShareButton tokenId={t.token_id} />
          <button className="btn sm" onClick={() => setShowPnl(true)}>PNL</button>
          <OpsBar t={t} reload={ctx.reload} menu />
        </div>
      </div>

      <div className="chips">
        <div className="chip"><span>Market cap</span><b>{nearUsdPrice ? fmtUsd(mcapUsd) : "–"}</b></div>
        <div className="chip"><span>Floor (vault)</span><b className="green">{nearUsdPrice ? fmtUsd(yoctoToUsd(vaultNear(t, linearPrice), nearUsdPrice)) : `${fmtPrice(floorPrice(t, linearPrice))} N`}</b></div>
        <div className="chip"><span>Floor / mcap</span><b>{mcapUsd > 0 && nearUsdPrice ? `${((yoctoToUsd(vaultNear(t, linearPrice), nearUsdPrice) / mcapUsd) * 100).toFixed(1)}%` : "–"}</b></div>
        <div className="chip"><span>Holders</span><b>{t.holders}</b></div>
        <div className="chip"><span>Locked</span><b>{fmtTok(t.total_locked, 0)}</b></div>
        <div className="chip"><span>Burned</span><b>{fmtTok(t.burned, 0)}</b></div>
      </div>

      {/* Graduation Status Banners */}
      {t.grad_stage !== "Curve" && !graduated && (
        <div className="panel stack" style={{ background: "var(--warn-tint)", border: "1.5px solid var(--warn)", gap: 10 }}>
          <div className="row between wrap">
            <div className="row" style={{ gap: 10 }}>
              <Moji face="hero" size={28} />
              <div>
                <strong>Bonding Curve 100% Filled! Migration to Ref Finance in Progress</strong>
                <div className="small muted">
                  Step: <span className="warn mono bold">{t.grad_stage}</span> · Sizing Ref pool at final curve price with 100% permanent LP lock
                </div>
              </div>
            </div>
            <OpsBar t={t} reload={ctx.reload} />
          </div>
        </div>
      )}

      {graduated && (
        <div className="panel row between wrap" style={{ background: "var(--good-tint)", border: "1.5px solid var(--accent)", gap: 12 }}>
          <div className="row" style={{ gap: 10 }}>
            <Moji face="flag" size={28} />
            <div>
              <strong className="green">Graduated to Ref Finance!</strong>
              <div className="small muted">
                Trading live on Ref Finance Pool #{t.pool_id}. 100% of LP shares are locked forever in the launchpad contract and accruing LiNEAR staking yield.
              </div>
            </div>
          </div>
          {t.pool_id !== null && (
            <div className="row wrap" style={{ gap: 8 }}>
              <a
                href={`https://${NETWORK === "mainnet" ? "app.ref.finance" : "testnet.ref.finance"}/#${t.token_id}|${LINEAR}`}
                target="_blank"
                rel="noreferrer"
                className="btn sm primary row"
                style={{ gap: 6 }}
              >
                <span>View on Ref Pool #{t.pool_id}</span>
                <SlabIcon name="external" size={12} />
              </a>
              <a
                href={`https://dexscreener.com/near/${t.token_id}`}
                target="_blank"
                rel="noreferrer"
                className="btn sm row"
                style={{ gap: 6 }}
              >
                <span>Dexscreener</span>
                <SlabIcon name="external" size={12} />
              </a>
            </div>
          )}
        </div>
      )}

      {!graduated && t.grad_stage === "Curve" && (
        <div className="bond">
          <div className="row between small">
            <span>Bonding curve · {pct.toFixed(1)}%</span>
            <span className="muted">graduates to Ref at {nearUsdPrice ? fmtUsd(gradUsd) : `$${t.grad_mcap_usd.toLocaleString()}`}</span>
          </div>
          <div className="progress big"><div style={{ width: `${pct}%` }} /></div>
        </div>
      )}

      <div className="token-layout">
        <div className="token-main">
          <PriceChart {...ctx} />
          <div className="tabs" role="tablist">
            {tabs.map((x) => (
              <button key={x} role="tab" className={tab === x ? "active" : ""} onClick={() => setTab(x)}>
                {x}
              </button>
            ))}
            {graduated && (
              <a
                href={`https://dexscreener.com/near/${t.token_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn sm row"
                style={{ gap: 5, marginLeft: "auto" }}
              >
                <span>Dexscreener</span>
                <SlabIcon name="external" size={11} />
              </a>
            )}
          </div>
          {tab === "Chat" && <div className="panel flush"><Chat t={t} /></div>}
          {tab === "Calls" && <TokenCallouts t={t} usdMcap={mcapUsd} />}
          {tab === "Trades" && <div className="panel"><TradesTable t={t} /></div>}
          {tab === "Floor" && <VaultPanel {...ctx} />}
          {tab === "Lock & vote" && <LockPanel {...ctx} />}
          {tab === "DAO" && <DaoPanel {...ctx} />}
          {tab === "Treasury" && <TreasuryPanel {...ctx} />}
          {tab === "Agent" && <AgentPanel {...ctx} onGoDao={() => setTab("DAO")} />}
          {t.meta.description && (
            <div className="panel about">
              <h3>About</h3>
              <p className="muted small" style={{ margin: 0 }}>{t.meta.description}</p>
              <p className="small muted mono" style={{ margin: "8px 0 0" }}>{t.token_id}</p>
            </div>
          )}
        </div>
        {desktop && <aside className="token-aside">
          <TradePanel {...ctx} />
          <div className="panel flush">
            <div className="aside-head row between">
              <b><MojiLabel face="wink">Live chat</MojiLabel></b>
              <span className="small muted">${t.meta.symbol}</span>
            </div>
            <Chat t={t} compact />
          </div>
          <div className="panel tight small">
            <div className="kv"><span>Contract</span><span className="mono ellipsis" style={{ maxWidth: 200 }}>{t.token_id}</span></div>
            <div className="kv"><span>DAO</span><span className="mono ellipsis" style={{ maxWidth: 200 }}>{t.dao_id}</span></div>
            <div className="kv"><span>Creator</span><span className="mono ellipsis" style={{ maxWidth: 200 }}>{t.creator}</span></div>
            <div className="kv"><span>Sized at</span><span>NEAR ${(Number(t.launch_near_usd) / 1e6).toFixed(2)}</span></div>
          </div>
        </aside>}
      </div>

      {/* mobile: sticky trade bar + bottom sheet */}
      <div className="trade-bar mobile-only">
        <button className="btn buy" onClick={() => setSheet("buy")}>Buy</button>
        <button className="btn danger-solid" onClick={() => setSheet("sell")}>Sell</button>
      </div>
      {sheet && (
        <div className="sheet-backdrop mobile-only" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Trade">
            <div className="sheet-grip" />
            <TradePanel {...ctx} initialSide={sheet} onDone={() => setSheet(null)} />
          </div>
        </div>
      )}

      {showPnl && (
        <PnlModal
          t={t}
          balance={ctx.balance}
          holdingSince={ctx.holdingSince}
          spotPriceNear={spotPriceNear}
          floorPriceNear={floorPrice(t, linearPrice)}
          nearUsd={nearUsdPrice}
          onClose={() => setShowPnl(false)}
        />
      )}
    </div>
  );
}
