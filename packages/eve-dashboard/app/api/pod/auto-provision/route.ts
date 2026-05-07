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
 * Returns:
 *   200 `{ ok: true, provisioned: AgentResult[], wired: WireResult[] }`
 *   500 `{ error: "provision_failed", message }`
 */

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
 * Returns:
 *   200 `{ ok: true, provisioned: AgentResult[], wired: WireResult[] }`
 *   500 `{ error: "provision_failed", message }`
 */

import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  COMPONENTS,
  readEveSecrets,
  wireAllInstalledComponents,
  resolveSynapUrlOnHost,
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

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { force?: boolean }
    | null;
  const force = body?.force === true;

  // Read secrets first — needed for URL resolution and wire results
  const secrets = await readEveSecrets();

  // Resolve running components
  const runningComponents = await discoverRunningComponents();

  // Resolve the pod URL for provisioning calls
  const podUrl = await resolveSynapUrlOnHost(secrets) ?? undefined;

  // Resolve provisioning token for the call to provisionAllAgents.
  const provisioningToken = resolveProvisioningToken() ?? undefined;

  const runner = new FetchRunner();

  let provisioned: AgentResult[];
  try {
    const results: ProvisionResult[] = await provisionAllAgents({
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

  return NextResponse.json({
    ok: true,
    provisioned,
    wired,
  });
}
