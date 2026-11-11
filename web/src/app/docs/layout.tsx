import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Documentation",
  description: "How Floorpad curves, vault floors, exit penalties, Ref LP locking, and Sputnik DAOs work.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return children;
}

