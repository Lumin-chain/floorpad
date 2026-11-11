"use client";

import { LAUNCHPAD, type TokenView } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { SlabIcon } from "./Brand";

/** Permissionless lifecycle steps. A keeper runs these too, but anyone can push them from here. */
export function OpsBar({ t, reload }: { t: TokenView; reload: () => void }) {
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
  if (t.grad_stage === "Graduated" && !t.epoch_busy && now >= t.next_epoch_at)
    ops.push({ label: "Settle epoch", method: "settle_epoch", gas: 300 });
  if (!ops.length) return null;
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
