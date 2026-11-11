"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { WalletProvider, useWallet } from "@/lib/wallet";
import { Mascot, MascotPreload } from "./Mascot";
import { SlabIcon } from "./Brand";
import { TradeTicker } from "./TradeTicker";
import { useEffect } from "react";
import { captureReferrer, fmtNear, LAUNCHPAD, NETWORK } from "@/lib/near";

const NAV = [
  { href: "/", label: "Explore", icon: "explore", plus: false },
  { href: "/calls", label: "Calls", icon: "calls", plus: false },
  { href: "/mechanics", label: "Mechanics", icon: "ops", plus: false },
  { href: "/docs", label: "Docs", icon: "rows", plus: false },
  { href: "/create", label: "Launch", icon: "launch", plus: true },
  { href: "/portfolio", label: "Portfolio", icon: "portfolio", plus: false },
] as const;


function Header() {
  const { accountId, nearBalance, signIn, signOut, ready } = useWallet();
  const path = usePathname();
  return (
    <header className="header">
      <div className="container wide">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/symbol.png" alt="" className="brand-symbol" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/wordmark.png" alt="Floorpad" className="brand-wordmark" />
        </Link>
        <nav className="nav desktop-only">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={path === n.href ? "active" : ""}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="spacer" />
        <span className="badge desktop-only">{NETWORK}</span>
        {accountId ? (
          <div className="row" style={{ gap: 6 }}>
            <span className="badge green mono" title="Wallet NEAR Balance" style={{ fontSize: "0.85rem", padding: "4px 8px" }}>
              {fmtNear(nearBalance, 2)} N
            </span>
            <button className="btn sm account-btn" onClick={signOut} title="Sign out">
              {accountId}
            </button>
          </div>
        ) : (
          <button className="btn primary sm" onClick={signIn} disabled={!ready}>
            Connect
          </button>
        )}
      </div>
    </header>
  );
}

function BottomNav() {
  const path = usePathname();
  return (
    <nav className="bottom-nav mobile-only" aria-label="Main">
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} className={`${path === n.href ? "active" : ""} ${n.plus ? "plus" : ""}`}>
          <span className="bn-icon"><SlabIcon name={n.icon} size={20} /></span>
          <span>{n.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function Toast() {
  const { toast } = useWallet();
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`}>
      {toast.kind === "ok" && <Mascot pose="wink" size={44} motion="celebrate" alt="" />}
      <span>{toast.text}</span>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  useEffect(() => captureReferrer(), []);
  return (
    <WalletProvider>
      <Header />
      <TradeTicker />
      <main className="container wide main">{children}</main>
      <footer className="footer desktop-only">
        <div className="container wide row between wrap">
          <span>Floorpad · contract <span className="mono">{LAUNCHPAD}</span></span>
          <span>Not financial advice. Meme tokens are volatile; the floor limits, but does not remove, risk.</span>
        </div>
      </footer>
      <BottomNav />
      <Toast />
      <MascotPreload />
    </WalletProvider>
  );
}
