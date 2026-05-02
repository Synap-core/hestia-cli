/**
 * Health checks — server-side. Mirrors `eve doctor` to give the dashboard
 * a single page that tells you whether the stack is correctly assembled.
 *
 * Returns a flat list of CheckResult instead of streaming so the page can
 * render the whole report once and update it on demand.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  COMPONENTS, entityStateManager, readEveSecrets, hasAnyProvider,
} from "@eve/dna";
import { verifyComponent } from "@eve/legs";

const execFileAsync = promisify(execFile);

export type CheckStatus = "pass" | "fail" | "warn";

/**
 * One-click repair the dashboard knows how to run. The doctor page uses
 * this to render an inline button next to a failing check; the click
 * POSTs to `/api/doctor/repair` with this kind.
 */
export type RepairKind =
  | "create-eve-network"
  | "start-container"
  | "rewire-openclaw";

export interface CheckResult {
  group: "platform" | "containers" | "network" | "ai" | "wiring" | "integrations";
  name: string;
  status: CheckStatus;
  message: string;
  /** Optional one-line fix hint shown next to the failing check. */
  fix?: string;
  /** Component id this check is about, if any — lets the UI link to drawer. */
  componentId?: string;
  /** When set, the dashboard renders a "Repair" button that runs this kind. */
  repair?: { kind: RepairKind; label: string };
  /**
   * Tag identifying which integration scenario this check belongs to.
   * Lets the Hermes drawer + the Channels page reuse the same checks
   * without duplicating logic.
   */
  integrationId?:
    | "hermes-synap"
    | "openclaw-synap"
    | "openwebui-synap"
    | "openwebui-pipelines";
}

/**
 * Per-call hard timeout for docker subprocesses we spawn from the doctor
 * route. Without this, a stuck docker daemon (paused VM, daemon under
 * load, partial network outage) would let `/api/doctor` hang for minutes
 * — visible to users as "Running diagnostics…" with no progress.
 */
const DOCKER_TIMEOUT_MS = 4000;

async function dockerOk(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["version"], { timeout: DOCKER_TIMEOUT_MS });
    return true;
  } catch { return false; }
}

async function composeOk(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["compose", "version"], { timeout: DOCKER_TIMEOUT_MS });
    return true;
  } catch { return false; }
}

async function eveNetworkExists(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "docker", ["network", "ls", "--format", "{{.Name}}"],
      { timeout: DOCKER_TIMEOUT_MS },
    );
    return stdout.split("\n").some(l => l.trim() === "eve-network");
  } catch { return false; }
}

async function listContainers(): Promise<{ running: Map<string, string>; all: Map<string, string> }> {
  const parse = (out: string): Map<string, string> => {
    const m = new Map<string, string>();
    for (const line of out.split("\n").filter(Boolean)) {
      const [name, ...rest] = line.split("\t");
      if (name) m.set(name.trim(), rest.join(" ").trim());
    }
    return m;
  };

  try {
    const [psOut, allOut] = await Promise.all([
      execFileAsync("docker", ["ps", "--format", "{{.Names}}\t{{.Status}}"], { timeout: DOCKER_TIMEOUT_MS }),
      execFileAsync("docker", ["ps", "-a", "--format", "{{.Names}}\t{{.Status}}"], { timeout: DOCKER_TIMEOUT_MS }),
    ]);
    return { running: parse(psOut.stdout), all: parse(allOut.stdout) };
  } catch {
    return { running: new Map(), all: new Map() };
  }
}

async function checkOpenclawWiring(): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "exec", "eve-arms-openclaw",
      "sh", "-c",
      "test -f /home/node/.openclaw/agents/main/agent/auth-profiles.json && echo OK || echo MISSING",
    ], { encoding: "utf-8", timeout: DOCKER_TIMEOUT_MS });
    if (stdout.trim() === "OK") {
      return {
        group: "wiring", name: "OpenClaw AI wiring", status: "pass",
        message: "auth-profiles.json present in container",
        componentId: "openclaw",
      };
    }
    return {
      group: "wiring", name: "OpenClaw AI wiring", status: "fail",
      message: "auth-profiles.json missing — agent loop will fail",
      fix: "Re-run the AI provider wiring for OpenClaw",
      componentId: "openclaw",
      repair: { kind: "rewire-openclaw", label: "Re-wire" },
    };
  } catch {
    return {
      group: "wiring", name: "OpenClaw AI wiring", status: "warn",
      message: "Container not running — can't verify wiring",
      fix: "Start OpenClaw from the components page",
      componentId: "openclaw",
    };
  }
}

export async function runDoctor(): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  // ─── Platform ────────────────────────────────────────────────────────────
  // Each check spawns a docker subprocess; run them in parallel and reuse
  // the results so we don't double-spawn.
  const [dockerReady, composeReady, networkPresent] = await Promise.all([
    dockerOk(),
    composeOk(),
    eveNetworkExists(),
  ]);

  checks.push({
    group: "platform",
    name: "Docker daemon",
    status: dockerReady ? "pass" : "fail",
    message: dockerReady ? "Docker is running" : "Docker daemon is not reachable",
    fix: "Start Docker Desktop or `sudo systemctl start docker`",
  });

  checks.push({
    group: "platform",
    name: "Docker Compose",
    status: composeReady ? "pass" : "fail",
    message: composeReady ? "Compose plugin available" : "Compose plugin not installed",
  });

  checks.push({
    group: "network",
    name: "eve-network",
    status: networkPresent ? "pass" : "warn",
    message: networkPresent
      ? "Shared bridge network exists"
      : "eve-network not created — components on the bridge can't reach each other",
    ...(networkPresent ? {} : {
      repair: { kind: "create-eve-network", label: "Create network" },
    }),
  });

  // ─── Containers — what's installed should be running ─────────────────────
  const installed = await entityStateManager.getInstalledComponents().catch(() => [] as string[]);
  const expected = COMPONENTS.filter(c => installed.includes(c.id) && c.service);
  const { running, all } = await listContainers();

  for (const c of expected) {
    const name = c.service!.containerName;
    if (running.has(name)) {
      checks.push({
        group: "containers",
        name: c.label,
        status: "pass",
        message: `Running — ${running.get(name)}`,
        componentId: c.id,
      });
    } else if (all.has(name)) {
      checks.push({
        group: "containers",
        name: c.label,
        status: "fail",
        message: `Stopped — ${all.get(name)}`,
        fix: `Start ${c.label}`,
        componentId: c.id,
        repair: { kind: "start-container", label: "Start" },
      });
    } else {
      checks.push({
        group: "containers",
        name: c.label,
        status: "warn",
        message: "Container missing",
        fix: `Reinstall: eve add ${c.id}`,
        componentId: c.id,
      });
    }
  }

  // ─── Network reachability — verifyComponent from @eve/legs ───────────────
  // `quick: true` collapses the retry budget (5x container + 4x reachability
  // probes, ~17.5s worst case) into a single probe per check. The dashboard
  // calls this interactively — users want a snapshot, not a "wait while
  // unhealthy components retry for 10s each" experience. The slower retry
  // mode is still used by post-install verification where retries matter.
  await Promise.all(expected.map(async c => {
    try {
      const result = await verifyComponent(c.id, { quick: true });
      if (result.ok) {
        checks.push({
          group: "network",
          name: `${c.label} reachable`,
          status: "pass",
          message: result.summary,
          componentId: c.id,
        });
      } else {
        const failed = result.checks.find(ch => !ch.ok);
        checks.push({
          group: "network",
          name: `${c.label} reachable`,
          status: "fail",
          message: failed?.detail ?? result.summary,
          fix: `Check container logs from the drawer`,
          componentId: c.id,
        });
      }
    } catch (err) {
      checks.push({
        group: "network",
        name: `${c.label} reachable`,
        status: "warn",
        message: err instanceof Error ? err.message : "probe failed",
        componentId: c.id,
      });
    }
  }));

  // ─── AI providers + per-component wiring ─────────────────────────────────
  const secrets = await readEveSecrets();
  const aiConsumers = new Set(["synap", "openclaw", "openwebui"]);
  const usesAi = installed.some(c => aiConsumers.has(c));

  if (!hasAnyProvider(secrets)) {
    checks.push({
      group: "ai",
      name: "AI provider",
      status: usesAi ? "warn" : "pass",
      message: usesAi
        ? "No provider key configured — AI-consuming components will fail"
        : "No provider configured (none needed)",
      fix: usesAi ? "Open the AI page → Add provider" : undefined,
    });
  } else {
    checks.push({
      group: "ai",
      name: "AI provider",
      status: "pass",
      message: "Provider key configured in secrets.json",
    });

    if (installed.includes("openclaw") && running.has("eve-arms-openclaw")) {
      checks.push(await checkOpenclawWiring());
    }
  }

  // ─── Pair-wise integration scenarios ────────────────────────────────────
  // For each integration the user might care about, run *all* the checks
  // that have to be true for it to actually work end-to-end. Each scenario
  // fans out into multiple CheckResult rows, all tagged with the same
  // `integrationId` so other surfaces (Hermes drawer, Channels page) can
  // pull just their slice.
  const installedSet = new Set(installed);
  if (installedSet.has("hermes")) {
    checks.push(...await checkHermesSynapIntegration(secrets, running));
  }
  if (installedSet.has("openclaw")) {
    checks.push(...checkOpenclawSynapIntegration(secrets, running, installedSet));
  }
  if (installedSet.has("openwebui")) {
    checks.push(...await checkOpenwebuiSynapIntegration(secrets, running, installedSet));
  }
  if (installedSet.has("openwebui-pipelines")) {
    checks.push(...await checkOpenwebuiPipelinesIntegration(running));
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Pair-wise integration helpers
// ---------------------------------------------------------------------------

type Secrets = Awaited<ReturnType<typeof readEveSecrets>>;

/**
 * Hermes ↔ Synap. Hermes is a CLI daemon — we can't probe it from inside
 * the dashboard container. What we *can* check: the prerequisites the
 * daemon needs at boot.
 */
async function checkHermesSynapIntegration(
  secrets: Secrets,
  running: Map<string, string>,
): Promise<CheckResult[]> {
  const integrationId = "hermes-synap" as const;
  const out: CheckResult[] = [];

  const enabled = secrets?.builder?.hermes?.enabled === true;
  out.push({
    group: "integrations",
    name: "Hermes daemon enabled",
    status: enabled ? "pass" : "warn",
    message: enabled
      ? "Daemon settings flag is on"
      : "Daemon is disabled in secrets — it will refuse to start",
    fix: enabled ? undefined : "Open Hermes → Daemon settings → Enabled",
    componentId: "hermes",
    integrationId,
  });

  out.push({
    group: "integrations",
    name: "Hermes has an AI provider",
    status: hasAnyProvider(secrets) ? "pass" : "fail",
    message: hasAnyProvider(secrets)
      ? "An AI provider key is configured"
      : "No provider — Hermes can't reason about tasks",
    fix: hasAnyProvider(secrets) ? undefined : "Open AI page → Add a provider",
    integrationId,
  });

  const hasSynapKey = Boolean(secrets?.synap?.apiKey);
  out.push({
    group: "integrations",
    name: "Hermes can reach Synap",
    status: hasSynapKey ? "pass" : "fail",
    message: hasSynapKey
      ? "Synap API key is set; daemon will use Hub Protocol"
      : "Synap API key missing — daemon can't pull tasks",
    fix: hasSynapKey ? undefined : "Reinstall Synap (eve add synap) to provision an API key",
    componentId: "synap",
    integrationId,
  });

  // Synap container running — needed for the daemon to actually fetch tasks.
  const synapRunning = running.has("synap-backend-backend-1");
  out.push({
    group: "integrations",
    name: "Synap pod is running",
    status: synapRunning ? "pass" : "fail",
    message: synapRunning
      ? "Pod container is up; daemon can poll"
      : "Pod is not running — daemon polls will fail",
    fix: synapRunning ? undefined : "Open Synap → Start",
    componentId: "synap",
    integrationId,
    repair: synapRunning ? undefined : { kind: "start-container", label: "Start pod" },
  });

  return out;
}

/** OpenClaw ↔ Synap. Already partly covered by checkOpenclawWiring; this
 *  groups everything end-to-end under one integrationId so the per-component
 *  surface can show a clean "is this wired" panel. */
function checkOpenclawSynapIntegration(
  secrets: Secrets,
  running: Map<string, string>,
  installedSet: Set<string>,
): CheckResult[] {
  const integrationId = "openclaw-synap" as const;
  const out: CheckResult[] = [];

  const ocRunning = running.has("eve-arms-openclaw");
  out.push({
    group: "integrations",
    name: "OpenClaw container running",
    status: ocRunning ? "pass" : "fail",
    message: ocRunning ? "Agent loop is alive" : "Container is not running",
    fix: ocRunning ? undefined : "Open OpenClaw → Start",
    componentId: "openclaw",
    integrationId,
    repair: ocRunning ? undefined : { kind: "start-container", label: "Start" },
  });

  out.push({
    group: "integrations",
    name: "OpenClaw has Synap pod credentials",
    status: secrets?.synap?.apiKey ? "pass" : "fail",
    message: secrets?.synap?.apiKey
      ? "API key present — wiring will pick it up"
      : "Missing Synap API key — re-install Synap or wire it",
    componentId: "synap",
    integrationId,
  });

  out.push({
    group: "integrations",
    name: "OpenClaw has an AI provider",
    status: hasAnyProvider(secrets) ? "pass" : "fail",
    message: hasAnyProvider(secrets)
      ? "Provider configured"
      : "No provider — OpenClaw's reasoning will fail",
    fix: hasAnyProvider(secrets) ? undefined : "Open AI page → Add a provider",
    integrationId,
  });

  if (!installedSet.has("synap")) {
    out.push({
      group: "integrations",
      name: "Synap pod installed",
      status: "fail",
      message: "Synap is not installed — OpenClaw needs it for memory + Hub",
      fix: "Install Synap from the components page",
      componentId: "synap",
      integrationId,
    });
  }

  return out;
}

/** Open WebUI ↔ Synap. Direct wiring: Open WebUI talks to Synap IS as its
 *  OpenAI-compat backend. Pipelines is a separate integration below. */
async function checkOpenwebuiSynapIntegration(
  secrets: Secrets,
  running: Map<string, string>,
  installedSet: Set<string>,
): Promise<CheckResult[]> {
  const integrationId = "openwebui-synap" as const;
  const out: CheckResult[] = [];

  const owRunning = running.has("hestia-openwebui");
  out.push({
    group: "integrations",
    name: "Open WebUI container running",
    status: owRunning ? "pass" : "fail",
    message: owRunning ? "Chat UI is up" : "Container is not running",
    fix: owRunning ? undefined : "Open Open WebUI → Start",
    componentId: "openwebui",
    integrationId,
    repair: owRunning ? undefined : { kind: "start-container", label: "Start" },
  });

  // Read /opt/openwebui/.env to verify the synap-aware env vars are set.
  // Best-effort — if the file doesn't exist (host-mount not configured)
  // we report a warn, not a fail.
  const envCheck = await readOpenwebuiEnv();
  if (envCheck.found) {
    const hasKey = envCheck.env.SYNAP_API_KEY && envCheck.env.SYNAP_API_KEY.length > 0;
    const hasUrl = Boolean(envCheck.env.SYNAP_IS_URL);
    out.push({
      group: "integrations",
      name: "Open WebUI knows the Synap API key",
      status: hasKey ? "pass" : "fail",
      message: hasKey
        ? "SYNAP_API_KEY is set in /opt/openwebui/.env"
        : "SYNAP_API_KEY missing — chat won't auth against the pod",
      fix: hasKey ? undefined : "Open AI page → Save (re-runs wiring)",
      integrationId,
    });
    out.push({
      group: "integrations",
      name: "Open WebUI knows the IS URL",
      status: hasUrl ? "pass" : "warn",
      message: hasUrl
        ? `SYNAP_IS_URL = ${envCheck.env.SYNAP_IS_URL}`
        : "SYNAP_IS_URL missing — Open WebUI will use the default",
      integrationId,
    });
  } else {
    out.push({
      group: "integrations",
      name: "Open WebUI env file",
      status: "warn",
      message: "/opt/openwebui/.env not found from this container — can't verify wiring",
      integrationId,
    });
  }

  if (!installedSet.has("synap")) {
    out.push({
      group: "integrations",
      name: "Synap pod installed",
      status: "fail",
      message: "Synap is not installed — chat has nothing to talk to",
      fix: "Install Synap from the components page",
      componentId: "synap",
      integrationId,
    });
  }

  // Use secrets.synap.apiKey too — when set, the wiring action propagates
  // it to /opt/openwebui/.env. Surface mismatch as a warn.
  if (envCheck.found && secrets?.synap?.apiKey
      && envCheck.env.SYNAP_API_KEY
      && envCheck.env.SYNAP_API_KEY !== secrets.synap.apiKey) {
    out.push({
      group: "integrations",
      name: "Open WebUI key matches secrets",
      status: "warn",
      message: "Open WebUI's SYNAP_API_KEY differs from secrets.json — re-wire to sync",
      fix: "Open AI page → Save (re-runs wiring)",
      integrationId,
    });
  }

  return out;
}

/** Open WebUI ↔ Pipelines sidecar ↔ Synap. Sidecar adds memory injection,
 *  channel sync, and Hermes dispatch on top of plain Open WebUI. */
async function checkOpenwebuiPipelinesIntegration(
  running: Map<string, string>,
): Promise<CheckResult[]> {
  const integrationId = "openwebui-pipelines" as const;
  const out: CheckResult[] = [];

  const sidecarRunning = running.has("eve-openwebui-pipelines");
  out.push({
    group: "integrations",
    name: "Pipelines sidecar running",
    status: sidecarRunning ? "pass" : "fail",
    message: sidecarRunning ? "Sidecar container is up" : "Sidecar is not running",
    fix: sidecarRunning ? undefined : "Open Pipelines → Start",
    componentId: "openwebui-pipelines",
    integrationId,
    repair: sidecarRunning ? undefined : { kind: "start-container", label: "Start" },
  });

  // Open WebUI's .env should reference the pipelines URL in OPENAI_API_BASE_URLS.
  // The install path adds it automatically; if removed, chat won't see the
  // pipeline filters at all.
  const envCheck = await readOpenwebuiEnv();
  if (envCheck.found) {
    const baseUrls = envCheck.env.OPENAI_API_BASE_URLS ?? "";
    const wired = baseUrls.includes("eve-openwebui-pipelines");
    out.push({
      group: "integrations",
      name: "Open WebUI calls pipelines",
      status: wired ? "pass" : "fail",
      message: wired
        ? "OPENAI_API_BASE_URLS routes through the sidecar"
        : "Sidecar isn't in OPENAI_API_BASE_URLS — pipelines won't fire",
      fix: wired ? undefined : "Re-install Pipelines (`eve add openwebui-pipelines`)",
      integrationId,
    });
  }

  return out;
}

interface OpenwebuiEnv {
  found: boolean;
  env: Record<string, string>;
}

async function readOpenwebuiEnv(): Promise<OpenwebuiEnv> {
  const { readFile, access } = await import("node:fs/promises");
  const path = "/opt/openwebui/.env";
  try {
    await access(path);
    const raw = await readFile(path, "utf-8");
    const env: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return { found: true, env };
  } catch {
    return { found: false, env: {} };
  }
}
