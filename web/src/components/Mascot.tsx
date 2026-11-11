"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";

export type Pose = "hero" | "cool" | "wink" | "flag";
export type Motion = "idle" | "wave" | "celebrate" | "peek" | "none";

const SRC: Record<Pose, string> = {
  hero: "/brand/mascot-hero.png",
  cool: "/brand/mascot-cool.png",
  wink: "/brand/mascot-wink.png",
  flag: "/brand/mascot-flag.png",
};

/**
 * The Floorpad brick, extracted as-is from the brand board and animated with CSS:
 * idle = float + sway, wave = rock side to side, celebrate = hop + pop, peek = rise in.
 * `blink` swaps to the wink pose for a moment every few seconds. Hover makes it hop.
 * All motion is disabled under prefers-reduced-motion.
 */
export function Mascot({
  pose = "hero",
  size = 160,
  motion = "idle",
  blink = false,
  className = "",
  alt = "Floorpad mascot",
}: {
  pose?: Pose;
  size?: number;
  motion?: Motion;
  blink?: boolean;
  className?: string;
  alt?: string;
}) {
  const [winking, setWinking] = useState(false);
  useEffect(() => {
    if (!blink) return;
    const t = setInterval(() => {
      setWinking(true);
      setTimeout(() => setWinking(false), 650);
    }, 4200);
    return () => clearInterval(t);
  }, [blink]);

  return (
    <span className={`mascot mascot-${motion} ${className}`} style={{ width: size }} aria-hidden={alt === "" ? true : undefined}>
      <span className="mascot-shadow" />
      <img src={SRC[winking ? "wink" : pose]} alt={alt} width={size} draggable={false} />
    </span>
  );
}

/** Preload all poses once so pose swaps never flash. */
export function MascotPreload() {
  return (
    <div style={{ display: "none" }} aria-hidden>
      {Object.values(SRC).map((s) => (
        <img key={s} src={s} alt="" />
      ))}
    </div>
  );
}
