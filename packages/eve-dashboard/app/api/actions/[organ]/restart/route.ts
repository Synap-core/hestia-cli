import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireAuth } from "@/lib/auth-server";

const execFileAsync = promisify(execFile);

const VALID_ORGANS = new Set(["brain", "arms", "builder", "eyes", "legs"]);

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ organ: string }> },
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const { organ } = await params;

  if (!VALID_ORGANS.has(organ)) {
    return NextResponse.json({ error: "Unknown organ" }, { status: 400 });
  }

  try {
    // Find containers matching eve-<organ>-* and restart them
    const { stdout } = await execFileAsync("docker", [
      "ps", "-a", "--filter", `name=eve-${organ}`, "--format", "{{.Names}}",
    ]);

    const containers = stdout.trim().split("\n").filter(Boolean);

    if (containers.length === 0) {
      return NextResponse.json({ error: `No containers found for organ: ${organ}` }, { status: 404 });
    }

    await Promise.all(
      containers.map((name) => execFileAsync("docker", ["restart", name])),
    );

    return NextResponse.json({ ok: true, restarted: containers });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Restart failed" },
      { status: 500 },
    );
  }
}
