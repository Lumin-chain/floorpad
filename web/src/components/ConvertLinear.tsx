"use client";

/**
 * Convert LiNEAR to NEAR (testnet phase helper). Opened by the header chip, the sell panel and
 * the portfolio via `openConvertLinear()`. Two routes: swap now on Rhea's best pool, or unstake
 * on LiNEAR for full value and withdraw a few epochs later.
 */
import { useEffect, useState } from "react";
import { fmtNear, LINEAR, parseUnits, REF, view, YOCTO } from "@/lib/near";
import {
  bestLinearQuote,
  linearAccount,
  linearSwapTxs,
  unstakeTxs,
  withdrawUnstakedTxs,
  type LinearQuote,
} from "@/lib/linear-exit";
import { storageCallIfNeeded, useView, useWallet } from "@/lib/wallet";

const SLIPPAGE_BPS = 100n; // 1%
/** Without a live quote (expired rate), never accept less than this share of the staking value. */
const BLIND_MIN_BPS = 7000n;

export function ConvertLinearHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("floorpad:convert-linear", h);
    return () => window.removeEventListener("floorpad:convert-linear", h);
  }, []);
  return open ? <ConvertLinearModal onClose={() => setOpen(false)} /> : null;
}

function ConvertLinearModal({ onClose }: { onClose: () => void }) {
  const { accountId, send, busy, signIn, reloadNearBalance } = useWallet();
  const [route, setRoute] = useState<"swap" | "unstake">("swap");
  const [amt, setAmt] = useState("");
  const { data: balStr, reload: reloadBal } = useView(
    accountId ? () => view<string>(LINEAR, "ft_balance_of", { account_id: accountId }) : null,
    [accountId, busy],
    15000,
  );
  const { data: priceStr } = useView(() => view<string>(LINEAR, "ft_price"), [], 60000);
  const { data: acct, reload: reloadAcct } = useView(accountId ? () => linearAccount(accountId) : null, [accountId, busy], 30000);
  const bal = BigInt(balStr ?? "0");
  const price = BigInt(priceStr ?? YOCTO.toString());
  const amount = parseUnits(amt, 24);
  const fair = (amount * price) / YOCTO;

  const [q, setQ] = useState<LinearQuote | null>(null);
  useEffect(() => {
    setQ(null);
    if (amount === 0n || route !== "swap") return;
    const h = setTimeout(() => bestLinearQuote(amount).then(setQ).catch(() => setQ(null)), 300);
    return () => clearTimeout(h);
  }, [amount, route]);

  const pct = q?.out && fair > 0n ? Number((q.out * 10000n) / fair) / 100 : null;
  const minOut = q?.out ? (q.out * (10000n - SLIPPAGE_BPS)) / 10000n : (fair * BLIND_MIN_BPS) / 10000n;
  const unstaking = acct ? BigInt(acct.unstaked_balance) : 0n;

  async function go() {
    if (!accountId) return signIn();
    if (amount === 0n || amount > bal) return;
    const ok =
      route === "swap"
        ? await send([...(await storageCallIfNeeded(REF, accountId).then((r) => (r ? [r] : []))), ...linearSwapTxs(accountId, amount, q!, minOut)])
        : await send(unstakeTxs(amount, price));
    if (ok) {
      setAmt("");
      reloadBal();
      reloadAcct();
      reloadNearBalance();
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet convert-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Convert LiNEAR to NEAR">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Convert LiNEAR → NEAR</h2>
          <button className="btn sm ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="small muted" style={{ margin: "6px 0 10px" }}>
          LiNEAR is staked NEAR (1 LiNEAR ≈ {fmtNear(price, 4)} NEAR) and keeps earning yield. Testnet pools are shallow, so pick how you want out.
        </p>
        <div className="row between small">
          <span className="muted">Your LiNEAR</span>
          <b>
            {fmtNear(bal, 4)} LiNEAR <span className="muted">≈ {fmtNear((bal * price) / YOCTO, 3)} NEAR</span>
          </b>
        </div>
        <div className="input-suffix" style={{ marginTop: 8 }}>
          <input className="input" inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value)} />
          <em>LiNEAR</em>
        </div>
        <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setAmt(fmtNear(bal, 24).replace(/,/g, ""))}>
          Max
        </button>

        <div className="convert-routes">
          <button className={`convert-route ${route === "swap" ? "active" : ""}`} onClick={() => setRoute("swap")}>
            <b>Swap now on Rhea</b>
            <span className="small muted">
              {amount === 0n
                ? "Instant, at the pool's price"
                : q?.out
                  ? `≈ ${fmtNear(q.out, 3)} NEAR · ${pct?.toFixed(0)}% of value · pool #${q.pool}`
                  : q
                    ? `Pool #${q.pool} rate is refreshed in the same transaction · at least ${fmtNear(minOut, 3)} NEAR`
                    : "Finding the best pool…"}
            </span>
          </button>
          <button className={`convert-route ${route === "unstake" ? "active" : ""}`} onClick={() => setRoute("unstake")}>
            <b>Unstake · full value</b>
            <span className="small muted">
              {amount === 0n ? "100% of value, ready in about 2–3 days" : `${fmtNear(fair, 3)} NEAR, withdraw here in about 2–3 days`}
            </span>
          </button>
        </div>
        {route === "swap" && pct !== null && pct < 90 && (
          <div className="notice warn small" style={{ marginTop: 8 }}>
            The pool pays {pct.toFixed(0)}% of LiNEAR&apos;s value for this size. Unstaking pays 100%, just slower.
          </div>
        )}
        <button className="btn primary block" style={{ marginTop: 10 }} disabled={busy || amount === 0n || amount > bal || (route === "swap" && !q)} onClick={go}>
          {busy ? "Waiting for wallet…" : amount > bal ? "Not enough LiNEAR" : route === "swap" ? "Swap to NEAR" : "Unstake"}
        </button>

        {unstaking > 0n && (
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

/** Header chip: shows the wallet's LiNEAR and opens the converter. */
export function LinearChip() {
  const { accountId } = useWallet();
  const { data } = useView(accountId ? () => view<string>(LINEAR, "ft_balance_of", { account_id: accountId }) : null, [accountId], 30000);
  const bal = BigInt(data ?? "0");
  if (!accountId || bal < 10n ** 21n) return null; // hide dust (< 0.001)
  return (
    <button
      className="badge sky mono linear-chip"
      onClick={() => window.dispatchEvent(new CustomEvent("floorpad:convert-linear"))}
      title="Convert your LiNEAR to NEAR"
    >
      {fmtNear(bal, 2)} LiNEAR ⇄
    </button>
  );
}
