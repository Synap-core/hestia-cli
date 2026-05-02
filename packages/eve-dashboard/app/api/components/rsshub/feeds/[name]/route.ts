/**
 * Remove a feed by name.
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { removeFeed } from "@/lib/feeds";

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const { name } = await ctx.params;
  const removed = await removeFeed(decodeURIComponent(name));

  if (!removed) {
    return NextResponse.json({ error: `Feed "${name}" not found` }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
