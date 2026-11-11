"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ago, type TokenView } from "@/lib/near";
import { api, fmtUsd, fmtX, useStream, type Callout } from "@/lib/social";
import { useWallet } from "@/lib/wallet";
import { Moji } from "./Brand";

export function CallRow({ c, showToken }: { c: Callout; showToken?: boolean }) {
  const up = c.x_now >= 1;
  return (
    <div className="call">
      <div className="row between">
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          {showToken && (
            <Link href={`/token/${c.token_id}`} className="row" style={{ gap: 6 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.icon ? <img src={c.icon} alt="" className="avatar xs" /> : <span className="avatar xs">{(c.symbol ?? "?").slice(0, 2)}</span>}
              <b>${c.symbol}</b>
            </Link>
          )}
          <span className="mono small ellipsis">{c.account}</span>
        </div>
        <span className={`x ${up ? "green" : "bad"}`}>{fmtX(c.x_now)}</span>
      </div>
      <div className="call-thesis">“{c.thesis}”</div>
      <div className="row between small muted wrap">
        <span>called at {fmtUsd(c.mcap_usd)} → now {fmtUsd(c.last_mcap_usd)}</span>
        <span>peak {fmtX(c.x_peak)} · {ago(c.ts)}</span>
      </div>
    </div>
  );
}

/** Callouts for one token: public, timestamped calls whose performance is tracked. */
export function TokenCallouts({ t, usdMcap }: { t: TokenView; usdMcap: number }) {
  const { accountId, chat, chatSignIn, signIn } = useWallet();
  const [calls, setCalls] = useState<Callout[] | null>(null);
  const [thesis, setThesis] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Callout[]>(`/tokens/${t.token_id}/calls`).then(setCalls).catch(() => setCalls([]));
  }, [t.token_id]);
  useStream(`token:${t.token_id}`, { call: (c) => setCalls((xs) => [c as Callout, ...(xs ?? [])]) });

  async function call() {
    setBusy(true);
    setErr(null);
    try {
      const c = await api<Callout>(`/tokens/${t.token_id}/calls`, { method: "POST", session: chat, body: JSON.stringify({ thesis }) });
      setCalls((xs) => (xs?.some((x) => x.id === c.id) ? xs : [c, ...(xs ?? [])]));
      setThesis("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="panel">
        <h2>Call ${t.meta.symbol}</h2>
        <p className="small muted">
          Your call is stamped with the market cap right now ({fmtUsd(usdMcap)}) and its performance is tracked publicly.
          Good callers rise on the leaderboard. One call per token per day.
        </p>
        {!accountId ? (
          <button className="btn block" onClick={signIn}>Connect wallet</button>
        ) : !chat ? (
          <button className="btn block" onClick={chatSignIn}>Sign in (free, no gas)</button>
        ) : (
          <>
            <textarea className="textarea" maxLength={280} placeholder="Why will this run? (280 chars)" value={thesis} onChange={(e) => setThesis(e.target.value)} />
            {err && <div className="small bad" style={{ margin: "6px 0" }}>{err}</div>}
            <button className="btn primary block" style={{ marginTop: 8 }} disabled={busy || thesis.trim().length < 4} onClick={call}>
              <Moji face="cool" size={22} /> Call it at {fmtUsd(usdMcap)}
            </button>
          </>
        )}
      </div>
      <div>
        {calls === null && <div className="empty small">Loading calls…</div>}
        {calls?.length === 0 && <div className="empty small">No callouts yet. Be the first caller.</div>}
        {calls?.map((c) => <CallRow key={c.id} c={c} />)}
      </div>
    </div>
  );
}
