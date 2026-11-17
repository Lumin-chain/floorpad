"use client";

import { useMemo, useState } from "react";
import {
  BUCKET_LABELS,
  fmtNear,
  LAUNCHPAD,
  LINEAR,
  lp,
  parseUnits,
  YOCTO,
  type LaunchConfig,
  type MechEvent,
  type Position,
  type TokenView,
} from "@/lib/near";
import { useView, useWallet } from "@/lib/wallet";
import { MojiLabel } from "./Brand";

/** Default agent share of yield while no holder has voted (contract: DEFAULT_AGENT_BPS). */
const DEFAULT_AGENT_BPS = 1000;
const [FLOOR, BUYBACK, AIRDROP, AGENT, TREASURY] = [0, 1, 2, 3, 4];

/** How a contribution is split at the next epoch, mirroring the contract's rules. Fractions sum to 1. */
function splitFractions(t: TokenView, platformBps: number): { platform: number; buckets: number[] } {
  const platform = platformBps / 10000;
  const rest = 1 - platform;
  const tally = (t.alloc_tally ?? []).map((x) => Number(BigInt(x) / 10n ** 12n));
  const sum = tally.reduce((a, b) => a + b, 0);
  const b = [0, 0, 0, 0, 0];
  if (sum === 0) {
    b[AGENT] = rest * (DEFAULT_AGENT_BPS / 10000);
    b[FLOOR] = rest - b[AGENT];
  } else {
    for (let i = 0; i < 5; i++) b[i] = (rest * tally[i]) / sum;
  }
  if (BigInt(t.total_weight ?? "0") === 0n) {
    b[FLOOR] += b[AIRDROP];
    b[AIRDROP] = 0;
  }
  if (t.dao_stage !== "Ready") {
    b[FLOOR] += b[TREASURY];
    b[TREASURY] = 0;
  }
  return { platform, buckets: b };
}

/**
 * Anyone can add to a graduated token's yield: NEAR is staked into LiNEAR and sent to the
 * launchpad with {"fund_yield": token}, then split by the next epoch's holder vote. The panel says
 * plainly what comes back to the contributor (only through tokens they hold or lock) and credits
 * contributors from the on-chain record.
 */
export function FundYield({ t, linearPrice }: { t: TokenView; linearPrice: bigint }) {
  const { send, busy, signIn, accountId } = useWallet();
  const [amt, setAmt] = useState("");
  const near = parseUnits(amt, 24);
  // conservative share estimate so the transfer never exceeds what deposit_and_stake mints
  const shares = linearPrice > 0n ? ((near * YOCTO) / linearPrice) * 999_000n / 1_000_000n : 0n;

  const { data: cfg } = useView(() => lp<LaunchConfig>("get_config"), [], 0);
  const { data: pos } = useView(
    accountId ? () => lp<Position | null>("get_position", { token_id: t.token_id, account_id: accountId }) : null,
    [accountId, t.token_id],
    30000,
  );
  const { data: bal } = useView(
    accountId ? () => import("@/lib/near").then((m) => m.view<string>(t.token_id, "ft_balance_of", { account_id: accountId })) : null,
    [accountId, t.token_id],
    30000,
  );
  const { data: mech } = useView(() => lp<MechEvent[]>("get_mech_log", { token_id: t.token_id, limit: 100 }), [t.token_id, t.mech_count], 60000);

  const split = useMemo(() => splitFractions(t, cfg?.yield_platform_bps ?? 1000), [t, cfg?.yield_platform_bps]);
  const nearNum = Number(near / 10n ** 18n) / 1e6;

  // the contributor's direct share: floor part by share of supply, airdrop part by lock weight
  const circ = BigInt(t.total_supply) - BigInt(t.burned);
  const locked = pos ? BigInt(pos.amount) : 0n;
  const held = BigInt(bal ?? "0") + locked;
  const holdPct = circ > 0n ? Number((held * 1_000_000n) / circ) / 1e6 : 0;
  const totalW = BigInt(t.total_weight ?? "0");
  const weightPct = pos && totalW > 0n ? Number((BigInt(pos.weight) * 1_000_000n) / totalW) / 1e6 : 0;
  const backFrac = split.buckets[FLOOR] * holdPct + split.buckets[AIRDROP] * weightPct;

  const boosters = useMemo(() => {
    const by = new Map<string, bigint>();
    for (const e of mech ?? []) {
      if (e.kind !== "yield_funded" || !e.account) continue;
      by.set(e.account, (by.get(e.account) ?? 0n) + BigInt(e.amount));
    }
    return [...by.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1)).slice(0, 5);
  }, [mech]);

  async function fund() {
    if (!accountId) return signIn();
    const ok = await send([
      {
        receiverId: LINEAR,
        calls: [
          { method: "deposit_and_stake", args: {}, gas: 50, deposit: near },
          { method: "ft_transfer_call", args: { receiver_id: LAUNCHPAD, amount: shares.toString(), msg: JSON.stringify({ fund_yield: t.token_id }) }, gas: 100, deposit: "1" },
        ],
      },
    ]);
    if (ok) setAmt("");
  }

  if (t.grad_stage !== "Graduated") return null;
  const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
  return (
    <div className="panel stack" style={{ gap: 8 }}>
      <h2 style={{ margin: 0 }}>
        <MojiLabel face="hero">Contribute to ${t.meta.symbol}&apos;s yield</MojiLabel>
      </h2>
      <p className="small muted" style={{ margin: 0 }}>
        Your NEAR is staked as LiNEAR and split at the next epoch by the holders&apos; vote. It is a contribution to the token: you get something back only
        through ${t.meta.symbol} you hold or lock.
      </p>

      <div className="fy-split small">
        {split.buckets.map((f, i) =>
          f > 0 ? (
            <span key={i}>
              {BUCKET_LABELS[i]} <b>{pct(f)}</b>
              {nearNum > 0 ? <span className="muted"> · {(f * nearNum).toFixed(2)} N</span> : null}
            </span>
          ) : null,
        )}
        <span className="muted">
          Platform {pct(split.platform)}
          {nearNum > 0 ? ` · ${(split.platform * nearNum).toFixed(2)} N` : ""}
        </span>
      </div>

      <div className="input-suffix">
        <input className="input" inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value)} />
        <em>NEAR</em>
      </div>

      <div className={`notice small ${accountId && backFrac === 0 ? "warn" : ""}`} style={{ margin: 0 }}>
        {!accountId ? (
          "Connect a wallet to see how much of a contribution comes back to you."
        ) : backFrac > 0 ? (
          <>
            About <b>{pct(backFrac)}</b>
            {nearNum > 0 ? ` (${(backFrac * nearNum).toFixed(3)} NEAR)` : ""} comes back to you directly: you hold {pct(holdPct)} of the supply
            {weightPct > 0 ? ` and ${pct(weightPct)} of the lock weight` : ""}. Buybacks can also lift the price of what you hold.
          </>
        ) : (
          <>You hold no ${t.meta.symbol}, so none of this comes back to you: it is a pure contribution to the community.</>
        )}
      </div>

      <button className="btn primary block" disabled={busy || near < YOCTO} onClick={fund}>
        {near < YOCTO ? "Contribute (min 1 NEAR)" : `Contribute ${amt} NEAR`}
      </button>

      {boosters.length > 0 && (
        <div className="small">
          <div className="muted" style={{ marginBottom: 4 }}>🙌 Recent top contributors</div>
          {boosters.map(([who, amount], i) => (
            <div key={who} className="row between">
              <span className="mono ellipsis" style={{ maxWidth: 200 }}>
                {i + 1}. {who}
                {who === accountId ? " (you)" : ""}
              </span>
              <span className="mono">{fmtNear((amount * linearPrice) / YOCTO, 2)} N</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
