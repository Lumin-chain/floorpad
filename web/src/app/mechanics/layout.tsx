import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Mechanics & Simulator",
  description: "Interactive 60-day floor simulator, immutable contract parameters, and mechanics log.",
};

export default function MechanicsLayout({ children }: { children: ReactNode }) {
  return children;
}

