/**
 * `POST /api/agents/test-event` — synthesizes a single, well-formed
 * agent event so operators can verify the graph + feed pipeline before
 * any real channel is connected.
 *
 * The event is NOT broadcast through the pod — it is returned to the
 * caller and appended to the local realtime buffer client-side. That
 * keeps the endpoint side-effect-free and means hitting it from curl
 * or a test script is harmless. The shape exactly matches the typed
 * Socket.IO payloads emitted by `synap-backend/packages/realtime` so
 * any rendering branch downstream (graph lane, feed row, side panel
 * activity list) lights up identically to a production event.
 *
 *   curl -X POST http://localhost:3000/api/agents/test-event \
 *     -H "Cookie: $cookie" \
 *     -d '{"name":"hermes:task:failed"}'
 *
 * Optional body: `{ name: EventName }` to pin the event name. Omitted
 * → server picks one at random from the canonical 6.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx §M5
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";

type EventName =
  | "openclaw:message:received"
  | "synap:reply:routed"
  | "hermes:task:queued"
  | "hermes:task:started"
  | "hermes:task:completed"
  | "hermes:task:failed";

const EVENT_NAMES: readonly EventName[] = [
  "openclaw:message:received",
  "synap:reply:routed",
  "hermes:task:queued",
  "hermes:task:started",
  "hermes:task:completed",
  "hermes:task:failed",
] as const;

const SAMPLE_EXCERPTS = [
  "Quick check-in — anything new?",
  "Schedule prep for tomorrow",
  "Found a new lead worth a look",
  "Ack — done.",
  "Reading list for the weekend",
];

const SAMPLE_KINDS = ["scrape", "embed", "summarize", "classify", "enrich"];
const SAMPLE_PLATFORMS = ["telegram", "discord", "whatsapp"] as const;

function pickOne<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function syntheticPayload(name: EventName): unknown {
  const now = new Date().toISOString();
  const tag = `synth-${Math.random().toString(36).slice(2, 8)}`;

  switch (name) {
    case "openclaw:message:received":
      return {
        channelId: `ch:${tag}`,
        messageId: `msg:${tag}`,
        platform: pickOne(SAMPLE_PLATFORMS),
        excerpt: pickOne(SAMPLE_EXCERPTS),
        receivedAt: now,
      };
    case "synap:reply:routed":
      return {
        channelId: `ch:${tag}`,
        messageId: `msg:${tag}`,
        targetPlatform: pickOne(SAMPLE_PLATFORMS),
        excerpt: pickOne(SAMPLE_EXCERPTS),
        routedAt: now,
      };
    case "hermes:task:queued":
      return {
        taskId: `task:${tag}`,
        kind: pickOne(SAMPLE_KINDS),
        source: "synthetic",
        queuedAt: now,
      };
    case "hermes:task:started":
      return {
        taskId: `task:${tag}`,
        kind: pickOne(SAMPLE_KINDS),
        startedAt: now,
      };
    case "hermes:task:completed":
      return {
        taskId: `task:${tag}`,
        durationMs: Math.floor(200 + Math.random() * 4800),
        completedAt: now,
      };
    case "hermes:task:failed":
      return {
        taskId: `task:${tag}`,
        error: "Simulated failure for UI verification",
        failedAt: now,
      };
  }
}

function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && (EVENT_NAMES as readonly string[]).includes(value);
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  let requestedName: EventName | null = null;
  try {
    const body = (await request.json()) as { name?: unknown };
    if (isEventName(body?.name)) requestedName = body.name;
  } catch {
    // Body is optional. A malformed body still produces a random event.
  }

  const name = requestedName ?? pickOne(EVENT_NAMES);
  const payload = syntheticPayload(name);

  return NextResponse.json({
    name,
    payload,
    synthetic: true,
  });
}
