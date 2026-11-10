"use client";

import { useEffect, useState } from "react";
import {
  fmtNear,
  fmtTok,
  LAUNCHPAD,
  LINEAR,
  lp,
  parseUnits,
  REF,
  view,
  YOCTO,
  type LaunchConfig,
  type Quote,
} from "@/lib/near";
import { storageCallIfNeeded, useView, useWallet, type Tx } from "@/lib/wallet";
import { Kv } from "./ui";
import type { TokenCtx } from "@/app/token/[id]/page";

const SLIPPAGE_BPS = 100n; // 1%

interface RefPool {
  token_account_ids: string[];
  amounts: string[];
  total_fee: number;
}

function refOut(amountIn: bigint, rIn: bigint, rOut: bigint, feeBps: number) {
  const inFee = amountIn * BigInt(10000 - feeBps);
  return (inFee * rOut) / (rIn * 10000n + inFee);
}

type TradeProps = TokenCtx & { initialSide?: "buy" | "sell"; onDone?: () => void };

export function TradePanel(props: TradeProps) {
  return props.t.grad_stage === "Graduated" ? <RefTrade {...props} /> : <CurveTrade {...props} />;
}

function useAge(holdingSince: number | null) {
  return holdingSince ? Math.max(0, Math.floor(Date.now() / 1000) - holdingSince) : 0;
}

function CurveTrade({ t, balance, holdingSince, reload, initialSide, onDone }: TradeProps) {
  const { send, busy, accountId } = useWallet();
  const [side, setSide] = useState<"buy" | "sell">(initialSide ?? "buy");
  const [amt, setAmt] = useState("");
  const [q, setQ] = useState<Quote | null>(null);
  const { data: cfg } = useView(() => lp<LaunchConfig>("get_config"), [], 0);
  const age = useAge(holdingSince);
  const closed = t.grad_stage !== "Curve";

  const base = side === "buy" ? parseUnits(amt, 24) : parseUnits(amt, 18);
  useEffect(() => {
    if (base === 0n) return setQ(null);
    const h = setTimeout(async () => {
      const r =
        side === "buy"
          ? await lp<Quote>("quote_buy", { token_id: t.token_id, near_in: base.toString(), account_id: accountId })
          : await lp<Quote>("quote_sell", { token_id: t.token_id, tokens_in: base.toString(), age_secs: age });
      setQ(r);
    }, 250);
    return () => clearTimeout(h);
  }, [base, side, t.token_id, t.sold, accountId, age]);

  async function submit() {
    if (!q) return;
    const min = (BigInt(q.amount_out) * (10000n - SLIPPAGE_BPS)) / 10000n;
    const tx: Tx =
      side === "buy"
        ? { receiverId: LAUNCHPAD, calls: [{ method: "buy", args: { token_id: t.token_id, min_tokens_out: min.toString() }, gas: 100, deposit: base }] }
        : {
            receiverId: t.token_id,
            calls: [{
              method: "ft_transfer_call",
              args: { receiver_id: LAUNCHPAD, amount: base.toString(), msg: JSON.stringify({ action: "sell", min_near_out: min.toString() }) },
              gas: 150,
              deposit: "1",
            }],
          };
    if (await send([tx])) {
      setAmt("");
      reload();
      onDone?.();
    }
  }

  const inSnipe = Date.now() / 1000 < t.snipe_window_ends;
  const exitPct = cfg ? Math.max(0, (cfg.max_exit_fee_bps * Math.max(0, cfg.exit_decay_secs - age)) / cfg.exit_decay_secs / 100) : 0;

  return (
    <div className="panel stack">
      <div className="row between">
        <div className="seg">
          <button className={side === "buy" ? "active buy" : ""} onClick={() => { setSide("buy"); setAmt(""); }}>Buy</button>
          <button className={side === "sell" ? "active sell" : ""} onClick={() => { setSide("sell"); setAmt(""); }}>Sell</button>
        </div>
        <span className="small muted">Balance {fmtTok(balance.toString())}</span>
      </div>
      {closed && <div className="notice warn">The curve sold out. Graduation to Ref is in progress.</div>}
      <div className="input-suffix">
        <input className="input" inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value)} />
        <em>{side === "buy" ? "NEAR" : `$${t.meta.symbol}`}</em>
      </div>
      {side === "buy" && (
        <div className="row">
          {["1", "5", "10", "25"].map((v) => (
            <button key={v} className="btn sm ghost" onClick={() => setAmt(v)}>{v} N</button>
          ))}
        </div>
      )}
      {side === "sell" && (
        <div className="row">
          {[25, 50, 100].map((p) => (
            <button key={p} className="btn sm ghost" onClick={() => setAmt(fmtTok(((balance * BigInt(p)) / 100n).toString(), 18).replace(/,/g, ""))}>
              {p}%
            </button>
          ))}
        </div>
      )}
      {q && (
        <div>
          <Kv k="You receive" v={side === "buy" ? `${fmtTok(q.amount_out)} $${t.meta.symbol}` : `${fmtNear(q.amount_out)} NEAR`} />
          <Kv k={`${side === "buy" ? "Buy" : "Sell"} fee (${((side === "buy" ? cfg?.buy_fee_bps ?? 100 : cfg?.sell_fee_bps ?? 200) / 100).toFixed(1)}%, half to the floor)`} v={`${fmtNear(q.fee)} N`} />
          {side === "sell" && <Kv k={`Exit fee (${exitPct.toFixed(1)}%, to the floor)`} v={`${fmtNear(q.exit_fee)} N`} />}
          {BigInt(q.refund) > 0n && <Kv k="Refund (curve sells out)" v={`${fmtNear(q.refund)} N`} />}
        </div>
      )}
      {side === "buy" && inSnipe && cfg && (
        <div className="notice">Fair-launch window: max {fmtTok(cfg.snipe_max_tokens, 0)} tokens per wallet for the first minutes.</div>
      )}
      {side === "sell" && holdingSince !== null && (
        <div className="notice small">
          Held for {Math.floor(age / 86400)}d {Math.floor((age % 86400) / 3600)}h. The exit fee falls to 0 after{" "}
          {cfg ? Math.round(cfg.exit_decay_secs / 86400) : 30} days. Locking tokens doesn&apos;t reset your age.
        </div>
      )}
      <button className={`btn block ${side === "buy" ? "primary" : "danger"}`} disabled={busy || !q || closed || BigInt(q?.amount_out ?? 0) === 0n} onClick={submit}>
        {side === "buy" ? "Buy" : "Sell"} ${t.meta.symbol}
      </button>
    </div>
  );
}

/** After graduation: swap through the locked Ref MEME/LiNEAR pool, all in-app. */
function RefTrade({ t, balance, linearPrice, reload, initialSide, onDone }: TradeProps) {
  const { send, busy, accountId } = useWallet();
  const [side, setSide] = useState<"buy" | "sell">(initialSide ?? "buy");
  const [amt, setAmt] = useState("");
  const { data: pool } = useView(() => view<RefPool>(REF, "get_pool", { pool_id: t.pool_id }), [t.pool_id], 8000);
  const { data: linBal } = useView(
    accountId ? () => view<string>(LINEAR, "ft_balance_of", { account_id: accountId }) : null,
    [accountId],
    10000,
  );

  const iMeme = pool ? pool.token_account_ids.indexOf(t.token_id) : 0;
  const rMeme = pool ? BigInt(pool.amounts[iMeme]) : 0n;
  const rLin = pool ? BigInt(pool.amounts[1 - iMeme]) : 0n;
  const fee = pool?.total_fee ?? 30;

  const base = side === "buy" ? parseUnits(amt, 24) : parseUnits(amt, 18);
  // NEAR -> LiNEAR shares (conservative), then LiNEAR -> MEME
  const shares = side === "buy" ? ((base * YOCTO) / linearPrice) * 999_999n / 1_000_000n : 0n;
  const out = !pool || base === 0n ? 0n : side === "buy" ? refOut(shares, rLin, rMeme, fee) : refOut(base, rMeme, rLin, fee);
  const min = (out * (10000n - SLIPPAGE_BPS)) / 10000n;
  const spot = rMeme > 0n ? Number((rLin * linearPrice * 10n ** 12n) / rMeme / YOCTO) / 1e18 / 1e6 : 0;

  async function submit() {
    if (!accountId || out === 0n) return;
    const txs: Tx[] = [];
    if (side === "buy") {
      txs.push({ receiverId: LINEAR, calls: [{ method: "deposit_and_stake", args: {}, gas: 50, deposit: base }] });
      const reg = await storageCallIfNeeded(t.token_id, accountId);
      if (reg) txs.push(reg);
      const msg = JSON.stringify({ actions: [{ pool_id: t.pool_id, token_in: LINEAR, token_out: t.token_id, amount_in: shares.toString(), min_amount_out: min.toString() }] });
      txs.push({ receiverId: LINEAR, calls: [{ method: "ft_transfer_call", args: { receiver_id: REF, amount: shares.toString(), msg }, gas: 180, deposit: "1" }] });
    } else {
      const reg = await storageCallIfNeeded(LINEAR, accountId);
      if (reg) txs.push(reg);
      const msg = JSON.stringify({ actions: [{ pool_id: t.pool_id, token_in: t.token_id, token_out: LINEAR, amount_in: base.toString(), min_amount_out: min.toString() }] });
      txs.push({ receiverId: t.token_id, calls: [{ method: "ft_transfer_call", args: { receiver_id: REF, amount: base.toString(), msg }, gas: 180, deposit: "1" }] });
    }
    if (await send(txs)) {
      setAmt("");
      reload();
      onDone?.();
    }
  }

  return (
    <div className="panel stack">
      <div className="row between">
        <div className="seg">
          <button className={side === "buy" ? "active buy" : ""} onClick={() => { setSide("buy"); setAmt(""); }}>Buy</button>
          <button className={side === "sell" ? "active sell" : ""} onClick={() => { setSide("sell"); setAmt(""); }}>Sell</button>
        </div>
        <span className="small muted">
          {side === "buy" ? `LiNEAR ${fmtNear(linBal ?? "0", 3)}` : `Balance ${fmtTok(balance.toString())}`}
        </span>
      </div>
      <div className="small muted">
        Ref pool #{t.pool_id}: {fmtTok(rMeme.toString(), 0)} ${t.meta.symbol} / {fmtNear(rLin.toString(), 2)} LiNEAR. LP is locked
        forever and earns staking yield. Spot ≈ {spot.toExponential(3)} N.
      </div>
      <div className="input-suffix">
        <input className="input" inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value)} />
        <em>{side === "buy" ? "NEAR" : `$${t.meta.symbol}`}</em>
      </div>
      <Kv k="You receive (est.)" v={side === "buy" ? `${fmtTok(out.toString())} $${t.meta.symbol}` : `${fmtNear(out.toString())} LiNEAR`} />
      <Kv k="Route" v={side === "buy" ? "NEAR → LiNEAR (stake) → Ref swap" : "Ref swap → LiNEAR"} />
      <Kv k="Slippage limit" v="1%" />
      {side === "sell" && (
        <div className="notice small">
          Selling on Ref has no exit fee, but it moves price. Redeeming at the floor (Floor tab) is the
          zero-slippage exit; its exit fee goes to remaining holders.
        </div>
      )}
      <button className={`btn block ${side === "buy" ? "primary" : "danger"}`} disabled={busy || out === 0n} onClick={submit}>
        {side === "buy" ? "Buy" : "Sell"} ${t.meta.symbol}
      </button>
    </div>
  );
}
