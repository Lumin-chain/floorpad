"use client";

import { BUCKET_LABELS, fmtNear, isGraduated, LINEAR, lp, view, YOCTO, type EpochReport } from "@/lib/near";
import { useView } from "@/lib/wallet";
import { BUCKET_COLORS, Kv, Stat } from "./ui";
import type { TokenCtx } from "@/app/token/[id]/page";

/** Treasury dashboard: DAO wallet, floor vault, creator escrow, agent budget and epoch history. */
export function TreasuryPanel({ t, linearPrice }: TokenCtx) {
  const ready = t.dao_stage === "Ready";
  const { data: daoNear } = useView(ready ? () => view<string>(t.dao_id, "get_available_amount") : null, [t.dao_id, ready], 15000);
  const { data: daoLin } = useView(() => view<string>(LINEAR, "ft_balance_of", { account_id: t.dao_id }).catch(() => "0"), [t.dao_id], 15000);
  const { data: daoClaim } = useView(() => lp<string>("get_claimable_linear", { account_id: t.dao_id }), [t.dao_id], 15000);
  const { data: epochs } = useView(() => lp<EpochReport[]>("get_epochs", { token_id: t.token_id, limit: 20 }), [t.token_id, t.epoch_index], 20000);
  const grad = isGraduated(t);
  const toNear = (s: string | bigint) => (BigInt(s) * linearPrice) / YOCTO;
  const vault = grad ? toNear(t.linear_shares) : BigInt(t.backing_near);
  const yieldShares = grad ? BigInt(t.linear_shares) - (BigInt(t.principal_near) * YOCTO) / linearPrice : 0n;

  return (
    <div className="stack">
      <div className="grid stats">
        <Stat k="DAO NEAR" v={ready ? fmtNear(daoNear ?? "0", 3) : "–"} s="spendable by proposal" />
        <Stat k="DAO LiNEAR" v={fmtNear(daoLin ?? "0", 3)} s={`≈ ${fmtNear(toNear(daoLin ?? "0"), 3)} NEAR`} />
        <Stat k="Floor vault" v={`${fmtNear(vault, 3)} N`} s="principal locked forever" />
        <Stat k="Pending yield" v={grad ? `${fmtNear(yieldShares > 0n ? yieldShares : 0n, 4)} LiNEAR` : "after graduation"} s="next epoch split" />
        <Stat k="Agent budget" v={`${fmtNear(t.agent_budget_shares, 4)} LiNEAR`} s="pays per post" />
        <Stat k="Creator escrow" v={`${fmtNear(t.creator_escrow, 3)} N`} s={`${fmtNear(t.creator_released, 3)} N released by vote`} />
      </div>

      <div className="grid half">
        <div className="panel">
          <h2>Vault breakdown</h2>
          <Kv k="Principal (NEAR value)" v={fmtNear(grad ? t.principal_near : t.backing_near, 4)} />
          {grad && <Kv k="Vault LiNEAR shares" v={fmtNear(t.linear_shares, 4)} />}
          {grad && <Kv k="LiNEAR price" v={`${fmtNear(linearPrice, 6)} NEAR`} />}
          {grad && <Kv k="Locked LP (LiNEAR side)" v={`${fmtNear(t.lp_shares, 3)} LiNEAR`} />}
          {grad && <Kv k="Ref pool" v={`#${t.pool_id}`} />}
          {!grad && <Kv k="Curve NEAR (becomes LP at graduation)" v={fmtNear(t.real_near, 3)} />}
          {daoClaim && daoClaim !== "0" && <Kv k="DAO LiNEAR held at launchpad" v={fmtNear(daoClaim, 4)} />}
        </div>
        <div className="panel">
          <h2>Accounts</h2>
          <Kv k="DAO" v={<span className="mono small">{t.dao_id}</span>} />
          <Kv k="Token" v={<span className="mono small">{t.token_id}</span>} />
          <Kv k="Creator" v={<span className="mono small">{t.creator}</span>} />
          <Kv k="AI agent operator" v={<span className="mono small">{t.agent_account}</span>} />
        </div>
      </div>

      <div className="panel">
        <h2>Epoch history</h2>
        {!epochs?.length ? (
          <div className="muted small">No epochs settled yet. The first one comes one epoch after graduation.</div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Yield (LiNEAR)</th>
                {BUCKET_LABELS.map((l, i) => (
                  <th key={l}><span style={{ color: BUCKET_COLORS[i] }}>■</span> {l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {epochs.map((e) => (
                <tr key={e.index}>
                  <td>{e.index}</td>
                  <td>{new Date(e.ts * 1000).toLocaleString()}</td>
                  <td>{fmtNear(e.yield_shares, 5)}</td>
                  {e.split.map((s, i) => <td key={i}>{fmtNear(s, 5)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
