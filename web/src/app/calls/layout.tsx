import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Calls Leaderboard",
  description: "Timestamped community callouts tracked against live on-chain market cap.",
};

export default function CallsLayout({ children }: { children: ReactNode }) {
  return children;
}

