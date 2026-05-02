/**
 * Hermes daemon settings — `builder.hermes` block in secrets.json.
 *
 * Hermes itself is a CLI process, not a container, so this endpoint only
 * manages the *settings* the daemon reads at boot. The user starts/stops
 * the daemon via `eve builder hermes start/stop` on the host.
 */

import { NextResponse } from "next/server";
import { readEveSecrets, writeEveSecrets } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

interface HermesConfig {
  enabled: boolean;
  pollIntervalMs: number;
  maxConcurrentTasks: number;
}

const DEFAULTS: HermesConfig = {
  enabled: false,
  pollIntervalMs: 30_000,
  maxConcurrentTasks: 1,
};

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const s = await readEveSecrets();
  const cfg = s?.builder?.hermes;
  return NextResponse.json({
    enabled: cfg?.enabled ?? DEFAULTS.enabled,
    pollIntervalMs: cfg?.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
    maxConcurrentTasks: cfg?.maxConcurrentTasks ?? DEFAULTS.maxConcurrentTasks,
  } satisfies HermesConfig);
}

export async function PUT(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as Partial<HermesConfig>;

  await writeEveSecrets({
    builder: {
      hermes: {
        enabled: Boolean(body.enabled),
        pollIntervalMs: clampInt(body.pollIntervalMs, DEFAULTS.pollIntervalMs, 1_000, 3_600_000),
        maxConcurrentTasks: clampInt(body.maxConcurrentTasks, DEFAULTS.maxConcurrentTasks, 1, 16),
      },
    },
  });

  return GET();
}

function clampInt(raw: unknown, def: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
