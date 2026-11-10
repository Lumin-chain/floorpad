"use client";

import { useEffect, useState } from "react";
import { api, fmtX, useStream, type Caller, type Callout } from "@/lib/social";
import { CallRow } from "@/components/Callouts";

export default function CallsPage() {
  const [tab, setTab] = useState<"feed" | "leaders">("feed");
  const [calls, setCalls] = useState<Callout[] | null>(null);
  const [leaders, setLeaders] = useState<Caller[] | null>(null);
  const [days, setDays] = useState(30);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Callout[]>("/calls?limit=100").then(setCalls).catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(() => {
    api<Caller[]>(`/callers/leaderboard?days=${days}`).then(setLeaders).catch(() => setLeaders([]));
  }, [days]);
  useStream("global", { call: (c) => setCalls((xs) => [c as Callout, ...(xs ?? [])]) });

  return (
    <div className="section">
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        <h1>Callouts</h1>
        <div className="seg">
          <button className={tab === "feed" ? "active" : ""} onClick={() => setTab("feed")}>Live feed</button>
          <button className={tab === "leaders" ? "active" : ""} onClick={() => setTab("leaders")}>Top callers</button>
        </div>
      </div>
      <p className="muted small" style={{ maxWidth: 680 }}>
        A callout is a public, timestamped call on a token. It records the market cap at the moment of the call and tracks
        the result. Make one from any token page.
      </p>
      {err && <div className="notice warn">Callouts unavailable: {err}</div>}

      {tab === "feed" && (
        <div className="grid cards" style={{ marginTop: 12 }}>
          {calls?.map((c) => <CallRow key={c.id} c={c} showToken />)}
          {calls?.length === 0 && <div className="empty">No callouts yet.</div>}
        </div>
      )}

      {tab === "leaders" && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="row between">
            <h2>Top callers</h2>
            <select className="select" style={{ width: 120 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
          <div className="table-scroll">
            <table className="t">
              <thead>
                <tr><th>#</th><th>Caller</th><th>Calls</th><th>Avg peak</th><th>Best</th><th>2x hits</th></tr>
              </thead>
              <tbody>
                {leaders?.map((l, i) => (
                  <tr key={l.account}>
                    <td>{i + 1}</td>
                    <td className="mono small">{l.account}</td>
                    <td>{l.calls}</td>
                    <td className="green">{fmtX(l.avg_peak_x)}</td>
                    <td>{fmtX(l.best_x)}</td>
                    <td>{l.hits_2x}</td>
                  </tr>
                ))}
                {leaders?.length === 0 && <tr><td colSpan={6} className="muted">No callers yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
