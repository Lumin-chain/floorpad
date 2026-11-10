"use client";

import { useState } from "react";
import { fmtNear, LINEAR, view } from "@/lib/near";
import { encodeDescription } from "@/lib/proposal-format";
import { useView, useWallet } from "@/lib/wallet";
import type { TokenView } from "@/lib/near";

interface Bounty {
  id: number;
  description: string;
  token: string;
  amount: string;
  times: number;
  max_deadline: string;
}
interface Claim {
  bounty_id: number;
  start_time: string;
  deadline: string;
  completed: boolean;
}

/**
 * Sputnik bounty lifecycle, in-app: holders fund a bounty by proposal (AddBounty);
 * anyone claims it (bond), submits the work (bounty_done -> BountyDone proposal),
 * and lockers vote to pay. Non-holders can submit work; only lockers decide.
 */
export function Bounties({ t, bountyBond }: { t: TokenView; bountyBond: string }) {
  const { accountId, send, busy, signIn } = useWallet();
  const dao = t.dao_id;
  const { data: bounties, reload } = useView(() => view<Bounty[]>(dao, "get_bounties", { from_index: 0, limit: 50 }), [dao], 15000);
  const { data: claims, reload: reloadClaims } = useView(
    accountId ? () => view<Claim[]>(dao, "get_bounty_claims", { account_id: accountId }) : null,
    [dao, accountId],
    15000,
  );
  const [work, setWork] = useState<Record<number, string>>({});
  const myClaim = (id: number) => claims?.find((c) => c.bounty_id === id && !c.completed);
  const refresh = () => {
    reload();
    reloadClaims();
  };

  async function claim(b: Bounty) {
    if (!accountId) return signIn();
    if (await send([{ receiverId: dao, calls: [{ method: "bounty_claim", args: { id: b.id, deadline: b.max_deadline }, gas: 50, deposit: bountyBond }] }])) refresh();
  }
  async function done(b: Bounty) {
    const description = encodeDescription({ title: `Bounty #${b.id} delivered`, notes: work[b.id], proposal_action: "bounty_done" });
    if (await send([{ receiverId: dao, calls: [{ method: "bounty_done", args: { id: b.id, account_id: null, description }, gas: 100, deposit: bountyBond }] }])) refresh();
  }
  async function giveUp(b: Bounty) {
    if (await send([{ receiverId: dao, calls: [{ method: "bounty_giveup", args: { id: b.id }, gas: 50 }] }])) refresh();
  }

  const days = (ns: string) => Math.round(Number(BigInt(ns) / 1_000_000_000n) / 86400);
  return (
    <div className="panel">
      <h2>🎯 Bounties</h2>
      <p className="small muted">
        Holders fund bounties by proposal. Anyone can claim one, deliver, and submit the work; lockers vote to pay out.
        Claiming locks a {fmtNear(bountyBond)} NEAR bond, refunded when the claim resolves.
      </p>
      {!bounties?.length && <div className="muted small">No open bounties. Propose one with the “Community bounty” template.</div>}
      {bounties?.filter((b) => b.times > 0).map((b) => {
        const mine = myClaim(b.id);
        return (
          <div key={b.id} className="call" style={{ marginTop: 8 }}>
            <div className="row between">
              <b>#{b.id} · {fmtNear(b.amount)} {b.token === "" ? "NEAR" : b.token === LINEAR ? "LiNEAR" : b.token}</b>
              <span className="small muted">{b.times} left · {days(b.max_deadline)}d to deliver</span>
            </div>
            <div className="small" style={{ margin: "6px 0" }}>{b.description}</div>
            {!mine ? (
              <button className="btn sm" disabled={busy} onClick={() => claim(b)}>Claim</button>
            ) : (
              <div className="stack">
                <textarea
                  className="textarea"
                  placeholder="Link to your work + a short note for holders"
                  value={work[b.id] ?? ""}
                  onChange={(e) => setWork({ ...work, [b.id]: e.target.value })}
                />
                <div className="row">
                  <button className="btn sm primary" disabled={busy || !(work[b.id] ?? "").trim()} onClick={() => done(b)}>Submit for vote</button>
                  <button className="btn sm ghost" disabled={busy} onClick={() => giveUp(b)}>Give up</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
