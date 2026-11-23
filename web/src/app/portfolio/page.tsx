"use client";

import { useState } from "react";
import Link from "next/link";
import {
  floorPrice,
  fmtNear,
  fmtPrice,
  fmtTok,
  isGraduated,
  LAUNCHPAD,
  LINEAR,
  lp,
  nearUsd,
  REF,
  tokenSpotPrice,
  until,
  view,
  YOCTO,
  type Position,
  type TokenView,
} from "@/lib/near";
import { storageCallIfNeeded, useView, useWallet } from "@/lib/wallet";
import { Avatar } from "@/components/ui";
import { Mascot } from "@/components/Mascot";
import { SlabIcon } from "@/components/Brand";
import { PnlModal } from "@/components/PnlModal";
import { positionSummary } from "@/lib/pnl";
import { openConvertLinear } from "@/lib/linear-exit";
import { claimsText, getClaims, stakeOf, stakePrice, STNEAR } from "@/lib/stake";

interface Row {
  t: TokenView;
  /** Wallet balance only. */
  balance: bigint;
  /** Tokens held in the instant-trading custody account. */
  custody: bigint;
  pos: Position | null;
  /** ft_holding_since for the wallet (seconds), drives exit-fee decay. */
  since: number | null;
  refPool?: { token_account_ids: string[]; amounts: string[] } | null;
}

/** Worth-now and PnL for one row, same math as the PnL card. */
function PositionCells({ r, account, linearPrice }: { r: Row; account: string; linearPrice: bigint }) {
  const held = r.balance + r.custody + (r.pos ? BigInt(r.pos.amount) : 0n);
  const age = r.since ? Math.max(0, Math.floor(Date.now() / 1000) - r.since) : 0;
  const { data: s } = useView(
    () => positionSummary(r.t, account, held, age, linearPrice),
    [r.t.token_id, account, held.toString(), linearPrice.toString()],
    60000,
  );
  if (!s) {
    return (
      <>
        <td className="muted">…</td>
        <td className="muted">…</td>
      </>
    );
  }
  return (
    <>
      <td title={s.value.via === "floor" ? "Best exit: redeem at the floor" : "Best exit: sell on the market"}>
        {fmtNear(s.value.near, 3)} N<span className="small muted"> {s.value.via === "floor" ? "floor" : "market"}</span>
      </td>
      <td className={s.pnlNear >= 0n ? "green" : "red"}>
        {s.pnlPct === null ? <span className="muted">no buys</span> : `${s.pnlPct >= 0 ? "+" : ""}${s.pnlPct.toFixed(1)}%`}
      </td>
    </>
  );
}

export default function Portfolio() {
  const { accountId, signIn, send, busy } = useWallet();
  const [pnlTarget, setPnlTarget] = useState<Row | null>(null);
  const { data: usd } = useView(() => nearUsd(), [], 60000);
  // each token is valued in its own staking token (LiNEAR or stNEAR)
  const { data: stakePrices } = useView(
    async () => ({ [LINEAR]: await stakePrice(LINEAR).catch(() => YOCTO), [STNEAR]: await stakePrice(STNEAR).catch(() => YOCTO) }),
    [],
    60000,
  );
  const priceFor = (t: TokenView) => stakePrices?.[stakeOf(t).id] ?? YOCTO;
  const { data: rows } = useView<Row[]>(
    accountId
      ? async () => {
          const tokens = (await lp<TokenView[]>("get_tokens", { from_index: 0, limit: 100 })).filter((t) => t.deployed);
          const out = await Promise.all(
            tokens.map(async (t) => {
              const [balance, pos, custody, since] = await Promise.all([
                view<string>(t.token_id, "ft_balance_of", { account_id: accountId }).then((x) => BigInt(x)).catch(() => 0n),
                lp<Position | null>("get_position", { token_id: t.token_id, account_id: accountId }).catch(() => null),
                lp<{ amount: string }>("get_custody", { token_id: t.token_id, account_id: accountId }).then((c) => BigInt(c?.amount ?? "0")).catch(() => 0n),
                view<string | null>(t.token_id, "ft_holding_since", { account_id: accountId }).then((x) => (x ? Number(x) : null)).catch(() => null),
              ]);
              const refPool =
                isGraduated(t) && t.pool_id !== null && (balance > 0n || custody > 0n || (pos && BigInt(pos.amount) > 0n))
                  ? await view<{ token_account_ids: string[]; amounts: string[] }>(REF, "get_pool", { pool_id: t.pool_id }).catch(() => null)
                  : null;
              return { t, balance, custody, pos, since, refPool };
            }),
          );
          return out.filter((r) => r.balance > 0n || r.custody > 0n || (r.pos && BigInt(r.pos.amount) > 0n));
        }
      : null,
    [accountId],
    20000,
  );
  const { data: claims } = useView(accountId ? () => getClaims(lp, accountId) : null, [accountId, busy], 15000);
  const { data: referral } = useView(accountId ? () => lp<string>("get_referral_balance", { account_id: accountId }) : null, [accountId], 15000);
  const { data: created } = useView(
    accountId ? async () => (await lp<TokenView[]>("get_tokens", { from_index: 0, limit: 100 })).filter((t) => t.creator === accountId) : null,
    [accountId],
    20000,
  );

  if (!accountId) {
    return (
      <div className="empty section mascot-empty">
        <Mascot pose="cool" size={120} motion="idle" alt="" />
        <p>Connect a wallet to see your tokens, locks and rewards.</p>
        <button className="btn primary" onClick={signIn}>Connect wallet</button>
      </div>
    );
  }

  async function withdraw() {
    const regs = [];
    for (const c of claims ?? []) {
      const r = await storageCallIfNeeded(c.token, accountId!);
      if (r) regs.push(r);
    }
    await send([...regs, { receiverId: LAUNCHPAD, calls: [{ method: "withdraw_linear", args: {}, gas: 50, deposit: "1" }] }]);
  }

  return (
    <div className="section stack">
      <div className="row between wrap">
        <h1 className="page-title">Portfolio</h1>
        <button
          className="btn sm"
          onClick={async () => {
            const url = `${window.location.origin}/?ref=${accountId}`;
            await navigator.clipboard.writeText(url).catch(() => { });
          }}
          title="Earn 20% of the platform fee on every trade your link brings"
        >
          <SlabIcon name="share" size={14} /> Copy my ref link
        </button>
        <div className="row">
          <span className="muted">Claimable: <b>{claimsText(claims, (v) => fmtNear(v))}</b></span>
          <button className="btn primary sm" disabled={busy || !claims?.length} onClick={withdraw}>Withdraw</button>
          <button className="btn sm" onClick={openConvertLinear} title="Turn stNEAR or LiNEAR into NEAR">Staked NEAR → NEAR</button>
        </div>
      </div>
      <div className="grid half">
        <div className="panel">
          <h2>Referral earnings</h2>
          <p className="small muted">You earn 20% of the platform fee on every curve trade made through your ref link.</p>
          <div className="row between">
            <b>{fmtNear(referral ?? "0")} NEAR</b>
            <button className="btn sm primary" disabled={busy || !referral || referral === "0"} onClick={() => send([{ receiverId: LAUNCHPAD, calls: [{ method: "claim_referral_fees", args: {}, gas: 20 }] }])}>Claim</button>
          </div>
        </div>
        <div className="panel">
          <h2>Creator fees</h2>
          {!created?.length && <p className="small muted">Tokens you launch show up here. Half of your 25% fee share is claimable any time.</p>}
          {created?.map((t) => (
            <div key={t.token_id} className="row between" style={{ marginTop: 6 }}>
              <span><b>${t.meta.symbol}</b> <span className="small muted">escrow {fmtNear(t.creator_escrow, 3)} N (DAO-released)</span></span>
              <button className="btn sm" disabled={busy || t.creator_claimable === "0"} onClick={() => send([{ receiverId: LAUNCHPAD, calls: [{ method: "claim_creator_fees", args: { token_id: t.token_id }, gas: 20 }] }])}>
                Claim {fmtNear(t.creator_claimable, 3)} N
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        {!rows && <div className="empty">Loading…</div>}
        {rows?.length === 0 && (
          <div className="empty mascot-empty">
            <Mascot pose="wink" size={96} motion="peek" alt="" />
            <span>No Floorpad tokens yet. <Link href="/" className="green link-chev">Explore launches <SlabIcon name="chevron" size={12} /></Link></span>
          </div>
        )}
        {rows && rows.length > 0 && (
          <div className="table-scroll">
            <table className="t">
              <thead>
                <tr><th>Token</th><th>Wallet</th><th>Locked</th><th>Unlocks</th><th>Floor value</th><th>Worth now</th><th>PnL</th><th>Rewards</th><th>Share</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { t, balance, custody, pos } = row;
                  const locked = pos ? BigInt(pos.amount) : 0n;
                  const floorVal = floorPrice(t, priceFor(t)) * Number((balance + custody + locked) / 10n ** 14n) / 1e4;
                  return (
                    <tr key={t.token_id}>
                      <td>
                        <Link href={`/token/${t.token_id}`} className="row" style={{ gap: 8 }}>
                          <Avatar t={t} /> <b>${t.meta.symbol}</b>
                        </Link>
                      </td>
                      <td>
                        {fmtTok(balance.toString(), 0)}
                        {custody > 0n && <div className="small muted">+{fmtTok(custody.toString(), 0)} instant</div>}
                      </td>
                      <td>{fmtTok(locked.toString(), 0)}</td>
                      <td>{locked > 0n ? until(pos!.unlock_at) : "–"}</td>
                      <td className="green">{fmtPrice(floorVal)} N</td>
                      <PositionCells r={row} account={accountId} linearPrice={priceFor(row.t)} />
                      <td>{pos ? `${fmtNear(pos.pending_reward, 5)} ${stakeOf(t).symbol}` : "–"}</td>
                      <td>
                        <button
                          className="btn sm"
                          onClick={() => setPnlTarget(row)}
                          title="Share PNL Card on X"
                        >
                          <SlabIcon name="share" size={12} /> PNL
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pnlTarget && (
        <PnlModal
          t={pnlTarget.t}
          balance={pnlTarget.balance}
          holdingSince={pnlTarget.since}
          linearPrice={priceFor(pnlTarget.t)}
          spotPriceNear={tokenSpotPrice(pnlTarget.t, pnlTarget.refPool, priceFor(pnlTarget.t))}
          floorPriceNear={floorPrice(pnlTarget.t, priceFor(pnlTarget.t))}
          nearUsd={usd ?? 3.6}
          onClose={() => setPnlTarget(null)}
        />
      )}
    </div>
  );
}
