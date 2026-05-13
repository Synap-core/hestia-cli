/**
 * Per-component detail + actions.
 *
 * GET  → registry row + live `docker inspect` data + log tail
 * POST → { action: "restart" } runs `docker restart <containerName>`
 */

import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  COMPONENTS,
  resolveComponent,
  type ComponentInfo,
  entityStateManager,
  readEveSecrets,
} from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import {
  runAction,
  runActionToCompletion,
  type LifecycleAction,
  type LifecycleEvent,
} from "@eve/lifecycle";

const VALID_ACTIONS: ReadonlySet<LifecycleAction> = new Set([
  "install", "start", "stop", "restart", "recreate", "update", "remove",
]);

interface InspectInfo {
  id: string;
  image: string;
  status: "running" | "exited" | "restarting" | "paused" | "unknown";
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  restartCount: number;
}

const execFileAsync = promisify(execFile);

async function inspectContainer(name: string): Promise<InspectInfo | null> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["inspect", "--format", "{{json .}}", name],
      { encoding: "utf-8" },
    );
    const raw = stdout.trim();
    if (!raw) return null;
    const data = JSON.parse(raw) as {
      Id?: string;
      Image?: string;
      Config?: { Image?: string };
      State?: {
        Status?: string;
        ExitCode?: number;
        StartedAt?: string;
        FinishedAt?: string;
      };
      RestartCount?: number;
    };

    const statusRaw = data.State?.Status ?? "unknown";
    const status =
      statusRaw === "running" || statusRaw === "exited" ||
      statusRaw === "restarting" || statusRaw === "paused"
        ? statusRaw
        : "unknown";

    return {
      id: (data.Id ?? "").slice(0, 12),
      image: data.Config?.Image ?? data.Image ?? "(unknown)",
      status,
      exitCode: typeof data.State?.ExitCode === "number" ? data.State.ExitCode : null,
      startedAt: data.State?.StartedAt ?? null,
      finishedAt: data.State?.FinishedAt ?? null,
      restartCount: typeof data.RestartCount === "number" ? data.RestartCount : 0,
    };
  } catch {
    return null;
  }
}

async function readLogs(name: string, lines = 50): Promise<string | null> {
  try {
    // 2>&1 needs a shell, but we don't want the shell — call docker without
    // `2>&1` and let `execFile` capture stderr separately, then merge.
    const { stdout, stderr } = await execFileAsync(
      "docker",
      ["logs", "--tail", String(lines), name],
      { encoding: "utf-8", maxBuffer: 1024 * 1024 },
    );
    return [stdout, stderr].filter(Boolean).join("");
  } catch {
    return null;
  }
}

function findComponent(id: string): ComponentInfo | null {
  return COMPONENTS.find(c => c.id === id) ?? null;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  const component = findComponent(id);
  if (!component) {
    return NextResponse.json({ error: `Unknown component: ${id}` }, { status: 404 });
  }

  const secrets = await readEveSecrets();
  const domain = secrets?.domain?.primary;
  const ssl = secrets?.domain?.ssl !== false;
  const protocol = ssl ? "https" : "http";

  // State
  let installed = false;
  let recordedState: string | null = null;
  let recordedVersion: string | null = null;
  try {
    const state = await entityStateManager.getState();
    const installedSet = new Set(await entityStateManager.getInstalledComponents());
    installed = installedSet.has(id);
    const entry = (state?.installed ?? {})[id] as { state?: string; version?: string } | undefined;
    recordedState = entry?.state ?? null;
    recordedVersion = entry?.version ?? null;
  } catch {
    // No state yet
  }

  // Reverse deps
  const requiredBy = COMPONENTS
    .filter(c => (c.requires ?? []).includes(id))
    .map(c => ({ id: c.id, label: c.label }));

  const requires = (component.requires ?? []).map(reqId => {
    const req = COMPONENTS.find(c => c.id === reqId);
    return { id: reqId, label: req?.label ?? reqId };
  });

  // Live container info — only if a container is expected. Both calls are
  // independent and both spawn docker, so we run them in parallel.
  const containerName = component.service?.containerName ?? null;
  const [inspect, logs] = installed && containerName
    ? await Promise.all([
        inspectContainer(containerName),
        readLogs(containerName, 50),
      ])
    : [null, null];

  return NextResponse.json({
    id: component.id,
    label: component.label,
    emoji: component.emoji,
    description: component.description,
    longDescription: component.longDescription ?? null,
    homepage: component.homepage ?? null,
    category: component.category,
    organ: component.organ ?? null,
    alwaysInstall: !!component.alwaysInstall,
    requires,
    requiredBy,
    installed,
    recordedState,
    recordedVersion,
    container: containerName ? {
      name: containerName,
      internalPort: component.service?.internalPort ?? null,
      hostPort: component.service?.hostPort ?? null,
      subdomain: component.service?.subdomain ?? null,
      domainUrl: domain && component.service?.subdomain
        ? `${protocol}://${component.service.subdomain}.${domain}`
        : null,
      inspect,
    } : null,
    logs,
  });
}

/**
 * POST /api/components/[id]
 *
 * Body: { action: "start"|"stop"|"restart"|"update"|"remove" }
 * Query: ?stream=1 → returns SSE stream of LifecycleEvent JSON lines.
 * Otherwise → returns { ok, summary, logs, error? } once the action completes.
 */
export async function POST(req: Request, ctx: RouteContext) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;

  // Validate component up-front so we can return 404 with a clean error.
  try {
    resolveComponent(id);
  } catch {
    return NextResponse.json({ error: `Unknown component: ${id}` }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action as LifecycleAction | undefined;

  if (!action || !VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: `Unknown action: ${action ?? "(none)"}. Valid: ${[...VALID_ACTIONS].join(", ")}` },
      { status: 400 },
    );
  }

  const wantsStream = new URL(req.url).searchParams.get("stream") === "1";

  if (wantsStream) {
    return streamingResponse(id, action);
  }

  const result = await runActionToCompletion(id, action);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

/**
 * Render a LifecycleEvent generator as a Server-Sent Events stream.
 * Drawer subscribes via fetch streaming (not EventSource — POST + SSE).
 *
 * Cancellation: the client may abort mid-action (e.g. close the tab during
 * a 5-minute `docker compose pull`). When that happens the ReadableStream's
 * `cancel` fires; we set a flag the generator loop checks on every iteration
 * and stop pumping events. The underlying docker subprocess is *not* killed
 * — that would leave the host in a half-applied state. The generator
 * naturally completes when docker exits.
 */
function streamingResponse(id: string, action: LifecycleAction): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: LifecycleEvent) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`)); }
        catch { /* already closed */ }
      };

      // Long actions can run for minutes — keep SSE proxies awake.
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); }
        catch { if (heartbeat) clearInterval(heartbeat); }
      }, 25_000);

      try {
        for await (const ev of runAction(id, action)) {
          if (cancelled) break;
          send(ev);
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
        try { controller.enqueue(encoder.encode(`event: end\ndata: \n\n`)); }
        catch { /* already closed */ }
        try { controller.close(); } catch { /* already closed */ }
      }
    },

    cancel() {
      cancelled = true;
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
