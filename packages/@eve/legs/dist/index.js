// src/lib/traefik.ts
import { execSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
var TraefikService = class {
  configDir;
  traefikConfigPath;
  dynamicConfigDir;
  constructor(configDir = "/opt/traefik") {
    this.configDir = configDir;
    this.traefikConfigPath = join(configDir, "traefik.yml");
    this.dynamicConfigDir = join(configDir, "dynamic");
  }
  async install() {
    console.log("Installing Traefik...");
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
    if (!existsSync(this.dynamicConfigDir)) {
      mkdirSync(this.dynamicConfigDir, { recursive: true });
    }
    const isDokploy = existsSync("/opt/dokploy");
    if (isDokploy) {
      console.log("Detected Dokploy - using existing Traefik installation");
      await this.configureDokployTraefik();
    } else {
      await this.installStandalone();
    }
    console.log("Traefik installation complete");
  }
  async installStandalone() {
    const staticConfig = `
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

providers:
  file:
    directory: ${this.dynamicConfigDir}
    watch: true

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@localhost
      storage: /etc/traefik/acme.json
      tlsChallenge: {}

api:
  dashboard: true
  insecure: false

log:
  level: INFO

accessLog: {}
`;
    writeFileSync(this.traefikConfigPath, staticConfig.trim());
    console.log("Created Traefik static config");
    try {
      execSync("docker network create eve-network", { stdio: "ignore" });
    } catch {
    }
    const dockerCmd = `
      docker run -d \\
        --name traefik \\
        --restart unless-stopped \\
        -p 80:80 \\
        -p 443:443 \\
        -p 8080:8080 \\
        -v ${this.configDir}/traefik.yml:/etc/traefik/traefik.yml \\
        -v ${this.dynamicConfigDir}:${this.dynamicConfigDir} \\
        -v /var/run/docker.sock:/var/run/docker.sock \\
        --network eve-network \\
        traefik:v3.0
    `;
    try {
      execSync(dockerCmd.replace(/\\/g, ""), { stdio: "inherit" });
      console.log("Traefik container started");
    } catch (error) {
      console.error("Failed to start Traefik:", error);
      throw error;
    }
  }
  async configureDokployTraefik() {
    console.log("Configuring Dokploy Traefik...");
    console.log("Using Dokploy-managed Traefik");
  }
  async addRoute(route) {
    console.log(`Adding route: ${route.path} -> ${route.target}`);
    const configFile = join(this.dynamicConfigDir, `${route.path.replace(/\//g, "_")}.yml`);
    const routeConfig = `
http:
  routers:
    ${route.path.replace(/[^a-zA-Z0-9]/g, "_")}:
      rule: "Host(\`${route.domain || "localhost"}\`) && PathPrefix(\`${route.path}\`)"
      service: ${route.path.replace(/[^a-zA-Z0-9]/g, "_")}
      ${route.ssl ? "tls: {}" : ""}
  
  services:
    ${route.path.replace(/[^a-zA-Z0-9]/g, "_")}:
      loadBalancer:
        servers:
          - url: "${route.target}"
`;
    writeFileSync(configFile, routeConfig.trim());
    console.log(`Route added: ${route.path}`);
  }
  async removeRoute(path) {
    console.log(`Removing route: ${path}`);
    const configFile = join(this.dynamicConfigDir, `${path.replace(/\//g, "_")}.yml`);
    if (existsSync(configFile)) {
      writeFileSync(configFile, "");
      console.log(`Route removed: ${path}`);
    } else {
      console.log(`Route not found: ${path}`);
    }
  }
  async configureDomain(domain) {
    console.log(`Configuring domain: ${domain}`);
    const routes = this.getRoutes();
    for (const route of routes) {
      await this.addRoute({ ...route, domain });
    }
    console.log(`Domain configured: ${domain}`);
  }
  async enableSSL() {
    console.log("Enabling SSL with Let's Encrypt...");
    const routes = this.getRoutes();
    for (const route of routes) {
      if (route.domain) {
        await this.addRoute({ ...route, ssl: true });
      }
    }
    console.log("SSL enabled for all routes with domains");
  }
  getRoutes() {
    try {
      const routes = [];
      const files = existsSync(this.dynamicConfigDir) ? readFileSync(this.dynamicConfigDir, "utf-8").split("\n") : [];
      for (const file of files) {
        if (file.endsWith(".yml")) {
          const content = readFileSync(join(this.dynamicConfigDir, file), "utf-8");
          const pathMatch = content.match(/PathPrefix\(`(.+)`\)/);
          const urlMatch = content.match(/url: "(.+)"/);
          if (pathMatch && urlMatch) {
            routes.push({
              path: pathMatch[1],
              target: urlMatch[1],
              domain: content.match(/Host\(`(.+)`\)/)?.[1],
              ssl: content.includes("tls:")
            });
          }
        }
      }
      return routes;
    } catch {
      return [];
    }
  }
  getStatus() {
    const installed = existsSync(this.traefikConfigPath);
    let running = false;
    try {
      execSync('docker ps --filter "name=traefik" --format "{{.Names}}"', { stdio: "pipe" });
      running = true;
    } catch {
      running = false;
    }
    const routes = this.getRoutes();
    const domain = routes.find((r) => r.domain)?.domain || null;
    const ssl = routes.some((r) => r.ssl);
    return { installed, running, domain, ssl, routes };
  }
};

// src/lib/tunnel.ts
import { execSync as execSync2 } from "child_process";
import { writeFileSync as writeFileSync2, existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2 } from "fs";
import { join as join2 } from "path";
var TunnelService = class {
  configDir;
  constructor(configDir = "/opt/hestia/tunnels") {
    this.configDir = configDir;
    if (!existsSync2(this.configDir)) {
      mkdirSync2(this.configDir, { recursive: true });
    }
  }
  async setupPangolin(config) {
    console.log("Setting up Pangolin tunnel...");
    try {
      execSync2("which pangolin", { stdio: "ignore" });
      console.log("Pangolin CLI already installed");
    } catch {
      console.log("Installing Pangolin CLI...");
      execSync2("curl -fsSL https://get.pangolin.cloud | sh", { stdio: "inherit" });
    }
    const pangolinConfig = {
      server: config?.server || "pangolin.to",
      domain: config?.domain,
      autoUpdate: true
    };
    writeFileSync2(
      join2(this.configDir, "pangolin.json"),
      JSON.stringify(pangolinConfig, null, 2)
    );
    console.log("Pangolin configured successfully");
  }
  async setupCloudflare(config) {
    console.log("Setting up Cloudflare tunnel...");
    try {
      execSync2("which cloudflared", { stdio: "ignore" });
      console.log("cloudflared already installed");
    } catch {
      console.log("Installing cloudflared...");
      execSync2("npm install -g cloudflared", { stdio: "inherit" });
    }
    const cfConfig = {
      tunnel: null,
      "credentials-file": join2(this.configDir, "cloudflare-credentials.json"),
      ingress: [
        {
          hostname: config?.domain,
          service: "http://localhost:3000"
        },
        {
          service: "http_status:404"
        }
      ]
    };
    writeFileSync2(
      join2(this.configDir, "cloudflare.yml"),
      JSON.stringify(cfConfig, null, 2)
    );
    console.log("Cloudflare tunnel configured");
  }
  startTunnel(provider) {
    console.log(`Starting ${provider} tunnel...`);
    if (provider === "pangolin") {
      execSync2("pangolin start", { stdio: "inherit" });
    } else {
      execSync2("cloudflared tunnel run", { stdio: "inherit" });
    }
  }
  stopTunnel(provider) {
    console.log(`Stopping ${provider} tunnel...`);
    try {
      if (provider === "pangolin") {
        execSync2("pkill pangolin", { stdio: "ignore" });
      } else {
        execSync2("pkill cloudflared", { stdio: "ignore" });
      }
      console.log(`${provider} tunnel stopped`);
    } catch {
      console.log(`${provider} tunnel was not running`);
    }
  }
  getConfig() {
    try {
      const configPath = join2(this.configDir, "config.json");
      if (!existsSync2(configPath)) {
        return null;
      }
      return JSON.parse(readFileSync2(configPath, "utf-8"));
    } catch {
      return null;
    }
  }
};

// src/lib/run-proxy-setup.ts
async function runLegsProxySetup(options) {
  console.log("\u{1F9B5} Setting up Legs (Traefik reverse proxy)...\n");
  const traefik = options.standalone ? new TraefikService("/opt/eve/traefik") : new TraefikService();
  console.log("Step 1: Installing Traefik...");
  await traefik.install();
  console.log("\nStep 2: Configuring routes...");
  const organs = [
    { name: "brain", path: "/brain", port: 3e3 },
    { name: "heart", path: "/heart", port: 4e3 },
    { name: "memory", path: "/memory", port: 5432 },
    { name: "nerves", path: "/nerves", port: 6379 },
    { name: "eyes", path: "/eyes", port: 8080 },
    { name: "dna", path: "/dna", port: 9e3 }
  ];
  for (const organ of organs) {
    const target = `http://localhost:${organ.port}`;
    await traefik.addRoute({
      path: organ.path,
      target,
      domain: options.domain,
      ssl: false
    });
    console.log(`  \u2713 Route: ${organ.path} -> ${target}`);
  }
  if (options.tunnel) {
    const tunnelMode = options.tunnel === "cloudflare_tunnel" ? "cloudflare" : options.tunnel === "pangolin_tunnel" ? "pangolin" : options.tunnel;
    console.log(`
Step 3: Setting up ${tunnelMode} tunnel...`);
    const tunnel = new TunnelService();
    if (tunnelMode === "pangolin") {
      await tunnel.setupPangolin({ domain: options.tunnelDomain });
      console.log("  \u2713 Pangolin tunnel configured");
    } else if (tunnelMode === "cloudflare") {
      await tunnel.setupCloudflare({ domain: options.tunnelDomain });
      console.log("  \u2713 Cloudflare tunnel configured");
    } else {
      console.warn(`  \u26A0 Unknown tunnel provider: ${String(options.tunnel)}`);
    }
  }
  if (options.domain) {
    console.log(`
Step 4: Configuring domain ${options.domain}...`);
    await traefik.configureDomain(options.domain);
    console.log("  \u2713 Domain configured");
    if (options.ssl) {
      console.log("\nStep 5: Enabling SSL...");
      await traefik.enableSSL();
      console.log("  \u2713 SSL enabled with Let's Encrypt");
    }
  }
  console.log("\n\u2705 Legs setup complete!");
  console.log("\nYour organs are now accessible at:");
  const baseUrl = options.domain || "localhost";
  const protocol = options.ssl ? "https" : "http";
  for (const organ of organs) {
    console.log(`  ${protocol}://${baseUrl}${organ.path}`);
  }
  if (options.tunnel) {
    console.log(`
Tunnel configured with ${options.tunnel}`);
    if (options.tunnelDomain) {
      console.log(`External domain: ${options.tunnelDomain}`);
    }
  }
}

// src/commands/setup.ts
function setupCommand(program) {
  program.command("setup").description("Setup Traefik reverse proxy for Eve").option("--domain <domain>", "Custom domain for external access").option(
    "--tunnel <provider>",
    "Tunnel provider (pangolin, cloudflare, pangolin_tunnel, cloudflare_tunnel)"
  ).option("--tunnel-domain <domain>", "Domain for tunnel (if using tunnel)").option("--ssl", "Enable SSL/TLS (requires --domain)").option("--standalone", "Install standalone Traefik (not using Dokploy)").action(async (options) => {
    try {
      await runLegsProxySetup({
        domain: options.domain,
        tunnel: options.tunnel,
        tunnelDomain: options.tunnelDomain,
        ssl: Boolean(options.ssl),
        standalone: Boolean(options.standalone)
      });
    } catch (error) {
      console.error("\n\u274C Setup failed:", error);
      process.exit(1);
    }
  });
}

// src/commands/domain.ts
function domainCommand(program) {
  const domain = program.command("domain").description("Configure Traefik domain and SSL");
  domain.command("set <domain>").description("Set primary domain for Traefik routes").option("--ssl", "Enable SSL with Let's Encrypt").action(async (domainName, options) => {
    try {
      const traefik = new TraefikService();
      console.log(`Configuring domain: ${domainName}`);
      await traefik.configureDomain(domainName);
      console.log(`Domain configured: ${domainName}`);
      if (options.ssl) {
        console.log("Enabling SSL with Let's Encrypt...");
        await traefik.enableSSL();
        console.log("SSL enabled");
      }
      const protocol = options.ssl ? "https" : "http";
      console.log("\nEndpoints (example paths):");
      for (const path of ["/brain", "/api"]) {
        console.log(`  ${protocol}://${domainName}${path}`);
      }
    } catch (error) {
      console.error("Domain configuration failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
  domain.command("unset").description("Revert domain to localhost").action(async () => {
    try {
      const traefik = new TraefikService();
      await traefik.configureDomain("localhost");
      console.log("Domain configuration removed (localhost)");
    } catch (error) {
      console.error("Failed to unset domain:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
  domain.command("status").description("Show current domain and route configuration").action(async () => {
    try {
      const traefik = new TraefikService();
      const status = await traefik.getStatus();
      console.log("Legs (Traefik) configuration:\n");
      const state = status.installed ? status.running ? "running" : "installed (not running)" : "not installed";
      console.log(`Status: ${state}`);
      console.log(`Domain: ${status.domain || "localhost"}`);
      console.log(`SSL: ${status.ssl ? "enabled" : "disabled"}`);
      console.log(`
Routes (${status.routes.length}):`);
      for (const route of status.routes) {
        console.log(`  ${route.path} -> ${route.target}`);
      }
    } catch (error) {
      console.error("Failed to get status:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
}

// src/commands/newt.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync3, writeFileSync as writeFileSync3 } from "fs";
import { join as join3 } from "path";
import { execSync as execSync3 } from "child_process";
var COMPOSE = `services:
  newt:
    image: fosrl/newt:latest
    container_name: eve-legs-newt
    restart: unless-stopped
    env_file:
      - \${NEWT_ENV_FILE}
    networks:
      - eve-network

networks:
  eve-network:
    external: true
`.trim();
function composePath(cwd) {
  return join3(cwd, ".eve", "legs", "newt-compose.yml");
}
function envPath(cwd) {
  return join3(cwd, ".eve", "legs", "newt.env");
}
function writeNewtEnvTemplate(cwd) {
  const dir = join3(cwd, ".eve", "legs");
  mkdirSync3(dir, { recursive: true });
  const p = envPath(cwd);
  if (!existsSync3(p)) {
    writeFileSync3(
      p,
      [
        "# Pangolin Newt site connector \u2014 https://docs.pangolin.net/manage/sites/install-site",
        "PANGOLIN_ENDPOINT=https://your-pangolin-host.example",
        "NEWT_ID=",
        "NEWT_SECRET=",
        "LOG_LEVEL=INFO",
        "# Optional: Docker discovery (read-only socket)",
        "# DOCKER_SOCKET=unix:///var/run/docker.sock",
        ""
      ].join("\n"),
      "utf-8"
    );
  }
  return p;
}
function newtCommand(program) {
  const n = program.command("newt").description("Pangolin Newt (site connector) on eve-network \u2014 fosrl/newt");
  n.command("init").description("Write .eve/legs/newt.env template if missing").action(() => {
    const cwd = process.cwd();
    const p = writeNewtEnvTemplate(cwd);
    console.log(`Newt env template: ${p}
Edit PANGOLIN_ENDPOINT, NEWT_ID, NEWT_SECRET then run: eve legs newt up`);
  });
  n.command("up").description("Start Newt container (requires filled newt.env + eve-network)").action(() => {
    const cwd = process.cwd();
    writeNewtEnvTemplate(cwd);
    const envFile = envPath(cwd);
    mkdirSync3(join3(cwd, ".eve", "legs"), { recursive: true });
    writeFileSync3(composePath(cwd), COMPOSE, "utf-8");
    try {
      execSync3("docker network create eve-network", { stdio: "ignore" });
    } catch {
    }
    const env = { ...process.env, NEWT_ENV_FILE: envFile };
    execSync3(`docker compose -f "${composePath(cwd)}" up -d`, { stdio: "inherit", cwd, env });
    console.log("\nNewt running. See Pangolin dashboard for site status.\n");
  });
  n.command("down").description("Stop Newt container").action(() => {
    const cwd = process.cwd();
    if (!existsSync3(composePath(cwd))) {
      console.log("No newt compose. Run: eve legs newt up");
      return;
    }
    execSync3(`docker compose -f "${composePath(cwd)}" down`, { stdio: "inherit", cwd, env: { ...process.env, NEWT_ENV_FILE: envPath(cwd) } });
  });
}

// src/lib/inference-gateway.ts
import { execSync as execSync4, spawnSync } from "child_process";
import { mkdirSync as mkdirSync4, writeFileSync as writeFileSync4 } from "fs";
import { join as join4 } from "path";
import { randomBytes } from "crypto";
import { readEveSecrets, writeEveSecrets } from "@eve/dna";
var GATEWAY_CONTAINER = "eve-inference-gateway";
var DEFAULT_HOST_PORT = "11435";
var InferenceGateway = class {
  baseDir;
  hostPort;
  cwd;
  constructor(cwd = process.cwd(), hostPort = DEFAULT_HOST_PORT) {
    this.cwd = cwd;
    this.baseDir = join4(cwd, ".eve", "inference-gateway");
    this.hostPort = process.env.EVE_INFERENCE_GATEWAY_PORT?.trim() || hostPort;
  }
  /** APR1 hash line for Traefik usersFile (user:hash). */
  htpasswdLine(username, plainPassword) {
    const r = spawnSync("openssl", ["passwd", "-apr1", plainPassword], { encoding: "utf-8" });
    if (r.error || r.status !== 0) {
      throw new Error(`openssl passwd -apr1 failed: ${r.stderr || r.error?.message || "unknown"}`);
    }
    const hash = (r.stdout ?? "").trim();
    return `${username}:${hash}`;
  }
  async ensure(ollamaHost = "http://eve-brain-ollama:11434") {
    mkdirSync4(join4(this.baseDir, "dynamic"), { recursive: true });
    const username = "eve";
    const password = randomBytes(18).toString("base64url").slice(0, 24);
    const userLine = this.htpasswdLine(username, password);
    const staticYaml = `
entryPoints:
  web:
    address: ":80"

providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true

log:
  level: INFO
`.trim();
    writeFileSync4(join4(this.baseDir, "dynamic", "ollama-users"), `${userLine}
`, { mode: 384 });
    const dynamicYaml = [
      "http:",
      "  routers:",
      "    ollama_api:",
      "      rule: PathPrefix(`/`)",
      "      entryPoints:",
      "        - web",
      "      service: ollama_svc",
      "      middlewares:",
      "        - ollama_auth",
      "  middlewares:",
      "    ollama_auth:",
      "      basicAuth:",
      "        usersFile: /etc/traefik/dynamic/ollama-users",
      "  services:",
      "    ollama_svc:",
      "      loadBalancer:",
      "        servers:",
      `          - url: "${ollamaHost}"`
    ].join("\n");
    writeFileSync4(join4(this.baseDir, "traefik.yml"), staticYaml);
    writeFileSync4(join4(this.baseDir, "dynamic", "ollama.yml"), dynamicYaml);
    const secretsFile = join4(this.baseDir, "..", "secrets", "ollama-gateway.txt");
    mkdirSync4(join4(this.baseDir, "..", "secrets"), { recursive: true });
    const secretBody = `# Eve inference gateway (Basic auth for Ollama)
URL=http://127.0.0.1:${this.hostPort}
USER=${username}
PASS=${password}

Example:
  curl -u '${username}:${password}' http://127.0.0.1:${this.hostPort}/api/tags
`;
    writeFileSync4(secretsFile, secretBody, { mode: 384 });
    const prevSecrets = await readEveSecrets(this.cwd);
    await writeEveSecrets(
      {
        inference: {
          ...prevSecrets?.inference ?? {},
          gatewayUrl: `http://127.0.0.1:${this.hostPort}`,
          gatewayUser: username,
          gatewayPass: password,
          ollamaUrl: prevSecrets?.inference?.ollamaUrl ?? ollamaHost
        }
      },
      this.cwd
    );
    try {
      execSync4("docker network create eve-network", { stdio: "ignore" });
    } catch {
    }
    const running = this.isGatewayRunning();
    if (!running) {
      if (this.gatewayContainerExists()) {
        execSync4(`docker start ${GATEWAY_CONTAINER}`, { stdio: "inherit" });
      } else {
        execSync4(
          [
            "docker",
            "run",
            "-d",
            "--name",
            GATEWAY_CONTAINER,
            "--restart",
            "unless-stopped",
            "--network",
            "eve-network",
            "-p",
            `${this.hostPort}:80`,
            "-v",
            `${this.baseDir}/traefik.yml:/etc/traefik/traefik.yml:ro`,
            "-v",
            `${this.baseDir}/dynamic:/etc/traefik/dynamic:ro`,
            "traefik:v3.0",
            "--configFile=/etc/traefik/traefik.yml"
          ].join(" "),
          { stdio: "inherit" }
        );
      }
    }
    return {
      baseDir: this.baseDir,
      hostPort: this.hostPort,
      publicUrl: `http://127.0.0.1:${this.hostPort}`,
      username,
      password,
      secretsFile
    };
  }
  gatewayContainerExists() {
    try {
      execSync4(`docker container inspect ${GATEWAY_CONTAINER}`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  isGatewayRunning() {
    try {
      const out = execSync4(`docker inspect -f '{{.State.Running}}' ${GATEWAY_CONTAINER}`, {
        encoding: "utf-8"
      }).trim();
      return out === "true";
    } catch {
      return false;
    }
  }
};

// src/index.ts
function registerLegsCommands(legs) {
  setupCommand(legs);
  domainCommand(legs);
  newtCommand(legs);
}
function registerCommands(program) {
  const legs = program.command("legs").description("Traefik, domains, and tunnels");
  registerLegsCommands(legs);
}
var index_default = {
  registerLegsCommands,
  registerCommands
};
export {
  InferenceGateway,
  TraefikService,
  TunnelService,
  index_default as default,
  domainCommand,
  newtCommand,
  registerCommands,
  registerLegsCommands,
  runLegsProxySetup,
  setupCommand
};
