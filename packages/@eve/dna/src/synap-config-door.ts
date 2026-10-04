/**
 * The Synap pod's ONE .env writer, as seen from Eve (update-door plan P4).
 *
 * Eve never writes `<deploy>/.env` itself. Every change goes through the pod's
 * own CLI — `synap config set|unset` (schema-validated: unknown keys such as
 * PATH are refused; atomic; the previous file kept as .env.bak.<ts>; secrets
 * masked in its output) and `synap apply` (recreates the RUNNING services
 * whose config changed, under the pod's update lock, pgdata guard and pinned
 * compose project). Values travel on STDIN, never argv (argv is readable by
 * every local user via `ps`).
 *
 * Lives in @eve/dna (the lowest layer) so dna-level callers (wire-ai,
 * restartBackendContainer) and @eve/brain share ONE implementation; brain's
 * `synapConfigSet` / `synapApply` resolve a default deploy dir and call these.
 * synap-backend's one-env-writer tripwire scans this repo for direct writes.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SynapConfigDoorOptions {
  /** Allow changing an immutable (data-indexing) secret. Never set by default. */
  force?: boolean;
}

export interface SynapConfigResult {
  ok: boolean;
  /** Keys whose value actually changed (parsed from the door's `config: set|unset KEY` lines). */
  changed: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** `KEY=` from a deploy .env (last assignment, one pair of quotes removed), or undefined. Read-only. */
export function readSynapEnvValue(envPath: string, key: string): string | undefined {
  if (!existsSync(envPath)) return undefined;
  const all = [...readFileSync(envPath, "utf-8").matchAll(new RegExp(`^\\s*${key}=(.*)$`, "gm"))];
  const raw = all.at(-1)?.[1];
  const value = raw?.trim().replace(/^(["'])(.*)\1$/, "$2");
  return value || undefined;
}

const ok0: SynapConfigResult = { ok: true, changed: [], exitCode: 0, stdout: "", stderr: "" };

function synapScriptFor(deployDir: string): string | null {
  const script = join(dirname(deployDir), "synap");
  return existsSync(script) && existsSync(join(deployDir, "docker-compose.yml")) ? script : null;
}

/** True when the pod's synap CLI carries the validated door (deploy/env-config.sh). */
export function hasSynapConfigDoor(deployDir: string): boolean {
  return existsSync(join(deployDir, "env-config.sh")) && synapScriptFor(deployDir) !== null;
}

function run(deployDir: string, args: string[], input?: string): SynapConfigResult {
  const script = synapScriptFor(deployDir);
  if (!script) {
    return { ok: false, changed: [], exitCode: -1, stdout: "", stderr: `no synap CLI beside ${deployDir} — cannot change the pod's .env without it` };
  }
  const env: NodeJS.ProcessEnv = { ...process.env, SYNAP_DEPLOY_DIR: deployDir, SYNAP_ASSUME_YES: "1", SYNAP_NON_INTERACTIVE: "1" };
  const pin = process.env.COMPOSE_PROJECT_NAME?.trim() || readSynapEnvValue(join(deployDir, ".env"), "COMPOSE_PROJECT_NAME");
  if (pin) env.COMPOSE_PROJECT_NAME = pin;
  else delete env.COMPOSE_PROJECT_NAME;
  const r = spawnSync("bash", [script, ...args], {
    cwd: deployDir,
    env,
    input,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5 * 60_000,
  });
  const stdout = r.stdout ?? "";
  const changed = [...stdout.matchAll(/^config: (?:set|unset) ([A-Z_][A-Z0-9_]*)/gm)].map((m) => m[1]!);
  return { ok: r.status === 0, changed, exitCode: r.status ?? -1, stdout, stderr: r.stderr ?? "" };
}

/** `synap config set` at <deployDir> — KEY=VALUE pairs on stdin, all-or-nothing. */
export function synapConfigSetAt(
  deployDir: string,
  entries: Record<string, string>,
  options: SynapConfigDoorOptions = {},
): SynapConfigResult {
  const pairs = Object.entries(entries);
  if (pairs.length === 0) return ok0;
  if (!hasSynapConfigDoor(deployDir)) {
    // Transitional: a pre-door synap only has the unvalidated `config set KEY VALUE`.
    // Still the pod's own CLI (not an Eve file write); gone after one `synap update`.
    if (!synapScriptFor(deployDir)) return run(deployDir, []);
    console.warn("  Note: this pod's synap CLI predates the validated config door — using its legacy `config set` (run `eve update synap`).");
    const changed: string[] = [];
    let last = ok0;
    for (const [k, v] of pairs) {
      last = run(deployDir, ["config", "set", k, v]);
      if (!last.ok) return { ...last, changed };
      changed.push(k);
    }
    return { ...last, changed };
  }
  const input = pairs.map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  return run(deployDir, ["config", "set", ...(options.force ? ["--force"] : []), "--stdin"], input);
}

/** `synap config unset` at <deployDir>. */
export function synapConfigUnsetAt(deployDir: string, keys: string[], options: SynapConfigDoorOptions = {}): SynapConfigResult {
  if (keys.length === 0) return ok0;
  if (!hasSynapConfigDoor(deployDir)) {
    return { ok: false, changed: [], exitCode: -1, stdout: "", stderr: "this pod's synap CLI has no `config unset` yet — run `eve update synap` first" };
  }
  return run(deployDir, ["config", "unset", ...(options.force ? ["--force"] : []), ...keys]);
}

/**
 * `synap apply` at <deployDir> — recreate the RUNNING services whose config
 * changed (pinned project, update lock, pgdata guard). On a pod whose CLI
 * predates `apply`, `synap start backend` (the old CLI's guarded path).
 */
export function synapApplyAt(deployDir: string): SynapConfigResult {
  return hasSynapConfigDoor(deployDir) ? run(deployDir, ["apply"]) : run(deployDir, ["start", "backend"]);
}
