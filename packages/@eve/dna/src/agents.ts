/**
 * Eve agent registry — single source of truth for which Synap agents Eve
 * provisions API keys for.
 *
 * Why this exists: until now Eve treated the Synap Hub Protocol as a
 * single-key world (`secrets.synap.apiKey`). In practice each consumer
 * (Eve itself for doctor probes, OpenClaw, Hermes, OpenWebUI Pipelines)
 * is a separate agent with its own user, scopes, and audit trail on the
 * pod. The pod already supports this — `POST /api/hub/setup/agent`
 * mints an agent-typed user + API key per `agentType` slug. Eve was
 * just collapsing them all into one shared key.
 *
 * This registry declares every agentType Eve provisions, in install
 * order. The `provisionAllAgents()` flow walks it and calls /setup/agent
 * for each entry that doesn't yet have a key in `secrets.agents`.
 *
 * Adding a new agent: append an entry here. The registry is the only
 * place that needs to change — auth.ts, secrets-contract.ts, and the
 * eve auth CLI are all driven by it.
 */

/**
 * Identity of one agent Eve provisions on the pod.
 */
export interface AgentInfo {
  /**
   * `agentType` slug sent to `POST /api/hub/setup/agent`. The pod
   * uses it as a pod-wide singleton key — re-running setup/agent for
   * the same slug rotates the key without creating a new agent user.
   * Must match `users.agentMetadata->>'agentType'` once provisioned.
   */
  agentType: string;
  /** Display name for CLI / dashboard output. */
  label: string;
  /**
   * One-line description shown in `eve auth status` (no agent flag).
   * Tells the operator what this key is *for*, distinct from `label`.
   */
  description: string;
  /**
   * Component ID this agent corresponds to in the COMPONENTS registry,
   * if any. `null` for agents that aren't components themselves
   * (e.g. "eve" — the CLI/dashboard probe identity).
   *
   * When set, Eve's lifecycle layer can use this to gate provisioning:
   * "only mint the openclaw key if the openclaw component is installed."
   */
  componentId: string | null;
  /**
   * Whether this agent's key should always be minted, even when the
   * matching component isn't installed yet. The "eve" agent uses this
   * — Doctor needs a working Hub key on day one, before any add-on is
   * installed, so the dashboard's diagnostics page doesn't 401.
   */
  alwaysProvision: boolean;
}

/**
 * The canonical list. Order matters: provisioning walks this top-to-bottom
 * during install. "eve" goes first so the Doctor has something to probe with
 * even if downstream agents fail to mint.
 */
export const AGENTS: AgentInfo[] = [
  {
    agentType: "eve",
    label: "Eve",
    description: "Eve CLI + dashboard — used by doctor probes and lifecycle introspection.",
    componentId: null,
    alwaysProvision: true,
  },
  {
    agentType: "openclaw",
    label: "OpenClaw",
    description: "OpenClaw agent runtime — reads/writes Synap data on behalf of the user.",
    componentId: "openclaw",
    alwaysProvision: false,
  },
  {
    agentType: "hermes",
    label: "Hermes",
    description: "Hermes builder daemon — scaffolds apps via Synap proposals.",
    componentId: "hermes",
    alwaysProvision: false,
  },
  {
    agentType: "openwebui",
    label: "Open WebUI",
    description: "Open WebUI chat frontend — used for Synap knowledge/skills/functions sync and model source auth.",
    componentId: "openwebui",
    alwaysProvision: false,
  },
  {
    agentType: "coder",
    label: "Coder",
    description:
      "Local AI coder agent — runs claudecode / opencode / openclaude as a subprocess based on secrets.builder.codeEngine",
    // The coder is a local subprocess identity, not a Docker component.
    // It corresponds to whichever engine the operator has selected, but
    // shouldn't be gated on a specific component install — gate on the
    // builder organ's `codeEngine` config instead.
    componentId: null,
    // Always-on: any builder workflow that spawns a coder subprocess
    // expects this key to exist. Mint it during install alongside the
    // eve agent so first-spawn never blocks on a Hub provision call.
    alwaysProvision: true,
  },
];

/**
 * Legacy per-engine agentType slugs that have been collapsed into the
 * single `coder` agent. Used by the migration path in @eve/lifecycle to
 * detect old installs and pick a `codeEngine` from whichever per-engine
 * key existed first.
 */
export const LEGACY_CODER_ENGINE_SLUGS = ["claudecode", "opencode", "openclaude"] as const;
export type LegacyCoderEngineSlug = (typeof LEGACY_CODER_ENGINE_SLUGS)[number];

/** Resolve an agent by its `agentType` slug. Returns `null` if unknown. */
export function resolveAgent(agentType: string): AgentInfo | null {
  return AGENTS.find((a) => a.agentType === agentType) ?? null;
}

/** Just the slugs, in registry order. */
export function allAgentTypes(): string[] {
  return AGENTS.map((a) => a.agentType);
}

/**
 * Filter the registry to agents Eve should provision right now.
 *
 * `installedComponentIds` lets the caller skip agents whose backing
 * component isn't installed. Agents flagged `alwaysProvision` are kept
 * regardless (eve itself is the canonical example).
 */
export function agentsToProvision(installedComponentIds: readonly string[]): AgentInfo[] {
  const installed = new Set(installedComponentIds);
  return AGENTS.filter((a) => a.alwaysProvision || (a.componentId !== null && installed.has(a.componentId)));
}
