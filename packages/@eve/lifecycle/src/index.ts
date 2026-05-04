/**
 * @eve/lifecycle — programmatic install/remove/update/start/stop for Eve
 * components.
 *
 * Both the CLI (`eve add`, `eve remove`, etc.) and the dashboard's
 * `POST /api/components/[id]` consume this. The shape is an
 * `AsyncIterable<LifecycleEvent>` so callers can stream progress (SSE,
 * spinner updates, structured logs) or `await` the whole thing.
 *
 * Errors are *yielded* as `{type: "error"}` events, never thrown — this is
 * what makes the same code path safe inside a long-running server. CLI
 * wrappers translate errors into `process.exit(1)`; the dashboard
 * translates them into UI toasts.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  COMPONENTS,
  resolveComponent,
  entityStateManager,
  readAgentKey,
  readEveSecrets,
  writeEveSecrets,
  pickPrimaryProvider,
  wireComponentAi,
  AI_CONSUMERS,
  AI_CONSUMERS_NEEDING_RECREATE,
  type ComponentInfo,
} from "@eve/dna";
import {
  refreshTraefikRoutes,
  installDashboardContainer,
  uninstallDashboardContainer,
} from "@eve/legs";
import {
  reconcileOpenclawConfig,
  type OpenclawReconcileResult,
} from "./components/openclaw/reconcile.js";
import { ensureBuilderWorkspace } from "./builder-workspace.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LifecycleAction =
  | "install" | "remove" | "update" | "start" | "stop" | "restart" | "recreate";

export type LifecycleEvent =
  | { type: "step"; label: string }
  | { type: "log"; line: string }
  | { type: "done"; summary: string }
  | { type: "error"; message: string };

export interface InstallOptions {
  /** Path to a synap-backend checkout (only needed when installing `synap`). */
  synapRepo?: string;
  /** Ollama model to pull (only used by `ollama`). */
  model?: string;
}

// ---------------------------------------------------------------------------
// Subprocess helper — yields stdout + stderr lines as they arrive
// ---------------------------------------------------------------------------

async function* runCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): AsyncGenerator<LifecycleEvent, number, void> {
  yield { type: "log", line: `$ ${cmd} ${args.join(" ")}` };

  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const queue: string[] = [];
  let resolveNext: (() => void) | null = null;
  let exited = false;
  let exitCode = 0;

  const wakeUp = () => {
    const r = resolveNext;
    resolveNext = null;
    r?.();
  };

  const consumeChunk = (buf: Buffer) => {
    const text = buf.toString("utf-8");
    for (const line of text.split(/\r?\n/)) {
      if (line.length > 0) queue.push(line);
    }
    wakeUp();
  };

  child.stdout.on("data", consumeChunk);
  child.stderr.on("data", consumeChunk);
  child.on("close", (code) => { exitCode = code ?? 0; exited = true; wakeUp(); });
  child.on("error", (err) => {
    queue.push(`error: ${err.message}`);
    exitCode = 1; exited = true; wakeUp();
  });

  while (true) {
    while (queue.length > 0) yield { type: "log", line: queue.shift()! };
    // Re-check after draining: a `close` event in the same tick as the last
    // chunk would otherwise leave bytes in the queue and we'd return without
    // emitting them.
    if (exited && queue.length === 0) break;
    if (exited) continue;
    await new Promise<void>((r) => { resolveNext = r; });
  }

  return exitCode;
}

async function* dockerExec(
  args: string[],
  label?: string,
): AsyncGenerator<LifecycleEvent, number, void> {
  if (label) yield { type: "step", label };
  return yield* runCommand("docker", args);
}

// ---------------------------------------------------------------------------
// Update plan — image pull or compose project recreate
// ---------------------------------------------------------------------------

interface UpdatePlan {
  imagePull?: string;
  compose?: {
    cwd: string;
    services?: string[];
    /**
     * Regenerate the compose file before pull/up. Used for components
     * we own end-to-end (openwebui, openwebui-pipelines) so a stale or
     * corrupt YAML from an older install version can't cause cryptic
     * failures like "no service selected". Synap's compose file is
     * managed by synap-backend itself, not us — leave it alone.
     */
    regenerate?: () => void;
    /**
     * Regenerate the component's `.env` before pull/up. Used for
     * components whose env file carries live secrets sourced from
     * `secrets.json` (openwebui-pipelines: SYNAP_API_KEY rotates with
     * `eve auth provision` / `migrateLegacyToAgents`). Without this,
     * `eve update <c>` keeps the stale env from first install and
     * `compose up -d` happily restarts with the wrong creds.
     */
    reconcileEnv?: () => Promise<void> | void;
  };
}

const UPDATE_PLAN: Record<string, UpdatePlan> = {
  traefik: { imagePull: "traefik:v3.0" },
  ollama: { imagePull: "ollama/ollama:latest" },
  openclaw: { imagePull: "ghcr.io/openclaw/openclaw:latest" },
  rsshub: { imagePull: "diygod/rsshub:latest" },
  // openwebui + pipelines were installed via `docker compose up -d`. After
  // a remove/down the container is gone, so a plain `docker restart` after
  // pull would fail with "No such container". `compose pull && compose up
  // -d` is idempotent — recreates if needed, restarts in place if not.
  openwebui: {
    compose: {
      cwd: "/opt/openwebui",
      regenerate: () => writeOpenwebuiCompose("/opt/openwebui"),
    },
  },
  "openwebui-pipelines": {
    compose: {
      cwd: "/opt/openwebui-pipelines",
      regenerate: () => writePipelinesCompose(
        "/opt/openwebui-pipelines",
        join("/opt/openwebui-pipelines", "pipelines"),
      ),
      reconcileEnv: () => reconcilePipelinesEnv("/opt/openwebui-pipelines"),
    },
  },
  synap: { compose: { cwd: "/opt/synap-backend/deploy", services: ["backend", "realtime"] } },
};

interface RemovePlan {
  composeDir?: string;
  containerNames: string[];
}

function removePlanFor(comp: ComponentInfo): RemovePlan {
  const containerNames = comp.service?.containerName ? [comp.service.containerName] : [];
  switch (comp.id) {
    case "synap":
      return { composeDir: "/opt/synap-backend/deploy", containerNames };
    case "openwebui":
      return { composeDir: "/opt/openwebui", containerNames };
    case "openwebui-pipelines":
      return { composeDir: "/opt/openwebui-pipelines", containerNames };
    case "traefik":
      return { composeDir: `${homedir()}/.eve/traefik`, containerNames };
    default:
      return { containerNames };
  }
}

// ---------------------------------------------------------------------------
// Lifecycle primitives — each yields events instead of printing/exiting
// ---------------------------------------------------------------------------

async function* startContainer(comp: ComponentInfo): AsyncGenerator<LifecycleEvent> {
  const name = comp.service?.containerName;
  if (!name) {
    yield { type: "error", message: `${comp.label} has no container to start.` };
    return;
  }
  const code = yield* dockerExec(["start", name], `Starting ${comp.label}…`);
  if (code === 0) yield { type: "done", summary: `${comp.label} started` };
  else yield { type: "error", message: `docker start exited ${code}` };
}

async function* stopContainer(comp: ComponentInfo): AsyncGenerator<LifecycleEvent> {
  const name = comp.service?.containerName;
  if (!name) {
    yield { type: "error", message: `${comp.label} has no container to stop.` };
    return;
  }
  const code = yield* dockerExec(["stop", name], `Stopping ${comp.label}…`);
  if (code === 0) yield { type: "done", summary: `${comp.label} stopped` };
  else yield { type: "error", message: `docker stop exited ${code}` };
}

async function* restartContainer(comp: ComponentInfo): AsyncGenerator<LifecycleEvent> {
  const name = comp.service?.containerName;
  if (!name) {
    yield { type: "error", message: `${comp.label} has no container to restart.` };
    return;
  }
  const code = yield* dockerExec(["restart", name], `Restarting ${comp.label}…`);
  if (code === 0) yield { type: "done", summary: `${comp.label} restarted` };
  else yield { type: "error", message: `docker restart exited ${code}` };
}

async function* updateContainer(comp: ComponentInfo): AsyncGenerator<LifecycleEvent> {
  const plan = UPDATE_PLAN[comp.id];
  if (!plan) {
    yield { type: "error", message: `${comp.label} has no automated update path.` };
    return;
  }

  // Capture the inner update path's outcome so we can layer post-update
  // reconciliation on top (e.g. OpenClaw's allowedOrigins). Anything inside
  // the plan branches yields its own `done`/`error` — we use `yield*` on a
  // dedicated helper so we can intercept the outcome here.
  let inner: LifecycleEvent[] = [];
  for await (const ev of runUpdatePlan(comp, plan)) {
    inner.push(ev);
    yield ev;
  }
  const lastDone = [...inner].reverse().find(e => e.type === "done");
  const lastErr = [...inner].reverse().find(e => e.type === "error");

  // Post-update component-specific reconciliation. Only fires on a clean
  // success path, never after an error. Yields its own `log` events so the
  // caller's stream stays unified.
  if (lastDone && !lastErr) {
    yield* runPostUpdateHooks(comp);
  }
}

/**
 * Inner update — the original logic, factored out so the outer
 * `updateContainer` can layer post-update reconciliation on top without
 * duplicating the four-branch decision tree below.
 */
async function* runUpdatePlan(
  comp: ComponentInfo,
  plan: UpdatePlan,
): AsyncGenerator<LifecycleEvent> {
  if (plan.compose) {
    // Regenerate the compose YAML for components we own end-to-end.
    // This guarantees the file is always our latest template and
    // recovers from drift caused by older install versions, manual
    // edits gone wrong, or partial writes. Synap's compose file is
    // managed elsewhere — its plan has no `regenerate`, so we skip.
    if (plan.compose.regenerate) {
      try {
        plan.compose.regenerate();
        yield { type: "log", line: `Regenerated ${plan.compose.cwd}/docker-compose.yml from current template` };
      } catch (err) {
        yield {
          type: "error",
          message: `Could not regenerate compose file: ${err instanceof Error ? err.message : String(err)}`,
        };
        return;
      }
    }

    // Reconcile the component's `.env` from current secrets BEFORE
    // `compose pull` / `compose up`. Components whose env carries live
    // secrets (openwebui-pipelines: SYNAP_API_KEY) need this so a key
    // rotation via `eve auth provision` actually lands in the container.
    if (plan.compose.reconcileEnv) {
      try {
        await plan.compose.reconcileEnv();
        yield { type: "log", line: `Reconciled ${plan.compose.cwd}/.env from current secrets` };
      } catch (err) {
        yield {
          type: "error",
          message: `Could not reconcile .env: ${err instanceof Error ? err.message : String(err)}`,
        };
        return;
      }
    }

    if (!existsSync(plan.compose.cwd)) {
      yield { type: "error", message: `Compose dir not found: ${plan.compose.cwd}.` };
      return;
    }

    // Compose v2 warns about the obsolete `version:` top-level key on
    // every command. Older versions of our install recipe (or hand-edited
    // files) may still have it. Strip it idempotently here so the user
    // doesn't see warning noise on every update.
    sanitizeComposeFile(join(plan.compose.cwd, "docker-compose.yml"));

    // Our compose files reference `eve-network` as `external: true`. If
    // the network was ever pruned (`docker network prune`, full host
    // wipe), `compose up` aborts with "network eve-network declared as
    // external, but could not be found". The install recipe creates it;
    // do the same here so update is self-recovering.
    yield* ensureEveNetwork();

    const services = plan.compose.services ?? [];
    let code = yield* runCommand(
      "docker",
      ["compose", "pull", ...services, "--ignore-pull-failures"],
      { cwd: plan.compose.cwd },
    );
    if (code !== 0) { yield { type: "error", message: `compose pull exited ${code}` }; return; }

    // Compose v2 rejects `--no-deps` without service names ("no service
    // selected"). The flag only matters when we scope to specific
    // services in a multi-service file (synap), so drop it when the
    // services list is empty (openwebui, openwebui-pipelines — single
    // service per file → bringing up the whole file is what we want).
    const upArgs = services.length > 0
      ? ["compose", "up", "-d", "--no-deps", ...services]
      : ["compose", "up", "-d"];
    code = yield* runCommand("docker", upArgs, { cwd: plan.compose.cwd });
    if (code !== 0) { yield { type: "error", message: `compose up exited ${code}` }; return; }

    yield { type: "done", summary: `${comp.label} updated` };
    return;
  }

  if (plan.imagePull && comp.service?.containerName) {
    const code = yield* dockerExec(["pull", plan.imagePull], `Pulling ${plan.imagePull}…`);
    if (code !== 0) { yield { type: "error", message: `pull exited ${code}` }; return; }

    // Three branches after a successful pull:
    //
    //   1. Container missing (drift) — `docker restart` would fail with
    //      "No such container". If we have an install recipe, recreate
    //      so the user gets recovery. Otherwise surface the drift.
    //
    //   2. Component is env-bound (`AI_CONSUMERS_NEEDING_RECREATE`) —
    //      `docker restart` keeps the stale env from the original
    //      `docker run`, so config changes (DEFAULT_MODEL, messaging,
    //      voice) wouldn't land. Recreate instead.
    //
    //   3. Plain restart for everything else (ollama, traefik, rsshub).
    const exists = await containerExists(comp.service.containerName);
    const needsRecreate = AI_CONSUMERS_NEEDING_RECREATE.has(comp.id);
    const hasInstallRecipe = HAS_INSTALL_RECIPE.has(comp.id);

    if (!exists && hasInstallRecipe) {
      yield { type: "log", line: `${comp.service.containerName} not found — recreating from install recipe…` };
      yield* installOne(comp, {});
      return;
    }
    if (!exists) {
      yield { type: "error", message: `${comp.service.containerName} not found — re-install with \`eve add ${comp.id}\`` };
      return;
    }
    if (needsRecreate && hasInstallRecipe) {
      yield { type: "log", line: `${comp.label} is env-bound — recreating to apply current config` };
      yield* recreateContainer(comp, {});
      return;
    }

    const restartCode = yield* dockerExec(
      ["restart", comp.service.containerName],
      `Restarting ${comp.label}…`,
    );
    if (restartCode !== 0) {
      yield { type: "error", message: `restart exited ${restartCode}` };
      return;
    }

    yield { type: "done", summary: `${comp.label} updated to latest` };
  }
}

// ---------------------------------------------------------------------------
// Post-update hooks — component-specific reconciliation that runs AFTER the
// generic update path succeeded. These exist because Docker images
// occasionally regenerate config that Eve owns (OpenClaw resets
// `gateway.controlUi.allowedOrigins` on every auth-token regen). Keeping
// the reconciliation here — not in install/wire — means it ALSO catches
// drift after manual restarts, image rebuilds, and dashboard-driven
// updates: anything that funnels through `runAction(_, "update")`.
// ---------------------------------------------------------------------------

async function* runPostUpdateHooks(comp: ComponentInfo): AsyncGenerator<LifecycleEvent> {
  if (comp.id === "openclaw") {
    yield* postUpdateReconcileOpenclaw();
  }
  if (comp.id === "synap") {
    yield* postUpdateReconcileAuth();
  }
}

/**
 * After every `eve update synap`, verify the agent API key is still
 * accepted by the freshly-updated backend. If the backend rejects the
 * key with a recoverable reason (revoked, expired) we attempt to mint a
 * fresh one inline so the operator never has to babysit the renew.
 *
 * Pattern mirrors `postUpdateReconcileOpenclaw`: log silently on the
 * happy path, surface concrete next steps when something needed action.
 * Auth failures are NEVER fatal — a 5xx during `eve update` shouldn't
 * blow up because of a key issue we can fix on the next pass.
 *
 * Note: secrets.json is read by clients (openwebui-pipelines, openclaw,
 * etc.), not by the backend itself, so a key swap doesn't need a
 * synap-backend restart. Downstream consumers may need a restart to pick
 * up the new key — surfaced as a hint, not enforced here.
 */
async function* postUpdateReconcileAuth(): AsyncGenerator<LifecycleEvent> {
  const { getAuthStatus, renewAgentKey, migrateLegacyToAgents } = await import("./auth.js");
  const { readAgentKey } = await import("@eve/dna");
  const secrets = await readEveSecrets();
  const synapUrl = secrets?.synap?.apiUrl?.trim() ?? "";
  if (!synapUrl) {
    // No pod URL — nothing to validate. Stay quiet.
    return;
  }

  // Auto-migrate from legacy single-key world to per-agent. Trigger
  // condition: legacy `synap.apiKey` exists but no `agents.eve` record.
  // Idempotent — `migrateLegacyToAgents` is itself a no-op when the eve
  // agent key is already present.
  const legacyKey = secrets?.synap?.apiKey?.trim() ?? "";
  const eveAgentKey = await readAgentKey("eve");
  if (legacyKey && !eveAgentKey) {
    yield {
      type: "log",
      line: "↳ legacy single-key install detected — migrating to per-agent keys",
    };
    let installedSet: string[];
    try {
      installedSet = await entityStateManager.getInstalledComponents();
    } catch {
      installedSet = [];
    }
    const migration = await migrateLegacyToAgents({
      installedComponentIds: installedSet,
    });
    if (migration.migrated) {
      const ok = migration.results.filter((r) => r.provisioned).length;
      const failed = migration.results.length - ok;
      yield {
        type: "log",
        line: `↳ migrated ${ok}/${migration.results.length} agent${migration.results.length === 1 ? "" : "s"} to per-agent keys${failed > 0 ? ` (${failed} failed — run \`eve auth status\`)` : ""}`,
      };
      // The eve agent key now exists in its own slot — seed the Builder
      // workspace so upgraded installs catch up to fresh-install state.
      // Failures are non-fatal: they yield a log, never break the migration.
      yield* postInstallSeedBuilderWorkspace();
    } else {
      yield {
        type: "log",
        line: `↳ legacy migration deferred: ${migration.reason ?? "unknown"} — run \`eve auth provision\` manually`,
      };
    }
    // After migration the legacy field has been overwritten by the eve
    // agent's fresh key, so the rest of this hook can keep running on
    // the new state without re-reading.
    return;
  }

  // Already on per-agent. Health-check the eve agent key (our canary —
  // it's the one Doctor probes use, so an eve key failure is the most
  // visible breakage).
  const eveKeyValue = eveAgentKey?.hubApiKey?.trim() ?? legacyKey;
  if (!eveKeyValue) {
    // No eve key at all. Two recovery paths:
    //   1. PROVISIONING_TOKEN is reachable (env or pod's deploy/.env) →
    //      auto-provision every agent here. This catches the common case
    //      where the operator ran `eve install` (no installOne path) and
    //      then `eve update synap` expecting things to work.
    //   2. No PROVISIONING_TOKEN → log a clear hint and stay quiet so we
    //      don't fail an update that has nothing to do with auth.
    yield {
      type: "log",
      line: "↳ no eve agent key found — attempting auto-provisioning",
    };
    yield* postInstallProvisionAgents("synap");
    yield* postInstallSeedBuilderWorkspace();
    return;
  }

  const status = await getAuthStatus({ synapUrl, apiKey: eveKeyValue });
  if (status.ok) {
    // Healthy auth on a non-legacy install — reconcile the Builder
    // workspace too, so every `eve update synap` brings the seeded
    // schema back in sync with the bundled template (idempotent via
    // proposalId). Errors yield a log only — never break update.
    yield* postInstallSeedBuilderWorkspace();
    return;
  }

  const reason = status.failure.reason;
  const recoverable = reason === "key_revoked" || reason === "expired";
  if (!recoverable) {
    yield {
      type: "log",
      line: `↳ post-update auth check returned ${reason} (${status.failure.message}) — run \`eve auth status\` for details`,
    };
    return;
  }

  yield {
    type: "log",
    line: `↳ eve agent key invalid (${reason}) — auto-renewing`,
  };
  const renewed = await renewAgentKey({
    agentType: "eve",
    reason: `${reason} during update`,
  });
  if (renewed.renewed) {
    yield {
      type: "log",
      line: `↳ refreshed eve agent key (was ${reason} during update) — new prefix ${renewed.keyIdPrefix}`,
    };
    yield {
      type: "log",
      line: "↳ downstream clients (openwebui-pipelines, openclaw) may need restart to pick up the new key",
    };
    // Fresh key in place — make sure the Builder workspace exists.
    yield* postInstallSeedBuilderWorkspace();
  } else {
    yield {
      type: "log",
      line: `↳ auto-renew failed: ${renewed.reason} — run \`eve auth renew\` manually`,
    };
  }
}

/**
 * Mint per-agent Hub keys for whichever agentTypes correspond to
 * `componentId`.
 *
 * Walks the AGENTS registry, picks the entries whose `componentId`
 * matches (plus the always-on "eve" agent when synap itself was just
 * installed), and calls `/api/hub/setup/agent` for each. Skips any
 * agent that already has a key in `secrets.agents[…]` so re-running
 * install doesn't churn keys.
 *
 * Failures are logged as `log` events, never `error` — a Hub Protocol
 * mint failure should never block a successful component install. The
 * operator can recover with `eve auth provision`.
 */
async function* postInstallProvisionAgents(componentId: string): AsyncGenerator<LifecycleEvent> {
  const { provisionAgent } = await import("./auth.js");
  const { AGENTS, readAgentKey } = await import("@eve/dna");

  // Decide which agentTypes this install should mint.
  const matches = AGENTS.filter((a) => a.componentId === componentId);
  if (componentId === "synap") {
    const eveEntry = AGENTS.find((a) => a.agentType === "eve");
    if (eveEntry && !matches.includes(eveEntry)) matches.push(eveEntry);
  }
  if (matches.length === 0) return;

  for (const agent of matches) {
    const existing = await readAgentKey(agent.agentType);
    if (existing && existing.hubApiKey) {
      // Already minted — leave it alone. Renew is the explicit path for rotation.
      yield {
        type: "log",
        line: `${agent.label} agent key already provisioned (prefix ${(existing.keyId ?? existing.hubApiKey).slice(0, 8)}…) — skipping`,
      };
      continue;
    }
    const result = await provisionAgent({
      agentType: agent.agentType,
      reason: `install:${componentId}`,
    });
    if (result.provisioned) {
      yield {
        type: "log",
        line: `Minted ${agent.label} agent key (prefix ${result.keyIdPrefix}…)`,
      };
    } else {
      yield {
        type: "log",
        line: `warning: could not mint ${agent.label} agent key — ${result.reason}. Run \`eve auth provision\` once the pod is reachable.`,
      };
    }
  }
}

/**
 * Seed the Builder workspace on the pod once the eve agent key is
 * provisioned. Wraps `ensureBuilderWorkspace` so install/update hooks
 * can fire-and-forget — failures are downgraded to a `log` event with
 * a clear retry hint, never bubbled as `error` (a workspace seed
 * failure should NEVER roll back the agent provisioning above; the
 * worst-case state is "everything works except the Builder lens, run
 * `eve update` to retry").
 *
 * Quiet exit when synap.apiUrl isn't set yet — that's the legitimate
 * case for an `install --dry-run` or a CLI flow that hasn't reached
 * the URL-write step. The caller is responsible for ordering.
 */
async function* postInstallSeedBuilderWorkspace(): AsyncGenerator<LifecycleEvent> {
  const secrets = await readEveSecrets();
  const podUrl = secrets?.synap?.apiUrl?.trim() ?? "";
  if (!podUrl) {
    yield {
      type: "log",
      line: "Skipping Builder workspace seed — synap.apiUrl not set yet (run `eve update` after configuring the pod URL).",
    };
    return;
  }
  try {
    const result = await ensureBuilderWorkspace({ secrets, podUrl });
    if (result.created) {
      yield {
        type: "log",
        line: `Seeded Builder workspace on pod (id: ${result.workspaceId})`,
      };
    } else {
      yield {
        type: "log",
        line: `Builder workspace already present on pod (id: ${result.workspaceId})`,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield {
      type: "log",
      line: `warning: could not seed Builder workspace — ${message}. Retry with \`eve update\`.`,
    };
  }
}

/**
 * Restore Eve's expected entries in `gateway.controlUi.allowedOrigins`
 * after an OpenClaw update.
 *
 * The container regenerates this list to localhost-only whenever its auth
 * token is missing on boot. After a fresh image pull (recreate path) the
 * volume can come back with a stale token — the new container regens, and
 * the user's public domain falls out of the allow-list. Doctor surfaces
 * this as a 502 on `openclaw.<domain>`. We re-add the public domain (and
 * the localhost variants the seeder put back) right after compose/run
 * comes up clean.
 *
 * Wait for the seeder to land its config before we read — otherwise we'd
 * race and find an empty `openclaw.json`. Bounded poll: ~6s total, exits
 * early as soon as the file is parseable. We don't restart the container
 * unless the merge actually changed something.
 */
async function* postUpdateReconcileOpenclaw(): AsyncGenerator<LifecycleEvent> {
  const secrets = await readEveSecrets();
  const domain = secrets?.domain?.primary;

  // Bounded wait so the freshly-recreated container has time to seed its
  // config. Doing it inline (not as a precondition in the reconcile fn)
  // keeps the helper testable in isolation while letting the live update
  // path absorb startup latency.
  const reconcile = await waitThenReconcileOpenclaw(domain);

  if (reconcile.notes.length > 0) {
    // Surface the headline note inline — most useful for the user is the
    // "re-added X" or "already in sync" line. We log every note so dump
    // logs from the dashboard show full context too.
    for (const n of reconcile.notes) {
      yield { type: "log", line: `OpenClaw: ${n}` };
    }
  }

  if (reconcile.changed) {
    // Restart so the new origins take effect — OpenClaw reads its config
    // at process start, not on every request. Restart is fine here (env
    // didn't change, only the on-disk file).
    const code = yield* dockerExec(["restart", "eve-arms-openclaw"], "Restarting OpenClaw to apply allowedOrigins…");
    if (code !== 0) {
      yield {
        type: "log",
        line: `OpenClaw: docker restart exited ${code} — config was updated but the container may still be serving the stale list`,
      };
    }
  }
}

/**
 * Wait up to ~6s for OpenClaw to write its config, then run the
 * reconcile. If it never appears (container down, image broken, etc.),
 * return whatever the reconcile says — it has its own structured no-op
 * paths that surface the cause.
 */
async function waitThenReconcileOpenclaw(
  domain: string | undefined,
): Promise<OpenclawReconcileResult> {
  const deadline = Date.now() + 6000;
  let last: OpenclawReconcileResult | null = null;
  while (Date.now() < deadline) {
    last = await reconcileOpenclawConfig({ domain });
    // Once we've successfully read SOMETHING (changed or already-in-sync),
    // we're done. The reconcile's no-op notes — `cat exited 1` for missing
    // file, "container is not running" — keep the loop going until either
    // the deadline or a clean read.
    const note = last.notes[0] ?? "";
    const stillBooting =
      note.includes("could not read") ||
      note.includes("not running");
    if (!stillBooting) return last;
    await new Promise(r => setTimeout(r, 500));
  }
  return last ?? {
    changed: false,
    before: { allowedOrigins: [], authTokenChanged: false },
    after: { allowedOrigins: [] },
    notes: ["reconcile timed out before OpenClaw seeded its config"],
  };
}

/**
 * Components that have an install recipe in this module (vs. CLI-only).
 * `update` falls back to the install path for these when the container
 * is missing (drift recovery). Keep in sync with the `runInstallRecipe`
 * switch below.
 */
const HAS_INSTALL_RECIPE: ReadonlySet<string> = new Set([
  "synap",
  "ollama",
  "rsshub",
  "openwebui",
  "openwebui-pipelines",
  "openclaw",
  "eve-dashboard",
]);

/** True if a container with that name exists (any state). 4s timeout. */
async function containerExists(name: string): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn("docker", ["ps", "-a", "--filter", `name=^${name}$`, "--format", "{{.Names}}"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill("SIGKILL");
      resolve(false);
    }, 4000);
    child.stdout?.on("data", chunk => { out += chunk.toString(); });
    child.on("close", () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(out.trim() === name);
    });
    child.on("error", () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function* removeOne(comp: ComponentInfo): AsyncGenerator<LifecycleEvent> {
  if (comp.alwaysInstall) {
    yield { type: "error", message: `${comp.label} is always-installed and cannot be removed.` };
    return;
  }

  const plan = removePlanFor(comp);

  if (plan.composeDir && existsSync(plan.composeDir)) {
    const code = yield* runCommand(
      "docker",
      ["compose", "down", "--volumes"],
      { cwd: plan.composeDir },
    );
    if (code !== 0) {
      yield { type: "log", line: `compose down exited ${code} — falling back to docker rm` };
    }
  }

  for (const name of plan.containerNames) {
    yield* dockerExec(["rm", "-f", name], `Removing ${name}…`);
  }

  // Special-case: eve-dashboard has its own teardown helper that also
  // cleans up the local image tag.
  if (comp.id === "eve-dashboard") {
    try {
      uninstallDashboardContainer();
    } catch (err) {
      yield {
        type: "log",
        line: `dashboard helper warning: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  try {
    await markRemoved(comp.id);
  } catch (err) {
    yield {
      type: "log",
      line: `warning: state.json wasn't updated (${err instanceof Error ? err.message : String(err)}) — dashboard list may show ${comp.label} until next sync`,
    };
  }
  yield { type: "done", summary: `${comp.label} removed` };
}

// ---------------------------------------------------------------------------
// Install — the big one. Each component has its own recipe; the recipe
// yields events as it runs and ends with `done` or `error`.
// ---------------------------------------------------------------------------

async function* installOne(
  comp: ComponentInfo,
  opts: InstallOptions,
): AsyncGenerator<LifecycleEvent> {
  // Prerequisite check — installed deps only.
  let installedSet: Set<string>;
  try {
    installedSet = new Set(await entityStateManager.getInstalledComponents());
  } catch {
    installedSet = new Set();
  }

  const missingDeps = (comp.requires ?? []).filter(d => !installedSet.has(d));
  if (missingDeps.length > 0) {
    yield {
      type: "error",
      message: `Missing prerequisites: ${missingDeps.join(", ")}. Install those first.`,
    };
    return;
  }

  if (installedSet.has(comp.id)) {
    yield { type: "log", line: `${comp.label} is already installed — re-running install (idempotent).` };
  }

  yield { type: "step", label: `Installing ${comp.label}…` };

  try {
    yield* runInstallRecipe(comp, opts);
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    return;
  }

  // After the recipe finishes, refresh Traefik routing so the new component
  // is reachable via subdomain.
  try {
    const refresh = await refreshTraefikRoutes();
    if (refresh.refreshed) {
      yield { type: "log", line: `Traefik routes refreshed for ${refresh.domain}` };
    }
  } catch {
    // not fatal — domain not configured or Traefik down
  }

  // State reconciliation. We've already done the docker work, so even if
  // this fails the component IS installed — surface the failure as a
  // warning rather than swallowing it. Operators need to know that
  // `eve status` and the dashboard catalog will show stale data until
  // they re-sync (e.g. via `eve grow`).
  try {
    await markInstalled(comp.id);
  } catch (err) {
    yield {
      type: "log",
      line: `warning: state.json wasn't updated (${err instanceof Error ? err.message : String(err)}) — dashboard list may show stale state until next sync`,
    };
  }

  // Auto-mint per-agent Hub API keys. Each Synap-aware component
  // (openclaw, hermes, openwebui-pipelines) has its own `agentType` on
  // the pod side; Synap's `/setup/agent` mints a separate user + key
  // per slug so audit / scope / revocation stays per-agent. We mint
  // them right after install so the freshly-running container can
  // auth on first request without a manual `eve auth provision`.
  //
  // For Synap itself we ALSO provision the always-on `eve` agent
  // (Doctor + dashboard probe identity). That gives a brand-new
  // install a working Hub key before any add-on is touched.
  yield* postInstallProvisionAgents(comp.id);

  // Once the eve agent key is in place (synap install only), seed the
  // Builder workspace so a fresh pod arrives with the developer schema
  // already wired (apps, packages, deployments, tasks, …). Idempotent
  // via `proposalId: "builder-workspace-v1"` — re-running install
  // resolves to the same workspace row instead of creating duplicates.
  if (comp.id === "synap") {
    yield* postInstallSeedBuilderWorkspace();
  }

  // Auto-seed AI provider config for components that consume AI. Without
  // this, a freshly installed openclaw / openwebui / synap sits there
  // until the user clicks "Apply" on the AI page. The wire path writes
  // the right env / auth file from the centralized `secrets.ai` config.
  if (AI_CONSUMERS.has(comp.id)) {
    try {
      const secrets = await readEveSecrets();
      const result = wireComponentAi(comp.id, secrets);
      if (result.outcome === "ok") {
        yield { type: "log", line: `AI config seeded: ${result.summary}` };
      } else if (result.outcome === "skipped") {
        yield { type: "log", line: `AI seed skipped: ${result.summary}` };
      } else {
        yield { type: "log", line: `warning: AI seed failed (${result.summary})` };
      }
    } catch (err) {
      yield {
        type: "log",
        line: `warning: AI seed step errored (${err instanceof Error ? err.message : String(err)})`,
      };
    }
  }

  yield { type: "done", summary: `${comp.label} installed` };
}

/** Per-component install recipe — throws on failure. */
async function* runInstallRecipe(
  comp: ComponentInfo,
  opts: InstallOptions,
): AsyncGenerator<LifecycleEvent> {
  switch (comp.id) {
    case "traefik":
      // Traefik install is a multi-step CLI flow involving secrets bootstrap +
      // file generation. Keep it on the CLI for now — the dashboard is
      // pre-Traefik in any sane install order anyway.
      throw new Error("Install Traefik from the CLI: `eve add traefik`. The dashboard runs on top of it.");

    case "synap": {
      const repo = opts.synapRepo ?? process.env.SYNAP_REPO_ROOT;
      if (!repo || !existsSync(repo)) {
        throw new Error(
          "Synap install needs a synap-backend checkout. " +
          "Set SYNAP_REPO_ROOT or pass --synap-repo on the host CLI.",
        );
      }
      // Defer to the brain organ's installer. We import lazily so the dashboard
      // bundle doesn't pull in `@eve/brain` until it's actually needed.
      const { runBrainInit } = await import("@eve/brain");
      await runBrainInit({
        synapRepo: repo,
        domain: "localhost",
        adminBootstrapMode: "token",
        withAi: false,
        withOpenclaw: false,
        withRsshub: false,
      });
      yield { type: "log", line: "Synap brain initialised" };
      return;
    }

    case "ollama": {
      const { runInferenceInit } = await import("@eve/brain");
      await runInferenceInit({
        model: opts.model ?? "llama3.1:8b",
        withGateway: true,
        internalOllamaOnly: true,
      });
      yield { type: "log", line: "Ollama up" };
      return;
    }

    case "rsshub": {
      const { RSSHubService } = await import("@eve/eyes");
      const rsshub = new RSSHubService();
      if (await rsshub.isInstalled()) {
        yield { type: "log", line: "RSSHub image already present — skipping pull" };
      } else {
        await rsshub.install({ port: 1200 });
      }
      yield { type: "log", line: "RSSHub container running" };
      return;
    }

    case "openwebui": {
      yield* installOpenWebUi();
      return;
    }

    case "openwebui-pipelines": {
      yield* installPipelinesSidecar();
      return;
    }

    case "eve-dashboard": {
      const secrets = await readEveSecrets();
      let secret = secrets?.dashboard?.secret;
      if (!secret) {
        secret = randomBytes(32).toString("hex");
        await writeEveSecrets({ dashboard: { secret, port: 7979 } });
        yield { type: "log", line: "Generated new dashboard secret (saved to ~/.eve/secrets.json)" };
      }
      installDashboardContainer({ workspaceRoot: process.cwd(), secret });
      yield { type: "log", line: "Dashboard container running" };
      return;
    }

    case "openclaw": {
      yield* installOpenclaw();
      return;
    }

    case "hermes":
    case "dokploy":
    case "opencode":
    case "openclaude":
      throw new Error(
        `${comp.label} install requires the host CLI right now. ` +
        `Run \`eve add ${comp.id}\` on the host — that path needs interactive input we can't reproduce here.`,
      );

    default:
      throw new Error(`No install recipe for ${comp.id}`);
  }
}

// ---------------------------------------------------------------------------
// Open WebUI install — pure file ops + docker compose
// ---------------------------------------------------------------------------

/**
 * Open WebUI compose template — single source of truth.
 *
 * Aligned with the official template
 * (https://github.com/open-webui/open-webui/blob/main/docker-compose.yaml)
 * with these deliberate deviations:
 *  - Service named `openwebui` (no hyphen) matches our state.json id.
 *  - `eve-network` external bridge so OpenClaw, Pipelines, Synap IS
 *    can reach each other by container name.
 *  - `env_file: .env` is the KEY fix: docker-compose's top-level .env
 *    is read for variable substitution in the YAML but vars are NOT
 *    automatically injected into containers. Without `env_file:`,
 *    anything pipelines wiring writes to `.env`
 *    (OPENAI_API_BASE_URLS, OPENAI_API_KEYS) would never reach the
 *    running container — chat requests would silently bypass the
 *    pipelines sidecar.
 *  - `extra_hosts: host.docker.internal:host-gateway` from upstream.
 *
 * Both install AND update call `writeOpenwebuiCompose()` so the file
 * is regenerated on every run. Users who customize should use
 * `docker-compose.override.yml` (compose's official extension hook),
 * not edit this file in place.
 */
const OPENWEBUI_COMPOSE_YAML = `# Open WebUI — generated by @eve/lifecycle (regenerated on every install/update)
services:
  openwebui:
    image: ghcr.io/open-webui/open-webui:\${WEBUI_DOCKER_TAG-main}
    container_name: hestia-openwebui
    restart: unless-stopped
    env_file:
      - .env
    environment:
      # Brand / chrome — makes OpenWebUI feel like part of Eve, not a
      # generic chat. Most of these are overridable via .env.
      - WEBUI_NAME=\${WEBUI_NAME:-Eve}
      - WEBUI_URL=\${WEBUI_URL:-}
      - WEBUI_DESCRIPTION=\${WEBUI_DESCRIPTION:-Sovereign AI chat wired to your Synap pod}

      - ENV=production
      - SCARF_NO_ANALYTICS=true
      - DO_NOT_TRACK=true

      # Backend wiring — Synap IS as the OpenAI-compat hub. The plural
      # OPENAI_API_BASE_URLS / OPENAI_API_KEYS are written to .env by
      # the pipelines install path; env_file: passes them straight to
      # the container, so they take precedence over the singulars below.
      - ENABLE_OPENAI_API=true
      - OPENAI_API_BASE_URL=\${SYNAP_IS_URL:-http://intelligence-hub:3001}/v1
      - OPENAI_API_KEY=\${SYNAP_API_KEY:-}
      - OLLAMA_BASE_URL=\${OLLAMA_BASE_URL:-http://eve-brain-ollama:11434}

      # Pre-selected model on first chat — \`synap/auto\` falls through to
      # the user's defaultProvider in IS, so it picks up secrets.ai.
      - DEFAULT_MODELS=\${DEFAULT_MODELS:-synap/auto}

      # Features
      - ENABLE_RAG=true
      - ENABLE_WEB_SEARCH=true
      - WEB_SEARCH_ENGINE=duckduckgo
      - ENABLE_COMMUNITY_SHARING=false

      # Auth — first signup auto-becomes admin (OpenWebUI's special-case).
      # Subsequent signups follow DEFAULT_USER_ROLE; "pending" forces the
      # admin to approve, which is the safer default for a network-bound
      # deployment.
      - ENABLE_SIGNUP=\${ENABLE_SIGNUP:-true}
      - DEFAULT_USER_ROLE=\${DEFAULT_USER_ROLE:-pending}
    ports:
      - "\${OPEN_WEBUI_PORT:-3011}:8080"
    volumes:
      - openwebui-data:/app/backend/data
    extra_hosts:
      - host.docker.internal:host-gateway
    networks:
      - eve-network

networks:
  eve-network:
    external: true

volumes:
  openwebui-data:
`;

/**
 * Write the OpenWebUI compose file (always overwrites). Call from both
 * install and update so a stale/corrupt file from an older install
 * is never the reason a deploy fails.
 */
function writeOpenwebuiCompose(deployDir: string): void {
  mkdirSync(deployDir, { recursive: true });
  writeFileSync(join(deployDir, "docker-compose.yml"), OPENWEBUI_COMPOSE_YAML);
}

async function* installOpenWebUi(): AsyncGenerator<LifecycleEvent> {
  const deployDir = "/opt/openwebui";

  const secrets = await readEveSecrets();
  // OpenWebUI's SYNAP_API_KEY is the bearer it uses to call Synap IS
  // when the Pipelines sidecar isn't sitting in front. Use the
  // openwebui-pipelines agent key when available — that's the
  // identity that should appear in IS's audit trail. Fall back to
  // the legacy single key for installs that haven't migrated yet.
  const pipelinesAgent = await readAgentKey("openwebui-pipelines");
  const synapApiKey =
    pipelinesAgent?.hubApiKey ??
    secrets?.synap?.apiKey ??
    process.env.SYNAP_API_KEY ??
    "";
  const isUrl = process.env.SYNAP_IS_URL ?? "http://intelligence-hub:3001";

  writeOpenwebuiCompose(deployDir);

  // Surface the public URL when a domain is set so OpenWebUI generates
  // correct absolute links (OAuth callbacks, sharing links, etc.).
  const domain = secrets?.domain?.primary;
  const ssl = !!secrets?.domain?.ssl;
  const protocol = ssl ? "https" : "http";
  const webuiUrl = domain ? `${protocol}://chat.${domain}` : "";

  const envPath = join(deployDir, ".env");
  if (!existsSync(envPath)) {
    writeFileSync(envPath, [
      "# Open WebUI — generated by @eve/lifecycle",
      "# Override anything in this file to customize without touching",
      "# docker-compose.yml (which is regenerated on every update).",
      "",
      "# Branding",
      `WEBUI_NAME=Eve`,
      `WEBUI_URL=${webuiUrl}`,
      "",
      "# Backend wiring",
      `SYNAP_API_KEY=${synapApiKey}`,
      `SYNAP_IS_URL=${isUrl}`,
      `OLLAMA_BASE_URL=http://eve-brain-ollama:11434`,
      "",
      "# Auth & first-run",
      "ENABLE_SIGNUP=true",
      "DEFAULT_USER_ROLE=pending",
      "",
      "# Secrets",
      `WEBUI_SECRET_KEY=${randomBytes(32).toString("hex")}`,
    ].join("\n"), { mode: 0o600 });
  }

  yield* ensureEveNetwork();

  const code = yield* runCommand(
    "docker", ["compose", "up", "-d"],
    { cwd: deployDir },
  );
  if (code !== 0) throw new Error(`docker compose up exited ${code}`);
}

// ---------------------------------------------------------------------------
// Open WebUI Pipelines sidecar
// ---------------------------------------------------------------------------

/**
 * Write the Pipelines sidecar compose file (always overwrites). Same
 * regenerate-on-every-call contract as `writeOpenwebuiCompose`. The
 * bind-mount path is a runtime arg so we can keep the YAML stable
 * across deploys with different EVE_HOME layouts.
 */
function writePipelinesCompose(deployDir: string, pipelinesDir: string): void {
  mkdirSync(deployDir, { recursive: true });
  const yaml = `# Open WebUI Pipelines — generated by @eve/lifecycle (regenerated on every install/update)
services:
  pipelines:
    image: ghcr.io/open-webui/pipelines:main
    container_name: eve-openwebui-pipelines
    restart: unless-stopped
    env_file:
      - .env
    # Bind-mount instead of a named volume so we can drop pipeline .py
    # files in from the host.
    volumes:
      - ${pipelinesDir}:/app/pipelines
    networks:
      - eve-network

networks:
  eve-network:
    external: true
`;
  writeFileSync(join(deployDir, "docker-compose.yml"), yaml);
}

/**
 * Reconcile `/opt/openwebui-pipelines/.env` so it reflects the current
 * `secrets.json`. Used by both first-install (`installPipelinesSidecar`)
 * and the update plan (so `eve update openwebui-pipelines` after
 * `eve auth provision` actually picks up the freshly minted hub key).
 *
 * PIPELINES_API_KEY is preserved across re-runs (Open WebUI authenticates
 * against the sidecar with it). The Synap vars are always rewritten to
 * current secrets.
 */
async function reconcilePipelinesEnv(deployDir: string): Promise<void> {
  const secrets = await readEveSecrets();
  const pipelinesAgent = await readAgentKey("openwebui-pipelines");
  const synapApiKey = pipelinesAgent?.hubApiKey ?? secrets?.synap?.apiKey ?? "";
  const synapApiUrl =
    secrets?.synap?.apiUrl ?? "http://synap-backend-backend-1:4000";
  const isUrl = process.env.SYNAP_IS_URL ?? "http://intelligence-hub:3001";

  const envPath = join(deployDir, ".env");
  const existing = existsSync(envPath)
    ? Object.fromEntries(
        readFileSync(envPath, "utf-8")
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#") && line.includes("="))
          .map((line) => {
            const eq = line.indexOf("=");
            return [line.slice(0, eq).trim(), line.slice(eq + 1)] as const;
          }),
      )
    : {};
  const pipelinesApiKey =
    existing.PIPELINES_API_KEY?.trim() || randomBytes(24).toString("hex");
  writeFileSync(envPath, [
    "# Pipelines sidecar — generated by @eve/lifecycle",
    `PIPELINES_API_KEY=${pipelinesApiKey}`,
    `SYNAP_API_URL=${synapApiUrl}`,
    `SYNAP_API_KEY=${synapApiKey}`,
    `SYNAP_IS_URL=${isUrl}`,
  ].join("\n"), { mode: 0o600 });
}

async function* installPipelinesSidecar(): AsyncGenerator<LifecycleEvent> {
  const deployDir = "/opt/openwebui-pipelines";
  const pipelinesDir = join(deployDir, "pipelines");
  mkdirSync(pipelinesDir, { recursive: true });

  // Drop the reference pipelines into the bind-mounted dir so the sidecar
  // picks them up on first boot. Currently 8: welcome, eve-help, hermes-
  // dispatch, knowledge-sync, calendar-awareness, notes-sync, memory-filter,
  // channel-sync. Re-running install overwrites them (idempotent — users
  // editing .py files in place will lose changes; that's by design for the
  // reference set, custom pipelines should use a different file name).
  yield* copyReferencePipelines(pipelinesDir);

  writePipelinesCompose(deployDir, pipelinesDir);
  await reconcilePipelinesEnv(deployDir);

  yield* ensureEveNetwork();

  const code = yield* runCommand(
    "docker", ["compose", "up", "-d"],
    { cwd: deployDir },
  );
  if (code !== 0) throw new Error(`docker compose up exited ${code}`);

  // Tell Open WebUI to call us — append to its env if present.
  //
  // Open WebUI's plural URL/key vars are SEMICOLON-separated and must align
  // by index: each base URL needs its own key (no fallback to the singular
  // OPENAI_API_KEY). Without this, requests to the pipelines URL go out
  // with the wrong bearer token and 401.
  //
  // We write LITERAL values (not `${SYNAP_API_KEY}` substitution syntax)
  // because compose `.env` files are mostly literal — interpolation
  // semantics vary across compose versions, and the OpenWebUI compose
  // file's `env_file: .env` directive ALSO needs literal values to pass
  // them straight to the container. Read the pipelines key back from
  // the sidecar's own .env so it stays in sync if regenerated.
  const owEnv = "/opt/openwebui/.env";
  if (existsSync(owEnv)) {
    const pipelinesEnvPath = join(deployDir, ".env");
    const pipelinesEnv = readFileSync(pipelinesEnvPath, "utf-8");
    const pipelinesKey = pipelinesEnv
      .split("\n")
      .find(l => l.startsWith("PIPELINES_API_KEY="))?.split("=", 2)[1] ?? "";
    const pipelinesSynapKey = pipelinesEnv
      .split("\n")
      .find(l => l.startsWith("SYNAP_API_KEY="))?.split("=", 2)[1] ?? "";

    const cur = readFileSync(owEnv, "utf-8");
    // Read the synap key already stored in OpenWebUI's .env so we can
    // emit it as a literal in OPENAI_API_KEYS — no compose-time
    // interpolation, no env_file passthrough surprises.
    const synapKeyFromEnv = cur
      .split("\n")
      .find(l => l.startsWith("SYNAP_API_KEY="))?.split("=", 2)[1] ?? pipelinesSynapKey;

    const marker = "# Pipelines wiring — managed by @eve/lifecycle";
    const stripped = cur.includes(marker) ? cur.split(marker)[0].trimEnd() : cur.trimEnd();
    const block = [
      marker,
      "OPENAI_API_BASE_URLS=http://eve-openwebui-pipelines:9099;http://intelligence-hub:3001/v1",
      `OPENAI_API_KEYS=${pipelinesKey};${synapKeyFromEnv}`,
    ].join("\n");
    writeFileSync(owEnv, (stripped ? stripped + "\n\n" : "") + block + "\n", { mode: 0o600 });

    // `docker restart` doesn't re-read .env — only `compose up -d` does.
    yield* runCommand(
      "docker", ["compose", "up", "-d"],
      { cwd: "/opt/openwebui" },
    );
  }
}

/**
 * Copy reference pipelines into the bind-mounted dir.
 *
 * Looks in two places — first the assets dir relative to this module
 * (works in dev / when running from source), then a fallback path inside
 * the container image (works in the dashboard's Docker build, which copies
 * `assets/` next to `dist/`).
 */
async function* copyReferencePipelines(targetDir: string): AsyncGenerator<LifecycleEvent> {
  const { copyFileSync, readdirSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname } = await import("node:path");

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "assets", "pipelines"),       // dev / built dist/ next to assets/
    join(here, "assets", "pipelines"),             // tsup might co-locate
    "/app/packages/@eve/lifecycle/assets/pipelines", // container baked path
  ];

  let sourceDir: string | null = null;
  for (const c of candidates) {
    if (existsSync(c)) { sourceDir = c; break; }
  }

  if (!sourceDir) {
    yield {
      type: "log",
      line: "warning: reference pipelines not found in package — pipelines container will start empty",
    };
    return;
  }

  let count = 0;
  for (const file of readdirSync(sourceDir)) {
    if (!file.endsWith(".py")) continue;
    copyFileSync(join(sourceDir, file), join(targetDir, file));
    count += 1;
  }
  yield { type: "log", line: `Installed ${count} reference pipeline${count === 1 ? "" : "s"} into ${targetDir}` };
}

// ---------------------------------------------------------------------------
// OpenClaw — agent runtime, drives off secrets.json so config changes apply
// on recreate. Mirrors the env shape of @eve/arms's OpenClawService but
// reads from secrets directly so the dashboard's channels page can
// re-wire messaging/voice and have it actually take effect.
// ---------------------------------------------------------------------------

const OPENCLAW_CONTAINER = "eve-arms-openclaw";

async function* installOpenclaw(): AsyncGenerator<LifecycleEvent> {
  const secrets = await readEveSecrets();

  const ollamaUrl = process.env.OLLAMA_URL ?? "http://eve-brain-ollama:11434";
  const synapApiUrl = secrets?.synap?.apiUrl ?? "";
  // OpenClaw uses the openclaw agent's key for Hub Protocol — its own
  // user, scopes, and audit trail on the pod. Fall back to the legacy
  // shared key only for pre-migration installs.
  const openclawAgent = await readAgentKey("openclaw");
  const synapApiKey = openclawAgent?.hubApiKey ?? secrets?.synap?.apiKey ?? "";
  const dokployApiUrl = secrets?.builder?.dokployApiUrl ?? "";

  // Pick the AI provider that drives OpenClaw — honors per-service
  // override (`secrets.ai.serviceProviders.openclaw`) and falls back
  // to the global default. Its `defaultModel` becomes OpenClaw's
  // `DEFAULT_MODEL` env var (replaces the hardcoded "llama3.2").
  const aiProvider = pickPrimaryProvider(secrets, "openclaw");
  const defaultModel = aiProvider?.defaultModel ?? "llama3.2";

  // Read messaging + voice config straight from secrets — the channels
  // page writes here, so this is what the live container must see.
  const m = secrets?.arms?.messaging ?? {};
  const v = secrets?.arms?.voice ?? {};

  yield* ensureEveNetwork();

  yield { type: "step", label: "Pulling OpenClaw image…" };
  const pullCode = yield* runCommand(
    "docker", ["pull", "ghcr.io/openclaw/openclaw:latest"],
  );
  if (pullCode !== 0) throw new Error(`docker pull exited ${pullCode}`);

  yield { type: "step", label: "Starting OpenClaw…" };
  const args = [
    "run", "-d",
    "--name", OPENCLAW_CONTAINER,
    "--network", "eve-network",
    "-p", "3000:3000",
    "-e", `OLLAMA_URL=${ollamaUrl}`,
    "-e", `DEFAULT_MODEL=${defaultModel}`,
    "-e", `SYNAP_API_URL=${synapApiUrl}`,
    "-e", `SYNAP_API_KEY=${synapApiKey}`,
    "-e", `DOKPLOY_API_URL=${dokployApiUrl}`,
    "-e", `MESSAGING_ENABLED=${Boolean(m.enabled)}`,
    "-e", `MESSAGING_PLATFORM=${m.platform ?? ""}`,
    "-e", `MESSAGING_BOT_TOKEN=${m.botToken ?? ""}`,
    "-e", `VOICE_ENABLED=${Boolean(v.enabled)}`,
    "-e", `VOICE_PROVIDER=${v.provider ?? ""}`,
    "-e", `VOICE_PHONE_NUMBER=${v.phoneNumber ?? ""}`,
    "-e", `VOICE_SIP_URI=${v.sipUri ?? ""}`,
    "-v", "eve-arms-openclaw-data:/data",
    "--restart", "unless-stopped",
    "ghcr.io/openclaw/openclaw:latest",
  ];
  const runCode = yield* runCommand("docker", args);
  if (runCode !== 0) throw new Error(`docker run exited ${runCode}`);
  yield { type: "log", line: "OpenClaw container running" };
}

/**
 * Remove deprecated top-level keys from a docker-compose.yml file in place.
 *
 * Currently strips `version:` (obsolete in Compose v2 — every command
 * prints a warning when it's present). Idempotent: leaves files without
 * the key untouched. Best-effort: missing file or unreadable content is
 * a no-op so we don't fail the update over a sanitization step.
 */
function sanitizeComposeFile(path: string): void {
  try {
    if (!existsSync(path)) return;
    const cur = readFileSync(path, "utf-8");
    // Match `version:` at start of a line, regardless of quotes/whitespace.
    const cleaned = cur.replace(/^version:\s*['"]?[^\n]*['"]?\s*\n/m, "");
    if (cleaned !== cur) writeFileSync(path, cleaned);
  } catch {
    // non-fatal — update can still proceed with the version warning
  }
}

/**
 * Ensure the shared `eve-network` exists. Quiet by design — the previous
 * implementation used `docker network inspect` which dumps multi-line
 * JSON to stdout when the network exists; that JSON ends up in the
 * lifecycle's log buffer and clutters error tails. We use a check that
 * only emits a single line ("eve-network" or empty), and we don't yield
 * its output as `log` events — only the actual create when it's missing.
 */
async function* ensureEveNetwork(): AsyncGenerator<LifecycleEvent> {
  let exists = false;
  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      const child = spawn("docker", ["network", "ls", "--filter", "name=^eve-network$", "--format", "{{.Name}}"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      const t = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("timeout")); }, 4000);
      child.stdout.on("data", c => { out += c.toString(); });
      child.on("close", () => { clearTimeout(t); resolve({ stdout: out }); });
      child.on("error", e => { clearTimeout(t); reject(e); });
    });
    exists = stdout.trim() === "eve-network";
  } catch {
    // Treat probe failure as "missing" — the create will fail loudly if
    // there's a real docker problem, surfacing the real error.
  }

  if (!exists) {
    yield { type: "step", label: "Creating eve-network…" };
    yield* runCommand("docker", ["network", "create", "eve-network"]);
  }
}

// ---------------------------------------------------------------------------
// State reconciliation
// ---------------------------------------------------------------------------

const ORGAN_MAP: Record<string, "brain" | "arms" | "builder" | "eyes" | "legs"> = {
  synap: "brain",
  ollama: "brain",
  openclaw: "arms",
  hermes: "builder",
  rsshub: "eyes",
  traefik: "legs",
  openwebui: "eyes",
  "openwebui-pipelines": "eyes",
  dokploy: "builder",
  opencode: "builder",
  openclaude: "builder",
  "eve-dashboard": "legs",
};

async function markInstalled(componentId: string): Promise<void> {
  const organ = ORGAN_MAP[componentId];
  if (organ) await entityStateManager.updateOrgan(organ, "ready", { version: "0.1.0" });
  await entityStateManager.updateComponentEntry(componentId, { state: "ready" });
  const current = await entityStateManager.getInstalledComponents();
  if (!current.includes(componentId)) {
    await entityStateManager.updateSetupProfile({ components: [...current, componentId] });
  }
}

async function markRemoved(componentId: string): Promise<void> {
  const organ = ORGAN_MAP[componentId];
  if (organ) await entityStateManager.updateOrgan(organ, "missing");
  await entityStateManager.updateComponentEntry(componentId, { state: "missing" });
  const current = await entityStateManager.getInstalledComponents();
  const next = current.filter(id => id !== componentId);
  await entityStateManager.updateSetupProfile({ components: next });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a lifecycle action against a component.
 *
 * Returns an async generator that yields `step | log | done | error` events.
 * Errors are *yielded*, never thrown — caller decides how to surface them.
 */
export async function* runAction(
  componentId: string,
  action: LifecycleAction,
  opts: InstallOptions = {},
): AsyncGenerator<LifecycleEvent> {
  let comp: ComponentInfo;
  try {
    comp = resolveComponent(componentId);
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    return;
  }

  switch (action) {
    case "install":  yield* installOne(comp, opts); return;
    case "remove":   yield* removeOne(comp); return;
    case "update":   yield* updateContainer(comp); return;
    case "start":    yield* startContainer(comp); return;
    case "stop":     yield* stopContainer(comp); return;
    case "restart":  yield* restartContainer(comp); return;
    case "recreate": yield* recreateContainer(comp, opts); return;
  }
}

/**
 * Recreate a container so it picks up new env / secrets.
 *
 * `docker restart` doesn't re-read env vars or `.env` files — it just
 * SIGTERMs and starts the same container with the same args. For
 * components whose config lives in secrets.json (openclaw messaging /
 * voice) or in a compose `.env` (openwebui pipelines wiring), restart
 * silently keeps the stale config. `recreate` does the right thing:
 * remove the container, then re-run the install recipe so the new
 * env / secrets land in the new container.
 */
async function* recreateContainer(
  comp: ComponentInfo,
  opts: InstallOptions,
): AsyncGenerator<LifecycleEvent> {
  // Stop + remove (best-effort — fine if the container doesn't exist).
  const name = comp.service?.containerName;
  if (name) {
    yield { type: "step", label: `Removing ${comp.label} container…` };
    yield* runCommand("docker", ["rm", "-f", name]);
  }
  yield* installOne(comp, opts);
}

/** Drain the generator into a single result — for callers that don't stream. */
export async function runActionToCompletion(
  componentId: string,
  action: LifecycleAction,
  opts: InstallOptions = {},
): Promise<{ ok: boolean; summary: string; logs: string[]; error?: string }> {
  const logs: string[] = [];
  let summary = "";
  let error: string | undefined;

  for await (const ev of runAction(componentId, action, opts)) {
    if (ev.type === "log") logs.push(ev.line);
    else if (ev.type === "step") logs.push(`▶ ${ev.label}`);
    else if (ev.type === "done") summary = ev.summary;
    else if (ev.type === "error") error = ev.message;
  }

  return { ok: !error, summary, logs, error };
}

/** Re-export the component registry so callers don't need a separate import. */
export { COMPONENTS, resolveComponent } from "@eve/dna";
export type { ComponentInfo } from "@eve/dna";

// Atomic .env file helpers — used by `eve mode` and anyone else
// flipping a single key on a compose-based component without
// reimplementing parse/write/atomic-rename for the Nth time.
export {
  readEnvVar,
  readEnvFile,
  writeEnvVar,
  type WriteEnvVarResult,
} from "./env-files.js";

// Hub Protocol diagnostics — shared between `eve doctor` (CLI) and the
// dashboard's `/api/doctor` route. Framework-agnostic; both surfaces map
// the neutral `HubProtocolDiagnostic` into their own row shape.
export {
  runHubProtocolProbes,
  probeSynapDiscovery,
  truncate,
  shortId,
  extractEntityId,
  deleteEntityBestEffort,
  combineSignals,
  isFetchTransportError,
  FetchRunner,
  type HubProtocolDiagnostic,
  type HubProtocolProbeId,
  type ProbeStatus,
  type RunHubProtocolProbesOptions,
  type IDoctorRunner,
  type DoctorRunnerResponse,
  type DoctorRunnerStream,
} from "./diagnostics.js";

// Auth — introspectable, renewable per-agent keys. Replaces the older
// "mint random secret on install, never check it again" model. The
// `provisionAgent` / `provisionAllAgents` / `migrateLegacyToAgents`
// surface drives the per-agent key model end-to-end.
export {
  getAuthStatus,
  isKeyValid,
  renewAgentKey,
  provisionAgent,
  provisionAllAgents,
  migrateLegacyToAgents,
  type AuthStatus,
  type AuthFailure,
  type AuthFailReason,
  type AuthResult,
  type GetAuthStatusOptions,
  type RenewAgentKeyOptions,
  type RenewResult,
  type ProvisionAgentOptions,
  type ProvisionResult,
} from "./auth.js";

// OpenClaw reconciliation — re-applies Eve's expected `allowedOrigins`
// after the container regenerates its config. Used by the lifecycle's
// post-update hook AND surfaced to the CLI as `eve mode reconcile-openclaw`
// for one-shot manual repairs (drift, new domain, etc.).
export {
  reconcileOpenclawConfig,
  type OpenclawReconcileResult,
  type OpenclawReconcileOptions,
  type OpenclawReconcileBefore,
  type OpenclawReconcileAfter,
} from "./components/openclaw/reconcile.js";

// Builder workspace seeder — posts the bundled `builder-workspace.json`
// template to the user's pod via `POST /api/hub/workspaces/from-definition`.
// Idempotent via `proposalId: "builder-workspace-v1"`. Wired into both the
// install and update post-hooks so every Eve install (fresh or upgraded)
// arrives with the developer schema already seeded.
export {
  ensureBuilderWorkspace,
  type EnsureBuilderWorkspaceOptions,
  type EnsureBuilderWorkspaceResult,
} from "./builder-workspace.js";
