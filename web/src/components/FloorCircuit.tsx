"use client";

import { Mascot } from "@/components/Mascot";

/**
 * Hero schematic: buy, sell and exit-fee inputs are routed as copper traces into the
 * floor-vault chip, LiNEAR yield feeds in from below, and the vault routes out to a
 * gold "redeem" pad. Signal pulses blink along the traces (opacity only).
 */
export function FloorCircuit({ vault, network }: { vault: string; network: string }) {
  const inputs = [
    { y: 64, label: "BUY 1.25%", path: "M40 64 H130 L160 94 H220" },
    { y: 150, label: "SELL 2.5%", path: "M40 150 H220" },
    { y: 236, label: "EXIT FEE <=10%", path: "M40 236 H130 L160 206 H220" },
  ];
  const pins = [94, 122, 150, 178, 206];
  return (
    <div className="floor-circuit" aria-hidden="true">
      <svg viewBox="0 0 480 300" className="fc-svg">
        {/* input pads + traces */}
        {inputs.map((i) => (
          <g key={i.label}>
            <path d={i.path} className="fc-trace" />
            <rect x={22} y={i.y - 9} width={18} height={18} rx={3} className="fc-pad" />
            <circle cx={31} cy={i.y} r={3.5} className="fc-drill" />
            <text x={22} y={i.y - 16} className="fc-label">{i.label}</text>
          </g>
        ))}

        {/* LiNEAR yield feeding up into the chip */}
        <path d="M280 300 V262 L300 242 V232" className="fc-trace" />
        <text x={308} y={286} className="fc-label">LiNEAR YIELD</text>

        {/* output to redeem pad */}
        <path d="M340 150 H392 L410 132 H428" className="fc-trace gold" />
        <circle cx={444} cy={132} r={14} className="fc-gold-pad" />
        <circle cx={444} cy={132} r={5} className="fc-drill" />
        <text x={410} y={170} className="fc-label">REDEEM</text>

        {/* chip body with pins */}
        {pins.map((y) => (
          <g key={y}>
            <rect x={210} y={y - 4} width={12} height={8} className="fc-pin" />
            <rect x={338} y={y - 4} width={12} height={8} className="fc-pin" />
          </g>
        ))}
        <rect x={220} y={72} width={120} height={160} rx={6} className="fc-chip" />
        <circle cx={234} cy={86} r={3} className="fc-dot" />
        <text x={280} y={118} textAnchor="middle" className="fc-ref">U1</text>
        <text x={280} y={142} textAnchor="middle" className="fc-chip-title">FLOOR</text>
        <text x={280} y={160} textAnchor="middle" className="fc-chip-title">VAULT</text>
        <text x={280} y={192} textAnchor="middle" className="fc-chip-value">{vault}</text>
        <text x={280} y={212} textAnchor="middle" className="fc-label">{network.toUpperCase()}</text>

        {/* signal pulses (staggered opacity blink) */}
        {[
          [100, 64], [190, 94], [120, 150], [200, 150], [100, 236], [190, 206], [280, 270], [372, 150],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={3.2} className="fc-pulse" style={{ animationDelay: `${i * 0.24}s` }} />
        ))}
      </svg>
      <div className="fc-mascot">
        <Mascot pose="cool" size={104} motion="idle" alt="" />
      </div>
    </div>
  );
}
