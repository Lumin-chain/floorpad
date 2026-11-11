import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Your Floorpad token balances, locks, floor backing, referral earnings, and PNL cards.",
};

export default function PortfolioLayout({ children }: { children: ReactNode }) {
  return children;
}

