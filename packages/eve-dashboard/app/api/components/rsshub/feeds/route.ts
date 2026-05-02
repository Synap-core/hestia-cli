/**
 * RSSHub feeds — list / add.
 * Removal lives at /api/components/rsshub/feeds/[name].
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { readFeeds, addFeed } from "@/lib/feeds";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const feeds = await readFeeds();
  return NextResponse.json({ feeds });
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { name?: string; url?: string };
  if (!body.name || !body.url) {
    return NextResponse.json(
      { error: "Both `name` and `url` are required." },
      { status: 400 },
    );
  }

  try {
    const feed = await addFeed({ name: body.name, url: body.url });
    return NextResponse.json({ feed }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to add feed" },
      { status: 400 },
    );
  }
}
