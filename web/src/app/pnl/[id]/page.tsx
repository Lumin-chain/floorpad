import type { Metadata } from "next";
import Link from "next/link";
import { SlabIcon } from "@/components/Brand";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    symbol?: string;
    pnl?: string;
    floor?: string;
    usd?: string;
    account?: string;
    ref?: string;
  }>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const sp = await searchParams;
  const symbol = sp.symbol || "TOKEN";
  const pnl = sp.pnl || "100";
  const floor = sp.floor || "10.0";
  const usd = sp.usd || "36.0";
  const account = sp.account || "trader.near";

  const ogUrl = `/api/og/pnl?symbol=${encodeURIComponent(symbol)}&pnl=${encodeURIComponent(pnl)}&floor=${encodeURIComponent(floor)}&usd=${encodeURIComponent(usd)}&account=${encodeURIComponent(account)}`;

  const title = `Up +${pnl}% on $${symbol} | Floorpad`;
  const description = `The memecoin with a strictly rising floor vault and locked Ref LP. Guaranteed floor backing: ${floor} NEAR.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogUrl, width: 1200, height: 630, alt: `${symbol} PNL Card` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}

export default async function PnlSharePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const symbol = sp.symbol || id.split(".")[0]?.toUpperCase() || "TOKEN";
  const pnl = sp.pnl || "100";
  const floor = sp.floor || "10.0";
  const usd = sp.usd || "36.0";
  const account = sp.account || "trader.near";
  const ref = sp.ref ? `?ref=${sp.ref}` : "";

  const isProfit = !pnl.startsWith("-");

  return (
    <div className="section stack" style={{ maxWidth: 800, margin: "40px auto", padding: "0 16px" }}>
      <div 
        className="panel stack" 
        style={{ 
          background: "linear-gradient(180deg, #0d1315 0%, #050708 100%)", 
          border: "1px solid rgba(46, 213, 115, 0.4)",
          borderRadius: 20,
          padding: 32,
          boxShadow: "0 20px 50px rgba(0,0,0,0.8), 0 0 40px rgba(46, 213, 115, 0.15)"
        }}
      >
        <div className="row between wrap">
          <div>
            <span className="small muted" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Floorpad Verified Return
            </span>
            <h1 style={{ margin: "4px 0 0", fontSize: 42 }}>
              ${symbol}
            </h1>
          </div>
          <div 
            style={{ 
              background: "rgba(46, 213, 115, 0.15)", 
              border: "1px solid rgba(46, 213, 115, 0.5)", 
              color: "#2ed573", 
              padding: "6px 16px", 
              borderRadius: 20, 
              fontWeight: 700 
            }}
          >
            ▲ RISING FLOOR VAULT
          </div>
        </div>

        <div style={{ margin: "24px 0" }}>
          <div 
            style={{ 
              fontSize: 72, 
              fontWeight: 900, 
              color: isProfit ? "#2ed573" : "#ff4757", 
              lineHeight: 1 
            }}
          >
            {isProfit ? `+${pnl}%` : `${pnl}%`}
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            Trader <span className="mono green">{account}</span> on NEAR Protocol
          </p>
        </div>

        <div className="grid two" style={{ gap: 16 }}>
          <div className="panel tight" style={{ background: "rgba(255,255,255,0.02)" }}>
            <span className="small muted">Current Position Value</span>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
              ${usd} USD
            </div>
          </div>
          <div className="panel tight" style={{ background: "rgba(255,255,255,0.02)" }}>
            <span className="small muted">Guaranteed Floor Backing</span>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#2ed573", marginTop: 4 }}>
              {floor} NEAR
            </div>
          </div>
        </div>

        <div style={{ marginTop: 24 }} className="row between wrap">
          <Link href={`/token/${id}${ref}`} className="btn primary block" style={{ fontSize: 18, padding: "14px 28px" }}>
            Trade ${symbol} on Floorpad <SlabIcon name="chevron" size={14} />
          </Link>
          <Link href="/" className="btn ghost" style={{ marginTop: 8 }}>
            Explore all fair launches
          </Link>
        </div>
      </div>
    </div>
  );
}
