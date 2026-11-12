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

const BOTTOM_NAV = [
  { href: "/", label: "Explore", icon: "explore", plus: false },
  { href: "/calls", label: "Calls", icon: "calls", plus: false },
  { href: "/create", label: "Launch", icon: "launch", plus: true },
  { href: "/docs", label: "Docs", icon: "rows", plus: false },
  { href: "/portfolio", label: "Portfolio", icon: "portfolio", plus: false },
] as const;


const X_URL = "https://x.com/usefloorpad_";

function XLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function Header() {
  const { accountId, nearBalance, signIn, signOut, ready } = useWallet();
  const path = usePathname();
  return (
    <header className="header">
      <div className="container wide">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/symbol.png" alt="Floorpad mark" className="brand-symbol" />
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
        <a
          href={X_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="x-profile-link"
          aria-label="Floorpad on X (@usefloorpad_)"
          title="@usefloorpad_ on X"
        >
          <XLogo size={14} />
          <span className="desktop-only">@usefloorpad_</span>
        </a>
        <span className={`badge ${NETWORK === "testnet" ? "warn" : "green"}`}>{NETWORK}</span>
        {accountId ? (
          <div className="row" style={{ gap: 6 }}>
            <span className="badge green mono desktop-only" title="Wallet NEAR Balance" style={{ padding: "4px 8px" }}>
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
      {BOTTOM_NAV.map((n) => (
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
      {toast.kind === "ok" && <Mascot pose="wink" size={44} motion="celebrate" alt="Success" />}
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
          <div className="row" style={{ gap: 12 }}>
            <span>Floorpad · contract <span className="mono">{LAUNCHPAD}</span></span>
            <a href={X_URL} target="_blank" rel="noopener noreferrer" className="x-profile-link" aria-label="Floorpad on X">
              <XLogo size={13} />
              <span>@usefloorpad_</span>
            </a>
            <a href="/brand" className="link-chev">Brand kit</a>
          </div>
          <span>Floor backing is denominated in NEAR/LiNEAR; USD value fluctuates with market prices. Not financial advice.</span>
        </div>
      </footer>
      <BottomNav />
      <Toast />
      <MascotPreload />
    </WalletProvider>
  );
}
