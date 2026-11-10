import type { Metadata } from "next";
import "@near-wallet-selector/modal-ui/styles.css";
import "./globals.css";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "Floorpad · meme launches with a rising floor",
  description:
    "Launch meme tokens on NEAR with a redeemable floor, locked LP earning staking yield, holder DAOs and AI agents funded by yield.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
