import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "Floorpad · meme launches with a rising floor",
  description:
    "Launch meme tokens on NEAR with a redeemable floor, locked LP earning staking yield, holder DAOs, live chat, callouts and AI agents.",
  applicationName: "Floorpad",
  appleWebApp: { capable: true, title: "Floorpad", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0d10",
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
