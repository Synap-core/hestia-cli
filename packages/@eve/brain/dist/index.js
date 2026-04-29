import {
  installSynapFromImage
} from "./chunk-LGDQJVFY.js";

// src/commands/init.ts
import { EntityStateManager, entityStateManager, readEveSecrets, getServerIp } from "@eve/dna";

// src/lib/exec.ts
import { spawn } from "child_process";
function execa(command, args, options) {
  return new Promise((resolve2, reject) => {
    const child = spawn(command, args, {
      stdio: options?.stdio === "inherit" ? "inherit" : "pipe",
      cwd: options?.cwd,
      env: options?.env
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }
    child.on("close", (code) => {
      if (code === 0) {
        resolve2({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
      }
    });
    child.on("error", (error) => {
      reject(error);
    });
  });
}
async function ensureNetwork() {
  try {
    const { stdout } = await execa("docker", ["network", "ls", "--format", "{{.Name}}"]);
    if (!stdout.includes("eve-network")) {
      console.log("Creating eve-network...");
      await execa("docker", ["network", "create", "eve-network"]);
    }
  } catch (error) {
    console.warn("Could not ensure Docker network:", error);
  }
}

// src/lib/ollama.ts
var OllamaService = class {
  containerName = "eve-brain-ollama";
  image = "ollama/ollama:latest";
  async install() {
    console.log("Installing Ollama...");
    await execa("docker", ["pull", this.image], { stdio: "inherit" });
    console.log("Ollama image pulled successfully");
  }
  /**
   * @param publishToHost - When false, Ollama is only on `eve-network` (use with Traefik gateway on Full stack).
   */
  async start(options) {
    const publishToHost = options?.publishToHost !== false;
    const running = await this.isRunning();
    if (running) {
      console.log("Ollama is already running");
      return;
    }
    const exists = await this.containerExists();
    if (exists) {
      await execa("docker", ["start", this.containerName], { stdio: "inherit" });
    } else {
      const args = [
        "run",
        "-d",
        "--name",
        this.containerName,
        "--network",
        "eve-network",
        "-v",
        "ollama-models:/root/.ollama",
        "--restart",
        "unless-stopped"
      ];
      if (publishToHost) {
        args.push("-p", "127.0.0.1:11434:11434");
      }
      args.push(this.image);
      await execa("docker", args, { stdio: "inherit" });
    }
    console.log(
      publishToHost ? "Ollama started on http://127.0.0.1:11434" : "Ollama started (no host port; reachable on eve-network as eve-brain-ollama:11434)"
    );
  }
  async pullModel(model, startOpts) {
    console.log(`Pulling model: ${model}...`);
    await this.start(startOpts);
    await new Promise((resolve2) => setTimeout(resolve2, 2e3));
    await execa("docker", [
      "exec",
      this.containerName,
      "ollama",
      "pull",
      model
    ], { stdio: "inherit" });
    console.log(`Model ${model} pulled successfully`);
  }
  async isRunning() {
    try {
      const { stdout } = await execa("docker", [
        "ps",
        "--filter",
        `name=${this.containerName}`,
        "--filter",
        "status=running",
        "--format",
        "{{.Names}}"
      ]);
      return stdout.trim() === this.containerName;
    } catch {
      return false;
    }
  }
  async getStatus() {
    const running = await this.isRunning();
    const models = await this.listModels();
    return {
      running,
      modelsInstalled: models,
      currentModel: models.length > 0 ? models[0] : void 0
    };
  }
  async listModels() {
    try {
      const { stdout } = await execa("docker", [
        "exec",
        this.containerName,
        "ollama",
        "list"
      ]);
      const lines = stdout.trim().split("\n").slice(1);
      return lines.map((line) => line.split(/\s+/)[0]).filter(Boolean);
    } catch {
      return [];
    }
  }
  async containerExists() {
    try {
      const { stdout } = await execa("docker", [
        "ps",
        "-a",
        "--filter",
        `name=${this.containerName}`,
        "--format",
        "{{.Names}}"
      ]);
      return stdout.trim() === this.containerName;
    } catch {
      return false;
    }
  }
};

// src/lib/synap-delegate.ts
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
var CANDIDATE_PATHS = [
  "/opt/synap",
  "/opt/synap-backend",
  "/srv/synap",
  "/home/synap/synap-backend",
  "/root/synap-backend"
];
function tryPath(root) {
  if (!existsSync(root)) return null;
  const script = join(root, "synap");
  if (!existsSync(script)) return null;
  const deployDir = join(root, "deploy");
  if (!existsSync(join(deployDir, "docker-compose.yml"))) return null;
  return { repoRoot: root, synapScript: script, deployDir };
}
function resolveSynapDelegate(cwd) {
  const cliOverride = process.env.SYNAP_CLI?.trim();
  if (cliOverride && existsSync(cliOverride)) {
    const root = resolve(cliOverride, "..");
    const d = tryPath(root);
    if (d) return d;
  }
  const envRoot = process.env.SYNAP_REPO_ROOT?.trim();
  if (envRoot) {
    const d = tryPath(envRoot);
    if (d) return d;
  }
  const statePath = join(cwd ?? process.cwd(), ".eve", "state.json");
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      const savedRoot = state?.installed?.synap?.config?.repoRoot;
      if (savedRoot) {
        const d = tryPath(savedRoot);
        if (d) return d;
      }
    } catch {
    }
  }
  for (const candidate of CANDIDATE_PATHS) {
    const d = tryPath(candidate);
    if (d) return d;
  }
  return null;
}

// src/commands/init.ts
async function cleanupKnownStaleState(deployDir) {
  console.log("Cleaning known stale Synap artifacts...");
  try {
    await execa("bash", ["-lc", `rm -f "${deployDir}/patch_migration.js"`], { stdio: "inherit" });
    await execa(
      "bash",
      [
        "-lc",
        `if [ -f "${deployDir}/docker-compose.override.yml" ] && grep -q "patch_migration.js" "${deployDir}/docker-compose.override.yml"; then rm -f "${deployDir}/docker-compose.override.yml"; fi`
      ],
      { stdio: "inherit" }
    );
  } catch {
  }
  try {
    await execa("docker", ["rm", "-f", "eve-brain-synap"], { stdio: "pipe" });
  } catch {
  }
}
async function runBrainInit(options) {
  const repo = options.synapRepo?.trim() || process.env.SYNAP_REPO_ROOT?.trim() || void 0;
  if (repo) {
    process.env.SYNAP_REPO_ROOT = repo;
  }
  const domain = options.domain?.trim() || "localhost";
  const email = options.email?.trim() || process.env.LETSENCRYPT_EMAIL?.trim() || process.env.SYNAP_LETSENCRYPT_EMAIL?.trim();
  const adminEmail = options.adminEmail?.trim() || process.env.ADMIN_EMAIL?.trim();
  const adminPassword = options.adminPassword?.trim() || process.env.ADMIN_PASSWORD?.trim();
  const adminBootstrapMode = options.adminBootstrapMode ?? "token";
  const delegate = options.fromImage ? null : resolveSynapDelegate();
  if (!delegate) {
    console.log("Installing Synap Data Pod from Docker image (ghcr.io/synap-core/backend)...\n");
    const { installSynapFromImage: installSynapFromImage2 } = await import("./synap-image-install-DH42RPL4.js");
    const result = await installSynapFromImage2({
      domain,
      email,
      adminEmail,
      adminPassword,
      adminBootstrapMode
    });
    const stateManager2 = new EntityStateManager();
    await stateManager2.updateOrgan("brain", "ready");
    await entityStateManager.updateComponentEntry("synap", {
      organ: "brain",
      state: "ready",
      version: "latest",
      managedBy: "eve",
      config: { domain, repoRoot: result.deployDir }
    });
    console.log("\n\u2705 Synap Data Pod installed from image.");
    if (result.bootstrapToken) {
      const secrets = await readEveSecrets(process.cwd()).catch(() => null);
      const configuredDomain = domain !== "localhost" ? domain : secrets?.domain?.primary;
      const ssl = secrets?.domain?.ssl ?? false;
      const serverIp = getServerIp();
      console.log(`
  Admin bootstrap token (save this \u2014 one-time use):`);
      console.log(`  ${result.bootstrapToken}`);
      console.log(`
  Complete setup at:`);
      if (configuredDomain) {
        const proto = ssl ? "https" : "http";
        console.log(`    ${proto}://${configuredDomain}/admin/bootstrap`);
      }
      if (serverIp) {
        console.log(`    http://${serverIp}:4000/admin/bootstrap`);
      }
      console.log(`    http://localhost:4000/admin/bootstrap`);
    }
    return;
  }
  if (domain !== "localhost" && !email) {
    throw new Error(
      "Non-localhost domain requires --email (or LETSENCRYPT_EMAIL) for synap install."
    );
  }
  console.log("Initializing Eve brain via Synap Data Pod CLI...\n");
  console.log(`  SYNAP_REPO_ROOT (install cwd): ${delegate.repoRoot}`);
  console.log(`  SYNAP_DEPLOY_DIR (compose dir):  ${delegate.deployDir}`);
  console.log(
    "  Note: Eve state under .eve/ uses your shell cwd (where you ran eve); Synap always uses the paths above.\n"
  );
  await cleanupKnownStaleState(delegate.deployDir);
  const installArgs = [delegate.synapScript, "install", "--non-interactive", "--domain", domain];
  if (email) {
    installArgs.push("--email", email);
  }
  if (adminBootstrapMode) {
    installArgs.push("--admin-bootstrap-mode", adminBootstrapMode);
  }
  if (adminEmail) {
    installArgs.push("--admin-email", adminEmail);
  }
  if (adminPassword) {
    installArgs.push("--admin-password", adminPassword);
  }
  if (options.fromImage) {
    installArgs.push("--from-image");
  }
  if (options.fromSource) {
    installArgs.push("--from-source");
  }
  if (options.withOpenclaw) {
    installArgs.push("--with-openclaw");
  }
  if (options.withRsshub) {
    installArgs.push("--with-rsshub");
  }
  await execa("bash", installArgs, {
    cwd: delegate.repoRoot,
    env: { ...process.env, SYNAP_DEPLOY_DIR: delegate.deployDir },
    stdio: "inherit"
  });
  if (options.withAi) {
    console.log("\n\u{1F916} Local Ollama (optional; not part of default Synap compose)\n");
    await ensureNetwork();
    const ollama = new OllamaService();
    await ollama.install();
    await ollama.start();
    await ollama.pullModel(options.model ?? "llama3.1:8b");
  }
  const stateManager = new EntityStateManager();
  await stateManager.updateOrgan("brain", "ready");
  await entityStateManager.updateComponentEntry("synap", {
    organ: "brain",
    state: "ready",
    version: "0.5.0",
    managedBy: "eve",
    config: { domain, withRsshub: options.withRsshub, repoRoot: delegate.repoRoot }
  });
  console.log("\n\u2705 Eve brain initialized (Synap Data Pod).");
  if (domain === "localhost") {
    console.log("  API: http://localhost:4000 (backend; Caddy may serve https://localhost when configured)");
  } else {
    console.log(`  Public URL: https://${domain} (see deploy .env PUBLIC_URL)`);
  }
  if (options.withRsshub) {
    console.log("  RSSHub: http://localhost:1200 (default compose port)");
  }
}
function initCommand(program) {
  program.command("init").description(
    "Install the Synap Data Pod. Uses pre-built Docker image by default; pass --synap-repo to use a local checkout."
  ).option("--with-ai", "Include local Ollama sidecar (optional)").option("--model <model>", "AI model to use", "llama3.1:8b").option(
    "--synap-repo <path>",
    "Path to synap-backend checkout (optional \u2014 auto-detected or uses Docker image)"
  ).option("--domain <host>", "Domain for the data pod", "localhost").option("--email <email>", "SSL contact email (required if domain is not localhost)").option("--with-openclaw", "With --synap-repo: pass --with-openclaw to synap install").option("--with-rsshub", "With --synap-repo: pass --with-rsshub to synap install").option("--from-image", "Force from-image install even if synap-repo is found").option("--from-source", "With --synap-repo: build from source instead of pulling image").option("--admin-email <email>", "Admin email for bootstrap").option("--admin-password <secret>", "Admin password (preseed bootstrap mode)").option("--admin-bootstrap-mode <mode>", "preseed | token (default: token)").action(
    async (options) => {
      try {
        await runBrainInit({
          withAi: options.withAi,
          model: options.model,
          synapRepo: options.synapRepo,
          domain: options.domain,
          email: options.email,
          withOpenclaw: options.withOpenclaw,
          withRsshub: options.withRsshub,
          fromImage: options.fromImage,
          fromSource: options.fromSource,
          adminEmail: options.adminEmail,
          adminPassword: options.adminPassword,
          adminBootstrapMode: options.adminBootstrapMode
        });
      } catch (error) {
        console.error("Failed to initialize brain:", error);
        process.exit(1);
      }
    }
  );
}

// src/commands/status.ts
function statusCommand(program) {
  program.command("status").description("Show brain health status").action(async () => {
    try {
      console.log("Checking brain health...\n");
      const delegate = resolveSynapDelegate();
      if (!delegate) {
        throw new Error(
          "Synap delegate not configured. Set SYNAP_REPO_ROOT to a valid synap-backend checkout and rerun `eve brain status`."
        );
      }
      await execa("bash", [delegate.synapScript, "health"], {
        cwd: delegate.repoRoot,
        env: { ...process.env, SYNAP_DEPLOY_DIR: delegate.deployDir },
        stdio: "inherit"
      });
      const ollama = new OllamaService();
      const ollamaStatus = await ollama.getStatus();
      if (ollamaStatus.running) {
        console.log("AI Models");
        if (ollamaStatus.modelsInstalled.length > 0) {
          for (const model of ollamaStatus.modelsInstalled) {
            const current = model === ollamaStatus.currentModel ? " (current)" : "";
            console.log(`  \u2022 ${model}${current}`);
          }
        } else {
          console.log("  No models installed");
          console.log("  Run: eve brain init --with-ai --model <model>");
        }
      }
    } catch (error) {
      console.error("Failed to check brain status:", error);
      process.exit(1);
    }
  });
}

// src/lib/synap.ts
import { execSync, spawnSync } from "child_process";
function getSynapContainerIds(runningOnly = false) {
  try {
    const flag = runningOnly ? "" : "-a";
    const out = execSync(
      `docker ps ${flag} --filter "label=com.docker.compose.project=synap-backend" --format "{{.Names}}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim();
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
var SynapService = class {
  delegate() {
    return resolveSynapDelegate();
  }
  requireDelegate() {
    const d = this.delegate();
    if (!d) {
      throw new Error(
        "Synap repo not found. Pass --synap-repo <path> or set SYNAP_REPO_ROOT to a synap-backend checkout.\nTried: SYNAP_REPO_ROOT env, saved state, /opt/synap, /opt/synap-backend."
      );
    }
    return d;
  }
  async install() {
    this.requireDelegate();
    console.log(
      "Synap install is managed via the official synap CLI. Use `eve brain init --synap-repo <path>` or `eve setup --profile data_pod`."
    );
  }
  async start() {
    const d = this.delegate();
    if (d) {
      console.log("Starting Synap stack via synap CLI...");
      await execa("bash", [d.synapScript, "start"], {
        cwd: d.repoRoot,
        env: { ...process.env, SYNAP_DEPLOY_DIR: d.deployDir },
        stdio: "inherit"
      });
      return;
    }
    const containers = getSynapContainerIds();
    if (containers.length === 0) {
      console.log("Synap Data Pod not found \u2014 installing from Docker image...\n");
      const { installSynapFromImage: installSynapFromImage2 } = await import("./synap-image-install-DH42RPL4.js");
      const result = await installSynapFromImage2();
      if (result.bootstrapToken) {
        console.log(`
  Admin bootstrap token: ${result.bootstrapToken}`);
        console.log(`  Use at: http://localhost:4000/admin/bootstrap`);
      }
      return;
    }
    console.log(`Starting ${containers.length} synap-backend container(s) directly...`);
    for (const name of containers) {
      const result = spawnSync("docker", ["start", name], { stdio: "inherit" });
      if (result.status !== 0) {
        throw new Error(`Failed to start container: ${name}`);
      }
    }
  }
  async stop() {
    const d = this.delegate();
    if (d) {
      console.log("Stopping Synap stack via synap CLI...");
      await execa("bash", [d.synapScript, "stop"], {
        cwd: d.repoRoot,
        env: { ...process.env, SYNAP_DEPLOY_DIR: d.deployDir },
        stdio: "inherit"
      });
      return;
    }
    const containers = getSynapContainerIds(true);
    if (containers.length === 0) {
      console.log("No running synap-backend containers found.");
      return;
    }
    console.log(`Stopping ${containers.length} synap-backend container(s) directly...`);
    for (const name of containers) {
      spawnSync("docker", ["stop", name], { stdio: "inherit" });
    }
  }
  async isHealthy() {
    this.requireDelegate();
    try {
      const res = await fetch("http://127.0.0.1:4000/health", { signal: AbortSignal.timeout(3e3) });
      return res.ok;
    } catch {
      return false;
    }
  }
  async getVersion() {
    this.requireDelegate();
    return "synap-compose";
  }
};

// src/commands/start.ts
function startCommand(program) {
  program.command("start").description("Start Synap backend container").action(async () => {
    const synap = new SynapService();
    await synap.start();
  });
}

// src/commands/stop.ts
function stopCommand(program) {
  program.command("stop").description("Stop Synap backend container").action(async () => {
    const synap = new SynapService();
    await synap.stop();
  });
}

// src/inference-init.ts
import { EntityStateManager as EntityStateManager2 } from "@eve/dna";
import { InferenceGateway } from "@eve/legs";
async function runInferenceInit(options = {}) {
  const withGateway = options.withGateway !== false;
  const internalOnly = Boolean(options.internalOllamaOnly);
  await ensureNetwork();
  const ollama = new OllamaService();
  await ollama.install();
  await ollama.start({ publishToHost: !internalOnly });
  const model = options.model ?? "llama3.1:8b";
  await ollama.pullModel(model, { publishToHost: !internalOnly });
  if (withGateway) {
    const gw = new InferenceGateway();
    const result = await gw.ensure();
    console.log("\nInference gateway (Traefik)");
    console.log(`  URL:      ${result.publicUrl}`);
    console.log(`  User:     ${result.username}`);
    console.log(`  Password: ${result.password}`);
    console.log(`  Secrets:  ${result.secretsFile}`);
    console.log(`  Test:     curl -u '${result.username}:${result.password}' ${result.publicUrl}/api/tags`);
    const stateManager2 = new EntityStateManager2();
    await stateManager2.updateOrgan("legs", "ready");
  }
  const stateManager = new EntityStateManager2();
  await stateManager.setAIModel("ollama");
  await stateManager.updateOrgan("brain", "ready");
  console.log("\nInference profile ready.");
}

// src/index.ts
function registerBrainCommands(brain) {
  initCommand(brain);
  statusCommand(brain);
  startCommand(brain);
  stopCommand(brain);
}
export {
  OllamaService,
  SynapService,
  ensureNetwork,
  execa,
  initCommand,
  installSynapFromImage,
  registerBrainCommands,
  resolveSynapDelegate,
  runBrainInit,
  runInferenceInit,
  startCommand,
  statusCommand,
  stopCommand
};
