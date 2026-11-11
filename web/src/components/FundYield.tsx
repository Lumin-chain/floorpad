"use client";

import { useState } from "react";
import { fmtNear, LAUNCHPAD, LINEAR, parseUnits, YOCTO, type TokenView } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { MojiLabel } from "./Brand";

/**
 * Sponsors, creators or whales can boost a graduated token's holder rewards:
 * NEAR is staked into LiNEAR and sent to the launchpad with {"fund_yield": token}.
 * It is split by the next epoch's holder vote exactly like staking yield.
 */
export function FundYield({ t, linearPrice }: { t: TokenView; linearPrice: bigint }) {
  const { send, busy, signIn, accountId } = useWallet();
  const [amt, setAmt] = useState("");
  const near = parseUnits(amt, 24);
  // conservative share estimate so the transfer never exceeds what deposit_and_stake mints
  const shares = linearPrice > 0n ? ((near * YOCTO) / linearPrice) * 999_000n / 1_000_000n : 0n;

  async function fund() {
    if (!accountId) return signIn();
    const ok = await send([
      { receiverId: LINEAR, calls: [{ method: "deposit_and_stake", args: {}, gas: 50, deposit: near }] },
      {
        receiverId: LINEAR,
        calls: [{ method: "ft_transfer_call", args: { receiver_id: LAUNCHPAD, amount: shares.toString(), msg: JSON.stringify({ fund_yield: t.token_id }) }, gas: 100, deposit: "1" }],
      },
    ]);
    if (ok) setAmt("");
  }

  if (t.grad_stage !== "Graduated") return null;
  return (
    <div className="panel">
      <h2><MojiLabel face="hero">Boost holder rewards</MojiLabel></h2>
      <p className="small muted">
        Add NEAR to ${t.meta.symbol}&apos;s yield pool. It is staked into LiNEAR and split at the next epoch by the holders&apos; vote:
        buyback &amp; burn, airdrop to lockers, AI agent, treasury or the floor.
      </p>
      <div className="input-suffix">
        <input className="input" inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value)} />
        <em>NEAR</em>
      </div>
      <div className="small muted" style={{ margin: "6px 0" }}>≈ {fmtNear(shares, 4)} LiNEAR (min 1 NEAR to stake)</div>
      <button className="btn primary block" disabled={busy || near < YOCTO} onClick={fund}>Fund yield</button>
    </div>
  );
}
