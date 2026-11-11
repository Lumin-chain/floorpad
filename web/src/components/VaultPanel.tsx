"use client";

import { useEffect, useState } from "react";
import { floorPrice, fmtNear, fmtPrice, fmtTok, isGraduated, LAUNCHPAD, LINEAR, lp, parseUnits, vaultNear, YOCTO, type Quote } from "@/lib/near";
import { storageCallIfNeeded, useView, useWallet, type Tx } from "@/lib/wallet";
import { Kv, Stat } from "./ui";
import type { TokenCtx } from "@/app/token/[id]/page";

export function VaultPanel({ t, linearPrice, balance, holdingSince, reload }: TokenCtx) {
  const { send, busy, accountId } = useWallet();
  const [amt, setAmt] = useState("");
  const [q, setQ] = useState<Quote | null>(null);
  const grad = isGraduated(t);
  const age = holdingSince ? Math.max(0, Math.floor(Date.now() / 1000) - holdingSince) : 0;
  const base = parseUnits(amt, 18);
  const { data: claimable } = useView(accountId ? () => lp<string>("get_claimable_linear", { account_id: accountId }) : null, [accountId], 10000);
  const { data: owed } = useView(accountId ? () => lp<string>("get_pending_tokens", { token_id: t.token_id, account_id: accountId }) : null, [accountId, t.token_id], 15000);
  const canRedeem = t.grad_stage === "Curve" || grad;

  useEffect(() => {
    if (base === 0n) return setQ(null);
    const h = setTimeout(async () => setQ(await lp<Quote>("quote_redeem", { token_id: t.token_id, tokens_in: base.toString(), age_secs: age })), 250);
    return () => clearTimeout(h);
  }, [base, t.token_id, age, t.linear_shares, t.backing_near]);

  async function redeem() {
    if (!q) return;
    const min = (BigInt(q.amount_out) * 99n) / 100n;
    const ok = await send([{
      receiverId: t.token_id,
      calls: [{ method: "ft_transfer_call", args: { receiver_id: LAUNCHPAD, amount: base.toString(), msg: JSON.stringify({ action: "redeem", min_out: min.toString() }) }, gas: 150, deposit: "1" }],
    }]);
    if (ok) {
      setAmt("");
      reload();
    }
  }

  async function withdraw() {
    if (!accountId) return;
    const txs: Tx[] = [];
    const reg = await storageCallIfNeeded(LINEAR, accountId);
    if (reg) txs.push(reg);
    txs.push({ receiverId: LAUNCHPAD, calls: [{ method: "withdraw_linear", args: {}, gas: 50, deposit: "1" }] });
    await send(txs);
  }

  const circ = grad ? BigInt(t.total_supply) - BigInt(t.burned) : BigInt(t.sold) - BigInt(t.burned);
  const principalShares = grad && linearPrice > 0n ? (BigInt(t.principal_near) * YOCTO) / linearPrice : 0n;
  const pendingYield = grad ? BigInt(t.linear_shares) - principalShares : 0n;

  return (
    <div className="grid two">
      <div className="stack">
        <div className="grid stats">
          <Stat k="Floor price" v={<span className="green">{fmtPrice(floorPrice(t, linearPrice))} N</span>} s="per token, before fees" />
          <Stat k="Vault value" v={`${fmtNear(vaultNear(t, linearPrice), 3)} N`} s={grad ? `${fmtNear(t.linear_shares, 3)} LiNEAR` : "held as NEAR until graduation"} />
          <Stat k="Redeemable supply" v={fmtTok(circ.toString(), 0)} s={grad ? "incl. tokens in the LP" : "sold on curve minus burned"} />
          {grad && (
            <>
              <Stat k="Unallocated yield" v={`${fmtNear(pendingYield > 0n ? pendingYield : 0n, 4)} LiNEAR`} s="split at the next epoch" />
              <Stat
                k="Harvested LP yield"
                v={`${fmtNear(t.harvested_linear ?? "0", 3)} LiNEAR`}
                s={`Burned ${fmtTok(t.harvest_burned ?? "0", 0)} $${t.meta.symbol}`}
              />
            </>
          )}
        </div>
        {grad && (
          <div className="panel" style={{ border: "1px solid #93C5FD", background: "#EFF6FF" }}>
            <div className="row between">
              <div>
                <h3 style={{ margin: 0 }}>LP Yield Harvest</h3>
                <p className="muted small" style={{ margin: "4px 0 0" }}>
                  Ref swap fees &amp; LiNEAR appreciation above locked depth are harvested each epoch: LiNEAR becomes epoch yield; meme tokens are permanently burned.
                </p>
              </div>
              {t.next_harvest_at && Math.floor(Date.now() / 1000) >= t.next_harvest_at && !t.harvest_busy && (
                <button
                  className="btn sm"
                  disabled={busy}
                  onClick={async () => {
                    await send([{
                      receiverId: LAUNCHPAD,
                      calls: [{ method: "harvest_lp", args: { token_id: t.token_id }, gas: 300 }],
                    }]);
                    reload();
                  }}
                >
                  Harvest LP now
                </button>
              )}
            </div>
          </div>
        )}
        <div className="panel">
          <h2>How the floor rises</h2>
          <ul className="muted small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>40% of every curve fee (1.25% buy, 2.5% sell) goes into the vault.</li>
            <li>Anyone can top up the yield pool with LiNEAR (Treasury tab); it is split by the next epoch vote.</li>
            <li>At graduation, 15% of the raise seeds the vault and unused LP tokens are burned.</li>
            <li>Exit fees on curve sells and on redemptions stay in the vault for remaining holders.</li>
            <li>At graduation the leftover raise joins the vault, and the whole vault is staked as LiNEAR.</li>
            <li>Each epoch, holders vote how to split staking yield. The &quot;Floor&quot; share compounds into principal.</li>
            <li>Redeemed tokens are burned, so supply only shrinks. Principal can never be withdrawn by anyone, including the DAO.</li>
          </ul>
        </div>
      </div>

      <div className="stack">
        <div className="panel stack">
          <div className="row between">
            <h2>Redeem at floor</h2>
            <span className="small muted">Balance {fmtTok(balance.toString())}</span>
          </div>
          {!canRedeem && <div className="notice warn">Redemptions pause while graduation is in progress.</div>}
          <div className="input-suffix">
            <input className="input" inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value)} />
            <em>${t.meta.symbol}</em>
          </div>
          <button className="btn sm ghost" onClick={() => setAmt(fmtTok(balance.toString(), 18).replace(/,/g, ""))}>Max</button>
          {q && (
            <div>
              <Kv k="You receive" v={`${grad ? fmtNear(q.amount_out) + " LiNEAR" : fmtNear(q.amount_out) + " NEAR"}`} />
              <Kv k="Redemption fee (stays in vault)" v={fmtNear(q.fee)} />
              <Kv k="Exit fee (holding-age based)" v={fmtNear(q.exit_fee)} />
            </div>
          )}
          <button className="btn block" disabled={busy || !q || !canRedeem || BigInt(q?.amount_out ?? 0) === 0n} onClick={redeem}>
            Redeem &amp; burn
          </button>
          {grad && <div className="small muted">LiNEAR payouts are credited to your claimable balance below.</div>}
        </div>

        <div className="panel">
          <h2>Your claimable</h2>
          <Kv k="LiNEAR (redemptions + airdrops)" v={fmtNear(claimable ?? "0")} />
          <button className="btn block" style={{ marginTop: 10 }} disabled={busy || !claimable || claimable === "0"} onClick={withdraw}>
            Withdraw LiNEAR
          </button>
          {owed && owed !== "0" && (
            <>
              <Kv k={`Undelivered $${t.meta.symbol}`} v={fmtTok(owed)} />
              <button
                className="btn block"
                style={{ marginTop: 8 }}
                onClick={async () => {
                  const reg = await storageCallIfNeeded(t.token_id, accountId!);
                  await send([...(reg ? [reg] : []), { receiverId: LAUNCHPAD, calls: [{ method: "claim_tokens", args: { token_id: t.token_id }, gas: 50 }] }]);
                }}
              >
                Claim tokens
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
