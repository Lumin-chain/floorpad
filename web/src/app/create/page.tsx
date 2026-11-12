"use client";

import { useState } from "react";
import { fmtNear, LAUNCHPAD, lp, NETWORK, safeExternalUrl, safeTelegramUrl, safeTwitterUrl, type LaunchConfig } from "@/lib/near";
import { useView, useWallet } from "@/lib/wallet";
import { Mascot } from "@/components/Mascot";

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
  const [taxMode, setTaxMode] = useState<"auto" | "custom">("auto");
  const [tax, setTax] = useState({ buyPct: "0.5", sellPct: "1", exitPct: "3", decayDays: "30" });
  const [icon, setIcon] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: k === "symbol" ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) : e.target.value });

  const valid = f.name.trim().length > 0 && f.symbol.length >= 2;

  async function submit() {
    setErr(null);
    if (!accountId) return signIn();
    if (f.website.trim() && !safeExternalUrl(f.website)) {
      return setErr("Website must be a valid http(s) URL");
    }
    if (f.twitter.trim() && !safeTwitterUrl(f.twitter)) {
      return setErr("X / Twitter must be a handle or https://x.com/ link");
    }
    if (f.telegram.trim() && !safeTelegramUrl(f.telegram)) {
      return setErr("Telegram must be a handle or https://t.me/ link");
    }
    const sub = f.symbol.toLowerCase();
    const taken = await lp("get_token", { token_id: `${sub}.${LAUNCHPAD}` }).catch(() => null);
    if (taken) return setErr(`$${f.symbol} is already taken`);
    const opt = (s: string) => (s.trim() ? s.trim() : null);
    const website = f.website.trim() ? safeExternalUrl(f.website) : null;
    let tax_policy: Record<string, number> | null = null;
    if (taxMode === "custom") {
      const buyBps = Math.round(Number(tax.buyPct) * 100);
      const sellBps = Math.round(Number(tax.sellPct) * 100);
      const exitBps = Math.round(Number(tax.exitPct) * 100);
      const decaySecs = Math.round(Number(tax.decayDays) * 86_400);
      if (Number.isNaN(buyBps) || buyBps < 0 || buyBps > 300) return setErr("Buy tax must be between 0% and 3%");
      if (Number.isNaN(sellBps) || sellBps < 0 || sellBps > 500) return setErr("Sell tax must be between 0% and 5%");
      if (Number.isNaN(exitBps) || exitBps < 0 || exitBps > 500) return setErr("Exit decay fee must be between 0% and 5%");
      if (Number.isNaN(decaySecs) || decaySecs < 0 || decaySecs > 30 * 86_400) return setErr("Decay period must be 0 to 30 days");
      tax_policy = {
        buy_tax_bps: buyBps,
        sell_tax_bps: sellBps,
        max_exit_fee_bps: exitBps,
        exit_decay_secs: decaySecs,
      };
    }
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
                website,
                twitter: opt(f.twitter),
                telegram: opt(f.telegram),
              },
              agent_persona: opt(f.persona),
              tax_policy,
            },
            gas: 300,
            deposit: cfg?.creation_fee ?? "1500000000000000000000000",
          },
        ],
      },
    ]);
  }

  const gradTargetStr = cfg ? `$${cfg.grad_mcap_usd.toLocaleString()}` : "target market cap";
  const creationFeeStr = cfg ? fmtNear(cfg.creation_fee, 2) : "1.5";

  return (
    <div className="grid two section">
      <div className="panel">
        <div className="row between wrap" style={{ marginBottom: 6 }}>
          <h1 className="page-title">Launch a token</h1>
          <span className="badge primary mono">Fee: {creationFeeStr} NEAR</span>
        </div>
        <p className="muted">
          One transaction creates the token, opens the bonding curve, and sets up the community DAO.
          760M of the 1B total supply sell on the curve, sized from live NEAR price to graduate to Ref Finance at{" "}
          <strong>{gradTargetStr} USD</strong> ({NETWORK} setting). Zero premint, zero team allocation.
        </p>
        <div className="grid half">
          <label className="field"><span>Name</span><input className="input" value={f.name} onChange={set("name")} maxLength={40} placeholder="Floor Cat" /></label>
          <label className="field"><span>Ticker</span><input className="input mono" value={f.symbol} onChange={set("symbol")} placeholder="FCAT" /></label>
        </div>
        <label className="field"><span>Description</span><textarea className="textarea" value={f.description} onChange={set("description")} maxLength={600} placeholder="What is the meme?" /></label>
        <div className="field">
          <span className="field-label">Token Image (automatically resized on-chain)</span>
          <label className="dropzone">
            {icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={icon} alt="Token preview" className="avatar lg" />
            ) : (
              <div className="avatar lg">{(f.symbol || "IMG").slice(0, 2)}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="bold small">{icon ? "Image ready — click to replace" : "Choose a PNG, JPG, or WEBP image"}</div>
              <div className="xs muted">Cropped square and stored directly on-chain (no external hosting needed).</div>
            </div>
            <span className="btn sm">Upload</span>
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
          </label>
        </div>
        <div className="grid half">
          <label className="field"><span>Website</span><input className="input" maxLength={200} value={f.website} onChange={set("website")} placeholder="https://" /></label>
          <label className="field"><span>X / Twitter</span><input className="input" maxLength={64} value={f.twitter} onChange={set("twitter")} placeholder="@handle" /></label>
        </div>
        <label className="field">
          <span>Telegram (add @floorpadagentbot to your group &amp; run /link {f.symbol || "$TICKER"} for buy alerts &amp; rules)</span>
          <input className="input" maxLength={64} value={f.telegram} onChange={set("telegram")} placeholder="t.me/…" />
        </label>
        <label className="field">
          <span>AI agent persona (holders can change it later by DAO vote)</span>
          <textarea className="textarea" value={f.persona} onChange={set("persona")} maxLength={1500} placeholder={`You are the voice of $${f.symbol || "TICKER"}. Funny, upbeat, never gives financial advice.`} />
        </label>
        <div className="panel tight stack" style={{ background: "var(--panel-2)", gap: 10, marginBottom: 14 }}>
          <div className="row between wrap">
            <div>
              <b className="small">Token Tax &amp; Decay Policy</b>
              <div className="xs muted">Holders can vote via DAO later to adjust the split &amp; decay period.</div>
            </div>
            <div className="seg">
              <button type="button" className={taxMode === "auto" ? "active" : ""} onClick={() => setTaxMode("auto")}>Automatic</button>
              <button type="button" className={taxMode === "custom" ? "active" : ""} onClick={() => setTaxMode("custom")}>Custom</button>
            </div>
          </div>
          {taxMode === "auto" ? (
            <div className="xs muted">
              Default: <strong>0.5% buy</strong> · <strong>1.0% sell</strong> · <strong>3.0% exit fee</strong> decaying over <strong>30 days</strong> (active on curve &amp; post-graduation DEX).
            </div>
          ) : (
            <div className="grid half">
              <label className="field"><span>Buy tax (0–3%)</span><input className="input mono" type="number" step="0.1" min="0" max="3" value={tax.buyPct} onChange={(e) => setTax({ ...tax, buyPct: e.target.value })} /></label>
              <label className="field"><span>Sell tax (0–5%)</span><input className="input mono" type="number" step="0.1" min="0" max="5" value={tax.sellPct} onChange={(e) => setTax({ ...tax, sellPct: e.target.value })} /></label>
              <label className="field"><span>Exit decay fee (0–5%)</span><input className="input mono" type="number" step="0.1" min="0" max="5" value={tax.exitPct} onChange={(e) => setTax({ ...tax, exitPct: e.target.value })} /></label>
              <label className="field"><span>Decay period (0–30 days)</span><input className="input mono" type="number" step="1" min="0" max="30" value={tax.decayDays} onChange={(e) => setTax({ ...tax, decayDays: e.target.value })} /></label>
            </div>
          )}
        </div>
        {err && <div className="notice warn" style={{ marginBottom: 12 }}>{err}</div>}
        <button className="btn primary block" disabled={!valid || busy} onClick={submit}>
          {accountId ? `Launch $${f.symbol || "…"} · ${cfg ? fmtNear(cfg.creation_fee, 2) : "1.5"} NEAR` : "Connect wallet to launch"}
        </button>
      </div>

      <div className="stack">
        <div className="panel create-mascot">
          <Mascot pose="flag" size={110} motion="wave" alt="" />
          <div>
            <b>Plant your flag.</b>
            <div className="small muted">One transaction: token, curve and holder DAO.</div>
          </div>
        </div>
        <div className="panel">
          <h2>What holders get</h2>
          <ul className="muted small" style={{ paddingLeft: 18, margin: 0 }}>
            <li><b>Fair launch:</b> per-wallet caps during the first minutes stop snipers.</li>
            <li><b>Floor vault:</b> token taxes ({taxMode === "auto" ? "0.5% buy, 1% sell" : `${tax.buyPct}% buy, ${tax.sellPct}% sell`} during the decay window), 100% of exit fees, and 15% of graduation funds back the redeemable vault floor (plus 1% platform fee).</li>
            <li><b>Exit penalty on quick flips:</b> starts at {taxMode === "auto" ? (cfg ? cfg.max_exit_fee_bps / 100 : 3) : tax.exitPct}% right after buying and decays linearly to 0% over {taxMode === "auto" ? (cfg ? Math.round(cfg.exit_decay_secs / 86400) : 30) : tax.decayDays} days.</li>
            <li><b>Graduation:</b> at {gradTargetStr} ({NETWORK}), the curve closes and liquidity moves to a locked Ref pool at the same price, earning staking yield.</li>
            <li><b>Yield votes:</b> lockers split staking yield across vault floor, buyback &amp; burn, locker rewards, AI agent and DAO treasury.</li>
            <li><b>Creator rewards:</b> 25% of curve fees (0.31% of buys, 0.63% of sells, above pump.fun&apos;s 0.30%). Half is claimable any time; half unlocks by holder vote (&gt;70%), and the DAO can claw it back.</li>
            <li><b>Referrals:</b> anyone who shares a ref link earns 20% of the platform fee on the trades they bring.</li>
          </ul>
        </div>
        <div className="notice">
          Launch fee covers the token account, the DAO deposit and storage. Your connected wallet becomes the creator.
        </div>
      </div>
    </div>
  );
}
