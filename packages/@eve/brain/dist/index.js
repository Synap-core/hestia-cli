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

// src/lib/synap.ts
var SynapService = class {
  containerName = "eve-brain-synap";
  image = "synap/backend:latest";
  delegate() {
    return resolveSynapDelegate();
  }
  async install() {
    const d = this.delegate();
    if (d) {
      console.log("Synap Data Pod: using synap CLI (SYNAP_REPO_ROOT). Run install via eve brain init --synap-repo \u2026");
      return;
    }
    console.log("Installing Synap backend...");
    await execa("docker", ["pull", this.image], { stdio: "inherit" });
    console.log("Synap backend image pulled successfully");
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
    console.log("Starting Synap backend...");
    const running = await this.isRunning();
    if (running) {
      console.log("Synap backend is already running");
      return;
    }
    const exists = await this.containerExists();
    if (exists) {
      await execa("docker", ["start", this.containerName], { stdio: "inherit" });
    } else {
      await execa(
        "docker",
        [
          "run",
          "-d",
          "--name",
          this.containerName,
          "--network",
          "eve-network",
          "-p",
          "4000:4000",
          "-e",
          "NODE_ENV=production",
          "-e",
          "DATABASE_URL=postgresql://eve:eve@eve-brain-postgres:5432/synap",
          "-e",
          "REDIS_URL=redis://eve-brain-redis:6379",
          "-e",
          "JWT_SECRET=hestia-local-dev-secret",
          "--restart",
          "unless-stopped",
          this.image
        ],
        { stdio: "inherit" }
      );
    }
    console.log("Synap backend started on port 4000");
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
    console.log("Stopping Synap backend...");
    const running = await this.isRunning();
    if (!running) {
      console.log("Synap backend is not running");
      return;
    }
    await execa("docker", ["stop", this.containerName], { stdio: "inherit" });
    console.log("Synap backend stopped");
  }
  async isHealthy() {
    if (this.delegate()) {
      try {
        const res = await fetch("http://127.0.0.1:4000/health", { signal: AbortSignal.timeout(3e3) });
        return res.ok;
      } catch {
        return false;
      }
    }
    try {
      const { stdout } = await execa("docker", [
        "inspect",
        "--format",
        "{{.State.Health.Status}}",
        this.containerName
      ]);
      return stdout.trim() === "healthy";
    } catch {
      return false;
    }
  }
  async getVersion() {
    if (this.delegate()) {
      return "synap-compose";
    }
    try {
      const { stdout } = await execa("docker", [
        "inspect",
        "--format",
        "{{.Config.Image}}",
        this.containerName
      ]);
      return stdout.trim();
    } catch {
      return "unknown";
    }
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

// src/commands/init.ts
import { EntityStateManager } from "@eve/dna";

// src/lib/postgres.ts
var PostgresService = class {
  containerName = "eve-brain-postgres";
  image = "postgres:16-alpine";
  async install() {
    console.log("Installing PostgreSQL...");
    await execa("docker", ["pull", this.image], { stdio: "inherit" });
    console.log("PostgreSQL image pulled successfully");
  }
  async start() {
    const running = await this.isRunning();
    if (running) {
      console.log("PostgreSQL is already running");
      return;
    }
    const exists = await this.containerExists();
    if (exists) {
      await execa("docker", ["start", this.containerName], { stdio: "inherit" });
    } else {
      await execa("docker", [
        "run",
        "-d",
        "--name",
        this.containerName,
        "--network",
        "eve-network",
        "-p",
        "5432:5432",
        "-e",
        "POSTGRES_USER=eve",
        "-e",
        "POSTGRES_PASSWORD=eve",
        "-e",
        "POSTGRES_DB=synap",
        "-v",
        "eve-postgres-data:/var/lib/postgresql/data",
        "--restart",
        "unless-stopped",
        this.image
      ], { stdio: "inherit" });
    }
    console.log("PostgreSQL started on port 5432");
    await this.waitForReady();
  }
  async stop() {
    console.log("Stopping PostgreSQL...");
    const running = await this.isRunning();
    if (!running) {
      console.log("PostgreSQL is not running");
      return;
    }
    await execa("docker", ["stop", this.containerName], { stdio: "inherit" });
    console.log("PostgreSQL stopped");
  }
  async createDatabase(name) {
    console.log(`Creating database: ${name}...`);
    await execa("docker", [
      "exec",
      this.containerName,
      "psql",
      "-U",
      "eve",
      "-c",
      `CREATE DATABASE ${name};`
    ], { stdio: "inherit" });
    console.log(`Database ${name} created`);
  }
  async isHealthy() {
    try {
      await execa("docker", [
        "exec",
        this.containerName,
        "pg_isready",
        "-U",
        "eve"
      ]);
      return true;
    } catch {
      return false;
    }
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
  async waitForReady() {
    console.log("Waiting for PostgreSQL to be ready...");
    let attempts = 0;
    const maxAttempts = 30;
    while (attempts < maxAttempts) {
      if (await this.isHealthy()) {
        console.log("PostgreSQL is ready");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1e3));
      attempts++;
    }
    throw new Error("PostgreSQL failed to become ready");
  }
};

// src/lib/redis.ts
var RedisService = class {
  containerName = "eve-brain-redis";
  image = "redis:7-alpine";
  async install() {
    console.log("Installing Redis...");
    await execa("docker", ["pull", this.image], { stdio: "inherit" });
    console.log("Redis image pulled successfully");
  }
  async start() {
    const running = await this.isRunning();
    if (running) {
      console.log("Redis is already running");
      return;
    }
    const exists = await this.containerExists();
    if (exists) {
      await execa("docker", ["start", this.containerName], { stdio: "inherit" });
    } else {
      await execa("docker", [
        "run",
        "-d",
        "--name",
        this.containerName,
        "--network",
        "eve-network",
        "-p",
        "6379:6379",
        "-v",
        "eve-redis-data:/data",
        "--restart",
        "unless-stopped",
        this.image,
        "redis-server",
        "--appendonly",
        "yes"
      ], { stdio: "inherit" });
    }
    console.log("Redis started on port 6379");
    await this.waitForReady();
  }
  async stop() {
    console.log("Stopping Redis...");
    const running = await this.isRunning();
    if (!running) {
      console.log("Redis is not running");
      return;
    }
    await execa("docker", ["stop", this.containerName], { stdio: "inherit" });
    console.log("Redis stopped");
  }
  async isHealthy() {
    try {
      await execa("docker", [
        "exec",
        this.containerName,
        "redis-cli",
        "ping"
      ]);
      return true;
    } catch {
      return false;
    }
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
  async waitForReady() {
    console.log("Waiting for Redis to be ready...");
    let attempts = 0;
    const maxAttempts = 30;
    while (attempts < maxAttempts) {
      if (await this.isHealthy()) {
        console.log("Redis is ready");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1e3));
      attempts++;
    }
    throw new Error("Redis failed to become ready");
  }
};

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

// src/commands/init.ts
async function runBrainInit(options) {
  const repo = options.synapRepo?.trim() || process.env.SYNAP_REPO_ROOT?.trim() || void 0;
  if (repo) {
    process.env.SYNAP_REPO_ROOT = repo;
  }
  const delegate = resolveSynapDelegate();
  if (delegate) {
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
    console.log(`  Repo: ${delegate.repoRoot}
`);
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
      const ollama2 = new OllamaService();
      await ollama2.install();
      await ollama2.start();
      await ollama2.pullModel(options.model ?? "llama3.1:8b");
    }
    const stateManager2 = new EntityStateManager();
    await stateManager2.updateOrgan("brain", "ready");
    console.log("\n\u2705 Eve brain initialized (Synap Data Pod).");
    if (domain === "localhost") {
      console.log("  API: http://localhost:4000 (backend; Caddy may serve https://localhost when configured)");
    } else {
      console.log(`  Public URL: https://${domain} (see deploy .env PUBLIC_URL)`);
    }
    if (options.withRsshub) {
      console.log("  RSSHub: http://localhost:1200 (default compose port)");
    }
    return;
  }
  console.log("Initializing Eve brain (Eve-managed Docker containers)...\n");
  console.log(
    "  Tip: for the full Data Pod, clone synap-backend and run with\n  SYNAP_REPO_ROOT=/path/to/synap-backend eve brain init\n  or: eve brain init --synap-repo /path/to/synap-backend\n"
  );
  const synap = new SynapService();
  const postgres = new PostgresService();
  const redis = new RedisService();
  const ollama = new OllamaService();
  await ensureNetwork();
  console.log("\n\u{1F4E6} Synap Backend");
  await synap.install();
  await synap.start();
  console.log("\n\u{1F4E6} Data Stores");
  await postgres.install();
  await postgres.start();
  await redis.install();
  await redis.start();
  if (options.withAi) {
    console.log("\n\u{1F916} AI Services");
    await ollama.install();
    await ollama.start();
    await ollama.pullModel(options.model ?? "llama3.1:8b");
  }
  const stateManager = new EntityStateManager();
  await stateManager.updateOrgan("brain", "ready");
  console.log("\n\u2705 Eve brain initialized successfully!");
  console.log("\nServices:");
  console.log("  Synap Backend: http://localhost:4000");
  console.log("  PostgreSQL: localhost:5432");
  console.log("  Redis: localhost:6379");
  if (options.withAi) {
    console.log("  Ollama: http://localhost:11434");
    console.log(`  Model: ${options.model}`);
  }
}
function initCommand(program) {
  program.command("init").description(
    "Initialize brain: Eve Docker stack, or full Synap Data Pod when --synap-repo / SYNAP_REPO_ROOT is set"
  ).option("--with-ai", "Include Ollama for local AI (alongside Synap or Eve stack)").option("--model <model>", "AI model to use", "llama3.1:8b").option(
    "--synap-repo <path>",
    "Path to synap-backend checkout; runs official synap install instead of Eve brain containers"
  ).option("--domain <host>", "With --synap-repo: DOMAIN for synap install", "localhost").option("--email <email>", "With --synap-repo: SSL contact (required if domain isn't localhost)").option("--with-openclaw", "With --synap-repo: pass --with-openclaw to synap install").option("--with-rsshub", "With --synap-repo: pass --with-rsshub to synap install").option("--from-image", "With --synap-repo: synap install --from-image").option("--from-source", "With --synap-repo: synap install --from-source").option("--admin-email <email>", "With --synap-repo: admin bootstrap email for synap install").option("--admin-password <secret>", "With --synap-repo: admin password for preseed bootstrap").option("--admin-bootstrap-mode <mode>", "With --synap-repo: preseed | token (default token)").action(
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
async function ensureNetwork() {
  try {
    const { stdout } = await execa("docker", ["network", "ls", "--format", "{{.Name}}"]);
    if (!stdout.includes("eve-network")) {
      console.log("Creating eve-network...");
      await execa("docker", ["network", "create", "eve-network"]);
    }
  } catch (error) {
    console.warn("Could not ensure network:", error);
  }
}

// src/commands/status.ts
function statusCommand(program) {
  program.command("status").description("Show brain health status").action(async () => {
    try {
      console.log("Checking brain health...\n");
      const delegate = resolveSynapDelegate();
      if (delegate) {
        await execa("bash", [delegate.synapScript, "health"], {
          cwd: delegate.repoRoot,
          env: { ...process.env, SYNAP_DEPLOY_DIR: delegate.deployDir },
          stdio: "inherit"
        });
        const ollama2 = new OllamaService();
        const ollamaStatus2 = await ollama2.getStatus();
        if (ollamaStatus2.running) {
          console.log("\nOllama (sidecar)");
          if (ollamaStatus2.modelsInstalled.length > 0) {
            for (const model of ollamaStatus2.modelsInstalled) {
              const current = model === ollamaStatus2.currentModel ? " (current)" : "";
              console.log(`  \u2022 ${model}${current}`);
            }
          }
        }
        return;
      }
      const synap = new SynapService();
      const postgres = new PostgresService();
      const redis = new RedisService();
      const ollama = new OllamaService();
      const synapHealthy = await synap.isHealthy();
      const postgresHealthy = await postgres.isHealthy();
      const redisHealthy = await redis.isHealthy();
      const ollamaStatus = await ollama.getStatus();
      console.log("Brain Status");
      const services = [
        { name: "Synap Backend", healthy: synapHealthy, url: "http://localhost:4000" },
        { name: "PostgreSQL", healthy: postgresHealthy, url: "localhost:5432" },
        { name: "Redis", healthy: redisHealthy, url: "localhost:6379" },
        { name: "Ollama", healthy: ollamaStatus.running, url: "http://localhost:11434" }
      ];
      for (const service of services) {
        const mark = service.healthy ? "\u2713" : "\u2717";
        console.log(`  ${mark} ${service.name.padEnd(20)} ${service.url}`);
      }
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
      const allHealthy = synapHealthy && postgresHealthy && redisHealthy;
      console.log("Summary");
      if (allHealthy) {
        console.log("All core services are healthy!");
      } else {
        console.warn('Some services are unhealthy. Run "eve brain init" to fix.');
      }
    } catch (error) {
      console.error("Failed to check brain status:", error);
      process.exit(1);
    }
  });
}

// src/inference-init.ts
import { EntityStateManager as EntityStateManager2 } from "@eve/dna";
import { InferenceGateway } from "@eve/legs";
async function ensureNetwork2() {
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
async function runInferenceInit(options = {}) {
  const withGateway = options.withGateway !== false;
  const internalOnly = Boolean(options.internalOllamaOnly);
  await ensureNetwork2();
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
  brain.command("start").description("Start Synap backend container").action(async () => {
    const synap = new SynapService();
    await synap.start();
  });
  brain.command("stop").description("Stop Synap backend container").action(async () => {
    const synap = new SynapService();
    await synap.stop();
  });
}
export {
  OllamaService,
  PostgresService,
  RedisService,
  SynapService,
  execa,
  initCommand,
  registerBrainCommands,
  resolveSynapDelegate,
  runBrainInit,
  runInferenceInit,
  statusCommand
};
