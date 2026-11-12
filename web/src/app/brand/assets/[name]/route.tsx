import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { kitAsset, KIT } from "@/lib/brand-kit";
import { loadMonoFonts } from "@/lib/og-theme";

export const runtime = "nodejs";

export function generateStaticParams() {
  return KIT.map((a) => ({ name: a.name }));
}

/**
 * GET /brand/assets/<name>          -> PNG preview
 * GET /brand/assets/<name>?download -> same PNG as a file download (floorpad-<name>.png)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const asset = kitAsset(name.replace(/\.png$/, ""));
  if (!asset) return new Response("unknown asset", { status: 404 });

  const fonts = await loadMonoFonts();
  const img = new ImageResponse(asset.render(), {
    width: asset.w,
    height: asset.h,
    fonts: fonts.length ? fonts : undefined,
  });
  const headers = new Headers(img.headers);
  headers.set("cache-control", "public, max-age=3600, s-maxage=86400");
  if (new URL(req.url).searchParams.has("download")) {
    headers.set("content-disposition", `attachment; filename="floorpad-${asset.name}.png"`);
  }
  return new Response(img.body, { status: 200, headers });
}
