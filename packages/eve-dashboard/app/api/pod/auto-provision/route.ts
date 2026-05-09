/**
 * POST /api/pod/auto-provision
 *
 * Provisions per-agent Hub Protocol keys for every component that is
 * currently running on the pod, then re-wires AI config for consumers
 * that were missing their key.
 *
 * Why this exists: the bootstrap-claim and CP-claim flows create a
 * user session on the pod but do NOT run `provisionAllAgents()` —
 * that only fires during `eve install`. Operators who set up via
 * dashboard (or who had a legacy single-key install) find their AI
 * consumers (OpenWebUI, OpenClaw, Hermes) unable to connect.
 *
 * This endpoint bridges the gap: it probes `docker ps` to discover
 * running components, calls `provisionAllAgents()` with the discovered
 * set, and re-wires any AI consumer whose key was just minted.
 *
 * Query/body params:
 *   - `force?: boolean` — when true, re-provisions agents that already
 *     have keys. When false, skips existing keys.
 *   - `componentId?: string` — when provided, only provisions that
 *     single component (overrides force logic).
 *
 * Returns:
 *   200 `{ ok: true, provisioned: AgentResult[], wired: WireResult[] }`
 *   500 `{ error: "provision_failed", message }`
 */

import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  AGENTS,
  COMPONENTS,
  readEveSecrets,
  writeEveSecrets,
  wireAllInstalledComponents,
  resolvePodUrl,
  type WiringStatus,
} from "@eve/dna";
import {
  provisionAllAgents,
  resolveProvisioningToken,
  FetchRunner,
  type ProvisionResult,
} from "@eve/lifecycle";

const execFileAsync = promisify(execFile);

interface AgentResult {
  id: string;
  provisioned: boolean;
  keyIdPrefix?: string;
  reason?: string;
}

interface WireResult {
  id: string;
  ok: boolean;
  summary: string;
}

/**
 * Resolve which components are currently running by probing `docker ps`.
 * Returns the component IDs for components that have a known containerName.
 */
async function discoverRunningComponents(): Promise<string[]> {
  try {
    const result = await execFileAsync("docker", ["ps", "--format", "{{.Names}}"], {
      timeout: 4000,
    });
    const running = new Set<string>(
      result.stdout.trim().split("\n").filter(Boolean).map(s => s.trim()),
    );

    const matching: string[] = [];
    for (const comp of COMPONENTS) {
      const name = comp.service?.containerName;
      if (name && running.has(name)) {
        matching.push(comp.id);
      }
    }
    return matching;
  } catch {
    // docker unavailable or timed out — return minimal set
    return ["synap"];
  }
}

/** Max retry attempts for provisionAllAgents (gap 13). */
const MAX_RETRIES = 3;
/** Base delay in ms for exponential backoff. */
const RETRY_DELAY_MS = 1000;

/**
 * Run provisionAllAgents with retry + exponential backoff.
 * Gap 13: auto-provision had zero retry — fire-and-forget with no
 * recovery. Now we try 3 times with increasing delays.
 */
async function provisionWithRetry(
  params: Parameters<typeof provisionAllAgents>[0],
): Promise<ProvisionResult[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await provisionAllAgents(params);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * (2 ** (attempt - 1));
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

/**
 * Persist wiring status to secrets.ai.wiringStatus (gap 12).
 * The schema already has this field — we just need to write to it.
 */
async function persistWiringStatus(
  wiringResults: { id: string; outcome: string }[],
): Promise<void> {
  try {
    const current = await readEveSecrets();
    const existingStatus = (current?.ai?.wiringStatus ?? {}) as WiringStatus;
    const nextStatus: WiringStatus = { ...existingStatus };
    for (const r of wiringResults) {
      nextStatus[r.id] = {
        lastApplied: new Date().toISOString(),
        outcome: r.outcome,
      };
    }
    await writeEveSecrets({ ai: { wiringStatus: nextStatus } });
  } catch {
    /* non-critical — wiring already succeeded even if we can't persist */
  }
}

/**
 * Persist provisioning result to history in secrets.ai (gap 15).
 * Keeps last 50 entries so the array stays bounded.
 */
async function persistProvisioningHistory(
  provisioned: AgentResult[],
  wired: WireResult[],
  force: boolean,
): Promise<void> {
  try {
    const current = await readEveSecrets();
    const existingHistory = (current?.ai?.provisioningHistory ?? []) as Array<{
      timestamp: string;
      provisioned: AgentResult[];
      wired: WireResult[];
      force: boolean;
    }>;
    const nextHistory = [
      {
        timestamp: new Date().toISOString(),
        provisioned,
        wired,
        force,
      },
      ...existingHistory,
    ].slice(0, 50);
    await writeEveSecrets({ ai: { provisioningHistory: nextHistory } });
  } catch {
    /* non-critical */
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { force?: boolean; componentId?: string }
    | null;
  const force = body?.force === true;

  // Read secrets first — needed for URL resolution and wire results
  const secrets = await readEveSecrets();

  // Resolve running components
  const runningComponents = await discoverRunningComponents();

  // Gap 14: Per-component provisioning. When componentId is provided,
  // only provision that single agent (e.g. "provision Claude Desktop now").
  if (body?.componentId) {
    const comp = COMPONENTS.find(c => c.id === body.componentId);
    if (comp) {
      const targetedComponents = runningComponents.filter(c => c === body.componentId);
      if (targetedComponents.length === 0) {
        // Component not running — still try to provision if it has a known agentType.
        const agentForComp = AGENTS.find(a => a.componentId === body.componentId);
        if (agentForComp) {
          const runner = new FetchRunner();
          const podUrl = await resolvePodUrl(undefined, req.url, req.headers) ?? undefined;
          const provisioningToken = resolveProvisioningToken() ?? undefined;
          try {
            const results: ProvisionResult[] = await provisionWithRetry({
              installedComponentIds: [body.componentId],
              reason: "auto-provision:dashboard-api:component",
              runner,
              synapUrl: podUrl,
              provisioningToken,
              skipIfPresent: !force,
            });
            const provisioned = results.map(r => {
              if (r.provisioned) {
                return {
                  id: r.agentType,
                  provisioned: true,
                  keyIdPrefix: r.keyIdPrefix,
                };
              }
              return { id: r.agentType, provisioned: false, reason: r.reason };
            });
            const wired = wireAllInstalledComponents(secrets, [body.componentId])
              .map(w => ({ id: w.id, ok: w.outcome === "ok", summary: w.summary }));
            // Persist history (gap 15)
            void persistProvisioningHistory(provisioned, wired, force);
            return NextResponse.json({ ok: true, provisioned, wired });
          } catch (err) {
            return NextResponse.json(
              {
                error: "provision_failed",
                message: err instanceof Error ? err.message : String(err),
              },
              { status: 500 },
            );
          }
        }
        return NextResponse.json(
          { error: "component_not_running", componentId: body.componentId },
          { status: 400 },
        );
      }
      // Run targeted provision
      const runner = new FetchRunner();
      const podUrl = await resolvePodUrl(undefined, req.url, req.headers) ?? undefined;
      const provisioningToken = resolveProvisioningToken() ?? undefined;
      let provisioned: AgentResult[];
      try {
        const results: ProvisionResult[] = await provisionWithRetry({
          installedComponentIds: targetedComponents,
          reason: "auto-provision:dashboard-api:component",
          runner,
          synapUrl: podUrl,
          provisioningToken,
          skipIfPresent: !force,
        });
        provisioned = results.map(r => {
          if (r.provisioned) {
            return {
              id: r.agentType,
              provisioned: true,
              keyIdPrefix: r.keyIdPrefix,
            };
          }
          return { id: r.agentType, provisioned: false, reason: r.reason };
        });
      } catch (err) {
        return NextResponse.json(
          {
            error: "provision_failed",
            message: err instanceof Error ? err.message : String(err),
          },
          { status: 500 },
        );
      }
      const wired = wireAllInstalledComponents(secrets, targetedComponents)
        .map(w => ({ id: w.id, ok: w.outcome === "ok", summary: w.summary }));
      // Persist wiring status (gap 12)
      void persistWiringStatus(wired.map(w => ({ id: w.id, outcome: w.ok ? "ok" : "failed" })));
      // Persist history (gap 15)
      void persistProvisioningHistory(provisioned, wired, force);
      return NextResponse.json({ ok: true, provisioned, wired });
    }
    return NextResponse.json(
      { error: "unknown_component", componentId: body.componentId },
      { status: 400 },
    );
  }

  // Full auto-provision path
  const podUrl = await resolvePodUrl(undefined, req.url, req.headers) ?? undefined;
  const provisioningToken = resolveProvisioningToken() ?? undefined;
  const runner = new FetchRunner();

  let provisioned: AgentResult[];
  try {
    const results: ProvisionResult[] = await provisionWithRetry({
      installedComponentIds: runningComponents,
      reason: "auto-provision:dashboard-api",
      runner,
      synapUrl: podUrl,
      provisioningToken,
      skipIfPresent: !force,
    });
    provisioned = results.map(r => {
      if (r.provisioned) {
        return {
          id: r.agentType,
          provisioned: true,
          keyIdPrefix: r.keyIdPrefix,
        };
      }
      return { id: r.agentType, provisioned: false, reason: r.reason };
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "provision_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  // Re-wire AI consumers. Use the secrets blob (keys were just written
  // by provisionAllAgents on disk, so secrets read earlier won't have
  // them — but wireAllInstalledComponents reads from the secrets file
  // internally, so it picks up the newly minted keys).
  const wired = wireAllInstalledComponents(secrets, runningComponents)
    .map(w => ({ id: w.id, ok: w.outcome === "ok", summary: w.summary }));

  // Persist wiring status (gap 12) — fire-and-forget
  void persistWiringStatus(wired.map(w => ({ id: w.id, outcome: w.ok ? "ok" : "failed" })));
  // Persist provisioning history (gap 15) — fire-and-forget
  void persistProvisioningHistory(provisioned, wired, force);

  return NextResponse.json({
    ok: true,
    provisioned,
    wired,
  });
}
