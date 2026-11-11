"use client";

import { useState } from "react";
import Link from "next/link";
import { floorPrice, fmtNear, fmtPrice, fmtTok, LAUNCHPAD, LINEAR, lp, pricePerToken, until, view, type Position, type TokenView } from "@/lib/near";
import { storageCallIfNeeded, useView, useWallet } from "@/lib/wallet";
import { Avatar } from "@/components/ui";
import { Mascot } from "@/components/Mascot";
import { SlabIcon } from "@/components/Brand";
import { PnlModal } from "@/components/PnlModal";

interface Row {
  t: TokenView;
  balance: bigint;
  pos: Position | null;
}

export default function Portfolio() {
  const { accountId, signIn, send, busy } = useWallet();
  const [pnlTarget, setPnlTarget] = useState<Row | null>(null);
  const { data: rows } = useView<Row[]>(
    accountId
      ? async () => {
          const tokens = (await lp<TokenView[]>("get_tokens", { from_index: 0, limit: 100 })).filter((t) => t.deployed);
          const out = await Promise.all(
            tokens.map(async (t) => ({
              t,
              balance: BigInt(await view<string>(t.token_id, "ft_balance_of", { account_id: accountId }).catch(() => "0")),
              pos: await lp<Position | null>("get_position", { token_id: t.token_id, account_id: accountId }),
            })),
          );
          return out.filter((r) => r.balance > 0n || (r.pos && BigInt(r.pos.amount) > 0n));
        }
      : null,
    [accountId],
    20000,
  );
  const { data: claimable } = useView(accountId ? () => lp<string>("get_claimable_linear", { account_id: accountId }) : null, [accountId], 15000);
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
    const reg = await storageCallIfNeeded(LINEAR, accountId!);
    await send([...(reg ? [reg] : []), { receiverId: LAUNCHPAD, calls: [{ method: "withdraw_linear", args: {}, gas: 50, deposit: "1" }] }]);
  }

  return (
    <div className="section stack">
      <div className="row between wrap">
        <h1>Portfolio</h1>
        <button
          className="btn sm"
          onClick={async () => {
            const url = `${window.location.origin}/?ref=${accountId}`;
            await navigator.clipboard.writeText(url).catch(() => {});
          }}
          title="Earn 20% of the platform fee on every trade your link brings"
        >
          <SlabIcon name="share" size={14} /> Copy my ref link
        </button>
        <div className="row">
          <span className="muted">Claimable: <b>{fmtNear(claimable ?? "0")} LiNEAR</b></span>
          <button className="btn primary sm" disabled={busy || !claimable || claimable === "0"} onClick={withdraw}>Withdraw</button>
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
                <tr><th>Token</th><th>Wallet</th><th>Locked</th><th>Unlocks</th><th>Floor value</th><th>Rewards</th><th>Share</th></tr>
              </thead>
              <tbody>
                {rows.map(({ t, balance, pos }) => {
                  const locked = pos ? BigInt(pos.amount) : 0n;
                  const floorVal = floorPrice(t) * Number((balance + locked) / 10n ** 14n) / 1e4;
                  return (
                    <tr key={t.token_id}>
                      <td>
                        <Link href={`/token/${t.token_id}`} className="row" style={{ gap: 8 }}>
                          <Avatar t={t} /> <b>${t.meta.symbol}</b>
                        </Link>
                      </td>
                      <td>{fmtTok(balance.toString(), 0)}</td>
                      <td>{fmtTok(locked.toString(), 0)}</td>
                      <td>{locked > 0n ? until(pos!.unlock_at) : "–"}</td>
                      <td className="green">{fmtPrice(floorVal)} N</td>
                      <td>{pos ? `${fmtNear(pos.pending_reward, 5)} LiNEAR` : "–"}</td>
                      <td>
                        <button
                          className="btn sm"
                          style={{ padding: "4px 10px", fontSize: 12, gap: 4 }}
                          onClick={() => setPnlTarget({ t, balance, pos })}
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
          balance={pnlTarget.balance + (pnlTarget.pos ? BigInt(pnlTarget.pos.amount) : 0n)}
          holdingSince={pnlTarget.pos ? pnlTarget.pos.unlock_at - 7 * 86400 : null}
          spotPriceNear={pricePerToken(BigInt(pnlTarget.t.v_near), BigInt(pnlTarget.t.v_tokens))}
          floorPriceNear={floorPrice(pnlTarget.t)}
          nearUsd={3.6}
          onClose={() => setPnlTarget(null)}
        />
      )}
    </div>
  );
}
