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
  progressPct,
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

const TABS = ["Chat", "Calls", "Trades", "Floor", "Lock & vote", "DAO", "Treasury", "Agent"] as const;
type Tab = (typeof TABS)[number];

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
  const [tab, setTab] = useState<Tab>("Chat");
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
  const mcapUsd = yoctoToUsd(t.fdv_near, nearUsdPrice);
  const gradUsd = yoctoToUsd(t.grad_fdv_near, nearUsdPrice);
  const pct = progressPct(t);
  const links = [
    t.meta.website && { href: t.meta.website, label: "Web" },
    t.meta.twitter && { href: `https://x.com/${t.meta.twitter.replace(/^@/, "")}`, label: "X" },
    t.meta.telegram && { href: t.meta.telegram.startsWith("http") ? t.meta.telegram : `https://${t.meta.telegram}`, label: "TG" },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <div className="token-page">
      <div className="token-head">
        <Avatar t={t} lg />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="token-title">
            {t.meta.name} <span className="muted">${t.meta.symbol}</span>
          </h1>
          <div className="row wrap" style={{ gap: 6 }}>
            <StageBadges t={t} />
            {links.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="badge">
                {l.label} ↗
              </a>
            ))}
          </div>
        </div>
        <div className="desktop-only"><OpsBar t={t} reload={ctx.reload} /></div>
      </div>

      <div className="chips">
        <div className="chip"><span>Market cap</span><b>{nearUsdPrice ? fmtUsd(mcapUsd) : "–"}</b></div>
        <div className="chip"><span>Floor (vault)</span><b className="green">{nearUsdPrice ? fmtUsd(yoctoToUsd(vaultNear(t, linearPrice), nearUsdPrice)) : `${fmtPrice(floorPrice(t, linearPrice))} N`}</b></div>
        <div className="chip"><span>Floor / mcap</span><b>{mcapUsd > 0 && nearUsdPrice ? `${((yoctoToUsd(vaultNear(t, linearPrice), nearUsdPrice) / mcapUsd) * 100).toFixed(1)}%` : "–"}</b></div>
        <div className="chip"><span>Holders</span><b>{t.holders}</b></div>
        <div className="chip"><span>Locked</span><b>{fmtTok(t.total_locked, 0)}</b></div>
        <div className="chip"><span>Burned</span><b>{fmtTok(t.burned, 0)}</b></div>
      </div>

      {!graduated && (
        <div className="bond">
          <div className="row between small">
            <span>Bonding curve · {pct.toFixed(1)}%</span>
            <span className="muted">graduates to Ref at {nearUsdPrice ? fmtUsd(gradUsd) : `$${t.grad_mcap_usd.toLocaleString()}`}</span>
          </div>
          <div className="progress big"><div style={{ width: `${pct}%` }} /></div>
        </div>
      )}

      <div className="mobile-only"><OpsBar t={t} reload={ctx.reload} /></div>

      <div className="token-layout">
        <div className="token-main">
          <PriceChart {...ctx} />
          <div className="tabs" role="tablist">
            {TABS.map((x) => (
              <button key={x} role="tab" className={tab === x ? "active" : ""} onClick={() => setTab(x)}>
                {x}
              </button>
            ))}
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
        <aside className="token-aside desktop-only">
          <TradePanel {...ctx} />
        </aside>
      </div>

      {/* mobile: sticky trade bar + bottom sheet */}
      <div className="trade-bar mobile-only">
        <button className="btn primary" onClick={() => setSheet("buy")}>Buy</button>
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
    </div>
  );
}
