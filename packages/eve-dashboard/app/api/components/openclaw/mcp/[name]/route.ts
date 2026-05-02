import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { removeMcpServer } from "@/lib/openclaw-config";

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const { name: rawName } = await ctx.params;

  // Validate the *decoded* value — `decodeURIComponent("foo%2Fbar") === "foo/bar"`,
  // and `removeMcpServer` will then reject it via its internal regex. We do
  // the same check up front so a malformed URL fails with 400 (not 500).
  let name: string;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    return NextResponse.json({ error: "Invalid URL encoding" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return NextResponse.json({ error: `Invalid MCP server name: ${name}` }, { status: 400 });
  }

  try {
    await removeMcpServer(name);
    return NextResponse.json({ ok: true, restartNeeded: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't remove MCP server" },
      { status: 400 },
    );
  }
}
