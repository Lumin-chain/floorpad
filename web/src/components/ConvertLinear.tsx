"use client";

/**
 * Convert a liquid staking token (stNEAR or LiNEAR) to NEAR. Opened by the header chip, the
 * sell panel and the portfolio via `openConvertLinear()`.
 *
 * Routes:
 * - stNEAR: instant unstake with Meta Pool (NEAR now, small fee), or swap on Rhea.
 * - LiNEAR: swap on Rhea, or unstake on LiNEAR for full value and withdraw a few epochs later.
 */
import { useEffect, useState } from "react";
import { fmtNear, LINEAR, parseUnits, REF, view, YOCTO } from "@/lib/near";
import { linearAccount, unstakeTxs, withdrawUnstakedTxs } from "@/lib/linear-exit";
import {
  bestExitQuote,
  exitSwapTxs,
  instantUnstakeLiquidity,
  instantUnstakeQuote,
  instantUnstakeTxs,
  stakeInfo,
  stakePrice,
  STNEAR,
  type ExitQuote,
} from "@/lib/stake";
import { storageCallIfNeeded, useView, useWallet } from "@/lib/wallet";

const SLIPPAGE_BPS = 100n; // 1%
/** Without a live quote (expired rate), never accept less than this share of the staking value. */
const BLIND_MIN_BPS = 7000n;

export function ConvertLinearHost() {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const h = (e: Event) => setOpen((e as CustomEvent<{ token?: string }>).detail?.token ?? "");
    window.addEventListener("floorpad:convert-linear", h);
    return () => window.removeEventListener("floorpad:convert-linear", h);
  }, []);
  return open !== null ? <ConvertModal initial={open} onClose={() => setOpen(null)} /> : null;
}

const balOf = (token: string, account: string) => view<string>(token, "ft_balance_of", { account_id: account }).then(BigInt).catch(() => 0n);

function ConvertModal({ initial, onClose }: { initial: string; onClose: () => void }) {
  const { accountId, send, busy, signIn, reloadNearBalance } = useWallet();
  const { data: bals, reload: reloadBal } = useView(
    accountId ? async () => ({ st: await balOf(STNEAR, accountId), lin: await balOf(LINEAR, accountId) }) : null,
    [accountId, busy],
    15000,
  );
  // which token: the one asked for, else the one the wallet holds (stNEAR first)
  const [token, setToken] = useState<string>(initial || STNEAR);
  useEffect(() => {
    if (initial || !bals) return;
    setToken(bals.st === 0n && bals.lin > 0n ? LINEAR : STNEAR);
  }, [bals, initial]);
  const s = stakeInfo(token);
  const meta = s.kind === "meta";

  const [route, setRoute] = useState<"instant" | "swap" | "unstake">(meta ? "instant" : "swap");
  useEffect(() => setRoute(meta ? "instant" : "swap"), [meta]);
  const [amt, setAmt] = useState("");
  const { data: priceRaw } = useView(() => stakePrice(token), [token], 60000);
  const { data: acct, reload: reloadAcct } = useView(accountId && !meta ? () => linearAccount(accountId) : null, [accountId, busy, meta], 30000);
  const { data: liq } = useView(meta ? () => instantUnstakeLiquidity() : null, [meta, busy], 30000);
  const bal = bals ? (meta ? bals.st : bals.lin) : 0n;
  const price = priceRaw ?? YOCTO;
  const amount = parseUnits(amt, 24);
  const fair = (amount * price) / YOCTO;

  const [q, setQ] = useState<ExitQuote | null>(null);
  const [instant, setInstant] = useState<bigint | null>(null);
  useEffect(() => {
    setQ(null);
    setInstant(null);
    if (amount === 0n) return;
    const h = setTimeout(() => {
      if (route === "swap") bestExitQuote(s, amount).then(setQ).catch(() => setQ(null));
      if (route === "instant") instantUnstakeQuote(amount).then(setInstant).catch(() => setInstant(null));
    }, 300);
    return () => clearTimeout(h);
  }, [amount, route, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = q?.out && fair > 0n ? Number((q.out * 10000n) / fair) / 100 : null;
  const minOut = q?.out ? (q.out * (10000n - SLIPPAGE_BPS)) / 10000n : (fair * BLIND_MIN_BPS) / 10000n;
  const instantPct = instant && fair > 0n ? Number((instant * 10000n) / fair) / 100 : null;
  const instantTooBig = meta && liq ? fair > liq.near : false;
  const unstaking = acct ? BigInt(acct.unstaked_balance) : 0n;

  async function go() {
    if (!accountId) return signIn();
    if (amount === 0n || amount > bal) return;
    let ok = false;
    if (route === "instant") {
      if (instant === null) return;
      ok = await send(instantUnstakeTxs(amount, (instant * (10000n - SLIPPAGE_BPS)) / 10000n));
    } else if (route === "swap") {
      ok = await send([...(await storageCallIfNeeded(REF, accountId).then((r) => (r ? [r] : []))), ...exitSwapTxs(accountId, s, amount, q!, minOut)]);
    } else {
      ok = await send(unstakeTxs(amount, price));
    }
    if (ok) {
      setAmt("");
      reloadBal();
      reloadAcct();
      reloadNearBalance();
    }
  }

  const canGo =
    !busy && amount > 0n && amount <= bal && (route === "swap" ? !!q : route === "instant" ? instant !== null && !instantTooBig : true);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet convert-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Convert ${s.symbol} to NEAR`}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>Convert {s.symbol} → NEAR</h2>
          <button className="btn sm ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {bals && bals.st > 0n && bals.lin > 0n && (
          <div className="seg" style={{ marginTop: 8 }}>
            {[STNEAR, LINEAR].map((id) => (
              <button key={id} className={token === id ? "active" : ""} onClick={() => { setToken(id); setAmt(""); }}>
                {stakeInfo(id).symbol}
              </button>
            ))}
          </div>
        )}
        <p className="small muted" style={{ margin: "6px 0 10px" }}>
          {s.symbol} is staked NEAR (1 {s.symbol} ≈ {fmtNear(price, 4)} NEAR) and keeps earning yield.{" "}
          {meta ? "Meta Pool turns it into NEAR instantly." : "Pick how you want out."}
        </p>
        <div className="row between small">
          <span className="muted">Your {s.symbol}</span>
          <b>
            {fmtNear(bal, 4)} {s.symbol} <span className="muted">≈ {fmtNear((bal * price) / YOCTO, 3)} NEAR</span>
          </b>
        </div>
        <div className="input-suffix" style={{ marginTop: 8 }}>
          <input className="input" inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value)} />
          <em>{s.symbol}</em>
        </div>
        <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setAmt(fmtNear(bal, 24).replace(/,/g, ""))}>
          Max
        </button>

        <div className="convert-routes">
          {meta && (
            <button className={`convert-route ${route === "instant" ? "active" : ""}`} onClick={() => setRoute("instant")}>
              <b>Instant unstake · Meta Pool</b>
              <span className="small muted">
                {amount === 0n
                  ? `NEAR now${liq ? ` · ${(liq.feeBps / 100).toFixed(2)}% fee · ${fmtNear(liq.near, 0)} NEAR available` : ""}`
                  : instantTooBig
                    ? `More than the ${fmtNear(liq!.near, 0)} NEAR available right now`
                    : instant !== null
                      ? `≈ ${fmtNear(instant, 3)} NEAR now · ${instantPct?.toFixed(2)}% of value`
                      : "Quoting…"}
              </span>
            </button>
          )}
          <button className={`convert-route ${route === "swap" ? "active" : ""}`} onClick={() => setRoute("swap")}>
            <b>Swap now on Rhea</b>
            <span className="small muted">
              {amount === 0n
                ? "Instant, at the pool's price"
                : q?.out
                  ? `≈ ${fmtNear(q.out, 3)} NEAR · ${pct?.toFixed(1)}% of value · pool #${q.pool}`
                  : q
                    ? `Pool #${q.pool} rate is refreshed in the same transaction · at least ${fmtNear(minOut, 3)} NEAR`
                    : "Finding the best pool…"}
            </span>
          </button>
          {!meta && (
            <button className={`convert-route ${route === "unstake" ? "active" : ""}`} onClick={() => setRoute("unstake")}>
              <b>Unstake · full value</b>
              <span className="small muted">
                {amount === 0n ? "100% of value, ready in about 2–3 days" : `${fmtNear(fair, 3)} NEAR, withdraw here in about 2–3 days`}
              </span>
            </button>
          )}
        </div>
        {route === "swap" && pct !== null && pct < 90 && (
          <div className="notice warn small" style={{ marginTop: 8 }}>
            The pool pays {pct.toFixed(0)}% of {s.symbol}&apos;s value for this size.{" "}
            {meta ? "Instant unstake usually pays more." : "Unstaking pays 100%, just slower."}
          </div>
        )}
        <button className="btn primary block" style={{ marginTop: 10 }} disabled={!canGo} onClick={go}>
          {busy
            ? "Waiting for wallet…"
            : amount > bal
              ? `Not enough ${s.symbol}`
              : route === "instant"
                ? "Unstake to NEAR now"
                : route === "swap"
                  ? "Swap to NEAR"
                  : "Unstake"}
        </button>

        {!meta && unstaking > 0n && (
          <div className="panel tight small" style={{ marginTop: 12 }}>
            <div className="row between">
              <span>
                Unstaked: <b>{fmtNear(unstaking, 4)} NEAR</b>
              </span>
              <button className="btn sm primary" disabled={busy || !acct?.can_withdraw} onClick={() => send(withdrawUnstakedTxs())}>
                {acct?.can_withdraw ? "Withdraw" : "Not ready yet"}
              </button>
            </div>
            {!acct?.can_withdraw && (
              <div className="muted" style={{ marginTop: 4 }}>
                Available from epoch {acct?.unstaked_available_epoch_height} (NEAR epochs last about half a day on testnet).
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Header chip: shows the wallet's staking tokens and opens the converter. */
export function LinearChip() {
  const { accountId } = useWallet();
  const { data } = useView(
    accountId ? async () => ({ st: await balOf(STNEAR, accountId), lin: await balOf(LINEAR, accountId) }) : null,
    [accountId],
    30000,
  );
  if (!accountId || !data) return null;
  const items = [
    { id: STNEAR, bal: data.st },
    { id: LINEAR, bal: data.lin },
  ].filter((x) => x.bal >= 10n ** 21n); // hide dust (< 0.001)
  if (items.length === 0) return null;
  return (
    <>
      {items.map((x) => (
        <button
          key={x.id}
          className="badge sky mono linear-chip"
          onClick={() => window.dispatchEvent(new CustomEvent("floorpad:convert-linear", { detail: { token: x.id } }))}
          title={`Convert your ${stakeInfo(x.id).symbol} to NEAR`}
        >
          {fmtNear(x.bal, 2)} {stakeInfo(x.id).symbol} ⇄
        </button>
      ))}
    </>
  );
}
