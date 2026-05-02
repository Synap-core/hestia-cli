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
  readEveSecrets,
  writeEveSecrets,
  pickPrimaryProvider,
  wireComponentAi,
  AI_CONSUMERS,
  type ComponentInfo,
} from "@eve/dna";
import {
  refreshTraefikRoutes,
  installDashboardContainer,
  uninstallDashboardContainer,
} from "@eve/legs";

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
  compose?: { cwd: string; services?: string[] };
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
  openwebui: { compose: { cwd: "/opt/openwebui" } },
  "openwebui-pipelines": { compose: { cwd: "/opt/openwebui-pipelines" } },
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

  if (plan.compose) {
    if (!existsSync(plan.compose.cwd)) {
      yield { type: "error", message: `Compose dir not found: ${plan.compose.cwd}.` };
      return;
    }

    // Compose v2 warns about the obsolete `version:` top-level key on
    // every command. Older versions of our install recipe (or hand-edited
    // files) may still have it. Strip it idempotently here so the user
    // doesn't see warning noise on every update.
    sanitizeComposeFile(join(plan.compose.cwd, "docker-compose.yml"));

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
    let code = yield* dockerExec(["pull", plan.imagePull], `Pulling ${plan.imagePull}…`);
    if (code !== 0) { yield { type: "error", message: `pull exited ${code}` }; return; }

    code = yield* dockerExec(
      ["restart", comp.service.containerName],
      `Restarting ${comp.label}…`,
    );
    if (code !== 0) { yield { type: "error", message: `restart exited ${code}` }; return; }

    yield { type: "done", summary: `${comp.label} updated to latest` };
  }
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

async function* installOpenWebUi(): AsyncGenerator<LifecycleEvent> {
  const deployDir = "/opt/openwebui";
  mkdirSync(deployDir, { recursive: true });

  const secrets = await readEveSecrets();
  const synapApiKey = secrets?.synap?.apiKey ?? process.env.SYNAP_API_KEY ?? "";
  const isUrl = process.env.SYNAP_IS_URL ?? "http://intelligence-hub:3001";

  const composeYaml = `# Open WebUI — generated by @eve/lifecycle
services:
  openwebui:
    image: ghcr.io/open-webui/open-webui:main
    container_name: hestia-openwebui
    restart: unless-stopped
    environment:
      - ENV=production
      - WEBUI_SECRET_KEY=\${WEBUI_SECRET_KEY:-change-me}
      - SCARF_NO_ANALYTICS=true
      - DO_NOT_TRACK=true
      - ENABLE_OPENAI_API=true
      - OPENAI_API_BASE_URL=\${SYNAP_IS_URL:-http://intelligence-hub:3001}/v1
      - OPENAI_API_KEY=\${SYNAP_API_KEY:-}
      - OLLAMA_BASE_URL=\${OLLAMA_BASE_URL:-http://eve-brain-ollama:11434}
      - ENABLE_RAG=true
      - ENABLE_WEB_SEARCH=true
      - WEB_SEARCH_ENGINE=duckduckgo
      - ENABLE_SIGNUP=\${ENABLE_SIGNUP:-true}
      - DEFAULT_USER_ROLE=\${DEFAULT_USER_ROLE:-user}
    ports:
      - "3011:8080"
    volumes:
      - openwebui-data:/app/backend/data
    networks:
      - eve-network

networks:
  eve-network:
    external: true

volumes:
  openwebui-data:
`;
  writeFileSync(join(deployDir, "docker-compose.yml"), composeYaml);

  const envPath = join(deployDir, ".env");
  if (!existsSync(envPath)) {
    writeFileSync(envPath, [
      "# Open WebUI — generated by @eve/lifecycle",
      `SYNAP_API_KEY=${synapApiKey}`,
      `SYNAP_IS_URL=${isUrl}`,
      `WEBUI_SECRET_KEY=${randomBytes(32).toString("hex")}`,
      `OLLAMA_BASE_URL=http://eve-brain-ollama:11434`,
      `ENABLE_SIGNUP=true`,
      `DEFAULT_USER_ROLE=user`,
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

async function* installPipelinesSidecar(): AsyncGenerator<LifecycleEvent> {
  const deployDir = "/opt/openwebui-pipelines";
  const pipelinesDir = join(deployDir, "pipelines");
  mkdirSync(pipelinesDir, { recursive: true });

  // Drop the three reference pipelines into the bind-mounted dir so the
  // sidecar picks them up on first boot. Re-running install overwrites them
  // (idempotent — users editing .py files in place will lose changes; that's
  // by design for the reference set, custom pipelines should use a different
  // file name).
  yield* copyReferencePipelines(pipelinesDir);

  const secrets = await readEveSecrets();
  const synapApiKey = secrets?.synap?.apiKey ?? "";
  const synapApiUrl = secrets?.synap?.apiUrl ?? "http://synap-backend-backend-1:4000";
  const isUrl = process.env.SYNAP_IS_URL ?? "http://intelligence-hub:3001";

  const composeYaml = `# Open WebUI Pipelines — generated by @eve/lifecycle
services:
  pipelines:
    image: ghcr.io/open-webui/pipelines:main
    container_name: eve-openwebui-pipelines
    restart: unless-stopped
    environment:
      - PIPELINES_API_KEY=\${PIPELINES_API_KEY}
      - SYNAP_API_URL=\${SYNAP_API_URL}
      - SYNAP_API_KEY=\${SYNAP_API_KEY}
      - SYNAP_IS_URL=\${SYNAP_IS_URL}
    # Bind-mount instead of a named volume so we can drop pipeline .py
    # files into ${pipelinesDir} from the host.
    volumes:
      - ${pipelinesDir}:/app/pipelines
    networks:
      - eve-network

networks:
  eve-network:
    external: true
`;
  writeFileSync(join(deployDir, "docker-compose.yml"), composeYaml);

  const envPath = join(deployDir, ".env");
  if (!existsSync(envPath)) {
    writeFileSync(envPath, [
      "# Pipelines sidecar — generated by @eve/lifecycle",
      `PIPELINES_API_KEY=${randomBytes(24).toString("hex")}`,
      `SYNAP_API_URL=${synapApiUrl}`,
      `SYNAP_API_KEY=${synapApiKey}`,
      `SYNAP_IS_URL=${isUrl}`,
    ].join("\n"), { mode: 0o600 });
  }

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
  // Read pipelines key back from the .env we just wrote so OpenWebUI sends
  // the right token to the sidecar.
  const owEnv = "/opt/openwebui/.env";
  if (existsSync(owEnv)) {
    const pipelinesEnv = readFileSync(envPath, "utf-8");
    const pipelinesKey = pipelinesEnv
      .split("\n")
      .find(l => l.startsWith("PIPELINES_API_KEY="))?.split("=", 2)[1] ?? "";

    const cur = readFileSync(owEnv, "utf-8");
    const marker = "# Pipelines wiring — managed by @eve/lifecycle";
    const stripped = cur.includes(marker) ? cur.split(marker)[0].trimEnd() : cur.trimEnd();
    const block = [
      marker,
      "OPENAI_API_BASE_URLS=http://eve-openwebui-pipelines:9099;http://intelligence-hub:3001/v1",
      `OPENAI_API_KEYS=${pipelinesKey};\${SYNAP_API_KEY}`,
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
  const synapApiKey = secrets?.synap?.apiKey ?? "";
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

async function* ensureEveNetwork(): AsyncGenerator<LifecycleEvent> {
  yield { type: "step", label: "Ensuring eve-network exists…" };
  const inspect = yield* runCommand("docker", ["network", "inspect", "eve-network"]);
  if (inspect !== 0) {
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
