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
  group: "platform" | "containers" | "network" | "ai" | "wiring";
  name: string;
  status: CheckStatus;
  message: string;
  /** Optional one-line fix hint shown next to the failing check. */
  fix?: string;
  /** Component id this check is about, if any — lets the UI link to drawer. */
  componentId?: string;
  /** When set, the dashboard renders a "Repair" button that runs this kind. */
  repair?: { kind: RepairKind; label: string };
}

async function dockerOk(): Promise<boolean> {
  try { await execFileAsync("docker", ["version"]); return true; } catch { return false; }
}

async function composeOk(): Promise<boolean> {
  try { await execFileAsync("docker", ["compose", "version"]); return true; } catch { return false; }
}

async function eveNetworkExists(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("docker", ["network", "ls", "--format", "{{.Name}}"]);
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
      execFileAsync("docker", ["ps", "--format", "{{.Names}}\t{{.Status}}"]),
      execFileAsync("docker", ["ps", "-a", "--format", "{{.Names}}\t{{.Status}}"]),
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
    ], { encoding: "utf-8" });
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
  await Promise.all(expected.map(async c => {
    try {
      const result = await verifyComponent(c.id);
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

  return checks;
}
