"use client";

/* eslint-disable @next/next/no-img-element */
import type { CSSProperties, ReactNode } from "react";

/**
 * Floorpad's own icon language, instead of emoji or stock line icons.
 *
 * Moji: the brick mascot's face, cropped from the brand board (no redraw), one per mood.
 *   cool  = calling something out (callouts, trending)
 *   wink  = new, nice, chat
 *   hero  = rising (bonding, boost, closest to bonding)
 *   flag  = launched, graduated, bounties
 *
 * SlabIcon: functional icons built from the logo's slanted, rounded slab. Filled,
 * on a 24px grid, same 12-degree lean as the logo, so every icon belongs to the mark.
 */
export type MojiFace = "cool" | "wink" | "hero" | "flag";

export function Moji({ face, size = 20, label, style }: { face: MojiFace; size?: number; label?: string; style?: CSSProperties }) {
  return (
    <img
      className="moji"
      src={`/brand/graded/moji/face-${face}.png`}
      width={size}
      height={size}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      draggable={false}
      style={style}
    />
  );
}

/** Label with a mascot face in front: <MojiLabel face="cool">Live callouts</MojiLabel> */
export function MojiLabel({ face, size = 22, children }: { face: MojiFace; size?: number; children: ReactNode }) {
  return (
    <span className="moji-label">
      <Moji face={face} size={size} />
      <span>{children}</span>
    </span>
  );
}

// A slab = the logo's rounded parallelogram. x,y = top-left of the top edge; lean = horizontal offset.
const slab = (x: number, y: number, w: number, h: number, lean = 2.2) =>
  `M${x + lean} ${y}H${x + w}L${x + w - lean} ${y + h}H${x}Z`;

const PATHS: Record<string, string[]> = {
  // navigation
  explore: [slab(6, 5, 14, 5), slab(3, 13, 14, 5)], // the stacked-floor mark
  calls: [slab(3, 9, 7, 6, 1), "M10 9 18 4.5V19.5L10 15Z", slab(19.5, 10.5, 2.5, 3, 0.6)], // megaphone
  launch: [slab(10, 3, 5, 18, 1.4), slab(3, 9.5, 18, 5, 1.4)], // plus
  portfolio: [slab(6, 3.5, 14, 4.2), slab(4.5, 9.9, 14, 4.2), slab(3, 16.3, 14, 4.2)], // stack
  // actions
  share: [slab(2.5, 13.5, 9, 5), slab(12.5, 5.5, 9, 5), "M8.6 13.6 14.9 10.4 15.6 12 9.3 15.2Z"],
  ops: [slab(2.5, 5, 19, 2.6, 0.8), slab(2.5, 15.5, 19, 2.6, 0.8), slab(13, 2.5, 5, 7.6, 1), slab(5.5, 13, 5, 7.6, 1)], // sliders
  grid: [slab(3, 4, 8.5, 7), slab(13, 4, 8.5, 7), slab(2.5, 13, 8.5, 7), slab(12.5, 13, 8.5, 7)],
  rows: [slab(2.5, 4, 19, 3.6, 1), slab(2.5, 10.2, 19, 3.6, 1), slab(2.5, 16.4, 19, 3.6, 1)],
  chevron: ["M8 4.5 11.2 4.5 18 12 11.2 19.5 8 19.5 14.6 12Z"],
  external: ["M8 4H20V16L16.6 12.6 9 20.2 3.8 15 11.4 7.4Z"],
  reply: ["M4 10 10 4.5V8H14.5C18.4 8 21 10.6 21 14.5V19H17.6V14.8C17.6 12.7 16.4 11.5 14.3 11.5H10V15Z"],
  up: ["M12 5 20 17H4Z"],
  down: ["M4 7H20L12 19Z"],
  swatch: [slab(3, 5, 18, 14, 3)],
};

export type SlabIconName = keyof typeof PATHS;

export function SlabIcon({
  name,
  size = 18,
  className = "",
  style,
  title,
}: {
  name: SlabIconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}) {
  return (
    <svg
      className={`slab-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinejoin="round"
      style={style}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
