"use client";

import { use, useState } from "react";
import {
  curvePrice,
  floorPrice,
  fmtNear,
  fmtPrice,
  fmtTok,
  isGraduated,
  LINEAR,
  lp,
  progressPct,
  vaultNear,
  view,
  type TokenView,
} from "@/lib/near";
import { useView, useWallet } from "@/lib/wallet";
import { Avatar, StageBadges, Stat } from "@/components/ui";
import { TradePanel } from "@/components/TradePanel";
import { PriceChart } from "@/components/PriceChart";
import { VaultPanel } from "@/components/VaultPanel";
import { LockPanel } from "@/components/LockPanel";
import { DaoPanel } from "@/components/DaoPanel";
import { TreasuryPanel } from "@/components/TreasuryPanel";
import { AgentPanel } from "@/components/AgentPanel";
import { OpsBar } from "@/components/OpsBar";

const TABS = ["Trade", "Floor", "Lock & vote", "DAO", "Treasury", "Agent"] as const;
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
  const [tab, setTab] = useState<Tab>("Trade");
  const tok = useView(() => lp<TokenView | null>("get_token", { token_id: id }), [id], 6000);
  const price = useView(() => view<string>(LINEAR, "ft_price"), [], 60000);
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

  const t = tok.data;
  if (tok.data === null) return <div className="empty section">Token not found.</div>;
  if (!t) return <div className="empty section">{tok.error ?? "Loading…"}</div>;

  const linearPrice = BigInt(price.data ?? (t.last_linear_price !== "0" ? t.last_linear_price : "1000000000000000000000000"));
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
  const links = [
    t.meta.website && { href: t.meta.website, label: "Website" },
    t.meta.twitter && { href: `https://x.com/${t.meta.twitter.replace(/^@/, "")}`, label: "X" },
    t.meta.telegram && { href: t.meta.telegram.startsWith("http") ? t.meta.telegram : `https://${t.meta.telegram}`, label: "Telegram" },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <div className="section">
      <div className="row between wrap" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 14 }}>
          <Avatar t={t} lg />
          <div>
            <h1 style={{ marginBottom: 4 }}>
              {t.meta.name} <span className="muted">${t.meta.symbol}</span>
            </h1>
            <div className="row wrap" style={{ gap: 8 }}>
              <StageBadges t={t} />
              <span className="small muted mono">{t.token_id}</span>
              {links.map((l) => (
                <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="small muted">
                  {l.label} ↗
                </a>
              ))}
            </div>
          </div>
        </div>
        <OpsBar t={t} reload={ctx.reload} />
      </div>
      {t.meta.description && <p className="muted" style={{ marginTop: 12, maxWidth: 800 }}>{t.meta.description}</p>}

      <div className="grid stats" style={{ marginTop: 16 }}>
        <Stat k="Price" v={graduated ? "Ref pool" : `${fmtPrice(curvePrice(t))} N`} s={graduated ? `pool #${t.pool_id}` : `${progressPct(t).toFixed(1)}% to graduation`} />
        <Stat k="Floor" v={<span className="green">{fmtPrice(floorPrice(t, linearPrice))} N</span>} s="redeemable any time" />
        <Stat k="Vault" v={`${fmtNear(vaultNear(t, linearPrice), 2)} N`} s={graduated ? `${fmtNear(t.linear_shares, 2)} LiNEAR` : "NEAR backing"} />
        <Stat k="Burned" v={fmtTok(t.burned, 0)} s="redeemed + bought back" />
        <Stat k="Locked" v={fmtTok(t.total_locked, 0)} s={`${t.stakers} lockers`} />
        <Stat k="Holders" v={t.holders} s={`${t.trade_count} curve trades`} />
      </div>

      <div className="tabs">
        {TABS.map((x) => (
          <button key={x} className={tab === x ? "active" : ""} onClick={() => setTab(x)}>
            {x}
          </button>
        ))}
      </div>

      {tab === "Trade" && (
        <div className="grid two">
          <PriceChart {...ctx} />
          <TradePanel {...ctx} />
        </div>
      )}
      {tab === "Floor" && <VaultPanel {...ctx} />}
      {tab === "Lock & vote" && <LockPanel {...ctx} />}
      {tab === "DAO" && <DaoPanel {...ctx} />}
      {tab === "Treasury" && <TreasuryPanel {...ctx} />}
      {tab === "Agent" && <AgentPanel {...ctx} onGoDao={() => setTab("DAO")} />}
    </div>
  );
}
