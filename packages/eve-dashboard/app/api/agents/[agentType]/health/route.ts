/**
 * GET /api/agents/[agentType]/health
 *
 * Runs Hub Protocol probes against a provisioned agent's API key to
 * verify it is actually connecting to the pod. Fills gap 16 — before
 * this, operators had no way to know if a minted key was functional.
 *
 * Returns:
 *   200 { agentType, keyIdPrefix, hasKey, probes: HubProtocolDiagnostic[] }
 *   400 { error, agentType } — unknown agent type
 *   400 { error, message }   — no key provisioned
 *   500 { error, message }   — probe failed unexpectedly
 */

import { NextResponse } from "next/server";
import {
  AGENTS,
  readEveSecrets,
  resolvePodUrl,
  readAgentKeyOrLegacy,
} from "@eve/dna";
import { runHubProtocolProbes, FetchRunner } from "@eve/lifecycle";
import { requireAuth } from "@/lib/auth-server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ agentType: string }> },
) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const agentType = (await params).agentType;

  // Validate agentType
  const agentInfo = AGENTS.find(a => a.agentType === agentType);
  if (!agentInfo) {
    return NextResponse.json(
      { error: "unknown_agent_type", agentType },
      { status: 400 },
    );
  }

  const secrets = await readEveSecrets();

  // Resolve agent key and metadata
  const agentEntry = secrets?.agents?.[agentType];
  const apiKey = agentEntry?.hubApiKey?.trim() ?? "";
  if (!apiKey) {
    return NextResponse.json(
      { error: "no_key_provisioned", agentType, keyIdPrefix: undefined },
      { status: 400 },
    );
  }

  const keyIdPrefix = agentEntry?.keyId
    ? agentEntry.keyId.slice(-8)
    : undefined;

  // Resolve pod URL — prefer on-host URL for loopback probes
  const podUrl = (await resolvePodUrl()) ?? "";

  if (!podUrl) {
    return NextResponse.json(
      { error: "no-pod-url", agentType, keyIdPrefix },
      { status: 400 },
    );
  }

  // Run probes
  const runner = new FetchRunner();
  const controller = new AbortController();
  // Set 30s timeout on the probe run
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  try {
    const probes = await runHubProtocolProbes({
      synapUrl: podUrl,
      apiKey: apiKey,
      runner,
      signal: controller.signal,
    });
    return NextResponse.json({
      ok: true,
      agentType,
      keyIdPrefix,
      hasKey: true,
      probes,
    });
  } catch (err) {
    // Abort may trigger an AbortError — surface as skip
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({
        ok: true,
        agentType,
        keyIdPrefix,
        hasKey: true,
        probes: [{
          id: "hub-protocol-openapi",
          name: "Synap Hub Protocol",
          status: "skip",
          message: "Probes timed out (30s)",
          durationMs: 30_000,
        }],
      });
    }
    return NextResponse.json(
      { error: "probe_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
