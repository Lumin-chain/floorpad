"use client";

import type { ReactNode } from "react";
import { BUCKET_LABELS, safeImageSrc, type TokenView } from "@/lib/near";

export const BUCKET_COLORS = ["#3E9C77", "#F0907A", "#E6C14A", "#D98C53", "#C0C0C0"];

export function Avatar({ t, lg, small }: { t: TokenView; lg?: boolean; small?: boolean }) {
  const safeIcon = safeImageSrc(t.meta.icon);
  if (safeIcon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`avatar${lg ? " lg" : small ? " sm" : ""}`} src={safeIcon} alt={t.meta.symbol} />;
  }
  return <div className={`avatar${lg ? " lg" : small ? " sm" : ""}`}>{t.meta.symbol.slice(0, 2)}</div>;
}

export function Stat({ k, v, s }: { k: string; v: ReactNode; s?: ReactNode }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}

export function StageBadges({ t }: { t: TokenView }) {
  const grad =
    t.grad_stage === "Graduated" ? (
      <span className="badge green">Graduated · LP locked</span>
    ) : t.grad_stage === "Curve" ? (
      <span className="badge">Bonding curve</span>
    ) : (
      <span className="badge warn">Graduating · {t.grad_stage}</span>
    );
  const dao =
    t.dao_stage === "Ready" ? (
      <span className="badge violet">DAO live</span>
    ) : t.dao_stage === "Failed" ? (
      <span className="badge bad">DAO needs retry</span>
    ) : (
      <span className="badge">DAO activating</span>
    );
  const snipe = Date.now() / 1000 < t.snipe_window_ends ? <span className="badge sky">Fair-launch caps on</span> : null;
  return (
    <span className="row wrap" style={{ gap: 6 }}>
      {grad}
      {dao}
      {snipe}
    </span>
  );
}

export function AllocBar({ values }: { values: (string | number | bigint)[] }) {
  const nums = values.map((v) => Number(BigInt(v.toString()) / 10n ** 6n));
  const sum = nums.reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="alloc-bar">
        {sum === 0 ? (
          <div style={{ width: "100%", background: BUCKET_COLORS[0] }} title="No votes yet: 100% floor" />
        ) : (
          nums.map((n, i) => (
            <div key={i} style={{ width: `${(n / sum) * 100}%`, background: BUCKET_COLORS[i] }} title={BUCKET_LABELS[i]} />
          ))
        )}
      </div>
      <div className="legend">
        {BUCKET_LABELS.map((l, i) => (
          <span key={l}>
            <i style={{ background: BUCKET_COLORS[i] }} />
            {l} {sum === 0 ? (i === 0 ? "100%" : "0%") : `${((nums[i] / sum) * 100).toFixed(1)}%`}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Kv({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="kv">
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}
