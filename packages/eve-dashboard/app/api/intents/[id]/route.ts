import { NextResponse } from "next/server";
import {
  isValidEveBackgroundAction,
  listEveBackgroundActions,
  readEveSecrets,
  resolveSynapUrl,
} from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

async function resolveAuth(): Promise<
  | { error: NextResponse }
  | { ok: true; podUrl: string; apiKey: string }
> {
  const secrets = await readEveSecrets();
  const podUrl = resolveSynapUrl(secrets);
  const apiKey = secrets?.agents?.eve?.hubApiKey?.trim();
  if (!podUrl) {
    return {
      error: NextResponse.json(
        { error: "Eve pod URL unresolved — set domain.primary in secrets.json" },
        { status: 503 },
      ),
    };
  }
  if (!apiKey) {
    return {
      error: NextResponse.json(
        { error: "Eve agent key missing (run `eve auth provision --agent eve`)" },
        { status: 503 },
      ),
    };
  }
  return { ok: true, podUrl, apiKey };
}

function hubUrl(podUrl: string, path: string): string {
  return `${podUrl.replace(/\/+$/, "")}/api/hub${path.startsWith("/") ? path : `/${path}`}`;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
}

async function passThroughJson(res: Response): Promise<NextResponse> {
  const text = await res.text();
  let payload: unknown = text;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      /* leave as text */
    }
  }
  return NextResponse.json(payload ?? null, { status: res.status });
}

// Next.js 16: dynamic route params are async.
type RouteContext = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// GET /api/intents/[id]
// ---------------------------------------------------------------------------

export async function GET(_req: Request, ctx: RouteContext) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const resolved = await resolveAuth();
  if ("error" in resolved) return resolved.error;

  const { id } = await ctx.params;
  try {
    const res = await fetch(
      hubUrl(resolved.podUrl, `/background-tasks/${encodeURIComponent(id)}`),
      { method: "GET", headers: authHeaders(resolved.apiKey) },
    );
    return passThroughJson(res);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Could not reach pod — ${err instanceof Error ? err.message : "network error"}`,
      },
      { status: 502 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/intents/[id]
// ---------------------------------------------------------------------------

export async function PATCH(req: Request, ctx: RouteContext) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const resolved = await resolveAuth();
  if ("error" in resolved) return resolved.error;

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body === "object" && body !== null) {
    const action = (body as { action?: unknown }).action;
    if (typeof action === "string" && !isValidEveBackgroundAction(action)) {
      return NextResponse.json(
        {
          error: `Unknown action "${action}"`,
          validActions: listEveBackgroundActions(),
        },
        { status: 400 },
      );
    }
  }

  try {
    const res = await fetch(
      hubUrl(resolved.podUrl, `/background-tasks/${encodeURIComponent(id)}`),
      {
        method: "PATCH",
        headers: {
          ...authHeaders(resolved.apiKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    return passThroughJson(res);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Could not reach pod — ${err instanceof Error ? err.message : "network error"}`,
      },
      { status: 502 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/intents/[id]
// ---------------------------------------------------------------------------

export async function DELETE(_req: Request, ctx: RouteContext) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const resolved = await resolveAuth();
  if ("error" in resolved) return resolved.error;

  const { id } = await ctx.params;
  try {
    const res = await fetch(
      hubUrl(resolved.podUrl, `/background-tasks/${encodeURIComponent(id)}`),
      { method: "DELETE", headers: authHeaders(resolved.apiKey) },
    );
    return passThroughJson(res);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Could not reach pod — ${err instanceof Error ? err.message : "network error"}`,
      },
      { status: 502 },
    );
  }
}
