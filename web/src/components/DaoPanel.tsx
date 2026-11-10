"use client";

import { useState } from "react";
import { ago, fmtNear, fmtTok, LAUNCHPAD, LINEAR, parseUnits, view } from "@/lib/near";
import { useView, useWallet } from "@/lib/wallet";
import { Kv, Stat } from "./ui";
import type { TokenCtx } from "@/app/token/[id]/page";

// ---- Sputnik DAO v2 shapes (subset) ----
type Kind = Record<string, unknown> | "Vote";
interface Proposal {
  id: number;
  proposer: string;
  description: string;
  kind: Kind;
  status: "InProgress" | "Approved" | "Rejected" | "Removed" | "Expired" | "Moved" | "Failed";
  vote_counts: Record<string, [string, string, string]>;
  votes: Record<string, "Approve" | "Reject" | "Remove">;
  submission_time: string;
}
interface Policy {
  proposal_bond: string;
  proposal_period: string;
  default_vote_policy: { quorum: string; threshold: [number, number] | string };
  roles: { name: string; vote_policy: Record<string, { threshold: [number, number] | string; quorum: string }> }[];
}

const b64json = (o: object) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const decodeArgs = (s: string) => {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(s))));
  } catch {
    return s;
  }
};

function kindName(k: Kind): string {
  return typeof k === "string" ? k : Object.keys(k)[0];
}

function describeKind(k: Kind, symbol: string): string {
  if (k === "Vote") return "Signal vote";
  const [name, body] = Object.entries(k)[0] as [string, Record<string, unknown>];
  switch (name) {
    case "Transfer": {
      const token = body.token_id === "" ? "NEAR" : body.token_id === LINEAR ? "LiNEAR" : String(body.token_id);
      return `Transfer ${fmtNear(String(body.amount))} ${token} → ${body.receiver_id}`;
    }
    case "FunctionCall": {
      const actions = body.actions as { method_name: string; args: string }[];
      const a = actions[0];
      if (body.receiver_id === LAUNCHPAD && a?.method_name === "dao_release_creator")
        return `Release ${fmtNear(decodeArgs(a.args).amount)} NEAR creator escrow`;
      if (body.receiver_id === LAUNCHPAD && a?.method_name === "dao_clawback_creator") return "Claw back creator escrow to treasury";
      if (body.receiver_id === LAUNCHPAD && a?.method_name === "dao_set_agent") return `Update $${symbol} AI agent`;
      return `Call ${body.receiver_id}.${actions.map((x) => x.method_name).join(", ")}`;
    }
    case "AddBounty": {
      const b = body.bounty as { description: string; amount: string };
      return `Bounty ${fmtNear(b.amount)} NEAR: ${b.description}`;
    }
    case "ChangePolicy":
      return "Change DAO policy";
    case "SetStakingContract":
      return `Set vote token contract → ${body.staking_id}`;
    default:
      return name;
  }
}

const STATUS_BADGE: Record<string, string> = { InProgress: "sky", Approved: "green", Rejected: "bad", Removed: "bad", Expired: "", Failed: "bad" };

export function DaoPanel({ t }: TokenCtx) {
  const { accountId, send, busy } = useWallet();
  const dao = t.dao_id;
  const ready = t.dao_stage === "Ready";
  const { data: last, reload: r1 } = useView(ready ? () => view<number>(dao, "get_last_proposal_id") : null, [dao, ready], 8000);
  const { data: proposals, reload: r2 } = useView(
    ready && last !== undefined ? () => view<Proposal[]>(dao, "get_proposals", { from_index: Math.max(0, last - 30), limit: 30 }) : null,
    [dao, last],
    8000,
  );
  const { data: policy } = useView(ready ? () => view<Policy>(dao, "get_policy") : null, [dao, ready], 0);
  const { data: total } = useView(ready ? () => view<string>(dao, "delegation_total_supply") : null, [dao, ready], 10000);
  const { data: mine } = useView(
    ready && accountId ? () => view<string>(dao, "delegation_balance_of", { account_id: accountId }) : null,
    [dao, ready, accountId],
    10000,
  );

  if (!ready) {
    return (
      <div className="notice">
        The DAO <span className="mono">{dao}</span> is {t.dao_stage.toLowerCase()}. Once it&apos;s activated, lock weight becomes
        Sputnik vote weight and every proposal is created, voted on and executed from this tab.
      </div>
    );
  }

  const reload = () => {
    r1();
    r2();
  };
  const totalW = BigInt(total ?? "0");
  const mineW = BigInt(mine ?? "0");
  const list = [...(proposals ?? [])].reverse().filter((p) => p.id > 1 || p.proposer !== LAUNCHPAD);

  const thresholdFor = (k: Kind): [number, number] => {
    const label = { ChangePolicy: "policy", UpgradeSelf: "upgrade_self", UpgradeRemote: "upgrade_remote", SetStakingContract: "set_vote_token" }[kindName(k)];
    const role = policy?.roles.find((r) => r.name === "holders");
    const vp = (label && role?.vote_policy[label]) || policy?.default_vote_policy;
    return Array.isArray(vp?.threshold) ? (vp!.threshold as [number, number]) : [1, 2];
  };

  async function act(p: Proposal, action: "VoteApprove" | "VoteReject" | "VoteRemove" | "Finalize") {
    if (await send([{ receiverId: dao, calls: [{ method: "act_proposal", args: { id: p.id, action, proposal: p.kind }, gas: 250 }] }])) reload();
  }

  return (
    <div className="grid two">
      <div>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2>Proposals</h2>
          <span className="small muted mono">{dao}</span>
        </div>
        {!proposals && <div className="empty">Loading…</div>}
        {proposals && list.length === 0 && <div className="empty">No proposals yet. Create the first one →</div>}
        {list.map((p) => {
          const counts = p.vote_counts["holders"] ?? ["0", "0", "0"];
          const yes = BigInt(counts[0]);
          const no = BigInt(counts[1]);
          const [n, d] = thresholdFor(p.kind);
          const needed = totalW > 0n ? (totalW * BigInt(n)) / BigInt(d) : 0n;
          const pct = (v: bigint) => (totalW > 0n ? Number((v * 10000n) / totalW) / 100 : 0);
          const voted = accountId ? p.votes[accountId] : undefined;
          const expires = Number(BigInt(p.submission_time) / 1_000_000_000n) + Number(BigInt(policy?.proposal_period ?? "0") / 1_000_000_000n);
          const expired = p.status === "InProgress" && Date.now() / 1000 > expires;
          return (
            <div className="proposal" key={p.id}>
              <div className="row between">
                <b>#{p.id} · {describeKind(p.kind, t.meta.symbol)}</b>
                <span className={`badge ${STATUS_BADGE[p.status] ?? ""}`}>{expired ? "Expired" : p.status}</span>
              </div>
              {p.description && <p className="small" style={{ margin: "6px 0" }}>{p.description}</p>}
              <div className="vote-bar">
                <div className="yes" style={{ width: `${pct(yes)}%` }} />
                <div className="no" style={{ width: `${pct(no)}%` }} />
              </div>
              <div className="row between small muted wrap">
                <span>Yes {pct(yes).toFixed(1)}% · No {pct(no).toFixed(1)}% · passes at {((n / d) * 100).toFixed(0)}% ({fmtTok(needed.toString(), 0)} weight)</span>
                <span>by {p.proposer} · {ago(Number(BigInt(p.submission_time) / 1_000_000_000n))}</span>
              </div>
              {p.status === "InProgress" && (
                <div className="row wrap" style={{ marginTop: 8 }}>
                  {expired ? (
                    <button className="btn sm" disabled={busy} onClick={() => act(p, "Finalize")}>Finalize (return bond)</button>
                  ) : voted ? (
                    <span className="small muted">You voted {voted}</span>
                  ) : mineW > 0n ? (
                    <>
                      <button className="btn sm primary" disabled={busy} onClick={() => act(p, "VoteApprove")}>Approve</button>
                      <button className="btn sm danger" disabled={busy} onClick={() => act(p, "VoteReject")}>Reject</button>
                      <button className="btn sm ghost" disabled={busy} onClick={() => act(p, "VoteRemove")}>Spam</button>
                    </>
                  ) : (
                    <span className="small muted">Lock ${t.meta.symbol} to vote.</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="stack">
        <div className="grid stats">
          <Stat k="Your vote weight" v={fmtTok(mineW.toString(), 0)} s={totalW > 0n ? `${(Number((mineW * 10000n) / totalW) / 100).toFixed(2)}% of total` : "–"} />
          <Stat k="Total delegated" v={fmtTok(totalW.toString(), 0)} s="ve-weight across lockers" />
        </div>
        <NewProposal t={t} bond={policy?.proposal_bond ?? "100000000000000000000000"} onDone={reload} />
        {policy && (
          <div className="panel tight small">
            <Kv k="Proposal bond" v={`${fmtNear(policy.proposal_bond)} NEAR`} />
            <Kv k="Voting period" v={`${Number(BigInt(policy.proposal_period) / 3_600_000_000_000n)}h`} />
            <Kv k="Default threshold" v="50% of delegated weight" />
            <Kv k="Policy / upgrades" v="66% of delegated weight" />
          </div>
        )}
      </div>
    </div>
  );
}

type Template = "signal" | "transfer" | "release" | "clawback" | "agent" | "bounty" | "custom";
const TEMPLATES: { id: Template; label: string }[] = [
  { id: "signal", label: "Signal vote" },
  { id: "transfer", label: "Treasury transfer" },
  { id: "release", label: "Release creator milestone" },
  { id: "clawback", label: "Claw back creator escrow" },
  { id: "agent", label: "Change AI agent persona" },
  { id: "bounty", label: "Community bounty" },
  { id: "custom", label: "Custom call (e.g. House of Stake)" },
];

function NewProposal({ t, bond, onDone }: { t: TokenCtx["t"]; bond: string; onDone: () => void }) {
  const { send, busy, accountId, signIn } = useWallet();
  const [tpl, setTpl] = useState<Template>("signal");
  const [desc, setDesc] = useState("");
  const [f, setF] = useState({ receiver: "", amount: "", token: "NEAR", persona: t.agent_persona, agent: "", method: "", args: "{}", deposit: "0", gas: "100", times: "1", days: "7" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const lpCall = (method_name: string, args: object) => ({
    FunctionCall: { receiver_id: LAUNCHPAD, actions: [{ method_name, args: b64json(args), deposit: "0", gas: "50000000000000" }] },
  });

  function kind(): Kind | null {
    switch (tpl) {
      case "signal":
        return "Vote";
      case "transfer":
        if (!f.receiver || !f.amount) return null;
        return { Transfer: { token_id: f.token === "NEAR" ? "" : LINEAR, receiver_id: f.receiver, amount: parseUnits(f.amount, 24).toString(), msg: null } };
      case "release":
        if (!f.amount) return null;
        return lpCall("dao_release_creator", { token_id: t.token_id, amount: parseUnits(f.amount, 24).toString() });
      case "clawback":
        return lpCall("dao_clawback_creator", { token_id: t.token_id });
      case "agent":
        return lpCall("dao_set_agent", { token_id: t.token_id, agent_account: f.agent || null, persona: f.persona || null });
      case "bounty":
        if (!f.amount) return null;
        return {
          AddBounty: {
            bounty: {
              description: desc,
              token: "",
              amount: parseUnits(f.amount, 24).toString(),
              times: Number(f.times) || 1,
              max_deadline: (BigInt(Number(f.days) || 7) * 86_400_000_000_000n).toString(),
            },
          },
        };
      case "custom": {
        if (!f.receiver || !f.method) return null;
        let args: object;
        try {
          args = JSON.parse(f.args || "{}");
        } catch {
          return null;
        }
        return {
          FunctionCall: {
            receiver_id: f.receiver,
            actions: [{ method_name: f.method, args: b64json(args), deposit: parseUnits(f.deposit || "0", 24).toString(), gas: (BigInt(Number(f.gas) || 100) * 10n ** 12n).toString() }],
          },
        };
      }
    }
  }

  const k = kind();
  async function submit() {
    if (!accountId) return signIn();
    if (!k) return;
    const ok = await send([{ receiverId: t.dao_id, calls: [{ method: "add_proposal", args: { proposal: { description: desc, kind: k } }, gas: 100, deposit: bond }] }]);
    if (ok) {
      setDesc("");
      onDone();
    }
  }

  return (
    <div className="panel">
      <h2>New proposal</h2>
      <label className="field">
        <span>Type</span>
        <select className="select" value={tpl} onChange={(e) => setTpl(e.target.value as Template)}>
          {TEMPLATES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      {(tpl === "transfer" || tpl === "custom") && (
        <label className="field"><span>{tpl === "custom" ? "Contract" : "Recipient"}</span><input className="input mono" value={f.receiver} onChange={set("receiver")} placeholder="account.near" /></label>
      )}
      {tpl === "transfer" && (
        <div className="grid half">
          <label className="field"><span>Amount</span><input className="input" value={f.amount} onChange={set("amount")} placeholder="0.0" /></label>
          <label className="field"><span>Token</span><select className="select" value={f.token} onChange={set("token")}><option>NEAR</option><option>LiNEAR</option></select></label>
        </div>
      )}
      {(tpl === "release" || tpl === "bounty") && (
        <label className="field"><span>Amount (NEAR)</span><input className="input" value={f.amount} onChange={set("amount")} placeholder={tpl === "release" ? `escrow: ${fmtNear(t.creator_escrow)}` : "0.0"} /></label>
      )}
      {tpl === "bounty" && (
        <div className="grid half">
          <label className="field"><span>Times claimable</span><input className="input" value={f.times} onChange={set("times")} /></label>
          <label className="field"><span>Deadline (days)</span><input className="input" value={f.days} onChange={set("days")} /></label>
        </div>
      )}
      {tpl === "agent" && (
        <>
          <label className="field"><span>Persona</span><textarea className="textarea" value={f.persona} onChange={set("persona")} maxLength={1500} /></label>
          <label className="field"><span>New operator account (optional)</span><input className="input mono" value={f.agent} onChange={set("agent")} placeholder={t.agent_account} /></label>
        </>
      )}
      {tpl === "custom" && (
        <>
          <label className="field"><span>Method</span><input className="input mono" value={f.method} onChange={set("method")} placeholder="method_name" /></label>
          <label className="field"><span>Args (JSON)</span><textarea className="textarea mono" value={f.args} onChange={set("args")} /></label>
          <div className="grid half">
            <label className="field"><span>Deposit (NEAR)</span><input className="input" value={f.deposit} onChange={set("deposit")} /></label>
            <label className="field"><span>Gas (Tgas)</span><input className="input" value={f.gas} onChange={set("gas")} /></label>
          </div>
          <div className="notice small" style={{ marginBottom: 10 }}>
            Use this for House of Stake: the treasury can lock NEAR for veNEAR so holders vote as a bloc in NEAR governance.
            Check the HoS contract methods before proposing.
          </div>
        </>
      )}
      {tpl === "clawback" && <div className="notice small" style={{ marginBottom: 10 }}>Moves the creator&apos;s remaining {fmtNear(t.creator_escrow)} NEAR escrow into the DAO treasury.</div>}
      <label className="field"><span>Description</span><textarea className="textarea" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Why should holders approve this?" /></label>
      <button className="btn primary block" disabled={busy || !k || !desc.trim()} onClick={submit}>
        Submit · {fmtNear(bond)} NEAR bond
      </button>
    </div>
  );
}
