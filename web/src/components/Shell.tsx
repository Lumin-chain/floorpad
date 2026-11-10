"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { WalletProvider, useWallet } from "@/lib/wallet";
import { useEffect } from "react";
import { captureReferrer, LAUNCHPAD, NETWORK } from "@/lib/near";

const NAV = [
  { href: "/", label: "Explore", icon: "M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" },
  { href: "/calls", label: "Calls", icon: "M3 10v4a1 1 0 0 0 1 1h3l5 4V5L7 9H4a1 1 0 0 0-1 1zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" },
  { href: "/create", label: "Launch", icon: "M12 5v14M5 12h14", plus: true },
  { href: "/portfolio", label: "Portfolio", icon: "M4 7h16v12H4zM8 7V5h8v2" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function Header() {
  const { accountId, signIn, signOut, ready } = useWallet();
  const path = usePathname();
  return (
    <header className="header">
      <div className="container wide">
        <Link href="/" className="brand">
          <span className="brand-mark" /> Floorpad
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
          <button className="btn sm account-btn" onClick={signOut} title="Sign out">
            {accountId}
          </button>
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
          <span className="bn-icon"><Icon d={n.icon} /></span>
          <span>{n.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function Toast() {
  const { toast } = useWallet();
  if (!toast) return null;
  return <div className={`toast ${toast.kind}`}>{toast.text}</div>;
}

export function Shell({ children }: { children: ReactNode }) {
  useEffect(() => captureReferrer(), []);
  return (
    <WalletProvider>
      <Header />
      <main className="container wide main">{children}</main>
      <footer className="footer desktop-only">
        <div className="container wide row between wrap">
          <span>Floorpad · contract <span className="mono">{LAUNCHPAD}</span></span>
          <span>Not financial advice. Meme tokens are volatile; the floor limits, but does not remove, risk.</span>
        </div>
      </footer>
      <BottomNav />
      <Toast />
    </WalletProvider>
  );
}
