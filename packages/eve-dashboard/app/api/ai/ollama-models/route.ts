/**
 * Discover models available from a local Ollama instance.
 *
 * GET /api/ai/ollama-models?url=http://localhost:11434
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";

export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const baseUrl = (searchParams.get("url") ?? "http://localhost:11434").replace(/\/$/, "");

  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Ollama returned ${res.status}` }, { status: 502 });
    }
    const data = await res.json() as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => m.name);
    return NextResponse.json({ models, baseUrl });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Connection failed" },
      { status: 502 },
    );
  }
}
