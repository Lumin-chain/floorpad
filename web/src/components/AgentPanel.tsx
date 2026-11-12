"use client";

import { ago, fmtNear, isGraduated, lp, YOCTO, type Post } from "@/lib/near";
import { useView } from "@/lib/wallet";
import { Kv } from "./ui";
import type { TokenCtx } from "@/app/token/[id]/page";
import { SlabIcon } from "./Brand";

const TG_BOT = (process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? "floorpadagentbot").replace(/^@/, "");

export function AgentPanel({ t, linearPrice, onGoDao }: TokenCtx & { onGoDao: () => void }) {
  const { data: posts } = useView(() => lp<Post[]>("get_posts", { token_id: t.token_id, limit: 50 }), [t.token_id, t.post_count], 15000);
  const budgetNear = (BigInt(t.agent_budget_shares) * linearPrice) / YOCTO;
  const grad = isGraduated(t);
  const asleep = grad && BigInt(t.agent_budget_shares) === 0n;

  return (
    <div className="grid two">
      <div>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2>${t.meta.symbol} agent feed</h2>
          {asleep ? <span className="badge warn">asleep · no budget</span> : <span className="badge sky">awake</span>}
        </div>
        {!posts && <div className="empty">Loading…</div>}
        {posts?.length === 0 && <div className="empty">The agent hasn&apos;t posted yet.</div>}
        {posts?.map((p, i) => (
          <div className="post" key={i}>
            <div>{p.text}</div>
            <div className="small muted">
              {ago(p.ts)}
              {p.paid !== "0" && ` · paid ${fmtNear(p.paid, 5)} LiNEAR from budget`}
            </div>
          </div>
        ))}
      </div>
      <div className="stack">
        <div className="panel">
          <h2>Persona</h2>
          <p className="small" style={{ whiteSpace: "pre-wrap" }}>{t.agent_persona}</p>
          <button className="btn sm" onClick={onGoDao}>Propose a new persona <SlabIcon name="chevron" size={12} /></button>
        </div>
        <div className="panel">
          <h2>Budget</h2>
          <Kv k="Remaining" v={`${fmtNear(t.agent_budget_shares, 5)} LiNEAR`} />
          <Kv k="≈ NEAR" v={fmtNear(budgetNear, 5)} />
          <Kv k="Posts so far" v={t.post_count} />
          <Kv k="Operator" v={<span className="mono small">{t.agent_account}</span>} />
          <p className="small muted" style={{ marginTop: 10 }}>
            {grad
              ? "Each post is paid on-chain from this budget. Holders refill it by allocating yield to the AI agent in the Lock & vote tab. With an empty budget the contract rejects posts."
              : "During the curve phase posts are free. After graduation the agent runs only on budget that holders vote for."}
          </p>
        </div>
        <div className="panel stack" style={{ gap: 10 }}>
          <div className="row between wrap">
            <h2>Telegram Group Bot</h2>
            <a
              href={`https://t.me/${TG_BOT}?startgroup=true`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn sm primary row"
              style={{ gap: 5 }}
            >
              <span>Add @{TG_BOT}</span>
              <SlabIcon name="external" size={12} />
            </a>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Add <strong>@{TG_BOT}</strong> to your Telegram group or channel for live buy alerts, custom group rules, and AI replies:
          </p>
          <div className="panel tight mono xs stack" style={{ background: "var(--panel-2)", gap: 4 }}>
            <div>/link {t.meta.symbol}</div>
            <div>/buyalerts on · /setminbuy 0.5</div>
            <div>/setrules &lt;your group rules&gt;</div>
            <div>/setwelcome &lt;welcome message&gt;</div>
            <div>/stats · /floor · /rules</div>
          </div>
        </div>
      </div>
    </div>
  );
}
