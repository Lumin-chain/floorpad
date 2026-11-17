"use client";

import { useEffect, useState } from "react";
import { floorPrice, fmtNear, fmtPrice, fmtTok, isGraduated, LAUNCHPAD, LINEAR, lp, parseUnits, vaultNear, YOCTO, type Quote } from "@/lib/near";
import { storageCallIfNeeded, tokenBalanceError, useView, useWallet, type Tx } from "@/lib/wallet";
import { Kv, Stat } from "./ui";
import type { TokenCtx } from "@/app/token/[id]/page";

/** Plain-language "what is the floor" card, filled with this token's live numbers. */
function FloorExplainer({
  t,
  linearPrice,
  balance,
  age,
  spotPriceNear,
  nearUsd,
}: Pick<TokenCtx, "t" | "linearPrice" | "balance"> & { age: number; spotPriceNear?: number; nearUsd?: number }) {
  const sym = t.meta.symbol;
  const floor = floorPrice(t, linearPrice);
  const vault = vaultNear(t, linearPrice);
  const usd = (near: number) => {
    if (!nearUsd) return "";
    const v = near * nearUsd;
    return ` (≈ $${v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : fmtPrice(v)})`;
  };
  const vaultN = Number(vault / 10n ** 18n) / 1e6;
  const { data: mine } = useView(
    balance > 0n ? () => lp<Quote>("quote_redeem", { token_id: t.token_id, tokens_in: balance.toString(), age_secs: age }) : null,
    [t.token_id, balance.toString(), age > 0, t.linear_shares, t.backing_near],
    20000,
  );
  // graduated tokens redeem for LiNEAR: value it in NEAR for the USD figure
  const mineN = mine
    ? (Number(BigInt(mine.amount_out) / 10n ** 18n) / 1e6) * (isGraduated(t) ? Number(linearPrice / 10n ** 18n) / 1e6 : 1)
    : 0;
  const ratio = spotPriceNear && floor > 0 ? spotPriceNear / floor : null;
  return (
    <div className="panel floor-explainer">
      <h2 style={{ marginTop: 0 }}>What is the floor?</h2>
      <p style={{ margin: "0 0 10px" }}>
        Every ${sym} is backed by NEAR held in this token&apos;s <b>floor vault</b>. The floor is that backing per token:{" "}
        <b className="green">
          {fmtPrice(floor)} NEAR{usd(floor)}
        </b>
        . You can sell any ${sym} back to the vault at that price, at any time. No buyer, pool or liquidity is needed.
      </p>
      <div className="floor-facts">
        <div>
          <span className="small muted">Vault holds</span>
          <b>
            {fmtNear(vault, 3)} NEAR{usd(vaultN)}
          </b>
        </div>
        <div>
          <span className="small muted">Your ${sym} redeem for</span>
          <b>{balance > 0n ? `${fmtNear(mine?.amount_out ?? "0", 4)} ${isGraduated(t) ? "LiNEAR" : "NEAR"}${usd(mineN)}` : "connect a wallet holding it"}</b>
        </div>
        <div>
          <span className="small muted">Market price vs floor</span>
          <b className={ratio && ratio < 0.95 ? "green" : undefined}>
            {!ratio
              ? "–"
              : ratio >= 1.05
                ? `${ratio >= 100 ? Math.round(ratio).toLocaleString() : ratio.toFixed(1)}× above the floor`
                : ratio > 0.95
                  ? "trading at the floor"
                  : `below the floor: redeeming pays ${(1 / ratio).toFixed(1)}× the market price`}
          </b>
        </div>
      </div>
      <div className="floor-why">
        <div>
          <b>🛟 A guaranteed exit</b>
          <span className="small muted">Even if nobody is buying, the vault always pays the floor. Your tokens can&apos;t go to zero.</span>
        </div>
        <div>
          <b>📈 It only goes up</b>
          <span className="small muted">
            Nothing is ever taken out except by redemptions, and those burn the tokens at the floor rate, so the backing per token stays the same. Yield, fees and burns push it higher.
          </span>
        </div>
        <div>
          <b>🧲 It supports the price</b>
          <span className="small muted">
            If the market price drops below the floor, anyone can buy cheap and redeem at the floor for a profit. That buying lifts the price back up.
          </span>
        </div>
      </div>
      <p className="small muted" style={{ margin: "10px 0 0" }}>
        The floor is the <b>minimum</b> the vault pays, not the market price. If you bought above the floor, redeeming can still be a loss: it protects the downside, it does not
        guarantee a profit. Redemptions pay a {isGraduated(t) ? "small redemption fee, plus an exit fee on recently bought tokens," : "small fee"} that stays in the vault for the remaining
        holders.
      </p>
    </div>
  );
}

export function VaultPanel({
  t,
  linearPrice,
  balance,
  holdingSince,
  reload,
  spotPriceNear,
  nearUsd,
}: TokenCtx & { spotPriceNear?: number; nearUsd?: number }) {
  const { send, busy, accountId, setToast } = useWallet();
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
    if (!q || !accountId) return;
    const err = await tokenBalanceError(t.token_id, accountId, base, t.meta.symbol);
    if (err) {
      setToast({ kind: "err", text: err });
      reload();
      return;
    }
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
    <div className="stack">
    <FloorExplainer t={t} linearPrice={linearPrice} balance={balance} age={age} spotPriceNear={spotPriceNear} nearUsd={nearUsd} />
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
          <div className="panel" style={{ border: "1px solid var(--primary)", background: "var(--sky-tint)" }}>
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
          <p className="muted small" style={{ margin: "0 0 8px" }}>Floor = NEAR in the vault ÷ tokens in circulation. It rises when the vault grows or the supply shrinks.</p>
          <ul className="muted small" style={{ paddingLeft: 18, margin: 0 }}>
            <li><b>Curve trades:</b> part of every bonding-curve fee and 100% of exit fees go into the vault, in NEAR.</li>
            <li><b>Graduation:</b> 15% of everything the curve raised seeds the vault, and the vault is staked as LiNEAR.</li>
            <li><b>Staking yield:</b> LiNEAR earns NEAR staking rewards every epoch; holders vote how much compounds into the floor.</li>
            <li><b>Pool fees:</b> the locked Ref LP earns a fee on every swap. The LiNEAR side becomes yield; the token side is burned.</li>
            <li><b>Burns:</b> DEX tax, harvested LP tokens, buyback-and-burn and redemptions all shrink the supply, so each remaining token is backed by more.</li>
            <li><b>Locked forever:</b> nobody, not even the DAO or the team, can withdraw the vault&apos;s principal. The protocol never sells your tokens.</li>
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
    </div>
  );
}
