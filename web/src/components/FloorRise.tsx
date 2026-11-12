"use client";

import { Mascot } from "@/components/Mascot";

/**
 * Hero visual: the floor rising. Each source that feeds the vault lays down one more floor
 * slab (buy fees, sell fees, exit fees, graduation, yield), the stack climbs, a level marker
 * reads out the current floor, and the mascot stands on the top floor. On load the slabs
 * rise into place one after another (transform + opacity only).
 */
// Figures are the live launchpad config: fee_vault_bps 4000, exit fee 100% to vault,
// grad_vault_bps 1500; yield is split by holder vote. Each slab reads "source | share to floor".
const SLABS = [
  { label: "BUY FEE 1.25%", value: "40% → FLOOR" },
  { label: "SELL FEE 2.5%", value: "40% → FLOOR" },
  { label: "EXIT FEE ≤10%", value: "ALL → FLOOR" },
  { label: "GRADUATION", value: "15% → FLOOR" },
  { label: "LiNEAR YIELD", value: "BY VOTE" },
];

const X0 = 96;
const W = 288;
const H = 38;
const BASE = 318; // bottom of the lowest slab
const STEP = 10; // each floor is set in a little, so the stack reads as rising steps

export function FloorRise({ vault }: { vault: string }) {
  const topY = BASE - SLABS.length * H;
  return (
    <div className="floor-rise" aria-hidden="true">
      <svg viewBox="0 0 480 340" className="fr-svg">
        {/* level gauge on the left: ticks climbing to an up arrow */}
        <path d={`M44 ${BASE} V${topY - 26}`} className="fr-gauge" />
        {SLABS.map((_, i) => (
          <path key={i} d={`M38 ${BASE - (i + 1) * H} H50`} className="fr-gauge" />
        ))}
        <path d={`M34 ${topY - 16} L44 ${topY - 32} L54 ${topY - 16}`} className="fr-gauge arrow" />

        {/* the slabs, lowest first */}
        {SLABS.map((s, i) => {
          const y = BASE - (i + 1) * H;
          const inset = i * STEP;
          const top = i === SLABS.length - 1;
          return (
            <g key={s.label} className="fr-slab" style={{ animationDelay: `${i * 0.12}s` }}>
              <rect x={X0 + inset} y={y} width={W - inset * 2} height={H - 3} rx={4} className={top ? "fr-slab-top" : "fr-slab-body"} />
              <rect x={X0 + inset} y={y} width={W - inset * 2} height={4} rx={2} className="fr-slab-edge" />
              <text x={X0 + inset + 12} y={y + 23} className={top ? "fr-text ink" : "fr-text"}>{s.label}</text>
              <text x={X0 + W - inset - 12} y={y + 23} textAnchor="end" className={top ? "fr-text ink" : "fr-value"}>{s.value}</text>
            </g>
          );
        })}

        {/* the ground floor everything stands on */}
        <rect x={0} y={BASE} width={480} height={22} className="fr-ground" />
        <path d={`M0 ${BASE} H480`} className="fr-ground-edge" />

        {/* current floor level marker */}
        <g className="fr-marker">
          <path d={`M${X0 + W - (SLABS.length - 1) * STEP + 6} ${topY} H452`} className="fr-level" />
          <rect x={392} y={topY - 46} width={84} height={38} rx={6} className="fr-tag" />
          <text x={434} y={topY - 31} textAnchor="middle" className="fr-tag-k">FLOOR</text>
          <text x={434} y={topY - 15} textAnchor="middle" className="fr-tag-v">{vault}</text>
        </g>
      </svg>

      <div className="fr-mascot" style={{ top: `${(topY / 340) * 100}%` }}>
        <Mascot pose="cool" size={96} motion="none" alt="" />
      </div>
    </div>
  );
}
