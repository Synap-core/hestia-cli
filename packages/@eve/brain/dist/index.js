// src/commands/init.ts
import { EntityStateManager, entityStateManager } from "@eve/dna";

// src/lib/exec.ts
import { spawn } from "child_process";
function execa(command, args, options) {
  return new Promise((resolve, reject) => {
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
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
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
    await new Promise((resolve) => setTimeout(resolve, 2e3));
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
import { existsSync } from "fs";
import { join } from "path";
function resolveSynapDelegate() {
  const repoRoot = process.env.SYNAP_REPO_ROOT?.trim();
  if (!repoRoot || !existsSync(repoRoot)) {
    return null;
  }
  const script = process.env.SYNAP_CLI?.trim() || join(repoRoot, "synap");
  if (!existsSync(script)) {
    return null;
  }
  const deployDir = join(repoRoot, "deploy");
  if (!existsSync(join(deployDir, "docker-compose.yml"))) {
    return null;
  }
  return { repoRoot, synapScript: script, deployDir };
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
  const delegate = resolveSynapDelegate();
  if (!delegate) {
    throw new Error(
      "Legacy Eve-managed Synap install path has been removed. Provide a valid `--synap-repo` (or `SYNAP_REPO_ROOT`) pointing to a synap-backend checkout with `synap` and `deploy/docker-compose.yml`."
    );
  }
  const domain = options.domain?.trim() || "localhost";
  const email = options.email?.trim() || process.env.LETSENCRYPT_EMAIL?.trim() || process.env.SYNAP_LETSENCRYPT_EMAIL?.trim();
  const adminEmail = options.adminEmail?.trim() || process.env.ADMIN_EMAIL?.trim();
  const adminPassword = options.adminPassword?.trim() || process.env.ADMIN_PASSWORD?.trim();
  const adminBootstrapMode = options.adminBootstrapMode ?? "token";
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
    config: { domain, withRsshub: options.withRsshub }
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
    "Initialize brain via Synap Data Pod (requires --synap-repo or SYNAP_REPO_ROOT)"
  ).option("--with-ai", "Include local Ollama sidecar (optional)").option("--model <model>", "AI model to use", "llama3.1:8b").option(
    "--synap-repo <path>",
    "Path to backend checkout; required for official synap install"
  ).option("--domain <host>", "With --synap-repo: DOMAIN for synap install", "localhost").option("--email <email>", "With --synap-repo: SSL contact (required if domain isn't localhost)").option("--with-openclaw", "With --synap-repo: pass --with-openclaw to synap install").option("--with-rsshub", "With --synap-repo: pass --with-rsshub to synap install").option("--from-image", "With --synap-repo: synap install --from-image").option("--from-source", "With --synap-repo: synap install --from-source").option("--admin-email <email>", "With --synap-repo: admin bootstrap email for synap install").option("--admin-password <secret>", "With --synap-repo: admin password for preseed bootstrap").option("--admin-bootstrap-mode <mode>", "With --synap-repo: preseed | token (default token)").action(
    async (options) => {
      console.log(
        `
\u26A0\uFE0F  \`eve brain init\` is deprecated.
    This command delegates to the Synap bash script.
    Please use instead:
        ./synap install (on your server)  or  npx @synap-core/cli init (on your laptop)
    (eve organs/brain/arms subcommands remain available for Eve Entity System use.)
`
      );
      if (!process.argv.includes("--confirm-delegation")) {
        console.log("    Pass --confirm-delegation to proceed anyway (not recommended).\n");
        process.exit(2);
      }
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
var SynapService = class {
  delegate() {
    return resolveSynapDelegate();
  }
  requireDelegate() {
    const d = this.delegate();
    if (!d) {
      throw new Error(
        "Synap delegate not configured. Set SYNAP_REPO_ROOT to a valid synap-backend checkout (must contain `synap` and `deploy/docker-compose.yml`), then run `eve setup --profile data_pod --synap-repo <path>`."
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
    const d = this.requireDelegate();
    console.log("Starting Synap stack via synap CLI...");
    await execa("bash", [d.synapScript, "start"], {
      cwd: d.repoRoot,
      env: { ...process.env, SYNAP_DEPLOY_DIR: d.deployDir },
      stdio: "inherit"
    });
  }
  async stop() {
    const d = this.requireDelegate();
    console.log("Stopping Synap stack via synap CLI...");
    await execa("bash", [d.synapScript, "stop"], {
      cwd: d.repoRoot,
      env: { ...process.env, SYNAP_DEPLOY_DIR: d.deployDir },
      stdio: "inherit"
    });
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
  registerBrainCommands,
  resolveSynapDelegate,
  runBrainInit,
  runInferenceInit,
  startCommand,
  statusCommand,
  stopCommand
};
