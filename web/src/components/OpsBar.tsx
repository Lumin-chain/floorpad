"use client";

import { LAUNCHPAD, type TokenView } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { SlabIcon } from "./Brand";

/** Permissionless lifecycle steps. Keeper/advanced actions tuck into a menu in the token header. */
export function OpsBar({ t, reload, menu = false }: { t: TokenView; reload: () => void; menu?: boolean }) {
  const { send, busy } = useWallet();
  const run = async (method: string, gas: number) => {
    if (await send([{ receiverId: LAUNCHPAD, calls: [{ method, args: { token_id: t.token_id }, gas }] }])) reload();
  };
  const now = Date.now() / 1000;
  const ops: { label: string; method: string; gas: number }[] = [];
  if (t.dao_stage === "Created") ops.push({ label: "Activate DAO", method: "finalize_dao", gas: 200 });
  if (t.dao_stage === "Failed") ops.push({ label: "Retry DAO", method: "retry_dao", gas: 250 });
  if (t.grad_stage !== "Curve" && t.grad_stage !== "Graduated" && !t.grad_busy)
    ops.push({ label: `Graduate: ${t.grad_stage}`, method: "advance_graduation", gas: 300 });
  if (
    t.grad_stage === "Graduated" && t.next_harvest_at !== undefined && !t.harvest_busy &&
    (t.harvest_pending || now >= t.next_harvest_at)
  )
    ops.push({ label: t.harvest_pending ? "Finish LP harvest" : "Harvest LP", method: "harvest_lp", gas: 300 });
  if (t.grad_stage === "Graduated" && !t.epoch_busy && now >= t.next_epoch_at)
    ops.push({ label: "Settle epoch", method: "settle_epoch", gas: 300 });
  if (t.grad_stage === "Graduated")
    ops.push({ label: "Harvest DEX tax", method: "harvest_token_tax", gas: 250 });
  if (!ops.length) return null;

  if (menu) {
    return (
      <details className="ops-details">
        <summary className="btn sm ghost" title="Permissionless keeper maintenance actions">
          <SlabIcon name="ops" size={14} /> Keeper ({ops.length})
        </summary>
        <div className="ops-menu">
          <div className="xs muted" style={{ padding: "2px 4px" }}>Permissionless maintenance</div>
          {ops.map((o) => (
            <button
              key={o.method}
              className="btn sm"
              style={{ justifyContent: "flex-start", width: "100%" }}
              disabled={busy}
              onClick={() => run(o.method, o.gas)}
            >
              <SlabIcon name="ops" size={13} /> {o.label}
            </button>
          ))}
        </div>
      </details>
    );
  }

  return (
    <div className="row wrap">
      {ops.map((o) => (
        <button key={o.method} className="btn sm" disabled={busy} onClick={() => run(o.method, o.gas)} title="Permissionless: anyone can run this step">
          <SlabIcon name="ops" size={14} /> {o.label}
        </button>
      ))}
    </div>
  );
}
