/**
 * Per-component detail + actions.
 *
 * GET  → registry row + live `docker inspect` data + log tail
 * POST → { action: "restart" } runs `docker restart <containerName>`
 */

import { NextResponse } from "next/server";
import { execSync, spawnSync } from "node:child_process";
import {
  COMPONENTS,
  resolveComponent,
  type ComponentInfo,
  entityStateManager,
  readEveSecrets,
} from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

interface InspectInfo {
  id: string;
  image: string;
  status: "running" | "exited" | "restarting" | "paused" | "unknown";
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  restartCount: number;
}

function inspectContainer(name: string): InspectInfo | null {
  try {
    const raw = execSync(
      `docker inspect --format '{{json .}}' ${name}`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] },
    ).trim();
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

function readLogs(name: string, lines = 50): string | null {
  try {
    return execSync(
      `docker logs --tail ${lines} ${name} 2>&1`,
      { encoding: "utf-8", maxBuffer: 1024 * 1024 },
    );
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
  const ssl = !!secrets?.domain?.ssl;
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

  // Live container info — only if a container is expected.
  const containerName = component.service?.containerName ?? null;
  const inspect = installed && containerName ? inspectContainer(containerName) : null;
  const logs = installed && containerName ? readLogs(containerName, 50) : null;

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

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;

  let component: ComponentInfo;
  try {
    component = resolveComponent(id);
  } catch {
    return NextResponse.json({ error: `Unknown component: ${id}` }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string };

  if (body.action === "restart") {
    if (!component.service?.containerName) {
      return NextResponse.json(
        { error: `${component.label} doesn't have a container to restart` },
        { status: 400 },
      );
    }
    const r = spawnSync("docker", ["restart", component.service.containerName], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
    });
    if (r.status !== 0) {
      return NextResponse.json(
        { error: `docker restart exited ${r.status}: ${r.stderr ?? r.stdout}` },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, container: component.service.containerName });
  }

  return NextResponse.json({ error: `Unknown action: ${body.action ?? "(none)"}` }, { status: 400 });
}
