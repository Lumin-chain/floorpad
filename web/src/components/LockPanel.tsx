"use client";

import { useEffect, useState } from "react";
import { BUCKET_LABELS, fmtNear, fmtTok, LAUNCHPAD, lp, parseUnits, until, type LaunchConfig, type Position } from "@/lib/near";
import { useView, useWallet } from "@/lib/wallet";
import { AllocBar, BUCKET_COLORS, Kv, Stat } from "./ui";
import type { TokenCtx } from "@/app/token/[id]/page";


function multBps(days: number, min: number, max: number) {
  const d = Math.min(max, Math.max(min, days));
  return max === min ? 10000 : 10000 + Math.floor((30000 * (d - min)) / (max - min));
}

export function LockPanel({ t, balance, reload }: TokenCtx) {
  const { send, busy, accountId } = useWallet();
  const { data: cfg } = useView(() => lp<LaunchConfig>("get_config"), [], 0);
  const { data: pos, reload: reloadPos } = useView(
    accountId ? () => lp<Position | null>("get_position", { token_id: t.token_id, account_id: accountId }) : null,
    [accountId, t.token_id],
    8000,
  );
  const min = cfg?.lock_min_days ?? 7;
  const max = cfg?.lock_max_days ?? 180;
  const [amt, setAmt] = useState("");
  const [days, setDays] = useState(90);
  const [alloc, setAlloc] = useState<number[]>([40, 20, 20, 10, 10]);

  useEffect(() => {
    if (pos?.alloc) setAlloc(pos.alloc.map((v) => v / 100));
  }, [pos?.alloc?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = parseUnits(amt, 18);
  const weightPreview = (base * BigInt(multBps(days, min, max))) / 10000n;
  const now = Date.now() / 1000;
  const locked = pos && BigInt(pos.amount) > 0n;
  const share = locked && BigInt(t.total_weight) > 0n ? Number((BigInt(pos!.weight) * 10000n) / BigInt(t.total_weight)) / 100 : 0;
  const allocSum = alloc.reduce((a, b) => a + b, 0);
  const needsSync = locked && t.dao_stage === "Ready" && pos!.delegated !== pos!.weight && !pos!.sync_busy;

  const done = () => {
    reload();
    reloadPos();
  };

  async function lock() {
    const ok = await send([{
      receiverId: t.token_id,
      calls: [{ method: "ft_transfer_call", args: { receiver_id: LAUNCHPAD, amount: base.toString(), msg: JSON.stringify({ action: "lock", days }) }, gas: 150, deposit: "1" }],
    }]);
    if (ok) {
      setAmt("");
      done();
    }
  }
  const call = async (method: string, args: object, gas = 100) => {
    if (await send([{ receiverId: LAUNCHPAD, calls: [{ method, args: { token_id: t.token_id, ...args }, gas }] }])) done();
  };
  function saveAlloc() {
    // normalise to exactly 10000 bps
    const bps = alloc.map((v) => Math.floor((v / allocSum) * 10000));
    bps[0] += 10000 - bps.reduce((a, b) => a + b, 0);
    call("set_allocation", { alloc: bps }, 30);
  }

  return (
    <div className="grid two">
      <div className="stack">
        <div className="grid stats">
          <Stat k="Total locked" v={fmtTok(t.total_locked, 0)} s={`${t.stakers} lockers`} />
          <Stat k="Total weight" v={fmtTok(t.total_weight, 0)} s="1× at 7d → 4× at 180d" />
          <Stat k="Next epoch" v={t.grad_stage === "Graduated" ? until(t.next_epoch_at) : "after graduation"} s={`epoch #${t.epoch_index}`} />
        </div>

        <div className="panel">
          <h2>Yield vote <span className="badge green">live tally</span></h2>
          <p className="muted small">
            Each epoch the vault&apos;s staking yield (never the principal) is split by lock-weighted vote.
            Your preference stays in place until you change it, so you don&apos;t need to vote every epoch.
          </p>
          <AllocBar values={t.alloc_tally} />
        </div>

        <div className="panel">
          <h2>Your allocation</h2>
          {BUCKET_LABELS.map((l, i) => (
            <div key={l} style={{ marginBottom: 8 }}>
              <div className="row between small">
                <span><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: BUCKET_COLORS[i], marginRight: 6 }} />{l}</span>
                <span className="mono">{allocSum ? ((alloc[i] / allocSum) * 100).toFixed(0) : 0}%</span>
              </div>
              <input type="range" min={0} max={100} value={alloc[i]} onChange={(e) => setAlloc(alloc.map((v, j) => (j === i ? Number(e.target.value) : v)))} />
            </div>
          ))}
          <div className="small muted" style={{ marginBottom: 10 }}>
            Floor = compound into backing · Buyback = swap on Ref and burn · Airdrop = LiNEAR to lockers by weight ·
            AI agent = inference budget · Treasury = DAO spends it via proposals.
          </div>
          <button className="btn block" disabled={busy || !allocSum || !accountId} onClick={saveAlloc}>
            {locked ? "Save allocation vote" : "Save preference (counts once you lock)"}
          </button>
        </div>
      </div>

      <div className="stack">
        <div className="panel stack">
          <div className="row between">
            <h2>Lock ${t.meta.symbol}</h2>
            <span className="small muted">Balance {fmtTok(balance.toString())}</span>
          </div>
          <div className="input-suffix">
            <input className="input" inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value)} />
            <em>${t.meta.symbol}</em>
          </div>
          <button className="btn sm ghost" onClick={() => setAmt(fmtTok(balance.toString(), 18).replace(/,/g, ""))}>Max</button>
          <div>
            <div className="row between small"><span className="muted">Duration</span><span>{days} days · {(multBps(days, min, max) / 10000).toFixed(2)}×</span></div>
            <input type="range" min={min} max={max} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </div>
          <Kv k="Voting weight" v={fmtTok(weightPreview.toString(), 0)} />
          <button className="btn primary block" disabled={busy || base === 0n} onClick={lock}>Lock</button>
          <div className="small muted">Your lock weight is your vote in the DAO and your share of airdrops.</div>
        </div>

        <div className="panel">
          <h2>Your position</h2>
          {!accountId && <div className="muted">Connect a wallet to see your lock.</div>}
          {accountId && !locked && <div className="muted">No active lock.</div>}
          {locked && pos && (
            <>
              <Kv k="Locked" v={fmtTok(pos.amount)} />
              <Kv k="Unlocks" v={pos.unlock_at <= now ? <span className="green">now</span> : `${new Date(pos.unlock_at * 1000).toLocaleDateString()} (${until(pos.unlock_at)})`} />
              <Kv k="Weight" v={`${fmtTok(pos.weight, 0)} (${share.toFixed(2)}%)`} />
              <Kv k="DAO vote weight" v={t.dao_stage === "Ready" ? fmtTok(pos.delegated, 0) : "DAO activating"} />
              <Kv k="Airdrop rewards" v={`${fmtNear(pos.pending_reward)} LiNEAR`} />
              <div className="row wrap" style={{ marginTop: 10 }}>
                {needsSync && <button className="btn sm" disabled={busy} onClick={() => call("sync_delegation", { account_id: accountId }, 100)}>Sync DAO weight</button>}
                <button className="btn sm" disabled={busy || pos.pending_reward === "0"} onClick={() => call("claim_rewards", {}, 30)}>Claim rewards</button>
                <button className="btn sm" disabled={busy} onClick={() => call("extend_lock", { days: max }, 100)}>Extend to {max}d</button>
                <button className="btn sm danger" disabled={busy || pos.unlock_at > now} onClick={() => call("unlock", {}, 100)}>Unlock</button>
              </div>
            </>
          )}
        </div>
        <div className="notice small">Lock period is {min}–{max} days. Re-locking keeps the later unlock date. Claimed rewards go to your claimable LiNEAR (Floor tab).</div>
        {cfg && <div className="small muted">Epoch length {Math.round(cfg.epoch_secs / 3600)}h.</div>}
      </div>
    </div>
  );
}

