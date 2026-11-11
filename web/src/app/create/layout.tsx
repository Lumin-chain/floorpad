import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Launch a Token",
  description: "Launch a fair-curve token on NEAR with an on-chain floor vault and holder DAO.",
};

export default function CreateLayout({ children }: { children: ReactNode }) {
  return children;
}

