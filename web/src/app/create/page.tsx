"use client";

import { useState } from "react";
import { fmtNear, LAUNCHPAD, lp, type LaunchConfig } from "@/lib/near";
import { useView, useWallet } from "@/lib/wallet";

const MAX_ICON = 12_000;

async function toIcon(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  for (const [size, q] of [[128, 0.8], [96, 0.7], [64, 0.6]] as const) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    const url = c.toDataURL("image/webp", q);
    if (url.length <= MAX_ICON) return url;
  }
  throw new Error("Image too detailed. Try a simpler one.");
}

export default function Create() {
  const { send, accountId, signIn, busy } = useWallet();
  const { data: cfg } = useView(() => lp<LaunchConfig>("get_config"), [], 0);
  const [f, setF] = useState({ name: "", symbol: "", description: "", website: "", twitter: "", telegram: "", persona: "" });
  const [icon, setIcon] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: k === "symbol" ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) : e.target.value });

  const valid = f.name.trim().length > 0 && f.symbol.length >= 2;

  async function submit() {
    setErr(null);
    if (!accountId) return signIn();
    const sub = f.symbol.toLowerCase();
    const taken = await lp("get_token", { token_id: `${sub}.${LAUNCHPAD}` }).catch(() => null);
    if (taken) return setErr(`$${f.symbol} is already taken`);
    const opt = (s: string) => (s.trim() ? s.trim() : null);
    await send([
      {
        receiverId: LAUNCHPAD,
        calls: [
          {
            method: "create_token",
            args: {
              meta: {
                name: f.name.trim(),
                symbol: f.symbol,
                icon,
                description: f.description.trim(),
                website: opt(f.website),
                twitter: opt(f.twitter),
                telegram: opt(f.telegram),
              },
              agent_persona: opt(f.persona),
            },
            gas: 300,
            deposit: cfg?.creation_fee ?? "3000000000000000000000000",
          },
        ],
      },
    ]);
  }

  return (
    <div className="grid two section">
      <div className="panel">
        <h1>Launch a token</h1>
        <p className="muted">
          A single transaction deploys the token, opens the bonding curve and creates the holders&apos; DAO.
          Total supply is 1B: 800M sell on the curve and 200M seed the locked Ref LP at graduation.
          There is no premint and no dev allocation.
        </p>
        <div className="grid half">
          <label className="field"><span>Name</span><input className="input" value={f.name} onChange={set("name")} maxLength={40} placeholder="Floor Cat" /></label>
          <label className="field"><span>Ticker</span><input className="input mono" value={f.symbol} onChange={set("symbol")} placeholder="FCAT" /></label>
        </div>
        <label className="field"><span>Description</span><textarea className="textarea" value={f.description} onChange={set("description")} maxLength={600} placeholder="What is the meme?" /></label>
        <label className="field">
          <span>Image (resized to fit on-chain)</span>
          <div className="row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {icon && <img src={icon} alt="" className="avatar lg" />}
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  setIcon(await toIcon(file));
                } catch (x) {
                  setErr((x as Error).message);
                }
              }}
            />
          </div>
        </label>
        <div className="grid half">
          <label className="field"><span>Website</span><input className="input" value={f.website} onChange={set("website")} placeholder="https://" /></label>
          <label className="field"><span>X / Twitter</span><input className="input" value={f.twitter} onChange={set("twitter")} placeholder="@handle" /></label>
        </div>
        <label className="field"><span>Telegram</span><input className="input" value={f.telegram} onChange={set("telegram")} placeholder="t.me/…" /></label>
        <label className="field">
          <span>AI agent persona (holders can change it later by DAO vote)</span>
          <textarea className="textarea" value={f.persona} onChange={set("persona")} maxLength={1500} placeholder={`You are the voice of $${f.symbol || "TICKER"}. Funny, upbeat, never gives financial advice.`} />
        </label>
        {err && <div className="notice warn" style={{ marginBottom: 12 }}>{err}</div>}
        <button className="btn primary block" disabled={!valid || busy} onClick={submit}>
          {accountId ? `Launch $${f.symbol || "…"} · ${cfg ? fmtNear(cfg.creation_fee, 2) : "3"} NEAR` : "Connect wallet to launch"}
        </button>
      </div>

      <div className="stack">
        <div className="panel">
          <h2>What holders get</h2>
          <ul className="muted small" style={{ paddingLeft: 18, margin: 0 }}>
            <li><b>Fair launch:</b> per-wallet caps during the first minutes stop snipers.</li>
            <li><b>Floor vault:</b> 70% of the 1% trade fee and every exit fee back a redeemable floor.</li>
            <li><b>Decaying exit fee:</b> up to {cfg ? cfg.max_exit_fee_bps / 100 : 10}% for fresh buyers, falling to 0 over {cfg ? Math.round(cfg.exit_decay_secs / 86400) : 30} days.</li>
            <li><b>Graduation:</b> the curve sells out, liquidity moves to a Ref MEME/LiNEAR pool and the LP is locked forever while it earns staking yield.</li>
            <li><b>Epoch votes:</b> holders split staking yield across floor, buyback &amp; burn, airdrop, AI agent and treasury.</li>
            <li><b>Creator escrow:</b> the creator&apos;s 20% fee share unlocks only by DAO vote, and the DAO can claw it back.</li>
          </ul>
        </div>
        <div className="notice">
          Launch fee covers the token account, the DAO deposit and storage. Your connected wallet becomes the creator.
        </div>
      </div>
    </div>
  );
}
