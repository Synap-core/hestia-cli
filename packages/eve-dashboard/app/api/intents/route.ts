import { NextResponse } from "next/server";
import {
  isValidEveBackgroundAction,
  listEveBackgroundActions,
  readEveSecrets,
  resolvePodUrl,
} from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

/**
 * Resolve the pod URL + Eve agent Hub key from disk.
 *
 * The dashboard mirrors the SDK's auth model: derive pod URL via
 * `resolvePodUrl()` (env var → loopback probe → Docker DNS → public domain)
 * and read `secrets.agents.eve.hubApiKey`. When either is missing we
 * surface a 503 — the dashboard is misconfigured, not the user's request.
 */
async function resolveAuth(): Promise<
  | { error: NextResponse }
  | { ok: true; podUrl: string; apiKey: string }
> {
  const secrets = await readEveSecrets();
  const podUrl = await resolvePodUrl();
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

// ---------------------------------------------------------------------------
// GET /api/intents — proxy list
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const resolved = await resolveAuth();
  if ("error" in resolved) return resolved.error;

  const incoming = new URL(req.url);
  const target = new URL(hubUrl(resolved.podUrl, "/background-tasks"));
  for (const key of ["status", "type", "workspaceId", "limit", "offset"]) {
    const v = incoming.searchParams.get(key);
    if (v !== null && v !== "") target.searchParams.set(key, v);
  }

  try {
    const res = await fetch(target.toString(), {
      method: "GET",
      headers: authHeaders(resolved.apiKey),
    });
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
// POST /api/intents — proxy create (with local action pre-flight)
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const resolved = await resolveAuth();
  if ("error" in resolved) return resolved.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { action?: unknown }).action !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing required field: action" },
      { status: 400 },
    );
  }
  const action = (body as { action: string }).action;
  if (!isValidEveBackgroundAction(action)) {
    return NextResponse.json(
      {
        error: `Unknown action "${action}"`,
        validActions: listEveBackgroundActions(),
      },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(hubUrl(resolved.podUrl, "/background-tasks"), {
      method: "POST",
      headers: {
        ...authHeaders(resolved.apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
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
