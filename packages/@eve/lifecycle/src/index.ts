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

import { execSync, spawn } from "node:child_process";
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
  resolveSynapUrl,
  resolveSynapUrlOnHost,
  SYNAP_BACKEND_INTERNAL_URL,
  AI_CONSUMERS,
  AI_CONSUMERS_NEEDING_RECREATE,
  pruneOldImagesForRepo,
  ensureSynapLoopbackOverride,
  connectTraefikToEveNetwork,
  writeHermesConfigYaml,
  generateSynapPlugin,
  buildOpenwebuiModelSources,
  buildOpenwebuiManagedConfig,
  registerOpenwebuiAdminApi,
  syncOpenwebuiExtras,
  formatExtrasSummary,
  ensureOpenWebuiBootstrapSecrets,
  writeOpenwebuiEnv,
  appendOperationalEvent,
  configStore,
  findPodDeployDir,
  type OpenwebuiStatus,
  type ComponentInfo,
  type EnsureOverrideResult,
  type RepairRequest,
  type RepairResult,
  type WireAiResult,
} from "@eve/dna";
import {
  installDashboardContainer,
  uninstallDashboardContainer,
} from "@eve/legs";
import { runSynapCli, reconcileEveEnv, backupPodSecrets, restorePodSecrets } from "@eve/brain";
import {
  reconcileOpenclawConfig,
  type OpenclawReconcileResult,
} from "./components/openclaw/reconcile.js";
import { ensureBuilderWorkspace } from "./builder-workspace.js";
import { materializeTargets } from "./materialize.js";

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
    /**
     * Idempotently write a sibling `docker-compose.override.yml` Eve
     * owns (currently only synap, for the loopback host port mapping).
     * Returns a result object so the runner can log "wrote" vs "kept
     * user-owned file" without needing to know what the override is for.
     */
    ensureOverride?: () => EnsureOverrideResult;
    /**
     * Image-pruning policy applied AFTER a successful `compose up -d`.
     * For each repository in the list, all but the most-recent N image
     * tags are removed. In-use tags (those mapping to running containers)
     * are skipped automatically by `docker rmi`. Default `keep` is 3.
     *
     * Scoped to repository prefix so we never accidentally prune images
     * belonging to a different compose project on the same host.
     */
    pruneImages?: { repositories: string[]; keep?: number };
  };
  /**
   * Delegate the update to an external CLI script that owns the install /
   * migrate / restart sequence (currently: synap-backend's `synap` bash
   * binary). Eve performs its own pre-steps (loopback override, eve-network)
   * and post-steps (image prune, post-update hooks) around the delegate
   * call, but the canary + DB migration + container recreation are entirely
   * the delegate's responsibility.
   */
  delegate?: {
    /** Compose dir Eve checks for existence + writes overrides into. */
    cwd: string;
    /** Subcommand to run (e.g. 'update'). */
    subcommand: 'update' | 'install' | 'restart';
    /** Args passed after the subcommand. */
    args?: string[];
    /** Optional pre-CLI loopback override hook (same shape as compose.ensureOverride). */
    ensureOverride?: () => EnsureOverrideResult;
    /** Pull the synap-backend git checkout before invoking the CLI. */
    refreshGit?: boolean;
    /**
     * Resolve the bare root domain from eve state at runtime. When set,
     * `runDelegatePlan` derives the pod FQDN (`pod.<root>`) and passes it
     * to the synap CLI — heals .env files written before the FQDN fix.
     */
    resolveDomain?: () => Promise<string | undefined>;
    /** Same prune policy as the compose branch — applied AFTER the CLI returns. */
    pruneImages?: { repositories: string[]; keep?: number };
  };
}

const UPDATE_PLAN: Record<string, UpdatePlan> = {
  traefik: { imagePull: "traefik:v3.0" },
  ollama: { imagePull: "ollama/ollama:latest" },
  openclaw: { imagePull: "ghcr.io/openclaw/openclaw:latest" },
  // Hermes: pull latest image, then regenerate config + plugin so the new
  // container starts with the current Synap memory provider and AI wiring.
  hermes: { imagePull: "nousresearch/hermes-agent:latest" },
  rsshub: { imagePull: "diygod/rsshub:latest" },
  nango: { imagePull: "nangohq/nango:latest" },
  // openwebui + pipelines were installed via `docker compose up -d`. After
  // a remove/down the container is gone, so a plain `docker restart` after
  // pull would fail with "No such container". `compose pull && compose up
  // -d` is idempotent — recreates if needed, restarts in place if not.
  openwebui: {
    compose: {
      cwd: "/opt/openwebui",
      regenerate: () => writeOpenwebuiCompose("/opt/openwebui"),
      reconcileEnv: () => reconcileOpenwebuiEnv("/opt/openwebui"),
    },
  },
  synap: {
    // Synap delegates to the canonical synap-backend bash CLI, which owns the
    // canary-first update flow, kratos-migrate force-recreate, CREATE DATABASE
    // idempotency, and migration sequencing. Eve still owns: loopback override,
    // eve-network attach, post-update hooks (Traefik/agent/AI wiring).
    // See: hestia-cli/.docs/synap-cli-as-source-of-truth.md
    delegate: {
      // Compose dir: synap-backend uses a git-checkout layout where the
      // compose file lives in `<repoRoot>/deploy/`. Eve clones into
      // `/opt/synap-backend/`, so the compose dir is `/opt/synap-backend/deploy/`.
      cwd: "/opt/synap-backend/deploy",
      subcommand: "update",
      // Don't pass `--from-image` or `--from-source` — let the synap CLI's
      // smart default decide. Its rules (synap line ~1838): if `.env` has
      // `BACKEND_VERSION=local` → build from source (skip the doomed pull
      // of the `:local` sentinel that never existed upstream); if we're in
      // a git checkout → build from source; otherwise → pull. Forcing
      // `--from-image` here meant every update tried to pull `:local`, hit
      // 404, and fell back to a build that — without `refreshGit` having
      // already run — was using whatever stale code happened to be on disk.
      args: [],
      // Idempotently write the loopback host-port override so the on-host
      // CLI can reach the backend at 127.0.0.1:4000 without going through
      // Traefik. Runs before the synap CLI so the recreated container
      // starts with the binding already in place.
      ensureOverride: () => ensureSynapLoopbackOverride("/opt/synap-backend/deploy"),
      refreshGit: true,
      // Heal `.env` if it was written with the bare root domain instead of
      // the pod FQDN. Reads from the centralised configStore at runtime.
      resolveDomain: async () => {
        const secrets = await configStore.get();
        return secrets?.domain?.primary;
      },
      // synap-backend, backend-canary, backend-migrate, realtime — all
      // share the same `ghcr.io/synap-core/backend` image. pod-agent
      // ships separately. Keep three so the user can still roll back
      // one or two versions if a deploy regresses.
      pruneImages: {
        repositories: ["ghcr.io/synap-core/backend", "ghcr.io/synap-core/pod-agent"],
        keep: 3,
      },
    },
  },
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
  if (plan.delegate) {
    yield* runDelegatePlan(comp, plan.delegate);
    return;
  }
  if (plan.compose) {
    yield { type: "step", label: `${comp.label} — prepare` };

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

    // Self-heal Eve-managed compose overrides (currently: synap loopback
    // port). Failures here are NOT fatal — the CLI works without the
    // loopback override, just slower (public URL fallback).
    if (plan.compose.ensureOverride) {
      try {
        const r = plan.compose.ensureOverride();
        yield {
          type: "log",
          line: r.outcome === "wrote"
            ? `Refreshed ${r.path}`
            : `Left ${r.path} alone — ${r.reason ?? "user-owned"}`,
        };
      } catch (err) {
        yield {
          type: "log",
          line: `Could not ensure compose override: ${err instanceof Error ? err.message : String(err)} (continuing)`,
        };
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
    yield { type: "step", label: `${comp.label} — pull images` };
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
    yield { type: "step", label: `${comp.label} — start containers` };
    const upArgs = services.length > 0
      ? ["compose", "up", "-d", "--no-deps", ...services]
      : ["compose", "up", "-d"];
    code = yield* runCommand("docker", upArgs, { cwd: plan.compose.cwd });
    if (code !== 0) { yield { type: "error", message: `compose up exited ${code}` }; return; }

    // Reclaim disk by removing old image versions. We deliberately run
    // this AFTER the new container is up — Docker's rmi refuses to drop
    // images backing live containers, so the in-flight version stays
    // safe even if `keep=1`. Failures (image still in use, network
    // glitch) are logged but never abort the update.
    if (plan.compose.pruneImages) {
      const keep = plan.compose.pruneImages.keep ?? 3;
      for (const repo of plan.compose.pruneImages.repositories) {
        try {
          const result = pruneOldImagesForRepo(repo, keep);
          if (result.removed.length > 0) {
            yield {
              type: "log",
              line: `Pruned ${result.removed.length} old ${repo} image(s) — kept latest ${keep} (${result.kept.length} remain).`,
            };
          }
          if (result.skipped.length > 0) {
            yield {
              type: "log",
              line: `Skipped ${result.skipped.length} ${repo} image(s) still in use by other containers.`,
            };
          }
        } catch (err) {
          yield {
            type: "log",
            line: `Image prune for ${repo} skipped: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
    }

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

/**
 * Delegate-plan runner — invoke an external CLI script (synap-backend's bash
 * `synap` binary) for the install/migrate/recreate sequence, with eve's
 * pre-steps (loopback override, eve-network) and post-steps (image prune)
 * around it. The post-update hooks (Traefik attach, agent provisioning, AI
 * wiring) still fire from `runPostUpdateHooks`, AFTER this returns ok.
 */
async function* runDelegatePlan(
  comp: ComponentInfo,
  plan: NonNullable<UpdatePlan["delegate"]>,
): AsyncGenerator<LifecycleEvent> {
  if (plan.ensureOverride) {
    try {
      const r = plan.ensureOverride();
      yield {
        type: "log",
        line: r.outcome === "wrote"
          ? `Refreshed ${r.path}`
          : `Left ${r.path} alone — ${r.reason ?? "user-owned"}`,
      };
    } catch (err) {
      yield {
        type: "log",
        line: `Could not ensure compose override: ${err instanceof Error ? err.message : String(err)} (continuing)`,
      };
    }
  }

  if (!existsSync(plan.cwd)) {
    yield { type: "error", message: `Compose dir not found: ${plan.cwd}.` };
    return;
  }

  // Pre-flight: refuse `update` when the install never completed. Without
  // a populated `.env`, `compose up` would launch postgres with a blank
  // POSTGRES_PASSWORD (because compose substitutes ${VAR} from env, and
  // every var defaults to ""). That detonates the postgres volume — the
  // container starts, can't authenticate, restart-loops, and migrations
  // fail. Detect this BEFORE invoking the delegate.
  //
  // Two failure modes covered:
  //   (a) `.env` missing entirely (install crashed before generate_and_create_env)
  //   (b) `.env` exists but POSTGRES_PASSWORD is blank/missing AND eve has
  //       no podSecrets backup to restore from (the reconcile branch below
  //       handles the case where backup IS available).
  if (plan.subcommand === "update") {
    const envPath = join(plan.cwd, ".env");
    const envExists = existsSync(plan.cwd) && existsSync(envPath);
    let envHasPostgresPassword = false;
    if (envExists) {
      try {
        const env = readFileSync(envPath, "utf-8");
        envHasPostgresPassword = /^POSTGRES_PASSWORD=.+$/m.test(env);
      } catch {
        // Read failure → treat as broken
      }
    }
    if (!envExists || !envHasPostgresPassword) {
      yield {
        type: "error",
        message: [
          `${comp.label}: install was never completed (${envExists ? "POSTGRES_PASSWORD missing in .env" : ".env missing"} at ${plan.cwd}).`,
          ``,
          `Running update against an unconfigured stack would launch postgres with`,
          `a blank password and destroy the volume. Refusing.`,
          ``,
          `Run \`eve install ${comp.id}\` to complete the initial setup, then`,
          `\`eve update ${comp.id}\` for subsequent updates.`,
        ].join("\n"),
      };
      return;
    }
  }

  // The synap CLI's compose file references `eve-network` as `external: true`.
  // If the network was ever pruned, `compose up` aborts. Create it before the
  // CLI runs so the delegate is self-recovering.
  yield* ensureEveNetwork();

  // Resolve the bare root domain so runSynapCli can heal an existing .env
  // whose DOMAIN= line was written before eve enforced the pod FQDN
  // convention. No-op when no resolver is configured.
  const bareDomain = plan.resolveDomain ? await plan.resolveDomain() : undefined;
  if (plan.resolveDomain && !bareDomain) {
    yield {
      type: "log",
      line: "No domain in eve secrets — synap CLI will use whatever DOMAIN is already in .env",
    };
  }

  // Pre-CLI .env reconciliation:
  //   1. Strip legacy KRATOS_CONFIG_DIR=./config/kratos (eve-flat-layout artefact).
  //   2. Restore pod-critical secrets from `secrets.json:synap.podSecrets` if
  //      the .env is missing them — protects against a half-migrated stub .env
  //      whose blank POSTGRES_PASSWORD would lock the postgres volume forever.
  // The CLI's `cmd_update` ends with `compose up -d backend realtime ...`,
  // which recreates the container if .env content changed — so healing here
  // means the new container boots with the right env.
  const envPath = join(plan.cwd, ".env");
  if (existsSync(envPath)) {
    const dirty = reconcileEveEnv(envPath);
    if (dirty) {
      yield { type: "log", line: "Reconciled eve-specific .env vars before delegating" };
    }
    try {
      const restored = await restorePodSecrets(envPath);
      if (restored.restored.length > 0) {
        yield {
          type: "log",
          line: `Restored ${restored.restored.length} pod secret(s) from eve backup: ${restored.restored.join(", ")}`,
        };
      }
    } catch (err) {
      yield {
        type: "log",
        line: `Pod-secrets restore failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  yield {
    type: "log",
    line: `Delegating ${comp.label} ${plan.subcommand} to synap CLI…`,
  };

  const result = runSynapCli(plan.subcommand, plan.args ?? [], {
    refreshGit: plan.refreshGit,
    domain: bareDomain,
  });

  if (!result.ok) {
    yield {
      type: "error",
      message: `synap ${plan.subcommand} exited ${result.exitCode}${result.stderr ? `: ${result.stderr}` : ""}`,
    };
    return;
  }

  // Refresh the eve-side backup of pod-critical secrets. Best-effort; never
  // fails the delegate. Synap CLI's cmd_update may have rotated values
  // (e.g. SYNAP_SERVICE_ENCRYPTION_KEY self-heal); capture the current state.
  if (existsSync(envPath)) {
    try {
      const captured = await backupPodSecrets(envPath);
      if (captured.captured.length > 0) {
        yield {
          type: "log",
          line: `Refreshed pod-secrets backup (${captured.captured.length} key(s) captured)`,
        };
      }
    } catch (err) {
      yield {
        type: "log",
        line: `Pod-secrets backup failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (plan.pruneImages) {
    const keep = plan.pruneImages.keep ?? 3;
    for (const repo of plan.pruneImages.repositories) {
      try {
        const pruneResult = pruneOldImagesForRepo(repo, keep);
        if (pruneResult.removed.length > 0) {
          yield {
            type: "log",
            line: `Pruned ${pruneResult.removed.length} old ${repo} image(s) — kept latest ${keep} (${pruneResult.kept.length} remain).`,
          };
        }
        if (pruneResult.skipped.length > 0) {
          yield {
            type: "log",
            line: `Skipped ${pruneResult.skipped.length} ${repo} image(s) still in use by other containers.`,
          };
        }
      } catch (err) {
        yield {
          type: "log",
          line: `Image prune for ${repo} skipped: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }

  // Synap-only: probe pod-admin invariant after the delegate run. Catches
  // the broken-but-running state where Kratos is fine, the backend serves
  // tRPC, but the pod-admin workspace has no owners — every admin surface
  // returns 403 silently otherwise. Surface a one-shot recovery command
  // instead of letting operators re-discover the failure on next login.
  if (comp.id === "synap") {
    yield* probePodAdminInvariant();
  }

  yield { type: "done", summary: `${comp.label} updated via synap CLI` };
}

/**
 * Hit `${podUrl}/api/hub/setup/status` (loopback) and surface the pod-admin
 * invariant. Non-fatal — never aborts the update; just adds operator-visible
 * guidance when something is wrong. The endpoint is unauthenticated so we
 * don't need to thread API keys here.
 */
async function* probePodAdminInvariant(): AsyncGenerator<LifecycleEvent> {
  const url = "http://127.0.0.1:14000/api/hub/setup/status";
  let body: {
    needsSetup?: boolean;
    podAdminInvariant?: { healthy?: boolean; kind?: string; reason?: string };
  };
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      yield {
        type: "log",
        line: `Pod-admin invariant probe: HTTP ${res.status} (skipping)`,
      };
      return;
    }
    body = (await res.json()) as typeof body;
  } catch (err) {
    yield {
      type: "log",
      line: `Pod-admin invariant probe failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
    };
    return;
  }

  const inv = body.podAdminInvariant;
  if (!inv) {
    // Old backend without invariant exposure — fine, that's why the field
    // is optional. Skip silently.
    return;
  }

  if (inv.healthy) {
    yield {
      type: "log",
      line: `Pod-admin invariant healthy (${inv.reason ?? "ok"})`,
    };
    return;
  }

  // Fresh installs are expected to have no admin yet — that's bootstrap, not
  // a regression. Don't shout at the operator.
  if (inv.kind === "fresh" || body.needsSetup === true) {
    yield {
      type: "log",
      line: "Pod-admin invariant: pre-bootstrap (no admin yet — run `synap setup admin` to seed one)",
    };
    return;
  }

  // Real broken state — actionable warning with a copy-paste recovery line.
  yield {
    type: "log",
    line:
      `⚠ Pod-admin invariant BROKEN (${inv.kind ?? "unknown"}): ${inv.reason ?? "unknown reason"}.\n` +
      `  Recover with:\n` +
      `    synap setup admin --email <your-email> --password <new-password>\n` +
      `  (run inside /opt/synap-backend or wherever your synap CLI lives).`,
  };
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
  yield { type: "step", label: `${comp.label} — post-update wiring` };
  if (comp.id === "openclaw") {
    yield* postUpdateReconcileOpenclaw();
    yield* postUpdateReconcileAiWiring();
  }
  if (comp.id === "synap") {
    // Kratos lifecycle (config regen, migrate, force-recreate) is now owned
    // by the synap CLI delegate. Eve only handles the cross-project plumbing
    // (Traefik attach, agent key verify, AI wiring cascade) below.
    yield* postUpdateConnectTraefik();
    yield* postUpdateReconcileAuth();
    yield* postUpdateReconcileAiWiring();
  }
  if (comp.id === "hermes") {
    yield* postUpdateReconcileHermes();
    yield* postUpdateReconcileAiWiring();
  }
  if (comp.id === "openwebui") {
    // One-time migration: tear down the retired Pipelines sidecar that
    // older installs still have running. No-op when the container, deploy
    // dir, and entity-state row are all already absent.
    yield* decommissionLegacyPipelines();
    // Validate the agent keys OpenWebUI relies on (eve = the bearer baked
    // into Synap connection + tool server + functions; hermes = same for
    // the Hermes Gateway connection). Auto-renew on `key_revoked` /
    // `expired` so a stale key doesn't silently leave the model picker
    // empty. Same recovery logic as postUpdateReconcileAuth, just hooked
    // here too because most users run `eve update openwebui` directly.
    yield* validateAndRenewKeyIfRevoked("eve");
    yield* validateAndRenewKeyIfRevoked("hermes");
    yield* postUpdateReconcileAiWiring();
  }
}

/**
 * Probe a per-agent Hub key against Synap and auto-renew on `key_revoked`
 * or `expired`. Idempotent: silent when the key is healthy, missing, or
 * the failure is non-recoverable (different code path needed). Designed
 * to be called from any post-update hook that depends on a working agent
 * key — currently `synap` (via `postUpdateReconcileAuth`) and `openwebui`.
 */
async function* validateAndRenewKeyIfRevoked(agentType: string): AsyncGenerator<LifecycleEvent> {
  const { getAuthStatus, renewAgentKey } = await import("./auth.js");
  const { readAgentKey } = await import("@eve/dna");

  const secrets = await readEveSecrets();
  const synapUrl = await resolveSynapUrlOnHost(secrets);
  if (!synapUrl) return;

  const agentRecord = await readAgentKey(agentType);
  const apiKey = agentRecord?.hubApiKey?.trim();
  if (!apiKey) return; // No key yet — different recovery path (provision, not renew).

  const status = await getAuthStatus({ synapUrl, apiKey });
  if (status.ok) {
    // Key is valid but may have been minted before a workspace existed.
    // If workspaceId is empty the key has no workspace membership, so
    // workspace-scoped Hub calls (e.g. syncOpenwebuiExtras) will 401.
    if (!agentRecord?.workspaceId) {
      yield {
        type: "log",
        line: `↳ ${agentType} agent key has no workspace binding — renewing to repair membership`,
      };
      const renewed = await renewAgentKey({ agentType, reason: "workspace-membership-repair" });
      if (renewed.renewed) {
        yield {
          type: "log",
          line: `↳ workspace membership repaired (new key prefix ${renewed.keyIdPrefix}…)`,
        };
      } else {
        yield {
          type: "log",
          line: `↳ workspace membership repair failed (${renewed.reason}) — run \`eve auth provision --agent ${agentType}\` manually`,
        };
      }
    }
    return;
  }

  const reason = status.failure.reason;
  // Recoverable reasons re-mint via /setup/agent which always grants the
  // full SETUP_AGENT_HUB_SCOPES set. A scope-insufficient key — e.g. one
  // minted before `hub-protocol.read` was added to the standard scopes —
  // is trivially fixed by re-minting, so include `missing_scope` /
  // `insufficient_scope` alongside the original revoke/expired triggers.
  const recoverable =
    reason === "key_revoked" ||
    reason === "expired" ||
    reason === "missing_scope";
  if (!recoverable) {
    yield {
      type: "log",
      line: `↳ ${agentType} agent key returned ${reason} (${status.failure.message}) — non-recoverable, run \`eve auth status\` for details`,
    };
    return;
  }

  yield { type: "log", line: `↳ ${agentType} agent key invalid (${reason}) — auto-renewing` };
  // Audit trail: every key renewal cascades a revoke of the prior `hub_inbound`
  // key for this agent user (see synap-backend rest/setup.ts:480). Operators
  // need a record of who triggered the revoke and why — without this event,
  // a missing key looks like spontaneous corruption.
  await appendOperationalEvent({
    type: 'repair.started',
    target: `agent-key:${agentType}`,
    summary: `Auto-renewing ${agentType} agent key (probe reason: ${reason})`,
    details: { agentType, probeReason: reason, trigger: 'validateAndRenewKeyIfRevoked' },
  }).catch(() => { /* never block renewal on telemetry */ });
  const renewed = await renewAgentKey({ agentType, reason: `${reason} during update` });
  if (renewed.renewed) {
    yield {
      type: "log",
      line: `↳ refreshed ${agentType} agent key — new prefix ${renewed.keyIdPrefix}`,
    };
    await appendOperationalEvent({
      type: 'repair.succeeded',
      target: `agent-key:${agentType}`,
      ok: true,
      summary: `${agentType} agent key renewed (new prefix ${renewed.keyIdPrefix})`,
      details: { agentType, keyIdPrefix: renewed.keyIdPrefix },
    }).catch(() => { /* swallow */ });
  } else {
    yield {
      type: "log",
      line: `↳ ${agentType} auto-renew failed: ${renewed.reason} — run \`eve auth renew --agent ${agentType}\` manually`,
    };
    await appendOperationalEvent({
      type: 'repair.failed',
      target: `agent-key:${agentType}`,
      ok: false,
      summary: `${agentType} agent key auto-renew failed`,
      error: renewed.reason,
      details: { agentType, probeReason: reason },
    }).catch(() => { /* swallow */ });
  }
}

/**
 * Re-run AI wiring for every installed component after an update succeeds.
 * This is idempotent — the .env file is rewritten with the same content.
 */
async function* postUpdateReconcileAiWiring(): AsyncGenerator<LifecycleEvent> {
  try {
    const secrets = await readEveSecrets();
    let installed: string[] = [];
    try { installed = await entityStateManager.getInstalledComponents(); } catch { /* state not initialized */ }
    if (installed.length === 0) {
      yield { type: "log", line: "No installed components — skipping AI wiring reconciliation" };
      return;
    }
    const [materialized] = await materializeTargets(secrets, ["ai-wiring"], { components: installed });
    let results = Array.isArray(materialized?.details?.results)
      ? materialized.details.results as WireAiResult[]
      : [];

    // Auto-recover from a stale eve hubApiKey detected during the extras
    // push (Synap skills / knowledge / tools). `wireOpenwebui` now embeds
    // the extras summary into its result; if Synap returned 401 we mint a
    // fresh key and re-run wiring for the openwebui component only. Without
    // this loop the operator sees "✓ wired" yet the Workspace surfaces stay
    // empty — exactly the bug we hit after every `eve auth provision` cycle
    // that revokes the old eve key before OpenWebUI's tool-server config
    // had a chance to pick up the new one.
    const owui = results.find(r => r.id === "openwebui");
    if (owui && /\b401\b|Unauthorized/i.test(owui.summary)) {
      yield { type: "log", line: "↳ OpenWebUI extras returned 401 — renewing eve agent key and retrying wiring" };
      const { renewAgentKey, resolveProvisioningToken } = await import("./auth.js");
      const provisioningToken = await resolveProvisioningToken() ?? undefined;
      const renewed = await renewAgentKey({ agentType: "eve", reason: "owui-extras-401", provisioningToken });
      if (renewed.renewed) {
        yield { type: "log", line: `↳ eve key renewed (prefix ${renewed.keyIdPrefix}…) — re-running OpenWebUI wiring` };
        const refreshed = await readEveSecrets();
        const [retry] = await materializeTargets(refreshed, ["ai-wiring"], { components: ["openwebui"] });
        const retryResults = Array.isArray(retry?.details?.results)
          ? retry.details.results as WireAiResult[]
          : [];
        // Replace the openwebui slot in the original results so the summary
        // below reflects the retry outcome, not the failed first attempt.
        const retried = retryResults.find(r => r.id === "openwebui");
        if (retried) {
          results = results.map(r => (r.id === "openwebui" ? retried : r));
          const retried401 = /\b401\b|Unauthorized/i.test(retried.summary);
          yield {
            type: "log",
            line: retried401
              ? "↳ retry still 401 — manual `eve auth provision --agent eve` may be required"
              : "↳ OpenWebUI wiring retry succeeded",
          };
        }
      } else {
        yield { type: "log", line: `↳ eve key renewal failed (${renewed.reason}) — run \`eve auth provision --agent eve\` manually` };
      }
    }

    const okCount = results.filter(r => r.outcome === "ok").length;
    const failCount = results.filter(r => r.outcome === "failed").length;
    if (failCount > 0) {
      yield { type: "log", line: `AI wiring reconciliation: ${okCount} ok, ${failCount} failed` };
    } else if (okCount > 0) {
      yield { type: "log", line: `AI wiring reconciled ✓ (${okCount} component(s))` };
    }
  } catch (err) {
    yield { type: "log", line: `Warning: AI wiring reconciliation failed — ${err}` };
  }
}

/**
 * After `eve update synap`, ensure the Traefik container is on eve-network
 * so it can route pod.<domain> → backend:4000 via Docker DNS.
 *
 * The backend is already on eve-network because the compose override
 * declares it. Traefik however may be a separately-managed container
 * (e.g. in /opt/traefik as its own compose project) that doesn't
 * automatically join eve-network on restart. We connect it explicitly —
 * idempotent, docker returns a non-zero exit code if already connected
 * which we deliberately swallow.
 *
 * We try four candidate names in order:
 *   1. Eve-managed container (standard install)
 *   2. Compose project name variants for an external /opt/traefik setup
 *   3. Bare "traefik" for hand-installed single containers
 *
 * Failures are non-fatal: the update succeeds even if we can't find
 * Traefik. The operator can run `docker network connect eve-network
 * <traefik-name>` manually and it won't need repeating if they add
 * eve-network to their traefik compose file too.
 */
async function* postUpdateConnectTraefik(): AsyncGenerator<LifecycleEvent> {
  const result = connectTraefikToEveNetwork();
  if (result.connected && result.containerName) {
    if (result.alreadyConnected) {
      yield { type: "log", line: `${result.containerName} already on eve-network ✓` };
    } else {
      yield { type: "log", line: `Connected ${result.containerName} → eve-network (Traefik can now route to backend)` };
    }
  } else {
    yield {
      type: "log",
      line: "Could not find Traefik container to connect to eve-network — if Traefik routes to backend return 502, run: docker network connect eve-network <traefik-container-name>",
    };
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
  // On-host resolver: prefers the loopback port published by Eve's
  // compose override (sub-ms, no DNS, no cert), falls back to the
  // public Traefik URL for off-host invocations.
  const synapUrl = await resolveSynapUrlOnHost(secrets);
  if (!synapUrl) {
    // Should never happen — resolver always returns *something* — but
    // guard so an unexpected null doesn't 500 the whole update.
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
    // Repair missing workspace membership. The eve key can be valid (key
    // passes /auth/status) yet have no workspace_members row when it was
    // minted before any workspace existed — e.g. a fresh install where
    // /setup/agent ran before seed-admin created the first workspace. All
    // workspace-scoped Hub calls (extras push, skills/knowledge sync) then
    // return 401 even though the key itself is fine. Renewing forces
    // /setup/agent to run again; with a workspace now present it creates
    // the missing membership row and returns the new key.
    if (!eveAgentKey?.workspaceId) {
      yield {
        type: "log",
        line: "↳ eve agent key has no workspace binding — renewing to repair membership",
      };
      const renewed = await renewAgentKey({ agentType: "eve", reason: "workspace-membership-repair" });
      if (renewed.renewed) {
        yield {
          type: "log",
          line: `↳ workspace membership repaired (new key prefix ${renewed.keyIdPrefix}…)`,
        };
      } else {
        yield {
          type: "log",
          line: `↳ workspace membership repair failed (${renewed.reason}) — run \`eve auth provision --agent eve\` manually`,
        };
      }
    }
    // Reconcile the Builder workspace so every `eve update synap` brings
    // the seeded schema back in sync with the bundled template (idempotent
    // via proposalId). Errors yield a log only — never break update.
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
  const podUrl = await resolveSynapUrlOnHost(secrets);
  if (!podUrl) {
    yield {
      type: "log",
      line: "Skipping Builder workspace seed — pod URL unresolved (configure domain.primary or synap.apiUrl).",
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

// ---------------------------------------------------------------------------
// Hermes — post-update reconciliation + install
// ---------------------------------------------------------------------------

/**
 * After `eve update hermes`, regenerate the Synap memory plugin and
 * config.yaml so the fresh container starts with the current AI wiring
 * and memory provider. The plugin is pure Python + stdlib so there's
 * nothing to compile — idempotent overwrite is fine.
 */
async function* postUpdateReconcileHermes(): AsyncGenerator<LifecycleEvent> {
  yield { type: "log", line: "Regenerating Hermes env + config.yaml + Synap memory plugin…" };
  try {
    // env file MUST be written before config.yaml — writeHermesConfigYaml reads
    // secrets that writeHermesEnvFile also reads, but the env file is what the
    // container actually picks up (--env-file at docker run time). This hook
    // runs inside runPostUpdateHooks(), which fires AFTER recreateContainer()
    // has already started the new container — so the fresh env file must be
    // written here to cover cases where the container was already recreated
    // with a stale env file and needs a live rewrite (e.g. key rotation via
    // wireHermes, or a post-upgrade env drift fix).
    await materializeTargets(null, ["hermes-env"]);
    await writeHermesConfigYaml();
    generateSynapPlugin();
    yield { type: "log", line: "Hermes env, config + plugin regenerated ✓" };
  } catch (err) {
    yield {
      type: "log",
      line: `Warning: could not regenerate Hermes config — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  yield* wireHermesIntoOpenwebui();
}

/**
 * Install Hermes: generate env + config + plugin, pull image, run container.
 *
 * The official `nousresearch/hermes-agent:latest` image has `hermes gateway`
 * as its default entrypoint. When the env file (hermes.env) contains
 * `API_SERVER_ENABLED=true` and `API_SERVER_KEY=...`, the gateway command
 * automatically starts the OpenAI-compat API server alongside messaging
 * platforms and MCP tools.
 *
 * config.yaml (written below) provides advanced settings: memory.provider,
 * model block, and MCP/dashboard config. The env file provides runtime
 * credentials (Hub key, channel tokens, API_SERVER_KEY).
 */
async function* installHermes(): AsyncGenerator<LifecycleEvent> {
  yield { type: "step", label: "Writing Hermes env + config + Synap memory plugin…" };
  try {
    await materializeTargets(null, ["hermes-env"]);
    await writeHermesConfigYaml();
    generateSynapPlugin();
    yield { type: "log", line: "Env file, config.yaml, and Synap plugin written ✓" };
  } catch (err) {
    throw new Error(
      `Failed to write Hermes config: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  yield* ensureEveNetwork();

  yield { type: "step", label: "Pulling Hermes image…" };
  const pullCode = yield* runCommand("docker", ["pull", "nousresearch/hermes-agent:latest"]);
  if (pullCode !== 0) throw new Error(`docker pull nousresearch/hermes-agent:latest exited ${pullCode}`);

  yield { type: "step", label: "Starting Hermes…" };
  const hermesHome = join(homedir(), ".eve", "hermes");
  mkdirSync(hermesHome, { recursive: true });
  const hermesEnv = join(homedir(), ".eve", "hermes.env");
  const skillsDir = join(homedir(), ".eve", "skills");
  mkdirSync(skillsDir, { recursive: true });

  // Hermes drops to UID 10000 inside the container but does NOT chown the
  // bind-mount itself before doing so — bundled-skills sync (87 categories
  // copied into /opt/data/skills/<category>/) then fails with EACCES when
  // the host dir is owned by root. Chown the host dir to match the
  // in-container hermes user. Best-effort: ignored on Docker Desktop where
  // UID mapping differs and on dev hosts where eve isn't running as root.
  try {
    execSync(`chown -R 10000:10000 ${JSON.stringify(hermesHome)}`, { stdio: "ignore" });
  } catch { /* non-fatal — user can run it manually if bundled-skills sync fails */ }

  // The image's default ENTRYPOINT is `hermes`, and its default CMD is the
  // interactive REPL — running `docker run -d` with no command override
  // greets the user, sees stdin isn't a TTY, prints "Goodbye! ⚕", exits,
  // and the restart-policy bounces it forever. We pass `gateway run` to
  // start the OpenAI-compat HTTP gateway + dashboard + MCP server, matching
  // the bundled `docker-compose.yml` (`command: ["gateway", "run"]`).
  //
  // Do NOT set HERMES_UID=0 / HERMES_GID=0: `hermes gateway` explicitly
  // refuses to run as root and exits with "Refusing to run the Hermes
  // gateway as root inside the official Docker image." The entrypoint
  // defaults to UID 10000 and drops privileges before booting the gateway.
  const args = [
    "run", "-d",
    "--name", "eve-builder-hermes",
    "--network", "eve-network",
    "--restart", "unless-stopped",
    "-p", "8642:8642",   // OpenAI-compat gateway (part of hermes gateway)
    "-p", "9119:9119",   // Admin dashboard (enabled via config.yaml)
    "-p", "9120:9120",   // MCP server (enabled via config.yaml)
    "-v", `${hermesHome}:/opt/data`,
    // Synap skill packages — mounted at a SIBLING path of Hermes's own
    // /opt/data/skills/ so the bind-mount doesn't shadow it. Hermes copies
    // ~91 bundled skills into /opt/data/skills/<category>/ on first boot;
    // when we mounted Synap's read-only at /opt/data/skills, every one of
    // those copies failed with "Read-only file system" and Hermes's tool
    // surface stayed empty. Hermes config (writeHermesConfigYaml) has been
    // updated to point at the new path.
    "-v", `${skillsDir}:/opt/data/synap-skills:ro`,
    "--env-file", hermesEnv,
    "-e", "HERMES_HOME=/opt/data",
    "nousresearch/hermes-agent:latest",
    "gateway", "run",
  ];
  const runCode = yield* runCommand("docker", args);
  if (runCode !== 0) throw new Error(`docker run exited ${runCode}`);

  // Wait briefly + verify the gateway didn't crash on boot. The `gateway run`
  // command typically takes 6-10s to settle (skill sync + plugin install).
  // A failure here is rarely the docker run itself — almost always a config
  // problem (bad API_SERVER_KEY, missing model, etc.) that's only visible
  // in the container logs. Surface it instead of silently moving on.
  await new Promise((r) => setTimeout(r, 12_000));
  const stillUp = await isContainerInState("eve-builder-hermes", "running");
  if (!stillUp) {
    yield {
      type: "log",
      line: "warning: Hermes container exited or is restarting — run `docker logs eve-builder-hermes` for details",
    };
  } else {
    yield { type: "log", line: "Hermes container running — gateway: :8642, dashboard: :9119, MCP: :9120" };
  }

  // Wire Hermes as a model source in OpenWebUI if it is installed.
  yield* wireHermesIntoOpenwebui();
}

/**
 * Patch `/opt/openwebui/.env` to add the Hermes OpenAI-compat gateway
 * as a model source. Safe to call multiple times — strips its own marker
 * block first so a re-run always produces a clean file.
 *
 * The .env changes are baked into the container at creation time. They
 * take effect on next full recreate (docker rm -f + docker run). For
 * immediate model-picker visibility, `registerPipelinesInOpenwebui`
 * calls the admin API upsert instead — which works without a recreate.
 */
async function* wireHermesIntoOpenwebui(): AsyncGenerator<LifecycleEvent> {
  const owEnv = "/opt/openwebui/.env";
  if (!existsSync(owEnv)) {
    yield { type: "log", line: "OpenWebUI not found — skipping Hermes model-source wiring" };
    return;
  }

  // Resolve the Hermes API key — prefer secrets.json, fall back to hermes.env.
  const secrets = await readEveSecrets();
  let hermesApiKey = secrets?.builder?.hermes?.apiServerKey ?? "";
  if (!hermesApiKey) {
    const hermesEnvPath = join(homedir(), ".eve", "hermes.env");
    if (existsSync(hermesEnvPath)) {
      const hermesEnv = readFileSync(hermesEnvPath, "utf-8");
      hermesApiKey = hermesEnv.split("\n")
        .find(l => l.startsWith("API_SERVER_KEY="))?.split("=", 2)[1]?.trim() ?? "";
      if (hermesApiKey) {
        try {
          const updated = await writeEveSecrets({
            ...(secrets ?? {}),
            builder: {
              ...(secrets?.builder ?? {}),
              hermes: { ...(secrets?.builder?.hermes ?? {}), apiServerKey: hermesApiKey },
            },
          });
          hermesApiKey = updated.builder?.hermes?.apiServerKey ?? hermesApiKey;
        } catch { /* non-fatal — fallback key is still valid */ }
      }
    }
  }

  if (!hermesApiKey) {
    yield {
      type: "log",
      line: "Warning: Hermes API key not found — OpenWebUI connection may fail. Run `eve update hermes` after setting the key.",
    };
  }

  // Wire .env, restart container, and await admin API registration.
  // wireComponentAi now propagates registration errors as outcome warnings
  // instead of swallowing them in a fire-and-forget.
  const result = await wireComponentAi('openwebui', secrets);
  yield { type: "log", line: result.summary };
  if (result.outcome === 'ok') {
    await markOpenwebuiConfigReconciled(secrets);
  }
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
  "openclaw",
  "hermes",
  "eve-dashboard",
]);

/**
 * True if a container with that name is currently in the requested state
 * (`running`, `restarting`, `exited`, etc.). Used by post-install probes
 * to distinguish "container exists but is restart-looping" from "container
 * came up clean." 4s timeout.
 */
async function isContainerInState(name: string, state: string): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn(
      "docker",
      ["ps", "--filter", `name=^${name}$`, "--filter", `status=${state}`, "--format", "{{.Names}}"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill("SIGKILL");
      resolve(false);
    }, 4000);
    child.stdout?.on("data", (chunk) => { out += chunk.toString(); });
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
    const [refresh] = await materializeTargets(null, ["traefik-routes"]);
    if (refresh?.changed) {
      yield { type: "log", line: refresh.summary };
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
      const result = await wireComponentAi(comp.id, secrets);
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
      // No more "checkout required" guard — `installSynapFromImage` (called
      // by `runBrainInit`) clones the synap-backend repo into the deploy
      // dir if missing. Operator can still pin a custom path via SYNAP_REPO_ROOT.
      const { runBrainInit } = await import("@eve/brain");
      const explicitRepo = opts.synapRepo ?? process.env.SYNAP_REPO_ROOT;
      // Pull domain + email from configStore so a fresh install on a
      // configured-domain host doesn't error on "non-localhost domain
      // requires --email". When unset, runBrainInit auto-discovers from
      // disk artefacts and falls back to localhost.
      const secrets = await configStore.get();
      const domain = secrets?.domain?.primary ?? "localhost";
      const email = secrets?.domain?.email;
      await runBrainInit({
        synapRepo: explicitRepo,
        domain,
        email,
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

    case "hermes": {
      yield* installHermes();
      return;
    }

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
      - OPENAI_API_BASE_URLS=\${OPENAI_API_BASE_URLS:-http://eve-brain-synap:4000/v1}
      - OPENAI_API_KEYS=\${OPENAI_API_KEYS:-}
      - OLLAMA_BASE_URL=\${OLLAMA_BASE_URL:-http://eve-brain-ollama:11434}

      # Pre-selected model on first chat — \`synap/auto\` falls through to
      # the user's defaultProvider in IS, so it picks up secrets.ai.
      - DEFAULT_MODELS=\${DEFAULT_MODELS:-synap/auto}

      # Features
      - ENABLE_RAG=true
      - ENABLE_WEB_SEARCH=true
      - WEB_SEARCH_ENGINE=duckduckgo
      - ENABLE_COMMUNITY_SHARING=false
      - ENABLE_PERSISTENT_CONFIG=\${ENABLE_PERSISTENT_CONFIG:-true}

      # Auth — first signup auto-becomes admin (OpenWebUI's special-case).
      # Eve also writes WEBUI_ADMIN_EMAIL/PASSWORD/NAME to .env so first
      # boot can create the admin user headlessly without using the UI.
      # Subsequent signups follow DEFAULT_USER_ROLE; "pending" forces approval.
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

async function reconcileOpenwebuiEnv(deployDir: string): Promise<void> {
  const bootstrap = await ensureOpenWebuiBootstrapSecrets();
  const secrets = bootstrap.secrets;
  // OpenWebUI's container talks to Synap as the `eve` agent — same
  // identity used by the registered tool server, the pushed Prompts,
  // and the inline Filter Functions. Falls back to the legacy single
  // key for installs that haven't migrated yet.
  const eveAgent = await readAgentKey("eve");
  const synapApiKey =
    eveAgent?.hubApiKey ??
    secrets?.synap?.apiKey ??
    process.env.SYNAP_API_KEY ??
    "";
  const isUrl = process.env.SYNAP_IS_URL ?? "http://eve-brain-synap:4000";
  const domain = secrets?.domain?.primary;
  const ssl = !!secrets?.domain?.ssl;
  const protocol = ssl ? "https" : "http";
  const webuiUrl = domain ? `${protocol}://chat.${domain}` : "";

  writeOpenwebuiEnv(deployDir, {
    synapApiKey,
    synapIsUrl: isUrl,
    webuiUrl,
    adminEmail: secrets.builder?.openwebui?.adminEmail ?? "admin@eve.local",
    adminPassword: secrets.builder?.openwebui?.adminPassword ?? "",
    adminName: secrets.builder?.openwebui?.adminName ?? "Eve Admin",
  });
}

async function markOpenwebuiConfigReconciled(secrets: Awaited<ReturnType<typeof readEveSecrets>>): Promise<void> {
  await writeEveSecrets({
    builder: {
      ...(secrets?.builder ?? {}),
      openwebui: {
        ...(secrets?.builder?.openwebui ?? {}),
        lastConfigReconciledAt: new Date().toISOString(),
      },
    },
  });
}

async function* installOpenWebUi(): AsyncGenerator<LifecycleEvent> {
  const deployDir = "/opt/openwebui";

  const bootstrap = await ensureOpenWebuiBootstrapSecrets();
  const secrets = bootstrap.secrets;
  // OpenWebUI's SYNAP_API_KEY is the bearer it uses to call Synap IS,
  // the bearer baked into the registered OpenAPI tool server, and the
  // bearer the inline Filter Functions forward to the Hub Protocol —
  // all three surfaces share the `eve` agent identity. Falls back to
  // the legacy single key for installs that haven't migrated yet.
  const eveAgent = await readAgentKey("eve");
  const synapApiKey =
    eveAgent?.hubApiKey ??
    secrets?.synap?.apiKey ??
    process.env.SYNAP_API_KEY ??
    "";
  const isUrl = process.env.SYNAP_IS_URL ?? "http://eve-brain-synap:4000";

  writeOpenwebuiCompose(deployDir);

  // Surface the public URL when a domain is set so OpenWebUI generates
  // correct absolute links (OAuth callbacks, sharing links, etc.).
  const domain = secrets?.domain?.primary;
  const ssl = !!secrets?.domain?.ssl;
  const protocol = ssl ? "https" : "http";
  const webuiUrl = domain ? `${protocol}://chat.${domain}` : "";

  const envResult = writeOpenwebuiEnv(deployDir, {
    synapApiKey,
    synapIsUrl: isUrl,
    webuiUrl,
    adminEmail: secrets.builder?.openwebui?.adminEmail ?? "admin@eve.local",
    adminPassword: secrets.builder?.openwebui?.adminPassword ?? "",
    adminName: secrets.builder?.openwebui?.adminName ?? "Eve Admin",
  });
  const generatedParts = [
    bootstrap.generated.adminEmail ? "email" : "",
    bootstrap.generated.adminPassword ? "password" : "",
    bootstrap.generated.adminName ? "name" : "",
    envResult.secretKeyGenerated ? "secret-key" : "",
  ].filter(Boolean);
  yield {
    type: "log",
    line: generatedParts.length > 0
      ? `OpenWebUI headless admin bootstrap prepared (${generatedParts.join(", ")} generated)`
      : "OpenWebUI headless admin bootstrap prepared (existing credentials reused)",
  };

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
 * Decommission the legacy Open WebUI Pipelines sidecar.
 *
 * The pipelines container was retired in favour of native Open WebUI
 * Filter Functions (see `pushSynapFunctionsToOpenwebui` in @eve/dna).
 * On hosts that still have the old install lying around we stop the
 * container, drop its compose dir, and clear it from the entity state
 * so subsequent `eve doctor` / `eve update` runs don't keep complaining.
 *
 * Idempotent — every step short-circuits when the artifact isn't there.
 */
async function* decommissionLegacyPipelines(): AsyncGenerator<LifecycleEvent> {
  const containerName = "eve-openwebui-pipelines";
  const deployDir = "/opt/openwebui-pipelines";

  let didSomething = false;

  if (await containerExists(containerName)) {
    yield { type: "step", label: `Removing legacy pipelines container ${containerName}` };
    yield* runCommand("docker", ["rm", "-f", containerName], {});
    didSomething = true;
  }

  if (existsSync(deployDir)) {
    const { rmSync } = await import("node:fs");
    rmSync(deployDir, { recursive: true, force: true });
    yield { type: "log", line: `Removed ${deployDir}` };
    didSomething = true;
  }

  // Even if neither artifact exists, scrub the entity state — older
  // installs may have an "openwebui-pipelines" component listed without
  // a backing container. We mark it 'missing' (the existing convention
  // used everywhere else in the state machine for "no longer present").
  try {
    const installed = await entityStateManager.getInstalledComponents();
    if (installed.includes("openwebui-pipelines")) {
      await entityStateManager.updateComponentEntry("openwebui-pipelines", { state: "missing" });
      yield { type: "log", line: "Marked openwebui-pipelines as missing in entity state" };
      didSomething = true;
    }
  } catch { /* state file may not exist on first install — fine */ }

  if (!didSomething) return;

  yield {
    type: "log",
    line: "Legacy Pipelines sidecar decommissioned — Synap memory + channel sync now live as inline OpenWebUI Functions.",
  };
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
  // OpenClaw runs on eve-network; in-network hostname avoids the public
  // Traefik round-trip. See SYNAP_BACKEND_INTERNAL_URL doc.
  const synapApiUrl = SYNAP_BACKEND_INTERNAL_URL;
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
  hermes: "arms",
  rsshub: "eyes",
  traefik: "legs",
  openwebui: "eyes",
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
  // Retired components: any action targeting `openwebui-pipelines` is
  // treated as a decommission so legacy installs and stale state can be
  // cleaned up via the same `eve add/update/remove openwebui-pipelines`
  // commands operators are already used to. The sidecar was replaced by
  // native OpenWebUI Filter Functions in 0.5.x.
  if (componentId === "openwebui-pipelines") {
    yield* decommissionLegacyPipelines();
    yield { type: "done", summary: "openwebui-pipelines decommissioned (replaced by native OpenWebUI Functions)" };
    return;
  }

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

export async function runRepair(request: RepairRequest): Promise<RepairResult> {
  await appendOperationalEvent({
    type: "repair.started",
    target: request.kind,
    componentId: request.componentId,
    details: { target: request.target },
  }).catch(() => {});

  let result: RepairResult;
  let eventRequest = request;
  try {
    switch (request.kind) {
      case "create-eve-network": {
        let commandError: string | undefined;
        for await (const event of runCommand("docker", ["network", "create", "eve-network"])) {
          if (event.type === "error") commandError = event.message;
        }
        if (commandError && !commandError.includes("already exists")) throw new Error(commandError);
        result = { ok: true, summary: "eve-network created", recheck: { doctorGroup: "network" } };
        break;
      }
      case "start-container":
      case "start-component":
        if (!request.componentId) throw new Error("componentId required");
        result = await runActionToCompletion(request.componentId, "start");
        result.recheck = { doctorGroup: "containers", componentId: request.componentId };
        break;
      case "restart-component":
        if (!request.componentId) throw new Error("componentId required");
        result = await runActionToCompletion(request.componentId, "restart");
        result.recheck = { doctorGroup: "containers", componentId: request.componentId };
        break;
      case "recreate-component":
        if (!request.componentId) throw new Error("componentId required");
        result = await runActionToCompletion(request.componentId, "recreate");
        result.recheck = { doctorGroup: "containers", componentId: request.componentId };
        break;
      case "materialize-target": {
        if (!request.target) throw new Error("target required");
        const [materialized] = await materializeTargets(null, [request.target]);
        result = {
          ok: materialized?.ok ?? false,
          summary: materialized?.summary ?? "No materializer result",
          error: materialized?.error,
          recheck: { target: request.target },
        };
        break;
      }
      case "repair-domain-routing": {
        const [materialized] = await materializeTargets(null, ["traefik-routes"]);
        result = {
          ok: materialized.ok,
          summary: materialized.summary,
          error: materialized.error,
          recheck: { doctorGroup: "network" },
        };
        break;
      }
      case "repair-pod-url": {
        const results = await materializeTargets(null, ["backend-env", "traefik-routes"]);
        const failed = results.find((item) => !item.ok);
        result = {
          ok: !failed,
          summary: failed ? failed.summary : "Pod URL materialized",
          error: failed?.error,
          recheck: { doctorGroup: "config" },
        };
        break;
      }
      case "rewire-openclaw":
        eventRequest = { ...request, kind: "rewire-ai", componentId: "openclaw" };
      // falls through
      case "rewire-ai": {
        const [materialized] = await materializeTargets(null, ["ai-wiring"], {
          components: eventRequest.componentId ? [eventRequest.componentId] : undefined,
        });
        result = {
          ok: materialized.ok,
          summary: materialized.summary,
          error: materialized.error,
          recheck: { doctorGroup: "wiring", componentId: eventRequest.componentId },
        };
        break;
      }
      default:
        result = { ok: false, summary: "Unknown repair", error: `Unknown repair: ${request.kind}` };
    }
  } catch (error) {
    result = {
      ok: false,
      summary: `${request.kind} failed`,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  await appendOperationalEvent({
    type: result.ok ? "repair.succeeded" : "repair.failed",
    target: eventRequest.kind,
    componentId: eventRequest.componentId,
    ok: result.ok,
    summary: result.summary,
    error: result.error,
    details: { target: eventRequest.target, recheck: result.recheck },
  }).catch(() => {});

  return result;
}

export {
  materializeTargets,
  type MaterializeOptions,
  type MaterializeResult,
} from "./materialize.js";

export {
  runDoctorChecks,
} from "./doctor.js";

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
  ensurePodProvisioningToken,
  resolveProvisioningToken,
  type AuthStatus,
  type AuthFailure,
  type AuthFailReason,
  type AuthResult,
  type GetAuthStatusOptions,
  type RenewAgentKeyOptions,
  type RenewResult,
  type ProvisionAgentOptions,
  type ProvisionResult,
  type EnsureProvisioningTokenResult,
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

// Backend preflight — auto-discover + auto-configure prerequisites before
// any command that needs to reach the synap-backend. Call this at the top
// of every command handler that talks to the pod.
export {
  runBackendPreflight,
  type PreflightResult,
  type PreflightOptions,
} from "./preflight.js";

// Install configuration resolver — single funnel used by `eve install`,
// `eve init`, `eve setup`, and any future install entry point. Resolves
// domain/email/SSL/admin/components from CLI flags → env → secrets →
// discovered → saved profile → interactive prompt → typed default. In
// non-interactive mode, missing required fields throw `InstallConfigError`
// with a structured `missing[]` list.
export {
  gatherInstallConfig,
  isValidDomain,
  isValidEmail,
  normalizeBareDomain,
  InstallConfigError,
  type ResolvedInstallConfig,
  type RawInstallFlags,
  type GatherInstallConfigOptions,
  type ResolverIO,
  type PromptFns,
  type FieldSource,
  type AiMode,
  type AiProvider,
  type TunnelProvider,
  type InstallMode,
  type AdminBootstrapMode,
  type Exposure,
  type MissingField,
} from "./install-config.js";

export { defaultPrompts } from "./install-config-prompts.js";

// One-shot migration: copy domain/email from .eve/setup-profile.json
// into ~/.eve/secrets.json so secrets is the single source of truth.
export {
  migrateSetupProfileToSecrets,
  type MigrationResult,
} from "./setup-profile-migration.js";
