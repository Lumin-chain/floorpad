import type { Metadata } from "next";
import type { ReactNode } from "react";

const NEAR_ACCOUNT_RE = /^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$/;

async function fetchSymbol(tokenId: string): Promise<{ name?: string; symbol?: string; description?: string } | null> {
  if (!tokenId || tokenId.length > 64 || !NEAR_ACCOUNT_RE.test(tokenId)) return null;
  try {
    const rpc = process.env.NEXT_PUBLIC_RPC || "https://rpc.testnet.fastnear.com";
    const launchpad = process.env.NEXT_PUBLIC_LAUNCHPAD || "lpv45w4s.fpbankmwbbc95z.testnet";
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
      signal: AbortSignal.timeout(2000),
    });
    const j = await res.json();
    if (j.result?.result) {
      const parsed = JSON.parse(Buffer.from(j.result.result).toString("utf8"));
      return parsed?.meta ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const meta = await fetchSymbol(id);
  const sym = meta?.symbol || id.split(".")[0]?.toUpperCase() || "TOKEN";
  return {
    title: `$${sym}`,
    description: meta?.description || `Trade $${sym} (${meta?.name || sym}) on Floorpad with a redeemable NEAR floor.`,
  };
}

export default function TokenLayout({ children }: { children: ReactNode }) {
  return children;
}

