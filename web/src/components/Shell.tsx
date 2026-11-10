"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { WalletProvider, useWallet } from "@/lib/wallet";
import { LAUNCHPAD, NETWORK } from "@/lib/near";

function Header() {
  const { accountId, signIn, signOut, ready } = useWallet();
  const path = usePathname();
  const nav = [
    { href: "/", label: "Explore" },
    { href: "/create", label: "Launch" },
    { href: "/portfolio", label: "Portfolio" },
  ];
  return (
    <header className="header">
      <div className="container">
        <Link href="/" className="brand">
          <span className="brand-mark" /> Floorpad
        </Link>
        <nav className="nav">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={path === n.href ? "active" : ""}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="spacer" />
        <span className="badge">{NETWORK}</span>
        {accountId ? (
          <button className="btn sm" onClick={signOut} title="Sign out">
            {accountId}
          </button>
        ) : (
          <button className="btn primary sm" onClick={signIn} disabled={!ready}>
            Connect wallet
          </button>
        )}
      </div>
    </header>
  );
}

function Toast() {
  const { toast } = useWallet();
  if (!toast) return null;
  return <div className={`toast ${toast.kind}`}>{toast.text}</div>;
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <Header />
      <main className="container">{children}</main>
      <footer className="footer">
        <div className="container row between wrap">
          <span>Floorpad · contract <span className="mono">{LAUNCHPAD}</span></span>
          <span>Not financial advice. Meme tokens are volatile; the floor limits, but does not remove, risk.</span>
        </div>
      </footer>
      <Toast />
    </WalletProvider>
  );
}
