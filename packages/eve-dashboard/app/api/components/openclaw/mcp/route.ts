/**
 * OpenClaw MCP servers — list + install preset.
 * Removal lives at /api/components/openclaw/mcp/[name].
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { listMcpServers, installMcpPreset, MCP_PRESETS } from "@/lib/openclaw-config";

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const servers = await listMcpServers();
  return NextResponse.json({
    servers,
    presets: Object.entries(MCP_PRESETS).map(([id, p]) => ({
      id,
      command: p.command,
      args: p.args,
      description: p.description,
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { preset?: string };
  if (!body.preset) {
    return NextResponse.json({ error: "`preset` is required." }, { status: 400 });
  }

  try {
    const server = await installMcpPreset(body.preset);
    return NextResponse.json({ server, restartNeeded: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't install preset" },
      { status: 400 },
    );
  }
}
