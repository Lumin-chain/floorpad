import type { Metadata } from "next";
import { headers } from "next/headers";
import { isValidNearAccount } from "@/lib/near";
import { PnlClientView } from "./PnlClientView";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    symbol?: string;
    name?: string;
    pnl?: string;
    floor?: string;
    usd?: string;
    entry?: string;
    price?: string;
    account?: string;
    ref?: string;
    hideNetworth?: string;
  }>;
}

async function fetchTokenMeta(tokenId: string) {
  if (!isValidNearAccount(tokenId)) return null;
  try {
    const rpc = process.env.NEXT_PUBLIC_RPC || "https://rpc.testnet.fastnear.com";
    const launchpad = process.env.NEXT_PUBLIC_LAUNCHPAD || "fplpmwbbcg00.testnet";
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "query",
        params: {
          request_type: "call_function",
          finality: "optimistic",
          account_id: launchpad,
          method_name: "get_token",
          args_base64: Buffer.from(JSON.stringify({ token_id: tokenId })).toString("base64"),
        },
      }),
      next: { revalidate: 60 },
    });
    const j = await res.json();
    if (j.result?.result) {
      return JSON.parse(Buffer.from(j.result.result).toString()) as {
        meta?: { name?: string; symbol?: string; icon?: string | null };
      };
    }
  } catch {
    return null;
  }
  return null;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const sp = await searchParams;
  const tok = await fetchTokenMeta(id);
  const symbol = sp.symbol || tok?.meta?.symbol || id.split(".")[0]?.toUpperCase() || "TOKEN";
  const name = sp.name || tok?.meta?.name || symbol;
  const pnl = sp.pnl || "100";
  const floor = sp.floor || "10.0";
  const usd = sp.usd || "36.0";
  const entry = sp.entry || "";
  const price = sp.price || "";
  const account = sp.account || "trader.near";
  const hideNetworth = sp.hideNetworth === "1" || sp.hideNetworth === "true";

  const hdrs = await headers();
  const rawHost = hdrs.get("host") || hdrs.get("x-forwarded-host") || "";
  const safeHost = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(rawHost) ? rawHost : "";
  const rawProto = hdrs.get("x-forwarded-proto");
  const proto = rawProto === "http" ? "http" : "https";
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : safeHost ? `${proto}://${safeHost}` : "");

  const safeSymbol = symbol.slice(0, 12);
  const safeName = name.slice(0, 40);
  const safeAccount = account.slice(0, 64);

  const ogPath = `/api/og/pnl?token=${encodeURIComponent(id)}&symbol=${encodeURIComponent(safeSymbol)}&name=${encodeURIComponent(safeName)}&pnl=${encodeURIComponent(pnl)}&floor=${encodeURIComponent(floor)}&usd=${encodeURIComponent(usd)}&entry=${encodeURIComponent(entry)}&price=${encodeURIComponent(price)}&account=${encodeURIComponent(safeAccount)}${hideNetworth ? "&hideNetworth=1" : ""}`;
  const ogUrl = origin ? `${origin}${ogPath}` : ogPath;

  const isProfit = !pnl.startsWith("-");
  const title = isProfit ? `Up +${pnl}% on $${safeSymbol} | Floorpad` : `Holding $${safeSymbol} (${pnl}%) | Floorpad`;
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
  const tok = await fetchTokenMeta(id);

  const safeFinite = (v: string | undefined, fb: number) => {
    const n = v !== undefined ? Number(v) : fb;
    return Number.isFinite(n) ? n : fb;
  };
  const symbol = (sp.symbol || tok?.meta?.symbol || id.split(".")[0]?.toUpperCase() || "TOKEN").slice(0, 12);
  const name = (sp.name || tok?.meta?.name || symbol).slice(0, 40);
  const icon = tok?.meta?.icon || null;
  const pnlNum = safeFinite(sp.pnl, 100);
  const floorNum = Math.max(0, safeFinite(sp.floor, 10));
  const usdNum = Math.max(0, safeFinite(sp.usd, 36));
  const entryPriceNum = sp.entry !== undefined && Number.isFinite(Number(sp.entry)) ? Number(sp.entry) : undefined;
  const currentPriceNum = sp.price !== undefined && Number.isFinite(Number(sp.price)) ? Number(sp.price) : undefined;
  const account = (sp.account || "trader.near").slice(0, 64);
  const refParam = isValidNearAccount(sp.ref) ? `?ref=${encodeURIComponent(sp.ref)}` : "";
  const initialHideNetworth = sp.hideNetworth === "1" || sp.hideNetworth === "true";

  return (
    <PnlClientView
      id={id}
      symbol={symbol}
      name={name}
      icon={icon}
      pnl={pnlNum}
      floorNear={floorNum}
      usdVal={usdNum}
      entryPrice={entryPriceNum}
      currentPrice={currentPriceNum}
      account={account}
      refParam={refParam}
      initialHideNetworth={initialHideNetworth}
    />
  );
}
