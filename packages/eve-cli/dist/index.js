#!/usr/bin/env node

// src/index.ts
import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath as fileURLToPath2 } from "url";
import { dirname as dirname2, join as join8 } from "path";
import { setGlobalCliFlags } from "@eve/cli-kit";
import { registerBrainCommands } from "@eve/brain";
import { registerArmsCommands } from "@eve/arms";
import { registerLegsCommands } from "@eve/legs";
import { registerEyesCommands } from "@eve/eyes";
import { registerBuilderCommands } from "@eve/builder";

// src/commands/status.ts
import Table from "cli-table3";
import { execSync } from "child_process";
import { entityStateManager, COMPONENTS } from "@eve/dna";
import { getGlobalCliFlags } from "@eve/cli-kit";

// src/lib/ui.ts
import chalk from "chalk";
import boxen from "boxen";
var colors = {
  primary: chalk.hex("#6366f1"),
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
  muted: chalk.gray,
  brain: chalk.hex("#f59e0b"),
  arms: chalk.green,
  builder: chalk.blue,
  eyes: chalk.magenta,
  legs: chalk.cyan
};
var emojis = {
  brain: "\u{1F9E0}",
  arms: "\u{1F9BE}",
  builder: "\u{1F3D7}\uFE0F",
  eyes: "\u{1F441}\uFE0F",
  legs: "\u{1F9BF}",
  entity: "\u{1F33F}",
  success: "\u2705",
  error: "\u274C",
  warning: "\u26A0\uFE0F",
  info: "\u2139\uFE0F",
  sparkles: "\u2728",
  check: "\u2713",
  cross: "\u2717",
  bullet: "\u2022"
};
var CLEAR_LINE = "\r\x1B[2K";
function createSpinner(text3) {
  let interval;
  const frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  let i = 0;
  return {
    start() {
      process.stdout.write(`${CLEAR_LINE}${colors.info(`${frames[0]} ${text3}`)}`);
      interval = setInterval(() => {
        process.stdout.write(`${CLEAR_LINE}${colors.info(`${frames[i]} ${text3}`)}`);
        i = (i + 1) % frames.length;
      }, 80);
    },
    succeed(msg) {
      clearInterval(interval);
      console.log(`${CLEAR_LINE}${colors.success(`${emojis.check} ${msg || text3}`)}`);
    },
    fail(msg) {
      clearInterval(interval);
      console.log(`${CLEAR_LINE}${colors.error(`${emojis.cross} ${msg || text3}`)}`);
    },
    warn(msg) {
      clearInterval(interval);
      console.log(`${CLEAR_LINE}${colors.warning(`${emojis.warning} ${msg || text3}`)}`);
    }
  };
}
function printHeader(title, emoji) {
  console.log();
  console.log(colors.primary.bold(`${emoji ? emoji + " " : ""}${title}`));
  console.log(colors.primary("\u2500".repeat(title.length + (emoji ? 2 : 0))));
}
function printSuccess(message) {
  console.log(colors.success(`${emojis.success} ${message}`));
}
function printError(message) {
  console.log(colors.error(`${emojis.error} ${message}`));
}
function printWarning(message) {
  console.log(colors.warning(`${emojis.warning} ${message}`));
}
function printInfo(message) {
  console.log(colors.info(`${emojis.info} ${message}`));
}
function printKeyValue(key, value, keyWidth = 20) {
  const paddedKey = key.padEnd(keyWidth);
  console.log(`${colors.muted(paddedKey)} ${value}`);
}
function formatOrgan(organ) {
  const organColors = {
    brain: colors.brain,
    arms: colors.arms,
    builder: colors.builder,
    eyes: colors.eyes,
    legs: colors.legs
  };
  const color = organColors[organ] || colors.info;
  const emoji = emojis[organ] || emojis.bullet;
  return color(`${emoji} ${organ.charAt(0).toUpperCase() + organ.slice(1)}`);
}
function printBox(title, lines) {
  const body = lines.join("\n");
  console.log(
    boxen(`${colors.primary.bold(title)}

${body}`, {
      padding: 1,
      margin: { top: 0, bottom: 1, left: 0, right: 0 },
      borderStyle: "round",
      borderColor: "#6366f1"
    })
  );
}

// src/commands/status.ts
var ORGAN_CONTAINERS = {
  brain: ["eve-brain-synap-proxy", "eve-brain-ollama"],
  arms: ["eve-arms-openclaw"],
  builder: [],
  eyes: ["eve-eyes-rsshub"],
  legs: ["eve-legs-traefik"]
};
function getLiveContainerState() {
  const running = /* @__PURE__ */ new Set();
  const all = /* @__PURE__ */ new Set();
  try {
    const outRunning = execSync('docker ps --format "{{.Names}}"', {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"]
    }).trim();
    for (const n of outRunning.split("\n").filter(Boolean)) running.add(n.trim());
  } catch {
  }
  try {
    const outAll = execSync('docker ps -a --format "{{.Names}}"', {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"]
    }).trim();
    for (const n of outAll.split("\n").filter(Boolean)) all.add(n.trim());
  } catch {
  }
  try {
    const synapName = execSync(
      `docker ps --filter "label=com.docker.compose.project=synap-backend" --filter "label=com.docker.compose.service=backend" --format "{{.Names}}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim().split("\n")[0]?.trim();
    if (synapName) running.add("eve-brain-synap-proxy");
  } catch {
  }
  try {
    const synapNameAll = execSync(
      `docker ps -a --filter "label=com.docker.compose.project=synap-backend" --filter "label=com.docker.compose.service=backend" --format "{{.Names}}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim().split("\n")[0]?.trim();
    if (synapNameAll) all.add("eve-brain-synap-proxy");
  } catch {
  }
  return { running, all };
}
function getOrganLiveState(organ, state) {
  const containers = ORGAN_CONTAINERS[organ];
  if (containers.length === 0) return "unknown";
  const runningCount = containers.filter((c) => state.running.has(c)).length;
  if (runningCount === containers.length) return "running";
  if (runningCount > 0) return "partial";
  const existsCount = containers.filter((c) => state.all.has(c)).length;
  if (existsCount === 0) return "not-installed";
  return "stopped";
}
function statusCommand(program2) {
  program2.command("status").alias("s").description("Show comprehensive entity status").option("-w, --watch", "Watch mode - continuously update").option("-j, --json", "Output as JSON").action(async (options) => {
    try {
      if (options.watch) {
        await watchStatus();
      } else {
        await showStatus(Boolean(options.json || getGlobalCliFlags().json));
      }
    } catch (error) {
      console.error(colors.error("Failed to get entity status:"), error);
      process.exit(1);
    }
  });
}
async function showStatus(json = false) {
  const state = await entityStateManager.getState();
  if (json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  const liveContainers = getLiveContainerState();
  console.log();
  console.log(colors.primary.bold(`${emojis.entity} Entity Status`));
  console.log(colors.primary("\u2550".repeat(50)));
  console.log();
  printKeyValue("Entity Name", state.metadata.entityName || "Unnamed");
  printKeyValue("Version", state.version);
  printKeyValue("Initialized", new Date(state.initializedAt).toLocaleDateString());
  printKeyValue("AI Model", state.aiModel === "none" ? "Not configured" : state.aiModel);
  if (state.metadata.lastBootTime) {
    printKeyValue("Last Boot", new Date(state.metadata.lastBootTime).toLocaleString());
  }
  console.log();
  const table = new Table({
    head: [
      colors.primary.bold("Organ"),
      colors.primary.bold("Status"),
      colors.primary.bold("Live"),
      colors.primary.bold("Version"),
      colors.primary.bold("Last Check")
    ],
    colWidths: [15, 12, 10, 12, 22],
    style: {
      head: [],
      border: ["grey"]
    }
  });
  const organs = ["brain", "arms", "builder", "eyes", "legs"];
  for (const organ of organs) {
    const organState = state.organs[organ];
    const statusColor = getStatusColor(organState.state);
    const liveState = getOrganLiveState(organ, liveContainers);
    let liveLabel;
    if (liveState === "running") liveLabel = colors.success("\u25CF up");
    else if (liveState === "partial") liveLabel = colors.warning("\u25D1 partial");
    else if (liveState === "stopped") liveLabel = colors.error("\u25CB down");
    else if (liveState === "not-installed") liveLabel = colors.muted("\u2717 none");
    else liveLabel = colors.muted("\u2014");
    table.push([
      formatOrgan(organ),
      statusColor(organState.state),
      liveLabel,
      organState.version || "-",
      organState.lastChecked ? new Date(organState.lastChecked).toLocaleString() : "Never"
    ]);
  }
  console.log(table.toString());
  console.log();
  const readyCount = organs.filter((o) => state.organs[o].state === "ready").length;
  const percent = Math.round(readyCount / organs.length * 100);
  printBox("Completeness", [
    `${colors.info("Progress:")} ${readyCount}/${organs.length} organs ready (${percent}%)`,
    "",
    getCompletenessBar(percent)
  ]);
  const FIX_COMMANDS = {
    brain: "npx eve brain init --synap-repo /path/to/synap-backend",
    arms: "npx eve install --components=arms",
    builder: "npx eve install --components=builder",
    eyes: "npx eve install --components=eyes",
    legs: "npx eve install --components=legs"
  };
  const RESTART_COMMANDS = {
    brain: 'docker start $(docker ps -a --filter "label=com.docker.compose.project=synap-backend" --filter "label=com.docker.compose.service=backend" -q)',
    arms: "docker start eve-arms-openclaw",
    builder: "docker start eve-builder-hermes",
    eyes: "docker start eve-eyes-rsshub",
    legs: "docker start eve-legs-traefik"
  };
  const staleOrgans = organs.filter((o) => {
    const live = getOrganLiveState(o, liveContainers);
    return state.organs[o].state === "ready" && (live === "stopped" || live === "not-installed");
  });
  const notInstalledOrgans = organs.filter(
    (o) => state.organs[o].state === "ready" && getOrganLiveState(o, liveContainers) === "not-installed"
  );
  const missingOrgans = organs.filter((o) => state.organs[o].state === "missing");
  if (staleOrgans.length > 0 || missingOrgans.length > 0) {
    console.log();
    console.log(colors.warning.bold(`${emojis.info} Action needed:`));
    for (const organ of staleOrgans) {
      const isNotInstalled = notInstalledOrgans.includes(organ);
      if (isNotInstalled) {
        console.log(`  ${colors.error("\u2717")} ${formatOrgan(organ)} \u2014 never installed or container removed`);
        console.log(`      ${colors.muted("\u2192")} ${colors.info(FIX_COMMANDS[organ])}`);
      } else {
        console.log(`  ${colors.error("\u25CB")} ${formatOrgan(organ)} \u2014 container stopped`);
        console.log(`      ${colors.muted("\u2192")} ${colors.info(RESTART_COMMANDS[organ])}`);
      }
    }
    for (const organ of missingOrgans) {
      console.log(`  ${colors.muted("\u2192")} Install ${formatOrgan(organ)}: ${colors.info(FIX_COMMANDS[organ])}`);
    }
  }
  await showComponentOverview();
  console.log();
}
async function showComponentOverview() {
  const installed = await entityStateManager.getInstalledComponents();
  const liveContainers = getLiveContainerState();
  const componentLiveState = /* @__PURE__ */ new Map();
  for (const comp of COMPONENTS) {
    if (!comp.service) {
      componentLiveState.set(comp.id, "no-service");
      continue;
    }
    componentLiveState.set(
      comp.id,
      liveContainers.running.has(comp.service.containerName) ? "running" : "missing"
    );
  }
  const installedComps = COMPONENTS.filter((c) => installed.includes(c.id));
  const availableComps = COMPONENTS.filter((c) => !installed.includes(c.id));
  const recommendations = [];
  if (installed.includes("synap") && !installed.includes("openclaw")) {
    recommendations.push({ id: "openclaw", reason: "gives your data pod an AI agent layer" });
  }
  if (installed.includes("synap") && !installed.includes("rsshub")) {
    recommendations.push({ id: "rsshub", reason: "turns websites into feeds your AI can read" });
  }
  if (installed.includes("synap") && !installed.includes("openwebui")) {
    recommendations.push({ id: "openwebui", reason: "self-hosted chat UI wired to your AI" });
  }
  if (!installed.includes("synap") && installed.includes("traefik")) {
    recommendations.push({ id: "synap", reason: "the data pod \u2014 your sovereign second brain" });
  }
  const recommendedIds = new Set(recommendations.map((r) => r.id));
  console.log();
  console.log(colors.primary.bold(`${emojis.entity} Components`));
  console.log(colors.muted("\u2500".repeat(60)));
  if (installedComps.length > 0) {
    console.log();
    console.log(colors.success.bold("  Installed"));
    for (const comp of installedComps) {
      const live = componentLiveState.get(comp.id);
      let dot;
      let suffix;
      if (live === "running") {
        dot = colors.success("\u25CF");
        suffix = "";
      } else if (live === "missing") {
        dot = colors.error("\u25CF");
        suffix = colors.error(" (container not running)");
      } else {
        dot = colors.muted("\u25CF");
        suffix = "";
      }
      console.log(`    ${dot} ${comp.emoji} ${comp.label.padEnd(20)} ${colors.muted(comp.description.split(".")[0])}${suffix}`);
    }
    const stale = installedComps.filter((c) => componentLiveState.get(c.id) === "missing");
    if (stale.length > 0) {
      console.log();
      console.log(colors.warning(`    \u26A0 ${stale.length} component(s) are marked installed but their containers are missing.`));
      console.log(colors.muted(`      Re-install: ${colors.info(`eve add ${stale.map((c) => c.id).join(" ")}`)}`));
      console.log(colors.muted(`      Or run:     ${colors.info("eve doctor")} ${colors.muted("to investigate")}`));
    }
  }
  if (recommendations.length > 0) {
    console.log();
    console.log(colors.warning.bold("  Recommended next"));
    for (const rec of recommendations) {
      const comp = COMPONENTS.find((c) => c.id === rec.id);
      console.log(`    ${colors.warning("\u25CB")} ${comp.emoji} ${comp.label.padEnd(20)} ${colors.muted(rec.reason)}`);
      console.log(`      ${colors.muted("\u2192")} ${colors.info(`eve add ${comp.id}`)}`);
    }
  }
  const otherAvailable = availableComps.filter((c) => !recommendedIds.has(c.id));
  if (otherAvailable.length > 0) {
    console.log();
    console.log(colors.muted.bold("  Also available"));
    for (const comp of otherAvailable) {
      const reqs = comp.requires?.length ? colors.muted(` (requires: ${comp.requires.join(", ")})`) : "";
      console.log(`    ${colors.muted("\u25CB")} ${comp.emoji} ${comp.label.padEnd(20)} ${colors.muted(comp.description.split(".")[0])}${reqs}`);
    }
    console.log();
    console.log(colors.muted(`    Install any with: ${colors.info("eve add <component-id>")}`));
  }
}
async function watchStatus() {
  console.log(colors.info("Watching entity status (press Ctrl+C to exit)...\n"));
  await showStatus();
  const interval = setInterval(async () => {
    console.log("\x1B[2J\x1B[0f");
    await showStatus();
    console.log(colors.muted("\n(Updating every 2 seconds. Press Ctrl+C to exit)"));
  }, 2e3);
  process.on("SIGINT", () => {
    clearInterval(interval);
    console.log("\n" + colors.success("Watch mode stopped"));
    process.exit(0);
  });
}
function getStatusColor(state) {
  switch (state) {
    case "ready":
      return colors.success;
    case "installing":
      return colors.info;
    case "error":
      return colors.error;
    case "stopped":
      return colors.warning;
    default:
      return colors.muted;
  }
}
function getCompletenessBar(percent) {
  const width = 30;
  const filled = Math.round(percent / 100 * width);
  const empty = width - filled;
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty);
  let color = colors.error;
  if (percent >= 60) color = colors.warning;
  if (percent >= 80) color = colors.info;
  if (percent === 100) color = colors.success;
  return color(bar) + colors.muted(` ${percent}%`);
}

// src/commands/doctor.ts
import { execa } from "execa";
import { execSync as execSync3 } from "child_process";
import {
  entityStateManager as entityStateManager2,
  COMPONENTS as COMPONENTS2,
  readEveSecrets,
  getAccessUrls,
  hasAnyProvider
} from "@eve/dna";
import { verifyComponent } from "@eve/legs";

// src/lib/probe-routes.ts
import { execSync as execSync2 } from "child_process";
import { getServerIp } from "@eve/dna";
function probeRoutes(urls) {
  const serverIp = getServerIp();
  const out = [];
  for (const svc of urls) {
    if (!svc.domainUrl) continue;
    const host = svc.domainUrl.replace(/^https?:\/\//, "").split("/")[0];
    let httpStatus = "???";
    try {
      httpStatus = execSync2(
        `curl -s -o /dev/null -w "%{http_code}" --max-time 4 -H "Host: ${host}" http://localhost:80/`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
      ).trim();
    } catch {
      httpStatus = "timeout";
    }
    let dnsResolved = null;
    try {
      const out2 = execSync2(`getent hosts ${host} 2>/dev/null | awk '{print $1}' | head -1`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"]
      }).trim();
      if (out2) dnsResolved = out2;
    } catch {
    }
    if (!dnsResolved) {
      try {
        const out2 = execSync2(`dig +short ${host} | head -1`, {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "ignore"]
        }).trim();
        if (out2) dnsResolved = out2;
      } catch {
      }
    }
    const dnsCorrect = !!serverIp && dnsResolved === serverIp;
    let outcome;
    if (!dnsResolved) {
      outcome = "dns-missing";
    } else if (!dnsCorrect) {
      outcome = "dns-wrong";
    } else if (httpStatus === "timeout") {
      outcome = "timeout";
    } else if (httpStatus === "404") {
      outcome = "not-routing";
    } else if (httpStatus === "502" || httpStatus === "503" || httpStatus === "504") {
      outcome = "upstream-down";
    } else {
      outcome = "ok";
    }
    out.push({ id: svc.id, host, httpStatus, dnsResolved, dnsCorrect, outcome });
  }
  return out;
}
function probeVerdict(probes) {
  if (probes.length === 0) return "ok";
  const okCount = probes.filter((p) => p.outcome === "ok").length;
  if (okCount === probes.length) return "ok";
  if (okCount === 0) return "broken";
  return "partial";
}

// src/commands/doctor.ts
function doctorCommand(program2) {
  program2.command("doctor").alias("doc").description("Run comprehensive diagnostics on the entity").option("-v, --verbose", "Show verbose output").action(async (options) => {
    try {
      await runDiagnostics(options.verbose);
    } catch (error) {
      printError("Diagnostics failed: " + String(error));
      process.exit(1);
    }
  });
}
async function runDiagnostics(verbose = false) {
  console.log();
  printHeader("Entity Diagnostics", emojis.info);
  console.log();
  const checks = [];
  const dockerCheck = createSpinner("Checking Docker...");
  dockerCheck.start();
  try {
    await execa("docker", ["version"]);
    dockerCheck.succeed("Docker is running");
    checks.push({ name: "Docker", status: "pass", message: "Docker daemon is running" });
  } catch {
    dockerCheck.fail("Docker is not running");
    checks.push({
      name: "Docker",
      status: "fail",
      message: "Docker daemon is not running",
      fix: "Start Docker Desktop or run: sudo systemctl start docker"
    });
  }
  const composeCheck = createSpinner("Checking Docker Compose...");
  composeCheck.start();
  try {
    await execa("docker", ["compose", "version"]);
    composeCheck.succeed("Docker Compose is available");
    checks.push({ name: "Docker Compose", status: "pass", message: "Docker Compose is installed" });
  } catch {
    composeCheck.fail("Docker Compose not found");
    checks.push({
      name: "Docker Compose",
      status: "fail",
      message: "Docker Compose is not installed",
      fix: "Install Docker Compose: https://docs.docker.com/compose/install/"
    });
  }
  const networkCheck = createSpinner("Checking eve-network...");
  networkCheck.start();
  try {
    const { stdout } = await execa("docker", ["network", "ls", "--format", "{{.Name}}"]);
    if (stdout.includes("eve-network")) {
      networkCheck.succeed("eve-network exists");
      checks.push({ name: "Network", status: "pass", message: "eve-network is created" });
    } else {
      networkCheck.warn("eve-network not found");
      checks.push({
        name: "Network",
        status: "warn",
        message: "eve-network does not exist",
        fix: "eve init will create it automatically"
      });
    }
  } catch {
    networkCheck.fail("Cannot check networks");
    checks.push({ name: "Network", status: "fail", message: "Failed to check Docker networks" });
  }
  const installed = await entityStateManager2.getInstalledComponents().catch(() => []);
  const expectedContainers = COMPONENTS2.filter((c) => installed.includes(c.id) && c.service).map((c) => ({ name: c.service.containerName, organ: c.organ ?? c.id, label: c.label }));
  const containerCheck = createSpinner("Checking installed containers...");
  containerCheck.start();
  try {
    const { stdout: psOut } = await execa("docker", [
      "ps",
      "--format",
      "{{.Names}}	{{.Status}}"
    ]);
    const running = /* @__PURE__ */ new Map();
    for (const line of psOut.split("\n").filter(Boolean)) {
      const [name, ...statusParts] = line.split("	");
      if (name) running.set(name.trim(), statusParts.join(" ").trim());
    }
    const { stdout: allOut } = await execa("docker", [
      "ps",
      "-a",
      "--format",
      "{{.Names}}	{{.Status}}"
    ]);
    const all = /* @__PURE__ */ new Map();
    for (const line of allOut.split("\n").filter(Boolean)) {
      const [name, ...statusParts] = line.split("	");
      if (name) all.set(name.trim(), statusParts.join(" ").trim());
    }
    containerCheck.succeed("Container check complete");
    for (const c of expectedContainers) {
      if (running.has(c.name)) {
        checks.push({
          name: c.name,
          status: "pass",
          message: `Running \u2014 ${running.get(c.name)}`
        });
      } else if (all.has(c.name)) {
        checks.push({
          name: c.name,
          status: "fail",
          message: `Stopped \u2014 ${all.get(c.name)}`,
          fix: `docker start ${c.name}`
        });
      } else {
        checks.push({
          name: c.name,
          status: "warn",
          message: "Not found \u2014 container missing",
          fix: `eve add ${c.organ}`
        });
      }
    }
  } catch {
    containerCheck.fail("Could not query Docker containers");
    checks.push({ name: "Containers", status: "fail", message: "docker ps failed \u2014 is Docker running?" });
  }
  const reachabilityCheck = createSpinner("Probing service reachability from Traefik...");
  reachabilityCheck.start();
  try {
    for (const c of COMPONENTS2) {
      if (!c.service || !installed.includes(c.id)) continue;
      const result = await verifyComponent(c.id);
      if (result.ok) {
        checks.push({ name: `${c.label} reachability`, status: "pass", message: result.summary });
      } else {
        const failed2 = result.checks.find((ch) => !ch.ok);
        checks.push({
          name: `${c.label} reachability`,
          status: "fail",
          message: failed2?.detail ?? result.summary,
          fix: `docker logs ${c.service.containerName} --tail 30`
        });
      }
    }
    reachabilityCheck.succeed("Reachability check complete");
  } catch (err) {
    reachabilityCheck.warn("Could not probe reachability");
  }
  const secrets = await readEveSecrets(process.cwd());
  if (secrets?.domain?.primary) {
    const routeCheck = createSpinner(`Probing domain routes (${secrets.domain.primary})...`);
    routeCheck.start();
    try {
      const urls = getAccessUrls(secrets, installed);
      const probes = probeRoutes(urls);
      routeCheck.succeed(`Probed ${probes.length} route(s)`);
      for (const p of probes) {
        if (p.outcome === "ok") {
          checks.push({ name: `route: ${p.host}`, status: "pass", message: `${p.httpStatus} reachable` });
        } else if (p.outcome === "upstream-down") {
          checks.push({
            name: `route: ${p.host}`,
            status: "fail",
            message: `${p.httpStatus} \u2014 route OK, upstream not responding`,
            fix: `Check the upstream container is running and listening on its port.`
          });
        } else if (p.outcome === "not-routing") {
          checks.push({
            name: `route: ${p.host}`,
            status: "fail",
            message: `Traefik returned 404 \u2014 no router matched`,
            fix: `eve domain repair`
          });
        } else if (p.outcome === "dns-missing") {
          checks.push({
            name: `route: ${p.host}`,
            status: "warn",
            message: `No DNS A record for ${p.host}`,
            fix: `Create A record at your registrar pointing to your server IP`
          });
        } else if (p.outcome === "dns-wrong") {
          checks.push({
            name: `route: ${p.host}`,
            status: "warn",
            message: `DNS resolves to ${p.dnsResolved} (not this server)`,
            fix: `Update A record at your registrar`
          });
        }
      }
      const verdict = probeVerdict(probes);
      if (verdict !== "ok") {
        checks.push({
          name: "Domain routes",
          status: verdict === "broken" ? "fail" : "warn",
          message: verdict === "broken" ? "No routes reachable" : "Some routes failing"
        });
      }
    } catch {
      routeCheck.fail("Could not probe domain routes");
    }
  }
  const aiCheck = createSpinner("Checking AI provider wiring...");
  aiCheck.start();
  try {
    const aiSecrets = secrets ?? await readEveSecrets(process.cwd());
    if (!hasAnyProvider(aiSecrets)) {
      const aiConsumers = ["synap", "openclaw", "openwebui"];
      const willUseAi = installed.some((c) => aiConsumers.includes(c));
      if (willUseAi) {
        aiCheck.warn("No AI provider configured");
        checks.push({
          name: "AI provider",
          status: "warn",
          message: "No provider key in secrets.ai.providers",
          fix: "eve ai providers add anthropic --api-key <key>"
        });
      } else {
        aiCheck.succeed("No AI provider configured (no AI-consuming components installed yet)");
      }
    } else {
      aiCheck.succeed("AI provider configured");
      if (installed.includes("openclaw")) {
        try {
          const out = execSync3(
            `docker exec eve-arms-openclaw test -f /home/node/.openclaw/agents/main/agent/auth-profiles.json && echo OK || echo MISSING`,
            { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
          ).trim();
          if (out === "OK") {
            checks.push({ name: "OpenClaw AI wiring", status: "pass", message: "auth-profiles.json present in container" });
          } else {
            checks.push({
              name: "OpenClaw AI wiring",
              status: "fail",
              message: "auth-profiles.json missing \u2014 agent loop will fail",
              fix: "eve ai apply"
            });
          }
        } catch {
          checks.push({
            name: "OpenClaw AI wiring",
            status: "warn",
            message: "Could not check (container not running?)",
            fix: "docker start eve-arms-openclaw"
          });
        }
      }
      if (installed.includes("openwebui")) {
        try {
          const { existsSync: existsSync8, readFileSync: readFileSync2 } = await import("fs");
          const envPath = "/opt/openwebui/.env";
          if (existsSync8(envPath)) {
            const content = readFileSync2(envPath, "utf-8");
            if (content.includes("SYNAP_IS_URL") && content.includes("SYNAP_API_KEY")) {
              checks.push({ name: "Open WebUI AI wiring", status: "pass", message: ".env points at Synap IS" });
            } else {
              checks.push({
                name: "Open WebUI AI wiring",
                status: "warn",
                message: ".env missing SYNAP_IS_URL/SYNAP_API_KEY",
                fix: "eve ai apply"
              });
            }
          }
        } catch {
        }
      }
      if (installed.includes("synap")) {
        try {
          const { existsSync: existsSync8, readFileSync: readFileSync2 } = await import("fs");
          const deployDir = process.env.SYNAP_DEPLOY_DIR ?? "/opt/synap-backend/deploy";
          const envPath = `${deployDir}/.env`;
          if (existsSync8(envPath)) {
            const content = readFileSync2(envPath, "utf-8");
            const hasKey = /^(OPENAI|ANTHROPIC|OPENROUTER)_API_KEY=.+/m.test(content);
            if (hasKey) {
              checks.push({ name: "Synap IS AI wiring", status: "pass", message: "upstream provider key in deploy/.env" });
            } else {
              checks.push({
                name: "Synap IS AI wiring",
                status: "warn",
                message: "No upstream provider key in Synap deploy/.env",
                fix: "eve ai apply"
              });
            }
          }
        } catch {
        }
      }
    }
  } catch {
    aiCheck.fail("AI wiring check failed");
  }
  const stateCheck = createSpinner("Checking entity state...");
  stateCheck.start();
  try {
    const state = await entityStateManager2.getState();
    stateCheck.succeed("Entity state is accessible");
    const organs = ["brain", "arms", "builder", "eyes", "legs"];
    for (const organ of organs) {
      const organState = state.organs[organ];
      if (organState.state === "ready") {
        checks.push({
          name: `${formatOrgan(organ)} (state)`,
          status: "pass",
          message: "Organ marked ready in state"
        });
      } else if (organState.state === "error") {
        checks.push({
          name: `${formatOrgan(organ)} (state)`,
          status: "fail",
          message: organState.errorMessage || "Organ has errors",
          fix: `eve install --components=${organ}`
        });
      } else if (organState.state === "missing") {
        checks.push({
          name: `${formatOrgan(organ)} (state)`,
          status: "warn",
          message: "Organ not installed",
          fix: `eve install --components=${organ}`
        });
      }
    }
  } catch (error) {
    stateCheck.fail("Cannot read entity state");
    checks.push({ name: "Entity State", status: "fail", message: "Failed to read state" });
  }
  console.log();
  printHeader("Diagnostic Results", emojis.info);
  console.log();
  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  for (const check of checks) {
    const icon = check.status === "pass" ? emojis.check : check.status === "fail" ? emojis.cross : emojis.warning;
    const color = check.status === "pass" ? colors.success : check.status === "fail" ? colors.error : colors.warning;
    console.log(`${color(icon)} ${check.name}`);
    if (verbose || check.status !== "pass") {
      console.log(colors.muted(`  ${check.message}`));
      if (check.fix) {
        console.log(colors.info(`  Fix: ${check.fix}`));
      }
    }
  }
  console.log();
  console.log(colors.primary("\u2500".repeat(50)));
  console.log(`${colors.success(`${passed} passed`)}, ${colors.error(`${failed} failed`)}, ${colors.warning(`${warnings} warnings`)}`);
  if (failed === 0 && warnings === 0) {
    console.log();
    printSuccess("Entity is healthy! All checks passed.");
  } else if (failed === 0) {
    console.log();
    printWarning("Entity has warnings but is functional.");
  } else {
    console.log();
    printError(`Entity has ${failed} issue(s) that need attention.`);
    printInfo("  Follow the Fix hints above, or run: eve inspect");
  }
  console.log();
}

// src/commands/grow.ts
import { confirm, select, isCancel } from "@clack/prompts";
import { entityStateManager as entityStateManager4 } from "@eve/dna";

// src/commands/add.ts
import { execa as execa2 } from "execa";
import { existsSync } from "fs";
import {
  entityStateManager as entityStateManager3
} from "@eve/dna";
import { runBrainInit, runInferenceInit } from "@eve/brain";
import { runLegsProxySetup, refreshTraefikRoutes, verifyComponent as verifyComponent2 } from "@eve/legs";

// src/lib/components.ts
import {
  COMPONENTS as COMPONENTS3,
  resolveComponent,
  allComponentIds,
  addonComponentIds,
  selectedIds
} from "@eve/dna";

// src/commands/add.ts
async function addTraefik() {
  await runLegsProxySetup({ standalone: true });
}
async function addSynap() {
  const envRepo = process.env.SYNAP_REPO_ROOT;
  if (!envRepo || !existsSync(envRepo)) {
    printWarning(
      `Synap installation requires a synap-backend checkout.
  Pass --synap-repo <path> or set SYNAP_REPO_ROOT.
  See: https://github.com/synap/synap-backend`
    );
    process.exit(1);
  }
  const flags = process.argv.slice(2);
  const opts = {
    domain: (flags.includes("--domain") ? flags[flags.indexOf("--domain") + 1] : void 0) || "localhost",
    email: process.env.LETSENCRYPT_EMAIL
  };
  await runBrainInit({
    synapRepo: envRepo,
    domain: opts.domain,
    email: opts.email,
    adminBootstrapMode: "token",
    withAi: false,
    withOpenclaw: false,
    withRsshub: false
  });
}
async function addOllama(model) {
  await runInferenceInit({ model, withGateway: true, internalOllamaOnly: true });
}
async function addOpenclaw() {
  const state = await entityStateManager3.getState();
  const brainStatus = state.organs.brain;
  if (brainStatus.state !== "ready") {
    printError("Brain is not ready. Please install Synap first: `eve add synap`");
    process.exit(1);
  }
  const synapScript = process.env.SYNAP_SETUP_SCRIPT;
  if (synapScript && existsSync(synapScript)) {
    await execa2("bash", [synapScript, "profiles", "enable", "openclaw"], {
      env: { ...process.env, SYNAP_DEPLOY_DIR: process.env.SYNAP_DEPLOY_DIR || "", SYNAP_ASSUME_YES: "1" },
      stdio: "inherit"
    });
    await execa2("bash", [synapScript, "services", "add", "openclaw"], {
      env: { ...process.env, SYNAP_DEPLOY_DIR: process.env.SYNAP_DEPLOY_DIR || "", SYNAP_ASSUME_YES: "1" },
      stdio: "inherit"
    });
  } else {
    printWarning("OpenClaw add via Synap delegate not available.");
    printInfo("  Set SYNAP_SETUP_SCRIPT to point to synap-backend/setup.sh for auto-provisioning.");
    printInfo("  Otherwise install OpenClaw manually: https://github.com/danielmiessler/openclaw");
  }
}
async function addRsshub() {
  const state = await entityStateManager3.getState();
  const brainStatus = state.organs.brain;
  if (brainStatus.state !== "ready") {
    printError("Brain is not ready. Please install Synap first: `eve add synap`");
    process.exit(1);
  }
  const { RSSHubService: RSSHubService2 } = await import("@eve/eyes");
  const rsshub = new RSSHubService2();
  if (await rsshub.isInstalled()) {
    printInfo("RSSHub is already installed. Use `eve eyes:start` to start it.");
    return;
  }
  await rsshub.install({ port: 1200 });
  await entityStateManager3.updateOrgan("eyes", "ready");
  printSuccess("RSSHub installed successfully!");
  printInfo("  URL: http://localhost:1200");
}
async function runAdd(componentId, opts = {}) {
  const comp = resolveComponent(componentId);
  const existing = await entityStateManager3.isComponentInstalled(componentId);
  if (existing) {
    printWarning(`${comp.label} is already installed.`);
    printInfo(`  Run "eve ${comp.organ} status" to check its state.`);
    return;
  }
  const currentComponents = await entityStateManager3.getInstalledComponents();
  const missingDeps = (comp.requires ?? []).filter((dep) => !currentComponents.includes(dep));
  if (missingDeps.length > 0) {
    const depNames = missingDeps.map((dep) => {
      const info = COMPONENTS3.find((c) => c.id === dep);
      return info ? info.label : dep;
    });
    printError(`Missing prerequisites: ${depNames.join(", ")}`);
    printInfo(`  Install them first: ${missingDeps.map((d) => `eve add ${d}`).join(" / ")}`);
    process.exit(1);
  }
  if (opts.synapRepo) {
    process.env.SYNAP_REPO_ROOT = opts.synapRepo;
  }
  printHeader(`Adding ${comp.label}`, comp.emoji);
  console.log();
  printInfo(comp.description.split("\n")[0]);
  console.log();
  let step;
  try {
    step = buildAddStep(comp.id, opts);
  } catch (err) {
    printError(String(err));
    process.exit(1);
  }
  const spinner = createSpinner(step.label);
  spinner.start();
  try {
    await step.fn();
    spinner.succeed(step.label);
  } catch (err) {
    spinner.fail(step.label);
    printError(`Failed to add ${comp.label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const verifySpinner = createSpinner(`Verifying ${comp.label} is reachable...`);
  verifySpinner.start();
  const verification = await verifyComponent2(comp.id);
  if (verification.ok) {
    verifySpinner.succeed(verification.summary);
  } else {
    verifySpinner.warn(verification.summary);
    for (const c of verification.checks) {
      if (!c.ok && c.detail) {
        printWarning(`  \u2022 ${c.name}: ${c.detail}`);
      }
    }
    printInfo(`  Component installed but not yet responding. Check logs: docker logs ${comp.id}`);
  }
  await updateStateAfterAdd(comp.id, verification.ok ? "ready" : "error");
  const refresh = await refreshTraefikRoutes();
  if (refresh.refreshed) {
    printInfo(`Traefik routes refreshed for ${refresh.domain}`);
  } else if (refresh.domain) {
    printWarning(`Could not refresh Traefik routes: ${refresh.reason ?? "unknown"}`);
  }
  console.log();
  printSuccess(`${comp.label} added successfully!`);
  console.log();
  printInfo("Next steps:");
  printInfo(`  - Run "eve status" to check entity state`);
  if (comp.organ) printInfo(`  - Run "eve ${comp.organ} status" for ${comp.label} status`);
  if (refresh.refreshed) printInfo(`  - Run "eve domain check" to verify routing`);
  console.log();
}
function buildAddStep(componentId, opts) {
  const model = opts.model || "llama3.1:8b";
  switch (componentId) {
    case "traefik":
      return {
        label: "Setting up Traefik routing...",
        fn: addTraefik
      };
    case "synap":
      return {
        label: "Installing Synap Data Pod...",
        fn: addSynap
      };
    case "ollama":
      return {
        label: "Setting up Ollama + AI gateway...",
        fn: () => addOllama(model)
      };
    case "openclaw":
      return {
        label: "Installing OpenClaw...",
        fn: addOpenclaw
      };
    case "rsshub":
      return {
        label: "Installing RSSHub...",
        fn: addRsshub
      };
    case "openwebui": {
      return {
        label: "Installing Open WebUI...",
        async fn() {
          const { mkdirSync, writeFileSync: writeFileSync2, existsSync: existsSync8 } = await import("fs");
          const { join: pathJoin } = await import("path");
          const { readEveSecrets: readEveSecrets8 } = await import("@eve/dna");
          const { randomBytes: randomBytes2 } = await import("crypto");
          const { execa: execa12 } = await import("execa");
          const deployDir = "/opt/openwebui";
          mkdirSync(deployDir, { recursive: true });
          const secrets = await readEveSecrets8(process.cwd());
          const synapApiKey = secrets?.synap?.apiKey ?? process.env.SYNAP_API_KEY ?? "";
          const isUrl = process.env.SYNAP_IS_URL ?? "http://intelligence-hub:3001";
          const composeYaml = `# Open WebUI \u2014 generated by Eve CLI
# Self-contained compose. Joins eve-network so Traefik can route chat.<domain>
# to this container. Uses SQLite by default (no external DB).

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
      # Synap IS as the OpenAI-compat backend
      - ENABLE_OPENAI_API=true
      - OPENAI_API_BASE_URL=\${SYNAP_IS_URL:-http://intelligence-hub:3001}/v1
      - OPENAI_API_KEY=\${SYNAP_API_KEY:-}
      # Local Ollama as fallback
      - OLLAMA_BASE_URL=\${OLLAMA_BASE_URL:-http://eve-brain-ollama:11434}
      # Features
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
          writeFileSync2(pathJoin(deployDir, "docker-compose.yml"), composeYaml);
          const envPath = pathJoin(deployDir, ".env");
          if (!existsSync8(envPath)) {
            writeFileSync2(envPath, [
              "# Open WebUI \u2014 generated by Eve CLI",
              `SYNAP_API_KEY=${synapApiKey}`,
              `SYNAP_IS_URL=${isUrl}`,
              `WEBUI_SECRET_KEY=${randomBytes2(32).toString("hex")}`,
              `OLLAMA_BASE_URL=http://eve-brain-ollama:11434`,
              `ENABLE_SIGNUP=true`,
              `DEFAULT_USER_ROLE=user`
            ].join("\n"), { mode: 384 });
          }
          try {
            await execa12("docker", ["network", "inspect", "eve-network"], { stdio: "ignore" });
          } catch {
            await execa12("docker", ["network", "create", "eve-network"], { stdio: "inherit" });
          }
          console.log(`  Config: ${deployDir}/docker-compose.yml`);
          await execa12("docker", ["compose", "up", "-d"], {
            cwd: deployDir,
            stdio: "inherit"
          });
        }
      };
    }
    case "hermes":
    case "dokploy":
    case "opencode":
    case "openclaude": {
      const info = COMPONENTS3.find((c) => c.id === componentId);
      printError(`${info?.label ?? componentId} requires builder organ setup.`);
      printInfo('  Run "eve builder init" to configure the builder stack.');
      process.exit(1);
      return { label: "", fn: async () => {
      } };
    }
    default:
      throw new Error(`No add handler for component: ${componentId}`);
  }
}
async function updateStateAfterAdd(componentId, finalState = "ready") {
  const organMap = {
    synap: "brain",
    ollama: "brain",
    openclaw: "arms",
    hermes: "builder",
    rsshub: "eyes",
    traefik: "legs",
    openwebui: "eyes",
    dokploy: "builder",
    opencode: "builder",
    openclaude: "builder"
  };
  const organ = organMap[componentId];
  if (organ) {
    await entityStateManager3.updateOrgan(organ, finalState, { version: "0.1.0" });
  }
  await entityStateManager3.updateComponentEntry(componentId, {
    state: finalState,
    version: "0.1.0",
    managedBy: "eve"
  });
  const current = await entityStateManager3.getInstalledComponents();
  if (!current.includes(componentId)) {
    await entityStateManager3.updateSetupProfile({ components: [...current, componentId] });
  }
}
function addCommand(program2) {
  program2.command("add").description("Add a component to an existing entity").argument("[component]", "Component ID to add (traefik, synap, ollama, openclaw, rsshub, openwebui, hermes, dokploy, opencode, openclaude)").option("--synap-repo <path>", "Path to synap-backend checkout (for synap component)").option("--model <model>", "Ollama model (for ollama component)", "llama3.1:8b").action(async (component, opts) => {
    if (!component) {
      console.log();
      printHeader("Eve \u2014 Add Component", emojis.entity);
      console.log();
      printInfo("Usage: eve add <component>");
      console.log();
      printInfo("Available components:");
      for (const comp of COMPONENTS3) {
        const installed = await entityStateManager3.isComponentInstalled(comp.id);
        const tag = installed ? colors.success(" [installed]") : colors.muted(`[requires: ${(comp.requires ?? []).join(", ") || "none"}]`);
        console.log(`  ${comp.emoji} ${colors.primary.bold(comp.label)}${tag}`);
        console.log(`    ${comp.description.split("\n")[0]}`);
      }
      console.log();
      printInfo("Examples:");
      printInfo("  eve add ollama              # Add local AI inference");
      printInfo("  eve add openclaw            # Add AI agent layer");
      printInfo("  eve add rsshub              # Add data perception");
      console.log();
      return;
    }
    await runAdd(component, opts);
  });
}

// src/commands/grow.ts
function growCommand(program2) {
  const grow = program2.command("grow").description("Grow the entity by developing new capabilities").action(async () => {
    await interactiveGrow();
  });
  grow.command("organ").description("Add a new organ to the entity").argument("[organ]", "Organ: brain | arms | builder | eyes | legs").option("--dry-run", "Print planned steps only (no install)").option("--with-ai", "When growing brain, include Ollama").action(async (organ, options) => {
    if (organ) {
      await growOrgan(organ, options);
    } else {
      await interactiveGrow();
    }
  });
  grow.command("capability").description("Add a new capability to an existing organ").action(async () => {
    await growCapability();
  });
}
async function interactiveGrow() {
  console.log();
  console.log(colors.primary.bold(`${emojis.sparkles} Eve Entity Growth`));
  console.log();
  const state = await entityStateManager4.getState();
  printHeader("Current Entity State", emojis.entity);
  console.log();
  const organs = ["brain", "arms", "builder", "eyes", "legs"];
  for (const organ of organs) {
    const status = state.organs[organ].state;
    const icon = status === "ready" ? emojis.check : status === "missing" ? "\u25CB" : "\u25D0";
    const color = status === "ready" ? colors.success : status === "missing" ? colors.muted : colors.warning;
    console.log(`  ${color(icon)} ${organ.charAt(0).toUpperCase() + organ.slice(1)}: ${color(status)}`);
  }
  console.log();
  const action = await select({
    message: "What would you like to grow?",
    options: [
      { value: "brain", label: "\u{1F9E0}  Brain - Intelligence & Memory", hint: "Core AI and data services" },
      { value: "arms", label: "\u{1F9BE}  Arms - Action & Tools", hint: "AI assistant and MCP servers" },
      { value: "eyes", label: "\u{1F441}\uFE0F  Eyes - Perception", hint: "RSS feeds and monitoring" },
      { value: "legs", label: "\u{1F9BF}  Legs - Exposure", hint: "Traefik and domain routing" },
      { value: "builder", label: "\u{1F3D7}\uFE0F  Builder - Creation", hint: "Development and deployment tools" }
    ]
  });
  if (isCancel(action)) {
    console.log(colors.muted("Cancelled."));
    return;
  }
  if (typeof action === "string") {
    let withAi = false;
    if (action === "brain") {
      const ai = await confirm({
        message: "Include local AI (Ollama)?",
        initialValue: false
      });
      if (isCancel(ai)) {
        console.log(colors.muted("Cancelled."));
        return;
      }
      withAi = Boolean(ai);
    }
    await growOrgan(action, {
      dryRun: false,
      withAi
    });
  }
}
var ORGAN_TO_COMPONENT = {
  brain: "synap",
  arms: "openclaw",
  eyes: "rsshub",
  legs: "traefik",
  builder: "hermes"
};
async function growOrgan(organ, options) {
  const valid = ["brain", "arms", "builder", "eyes", "legs"];
  if (!valid.includes(organ)) {
    printError(`Unknown organ: ${organ}. Use: ${valid.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const componentId = ORGAN_TO_COMPONENT[organ];
  console.log();
  printHeader(`Growing ${organ.charAt(0).toUpperCase() + organ.slice(1)}`, emojis.sparkles);
  console.log();
  if (options.dryRun) {
    printInfo(`Would run: eve add ${componentId}`);
    return;
  }
  const shouldProceed = await confirm({
    message: `Install the ${organ} organ (eve add ${componentId})?`,
    initialValue: true
  });
  if (isCancel(shouldProceed) || !shouldProceed) {
    console.log(colors.muted("Cancelled."));
    return;
  }
  await runAdd(componentId, {});
}
async function growCapability() {
  const state = await entityStateManager4.getState();
  const organ = await select({
    message: "Which organ would you like to enhance?",
    options: [
      { value: "brain", label: "\u{1F9E0} Brain", hint: state.organs.brain.state === "ready" ? "Installed" : "Not installed" },
      { value: "arms", label: "\u{1F9BE} Arms", hint: state.organs.arms.state === "ready" ? "Installed" : "Not installed" }
    ]
  });
  if (isCancel(organ)) {
    console.log(colors.muted("Cancelled."));
    return;
  }
  if (typeof organ === "string") {
    if (state.organs[organ].state !== "ready") {
      printError(`${organ} organ is not installed. Run: eve grow organ ${organ}`);
      return;
    }
    printInfo(`Enhancing ${organ} capabilities... (coming soon)`);
  }
}

// src/commands/lifecycle/birth.ts
function birthCommand(program2) {
  const birth = program2.command("birth").description("Bare-metal provisioning (USB) and host install scripts");
  birth.command("usb").description("Create a bootable USB with Ventoy + autoinstall (coming soon)").action(async () => {
    printInfo("USB creation script not yet implemented. This will use a Ventoy-based autoinstall profile.");
  });
  birth.command("install").description("Run server install script (coming soon)").option("--phase <n>", "Run only phase1 | phase2 | phase3 | all", "all").action(async (_opts) => {
    printInfo("Install script not yet implemented. Use `eve setup` for the current install flow.");
  });
}

// src/commands/lifecycle/install.ts
import { confirm as confirm2, select as select2, multiselect, isCancel as isCancel2, intro, note } from "@clack/prompts";
import { existsSync as existsSync2 } from "fs";
import { join } from "path";
import {
  entityStateManager as entityStateManager5,
  writeSetupProfile,
  readEveSecrets as readEveSecrets3,
  writeEveSecrets as writeEveSecrets2,
  ensureEveSkillsLayout as ensureEveSkillsLayout2,
  defaultSkillsDir as defaultSkillsDir2,
  ensureSecretValue,
  getServerIp as getServerIp2,
  hasAnyProvider as hasAnyProvider2,
  wireAllInstalledComponents
} from "@eve/dna";
import { getGlobalCliFlags as getGlobalCliFlags2, outputJson } from "@eve/cli-kit";
import { runBrainInit as runBrainInit2, runInferenceInit as runInferenceInit2, resolveSynapDelegate } from "@eve/brain";
import { runLegsProxySetup as runLegsProxySetup2, TraefikService } from "@eve/legs";
import { text } from "@clack/prompts";
import { RSSHubService } from "@eve/eyes";
async function runInstall(opts) {
  const flags = getGlobalCliFlags2();
  const jsonMode = Boolean(flags.json);
  const nonInteractive = Boolean(flags.nonInteractive) || Boolean(opts.skipInteractive);
  let componentSet;
  if (opts.components && opts.components.length > 0) {
    componentSet = {};
    for (const id of opts.components) {
      const comp = COMPONENTS3.find((c) => c.id === id);
      if (!comp) {
        throw new Error(`Unknown component: ${id}. Available: ${COMPONENTS3.map((c) => c.id).join(", ")}`);
      }
      componentSet[id] = true;
    }
  } else if (nonInteractive) {
    componentSet = { traefik: true, synap: true };
  } else {
    componentSet = await interactiveComponentSelect();
    if (isCancel2(componentSet)) {
      console.log(colors.muted("Installation cancelled."));
      return;
    }
  }
  for (const comp of COMPONENTS3) {
    if (comp.alwaysInstall) {
      componentSet[comp.id] = true;
    }
  }
  const installList = selectedIds(componentSet);
  const domain = opts.domain || "localhost";
  const email = opts.email || process.env.LETSENCRYPT_EMAIL;
  const withOpenclaw = opts.withOpenclaw || componentSet["openclaw"];
  const withRsshub = opts.withRsshub || componentSet["rsshub"] || componentSet["rsshub"];
  const legacyProfile = inferLegacyProfile(installList);
  if (!opts.dryRun) {
    const spinner = createSpinner("Checking prerequisites...");
    spinner.start();
    let dockerPath = "docker";
    try {
      const { stdout } = await execa3("which", ["docker"]);
      if (stdout) dockerPath = stdout;
    } catch {
      const candidates = [
        "/usr/local/bin/docker",
        "/usr/bin/docker",
        "/usr/bin/containerd"
      ];
      for (const c of candidates) {
        if (existsSync2(c)) {
          dockerPath = c;
          break;
        }
      }
    }
    let dockerOk = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await execa3(dockerPath, ["version"]);
        dockerOk = true;
        break;
      } catch {
        if (attempt < 7) {
          await new Promise((resolve2) => setTimeout(resolve2, 3e3));
        }
      }
    }
    if (dockerOk) {
      spinner.succeed("Docker is running");
    }
    if (!dockerOk) {
      spinner.fail("Docker is not running");
      console.log();
      printError("Eve requires Docker to manage containers.");
      console.log();
      if (process.platform === "darwin") {
        printInfo("macOS: Install Docker Desktop and start it, then run:");
        printInfo("  open -a Docker");
      } else if (process.platform === "win32") {
        printInfo("Windows: Install Docker Desktop and start the app.");
      } else {
        printInfo("Docker is installed but the daemon is not responding.");
        printInfo("Make sure it is running:");
        printInfo("  sudo systemctl status docker");
        console.log();
        printInfo("If not running, start it:");
        printInfo("  sudo systemctl start docker");
        printInfo("  # wait ~5 seconds for it to initialize");
        console.log();
        printInfo("If Docker is not installed, run:");
        printInfo("  curl -fsSL https://get.docker.com | sudo bash");
      }
      console.log();
      process.exit(1);
    }
  }
  if (!opts.dryRun) {
    const cwd = process.cwd();
    const skillsDir = defaultSkillsDir2();
    const setupProfile = {
      profile: legacyProfile,
      source: nonInteractive ? "cli" : "wizard",
      domainHint: domain
    };
    if (opts.tunnel) {
      setupProfile.tunnelProvider = opts.tunnel;
    }
    if (opts.tunnelDomain) {
      setupProfile.tunnelDomain = opts.tunnelDomain;
    }
    await writeSetupProfile(setupProfile, cwd);
    const prevSecrets = await readEveSecrets3(cwd);
    const merge = {
      version: "1",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      ai: {
        mode: opts.aiMode || "hybrid",
        defaultProvider: opts.aiProvider,
        fallbackProvider: opts.fallbackProvider,
        syncToSynap: true,
        providers: []
      }
    };
    if (componentSet["synap"]) {
      merge.synap = {
        apiUrl: prevSecrets?.synap?.apiUrl || "http://127.0.0.1:4000",
        apiKey: ensureSecretValue(prevSecrets?.synap?.apiKey || process.env.SYNAP_API_KEY || process.env.OPENCLAW_SYNAP_API_KEY || ""),
        hubBaseUrl: prevSecrets?.synap?.hubBaseUrl
      };
    }
    if (componentSet["ollama"] || componentSet["synap"]) {
      merge.inference = {
        ollamaUrl: componentSet["ollama"] ? "http://127.0.0.1:11434" : "http://127.0.0.1:11434",
        gatewayUrl: "http://127.0.0.1:11435"
      };
    }
    await writeEveSecrets2(merge, cwd);
    ensureEveSkillsLayout2(skillsDir);
  }
  if (!jsonMode) {
    console.log();
    printHeader("Eve Install Plan", emojis.entity);
    console.log();
    for (const comp of COMPONENTS3) {
      if (!componentSet[comp.id]) continue;
      const tag = comp.alwaysInstall ? colors.muted(" [infrastructure]") : "";
      console.log(`  ${colors.success(emojis.check)} ${colors.primary.bold(comp.label)} ${colors.muted(comp.description.split("\n")[0])}${tag}`);
    }
    console.log();
    printInfo(`Domain: ${colors.info(domain)}${email ? `  TLS: ${colors.info(email)}` : ""}`);
    console.log();
  }
  if (opts.dryRun) {
    if (jsonMode) {
      outputJson({ ok: true, components: installList });
    }
    return;
  }
  const steps = buildInstallSteps(installList, opts);
  const skippedComponents = /* @__PURE__ */ new Set();
  for (const step of steps) {
    if (jsonMode) {
      console.error(`[install] ${step.label}`);
    }
    const spinner = createSpinner(step.label);
    spinner.start();
    try {
      await step.fn();
      if (step.skips?.length) {
        spinner.warn(`${step.label} \u2014 skipped (no repo found)`);
        step.skips.forEach((c) => skippedComponents.add(c));
      } else {
        spinner.succeed(step.label);
      }
    } catch (err) {
      spinner.fail(step.label);
      printError(`Failed to install ${step.label}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }
  const installedComponents = installList.filter((c) => !skippedComponents.has(c));
  await updateEntityStateFromComponents(installedComponents, opts);
  if (!jsonMode && !opts.skipInteractive) {
    await maybeOfferDomainSetup(installedComponents);
  }
  if (!jsonMode && !opts.skipInteractive) {
    await maybeOfferAiProviderSetup(installedComponents);
  }
  if (!jsonMode && !opts.skipInteractive && process.platform === "linux") {
    await maybeOfferDashboardService();
  }
  if (!jsonMode) {
    console.log();
    printSuccess("Entity installation complete.");
    console.log();
    printInfo(`  Components installed: ${installList.join(", ")}`);
    console.log();
    printInfo("Next steps:");
    printInfo(`  - Run "eve status"               to check entity state`);
    printInfo(`  - Run "eve ui"                   to open the web dashboard`);
    printInfo(`  - Run "eve domain show"          to see all access URLs`);
    printInfo(`  - Run "eve domain set <domain>"  to configure remote domain access`);
    printInfo(`  - Run "eve grow organ"           to add more capabilities later`);
    printInfo(`  - Run "eve add <component>"      to add add-ons (dokploy, opencode, openclaude)`);
    const serverIp = getServerIp2();
    if (serverIp) {
      console.log();
      console.log(colors.muted(`  Your server IP: ${serverIp}`));
      console.log(colors.muted(`  Dashboard: http://${serverIp}:7979  (open port 7979 in your firewall)`));
    }
    console.log();
  } else {
    outputJson({ ok: true, components: installList });
  }
}
async function maybeOfferDomainSetup(installedComponents) {
  const existing = await readEveSecrets3(process.cwd());
  if (existing?.domain?.primary) return;
  console.log();
  const wantDomain = await confirm2({
    message: "Want to expose this Eve installation on a public domain?",
    initialValue: false
  });
  if (isCancel2(wantDomain) || !wantDomain) return;
  const domainName = await text({
    message: "Domain (e.g. mydomain.com):",
    placeholder: "mydomain.com",
    validate: (value) => {
      if (!value) return "Domain is required";
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return "Invalid domain format";
      return void 0;
    }
  });
  if (isCancel2(domainName)) return;
  const wantSsl = await confirm2({
    message: "Enable SSL via Let's Encrypt? (recommended for public domains)",
    initialValue: true
  });
  if (isCancel2(wantSsl)) return;
  let email;
  if (wantSsl) {
    const emailResult = await text({
      message: "Email for Let's Encrypt notifications:",
      placeholder: "you@example.com",
      validate: (value) => value && /^[^@]+@[^@]+\.[^@]+$/.test(value) ? void 0 : "Invalid email"
    });
    if (isCancel2(emailResult)) return;
    email = emailResult;
  }
  console.log();
  const spinner = createSpinner(`Configuring Traefik routes for ${domainName}...`);
  spinner.start();
  try {
    await writeEveSecrets2({ domain: { primary: domainName, ssl: !!wantSsl, email } });
    const traefik = new TraefikService();
    await traefik.configureSubdomains(domainName, !!wantSsl, email, installedComponents);
    spinner.succeed(`Domain ${domainName} configured`);
  } catch (err) {
    spinner.fail(`Failed to configure domain: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const serverIp = getServerIp2();
  console.log();
  printInfo("Now create these DNS A records at your registrar:");
  console.log();
  for (const comp of [{ subdomain: "eve" }, ...installedComponents.flatMap((id) => {
    const c = COMPONENTS3.find((c2) => c2.id === id);
    return c?.service?.subdomain ? [{ subdomain: c.service.subdomain }] : [];
  })]) {
    const value = serverIp ?? "<your-server-ip>";
    console.log(`  ${colors.muted("A")}    ${`${comp.subdomain}.${domainName}`.padEnd(32)}  ${value}`);
  }
  console.log();
  printInfo("Once DNS propagates, verify with: eve domain check");
  if (wantSsl) printInfo("SSL certificates provision automatically (1\u20135 min after DNS works)");
}
async function maybeOfferAiProviderSetup(installedComponents) {
  const existing = await readEveSecrets3(process.cwd());
  if (hasAnyProvider2(existing)) return;
  const aiConsumers = ["synap", "openclaw", "openwebui", "hermes", "opencode", "openclaude"];
  const willUseAi = installedComponents.some((c) => aiConsumers.includes(c));
  if (!willUseAi) return;
  console.log();
  console.log(colors.muted("Eve uses Synap IS as the central AI hub. Other components (OpenClaw,"));
  console.log(colors.muted("Open WebUI, agents) route through it \u2014 so you only set this once."));
  console.log();
  const providerChoice = await select2({
    message: "Which AI provider do you want to use?",
    options: [
      { value: "anthropic", label: "Anthropic (Claude) \u2014 recommended", hint: "best quality" },
      { value: "openai", label: "OpenAI (GPT-5/4)" },
      { value: "openrouter", label: "OpenRouter (multi-provider)" },
      { value: "ollama", label: "Ollama only (local, free)", hint: "requires ollama component" },
      { value: "skip", label: "Skip \u2014 configure later with `eve ai providers add`" }
    ],
    initialValue: "anthropic"
  });
  if (isCancel2(providerChoice) || providerChoice === "skip") {
    printInfo("You can configure your AI provider later with: eve ai providers add <id> --api-key <key>");
    return;
  }
  if (providerChoice === "ollama") {
    await writeEveSecrets2({
      ai: {
        defaultProvider: "ollama",
        providers: [{ id: "ollama", enabled: true }]
      }
    });
    printSuccess("Ollama set as default provider (no API key needed).");
    return;
  }
  const apiKey = await text({
    message: `Paste your ${providerChoice} API key:`,
    placeholder: providerChoice === "anthropic" ? "sk-ant-..." : providerChoice === "openai" ? "sk-..." : "sk-or-...",
    validate: (v) => v && v.trim().length > 8 ? void 0 : "API key is required"
  });
  if (isCancel2(apiKey)) {
    printInfo("Skipped. Configure later with: eve ai providers add " + providerChoice + " --api-key <key>");
    return;
  }
  const DEFAULT_MODELS = {
    anthropic: "claude-sonnet-4-7",
    openai: "gpt-5",
    openrouter: "anthropic/claude-sonnet-4-7"
  };
  let defaultModel = DEFAULT_MODELS[providerChoice];
  if (providerChoice === "openrouter") {
    const modelInput = await text({
      message: "Default model on OpenRouter:",
      placeholder: "anthropic/claude-sonnet-4-7",
      initialValue: "anthropic/claude-sonnet-4-7",
      validate: (v) => v && v.includes("/") ? void 0 : "Use the form provider/model (e.g. anthropic/claude-sonnet-4-7)"
    });
    if (isCancel2(modelInput)) {
      printInfo("Skipped \u2014 no default model set. Configure in the dashboard later.");
      return;
    }
    defaultModel = modelInput.trim();
  } else {
    const modelInput = await text({
      message: `Default model (press enter to use "${defaultModel}"):`,
      placeholder: defaultModel,
      initialValue: defaultModel
    });
    if (!isCancel2(modelInput) && modelInput.trim()) {
      defaultModel = modelInput.trim();
    }
  }
  await writeEveSecrets2({
    ai: {
      defaultProvider: providerChoice,
      providers: [{
        id: providerChoice,
        enabled: true,
        apiKey: apiKey.trim(),
        defaultModel
      }]
    }
  });
  printSuccess(`${providerChoice} (${defaultModel}) saved.`);
  console.log();
  const spinner = createSpinner("Wiring AI provider into installed components...");
  spinner.start();
  const updated = await readEveSecrets3(process.cwd());
  const results = wireAllInstalledComponents(updated, installedComponents);
  const ok = results.filter((r) => r.outcome === "ok").length;
  const failed = results.filter((r) => r.outcome === "failed");
  if (failed.length === 0) {
    spinner.succeed(`AI wiring applied to ${ok} component(s)`);
  } else {
    spinner.warn(`AI wiring partially applied (${ok} ok, ${failed.length} failed)`);
    for (const r of failed) {
      printWarning(`  \u2022 ${r.id}: ${r.summary}${r.detail ? " \u2014 " + r.detail : ""}`);
    }
  }
  console.log();
  printInfo("Configure model, fallback provider, and multiple providers in the dashboard:");
  printInfo('  eve ui   \u2192   open the dashboard, navigate to "AI Providers"');
}
async function maybeOfferDashboardService() {
  if (process.getuid && process.getuid() !== 0) return;
  const SERVICE_PATH2 = "/etc/systemd/system/eve-dashboard.service";
  if (existsSync2(SERVICE_PATH2)) return;
  console.log();
  const wantService = await confirm2({
    message: "Install the Eve Dashboard as a systemd service so it auto-starts on boot?",
    initialValue: true
  });
  if (isCancel2(wantService) || !wantService) {
    printInfo("You can run the dashboard manually anytime with: eve ui");
    return;
  }
  printInfo("Run: sudo eve ui --install-service");
  printInfo("  (We don't do it inline because it requires building the dashboard first.)");
}
function buildInstallSteps(components, opts) {
  const steps = [];
  const hasSynap = components.includes("synap");
  const hasOllama = components.includes("ollama");
  const hasTraefik = components.includes("traefik");
  const hasOpenclaw = components.includes("openclaw");
  const hasRsshub = components.includes("rsshub");
  const hasHermes = components.includes("hermes");
  const hasDokploy = components.includes("dokploy");
  const hasOpenCode = components.includes("opencode");
  const hasOpenClaude = components.includes("openclaude");
  const hasBuilder = hasHermes || hasDokploy || hasOpenCode || hasOpenClaude;
  const hasTunnel = opts.tunnel;
  if (hasTraefik) {
    steps.push({
      label: "Setting up Traefik routing...",
      async fn() {
        const domain = opts.domain || "localhost";
        await runLegsProxySetup2({
          domain: hasSynap ? domain : void 0,
          tunnel: opts.tunnel,
          tunnelDomain: opts.tunnelDomain,
          ssl: hasSynap && domain !== "localhost",
          standalone: true
        });
      }
    });
  }
  if (hasSynap) {
    const synapRepo = opts.synapRepo || process.env.SYNAP_REPO_ROOT;
    const delegate = resolveSynapDelegate();
    const resolvedRepo = synapRepo || delegate?.repoRoot;
    if (resolvedRepo) {
      steps.push({
        label: "Installing Synap Data Pod...",
        async fn() {
          await runBrainInit2({
            synapRepo: resolvedRepo,
            domain: opts.domain,
            email: opts.email,
            adminBootstrapMode: opts.adminBootstrapMode || "token",
            adminEmail: opts.adminEmail,
            adminPassword: opts.adminPassword,
            fromImage: opts.fromImage,
            fromSource: opts.fromSource,
            withOpenclaw: false,
            withRsshub: opts.withRsshub || hasRsshub,
            withAi: false
          });
        }
      });
    } else {
      steps.push({
        label: "Installing Synap Data Pod (from Docker image)...",
        async fn() {
          await runBrainInit2({
            domain: opts.domain,
            email: opts.email,
            adminBootstrapMode: opts.adminBootstrapMode || "token",
            adminEmail: opts.adminEmail,
            adminPassword: opts.adminPassword
          });
        }
      });
    }
  }
  if (hasOllama) {
    steps.push({
      label: "Setting up Ollama + AI gateway...",
      async fn() {
        await runInferenceInit2({
          model: opts.model || "llama3.1:8b",
          withGateway: true,
          internalOllamaOnly: hasSynap
        });
      }
    });
  }
  if (hasOpenclaw) {
    steps.push({
      label: "Setting up OpenClaw...",
      async fn() {
        const { OpenClawService } = await import("@eve/arms");
        const ollamaUrl = "http://127.0.0.1:11434";
        const openclaw = new OpenClawService();
        await openclaw.install();
        await openclaw.configure(ollamaUrl);
        await openclaw.start();
        const synapPod = resolveSynapDelegate();
        if (synapPod && hasSynap) {
          console.log("  Delegating Synap\u2194OpenClaw wiring to synap-cli...");
          try {
            const { homedir: homedir3 } = await import("os");
            const { existsSync: existsSync8 } = await import("fs");
            const podConfigPath = join(homedir3(), ".synap", "pod-config.json");
            if (existsSync8(podConfigPath)) {
              await spawnAsync("npx", ["-p", "@synap-core/cli", "synap", "finish", "--skip-ai-key", "--skip-domain"], {
                env: { ...process.env, SYNAP_DEPLOY_DIR: synapPod.deployDir },
                cwd: synapPod.repoRoot
              });
            } else {
              console.log("  No pod-config found \u2014 skipping synap-cli finish.");
              console.log('  Run "synap connect --target=openclaw" then "synap finish" manually for full wiring.');
            }
          } catch (err) {
            console.log(`  synap-cli finish warning: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    });
  }
  if (hasRsshub) {
    steps.push({
      label: "Setting up RSSHub...",
      async fn() {
        const rsshub = new RSSHubService();
        await rsshub.install();
        await rsshub.start();
      }
    });
  }
  if (hasHermes) {
    steps.push({
      label: "Setting up Hermes daemon...",
      async fn() {
        const { writeHermesEnvFile } = await import("@eve/dna");
        await writeHermesEnvFile(process.cwd());
        console.log("  Hermes env file written to .eve/hermes.env");
        console.log("  Start with: docker compose up -d hermes");
      }
    });
  }
  const hasOpenWebUI = components.includes("openwebui");
  if (hasOpenWebUI) {
    steps.push({
      label: "Setting up Open WebUI...",
      async fn() {
        const { mkdirSync, writeFileSync: writeFileSync2, existsSync: existsSync8 } = await import("fs");
        const { join: pathJoin } = await import("path");
        const { readEveSecrets: readEveSecrets8 } = await import("@eve/dna");
        const { randomBytes: randomBytes2 } = await import("crypto");
        const deployDir = "/opt/openwebui";
        mkdirSync(deployDir, { recursive: true });
        const secrets = await readEveSecrets8(process.cwd());
        const synapApiKey = secrets?.synap?.apiKey ?? process.env.SYNAP_API_KEY ?? "";
        const isUrl = process.env.SYNAP_IS_URL ?? "http://intelligence-hub:3001";
        const envPath = pathJoin(deployDir, ".env");
        if (!existsSync8(envPath)) {
          writeFileSync2(envPath, [
            "# Open WebUI \u2014 generated by Eve CLI",
            `SYNAP_API_KEY=${synapApiKey}`,
            `SYNAP_IS_URL=${isUrl}`,
            `WEBUI_SECRET_KEY=${randomBytes2(32).toString("hex")}`,
            `ENABLE_SIGNUP=true`,
            `DEFAULT_USER_ROLE=user`
          ].join("\n"), { mode: 384 });
        }
        console.log(`  Open WebUI config written to ${deployDir}`);
        console.log("  Start with: docker compose --profile openwebui up -d");
      }
    });
  }
  return steps;
}
async function updateEntityStateFromComponents(components, opts) {
  const organMap = {
    synap: "brain",
    ollama: "brain",
    openclaw: "arms",
    hermes: "builder",
    rsshub: "eyes",
    traefik: "legs",
    dokploy: "builder",
    opencode: "builder",
    openclaude: "builder"
  };
  for (const compId of components) {
    const organ = organMap[compId];
    if (organ) {
      await entityStateManager5.updateOrgan(organ, "ready", { version: "0.1.0" });
    }
    await entityStateManager5.updateComponentEntry(compId, {
      state: "ready",
      version: "0.1.0",
      managedBy: "eve"
    });
  }
  await entityStateManager5.updateSetupProfile({ components });
}
var PRESETS = [
  {
    value: "personal",
    label: "\u{1F9E0}  Personal AI pod",
    hint: "Synap + Traefik",
    ids: ["traefik", "synap"]
  },
  {
    value: "full",
    label: "\u{1F680}  Full stack",
    hint: "Synap + Ollama + OpenClaw + Traefik",
    ids: ["traefik", "synap", "ollama", "openclaw"]
  },
  {
    value: "chat",
    label: "\u{1F4AC}  AI chat server",
    hint: "Synap + Open WebUI + Traefik",
    ids: ["traefik", "synap", "openwebui"]
  },
  {
    value: "builder",
    label: "\u{1F3D7}\uFE0F  Builder server",
    hint: "Synap + Hermes + OpenClaw + Traefik",
    ids: ["traefik", "synap", "openclaw", "hermes"]
  },
  {
    value: "minimal",
    label: "\u26A1  Minimal",
    hint: "Traefik only \u2014 add components later",
    ids: ["traefik"]
  },
  {
    value: "custom",
    label: "\u{1F527}  Custom",
    hint: "Pick each component individually",
    ids: []
  }
];
async function interactiveComponentSelect() {
  intro(colors.primary.bold("Eve \u2014 Composable Installer"));
  const preset = await select2({
    message: "What do you want to set up?",
    options: PRESETS,
    initialValue: "full"
  });
  if (isCancel2(preset)) return {};
  const selectableComponents = COMPONENTS3.filter((c) => !c.alwaysInstall);
  let presetIds = preset === "custom" ? selectableComponents.filter((c) => c.category !== "add-on").map((c) => c.id) : PRESETS.find((p) => p.value === preset)?.ids.filter((id) => id !== "traefik") ?? [];
  let finalIds = [];
  if (preset !== "minimal") {
    finalIds = await multiselect({
      message: preset === "custom" ? "Select components:" : "Adjust selection (space to toggle):",
      options: selectableComponents.map((c) => ({
        value: c.id,
        label: `${c.emoji}  ${c.label}`,
        hint: c.description.split(".")[0]
      })),
      initialValues: presetIds,
      required: false
    });
  }
  if (isCancel2(finalIds)) return {};
  const result = { traefik: true };
  for (const id of finalIds) {
    result[id] = true;
  }
  const missing = [];
  for (const id of Object.keys(result)) {
    const comp = COMPONENTS3.find((c) => c.id === id);
    for (const req of comp?.requires ?? []) {
      if (!result[req]) missing.push(`${comp.label} requires ${req}`);
    }
  }
  if (missing.length) {
    note(missing.join("\n"), "Dependency note \u2014 adding missing requirements");
    for (const id of Object.keys(result)) {
      const comp = COMPONENTS3.find((c) => c.id === id);
      for (const req of comp?.requires ?? []) result[req] = true;
    }
  }
  return result;
}
function inferLegacyProfile(components) {
  const set = new Set(components);
  const hasSynap = set.has("synap");
  const hasOllama = set.has("ollama");
  const hasBuilder = ["hermes", "openclaw"].some((c) => set.has(c));
  if (!hasSynap && hasOllama) return "inference_only";
  if (hasSynap && hasOllama && hasBuilder) return "full";
  if (hasSynap) return "data_pod";
  return "data_pod";
}
function installCommand(program2) {
  program2.command("install").alias("i").description("Composable component installer \u2014 pick what you need").option(
    "--components <list>",
    "Comma-separated component IDs (traefik,synap,ollama,openclaw,hermes,rsshub,openwebui,dokploy,opencode,openclaude)"
  ).option("--domain <host>", "Public hostname (default: localhost)", "localhost").option("--email <email>", "Let's Encrypt email for TLS").option("--model <model>", "Ollama model", "llama3.1:8b").option("--admin-email <email>", "Admin bootstrap email for Synap").option("--admin-password <secret>", "Admin password for preseed bootstrap").option("--admin-bootstrap-mode <mode>", "Token | preseed (default: token)").option("--tunnel <provider>", "Tunnel provider: pangolin | cloudflare").option("--tunnel-domain <host>", "Tunnel hostname").option("--ai-mode <m>", "AI inference mode: local | provider | hybrid").option("--ai-provider <p>", "Default AI provider: openrouter | anthropic | openai | ollama").option("--fallback-provider <p>", "Fallback AI provider").option("--synap-repo <path>", "Path to synap-backend checkout").option("--with-openclaw", "Enable OpenClaw (legacy flag)").option("--with-rsshub", "Enable RSSHub (legacy flag)").option("--from-image", "Install Synap from prebuilt image").option("--from-source", "Install Synap from source").option("--dry-run", "Print planned steps without executing").option("--skip-hardware", "Skip hardware summary").addHelpText(
    "after",
    `
Components
  ${colors.muted("Infrastructure")}  traefik (always)
  ${colors.muted("Data")}          synap, ollama
  ${colors.muted("Agent")}         openclaw
  ${colors.muted("Builder")}       hermes, dokploy, opencode, openclaude
  ${colors.muted("Perception")}    rsshub

Run "eve add <component>" to add components later.
Run "eve status" to see current state.
`
  ).action(async (rawOpts) => {
    if (rawOpts.synapRepo) {
      process.env.SYNAP_REPO_ROOT = rawOpts.synapRepo;
    }
    let tunnelProvider;
    if (rawOpts.tunnel) {
      const t = rawOpts.tunnel.toLowerCase();
      if (t === "pangolin") tunnelProvider = "pangolin";
      else if (t === "cloudflare" || t === "cf") tunnelProvider = "cloudflare";
      else {
        printError(`Unknown tunnel provider: ${rawOpts.tunnel} (use pangolin or cloudflare)`);
        process.exit(1);
      }
    }
    let aiMode;
    if (rawOpts.aiMode) {
      const m = rawOpts.aiMode.toLowerCase();
      if (["local", "provider", "hybrid"].includes(m)) aiMode = m;
    }
    let aiProvider;
    if (rawOpts.aiProvider) {
      const p = rawOpts.aiProvider.toLowerCase();
      if (["ollama", "openrouter", "anthropic", "openai"].includes(p)) aiProvider = p;
    }
    let fallbackProvider;
    if (rawOpts.fallbackProvider) {
      const p = rawOpts.fallbackProvider.toLowerCase();
      if (["ollama", "openrouter", "anthropic", "openai"].includes(p)) fallbackProvider = p;
    }
    let components;
    if (rawOpts.components) {
      components = rawOpts.components.split(",").map((s) => s.trim()).filter(Boolean);
    }
    await runInstall({
      components,
      domain: rawOpts.domain,
      email: rawOpts.email,
      model: rawOpts.model,
      adminEmail: rawOpts.adminEmail,
      adminPassword: rawOpts.adminPassword,
      adminBootstrapMode: rawOpts.adminBootstrapMode,
      tunnel: tunnelProvider,
      tunnelDomain: rawOpts.tunnelDomain,
      aiMode,
      aiProvider,
      fallbackProvider,
      withOpenclaw: rawOpts.withOpenclaw,
      withRsshub: rawOpts.withRsshub,
      fromImage: rawOpts.fromImage,
      fromSource: rawOpts.fromSource,
      dryRun: rawOpts.dryRun
    });
  });
}
function execa3(cmd, args, opts) {
  return import("execa").then((mod) => mod.execa(cmd, args, { ...opts || {}, shell: true }));
}
function spawnAsync(cmd, args, opts) {
  return import("execa").then(
    ({ execa: execaFn }) => execaFn(cmd, args, {
      env: { ...process.env, ...opts?.env || {} },
      cwd: opts?.cwd,
      stdio: "inherit"
    }).then(() => void 0)
  );
}

// src/commands/setup.ts
import { select as select3, confirm as confirm3, isCancel as isCancel3, text as text2 } from "@clack/prompts";
import { homedir, tmpdir } from "os";
import { existsSync as existsSync3 } from "fs";
import { mkdir, readdir, rm } from "fs/promises";
import { dirname, join as join2, resolve } from "path";
import { execa as execa4 } from "execa";
import {
  readSetupProfile,
  writeSetupProfile as writeSetupProfile2,
  getSetupProfilePath,
  readUsbSetupManifest,
  probeHardware,
  formatHardwareReport,
  readEveSecrets as readEveSecrets4,
  writeEveSecrets as writeEveSecrets3,
  ensureSecretValue as ensureSecretValue2,
  defaultSkillsDir as defaultSkillsDir3,
  ensureEveSkillsLayout as ensureEveSkillsLayout3
} from "@eve/dna";
import { runBrainInit as runBrainInit3, runInferenceInit as runInferenceInit3 } from "@eve/brain";
import { runLegsProxySetup as runLegsProxySetup3 } from "@eve/legs";
import { getGlobalCliFlags as getGlobalCliFlags3, outputJson as outputJson2 } from "@eve/cli-kit";
function parseProfile(s) {
  if (!s) return null;
  const v = s.trim().toLowerCase().replace(/-/g, "_");
  if (v === "inference_only" || v === "inferenceonly") return "inference_only";
  if (v === "data_pod" || v === "datapod") return "data_pod";
  if (v === "full") return "full";
  return null;
}
function parseTunnel(s) {
  if (!s) return void 0;
  const v = s.trim().toLowerCase();
  if (v === "pangolin") return "pangolin";
  if (v === "cloudflare" || v === "cf") return "cloudflare";
  return void 0;
}
function parseCodeEngine(s) {
  if (!s) return void 0;
  const v = s.trim().toLowerCase();
  if (v === "opencode") return "opencode";
  if (v === "openclaude") return "openclaude";
  if (v === "claudecode" || v === "claude_code" || v === "claude-code") return "claudecode";
  return void 0;
}
function parseAiMode(s) {
  if (!s) return void 0;
  const v = s.trim().toLowerCase();
  if (v === "local" || v === "provider" || v === "hybrid") return v;
  return void 0;
}
function parseAiProvider(s) {
  if (!s) return void 0;
  const v = s.trim().toLowerCase();
  if (v === "ollama" || v === "openrouter" || v === "anthropic" || v === "openai") return v;
  return void 0;
}
function prevAiModeFromUsb(usb) {
  if (!usb) return void 0;
  if (usb.target_profile === "inference_only") return "local";
  return void 0;
}
var SYNAP_BACKEND_REPO_URL = "https://github.com/synap-core/backend.git";
var SYNAP_BACKEND_TARBALL_URL = "https://codeload.github.com/synap-core/backend/tar.gz/refs/heads/main";
function looksLikeSynapRepo(repoRoot) {
  return existsSync3(join2(repoRoot, "synap")) && existsSync3(join2(repoRoot, "deploy", "docker-compose.yml"));
}
function findLocalSynapRepo(startDir) {
  const candidates = /* @__PURE__ */ new Set();
  const resolvedStart = resolve(startDir);
  let cursor = resolvedStart;
  for (let i = 0; i < 8; i += 1) {
    candidates.add(cursor);
    candidates.add(join2(cursor, "synap-backend"));
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const home = homedir();
  for (const p of [
    "/opt/synap-backend",
    "/srv/synap-backend",
    join2(home, "synap-backend"),
    join2(home, "synap", "synap-backend")
  ]) {
    candidates.add(p);
  }
  for (const candidate of candidates) {
    if (looksLikeSynapRepo(candidate)) return candidate;
  }
  return null;
}
async function isDirectoryEmpty(path) {
  try {
    const entries = await readdir(path);
    return entries.length === 0;
  } catch {
    return false;
  }
}
async function ensureSynapRepoForProfile(requestedPath, cwd, nonInteractive, jsonMode) {
  const explicit = requestedPath?.trim() || process.env.SYNAP_REPO_ROOT?.trim();
  if (explicit) {
    const resolved = resolve(explicit);
    if (!looksLikeSynapRepo(resolved)) {
      throw new Error(
        `Invalid synap repo at ${resolved}. Expected ${resolved}/synap and ${resolved}/deploy/docker-compose.yml`
      );
    }
    return resolved;
  }
  const detected = findLocalSynapRepo(cwd);
  if (detected) return detected;
  const defaultCloneDir = "/opt/synap-backend";
  let targetDir = defaultCloneDir;
  if (!nonInteractive && !jsonMode) {
    const shouldClone = await confirm3({
      message: `No synap-backend checkout detected. Clone it automatically to ${defaultCloneDir}?`,
      initialValue: true
    });
    if (isCancel3(shouldClone) || !shouldClone) {
      throw new Error(
        "data_pod/full requires a synap-backend checkout. Pass --synap-repo or set SYNAP_REPO_ROOT."
      );
    }
    const maybePath = await text2({
      message: "Where should synap-backend be cloned?",
      placeholder: defaultCloneDir,
      defaultValue: defaultCloneDir
    });
    if (isCancel3(maybePath)) {
      throw new Error("Cancelled.");
    }
    const trimmed = maybePath.trim();
    targetDir = resolve(trimmed.length ? trimmed : defaultCloneDir);
  }
  if (existsSync3(targetDir) && !looksLikeSynapRepo(targetDir)) {
    const empty = await isDirectoryEmpty(targetDir);
    if (empty) {
      await rm(targetDir, { recursive: true, force: true });
    } else if (!nonInteractive && !jsonMode) {
      const cleanup = await confirm3({
        message: `${targetDir} exists but is not a valid synap-backend checkout. Remove it and retry download?`,
        initialValue: true
      });
      if (isCancel3(cleanup) || !cleanup) {
        throw new Error(
          `Cannot continue with invalid checkout at ${targetDir}. Pass --synap-repo to a valid checkout or remove that folder.`
        );
      }
      await rm(targetDir, { recursive: true, force: true });
    } else {
      throw new Error(
        `Cannot auto-clone: target exists but is not a valid synap-backend checkout (${targetDir}). Remove it first or pass --synap-repo.`
      );
    }
  }
  if (!existsSync3(targetDir)) {
    if (!jsonMode) {
      console.log(`${emojis.info} Cloning synap-backend to ${colors.info(targetDir)} \u2026`);
    }
    try {
      await execa4(
        "git",
        [
          "-c",
          "credential.interactive=never",
          "clone",
          "--depth",
          "1",
          SYNAP_BACKEND_REPO_URL,
          targetDir
        ],
        {
          stdio: "inherit",
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0"
          }
        }
      );
    } catch {
      const archivePath = join2(tmpdir(), `synap-backend-${Date.now()}.tar.gz`);
      try {
        if (!jsonMode) {
          console.log(
            `${emojis.info} git clone failed; trying public archive download from codeload.github.com \u2026`
          );
        }
        await mkdir(targetDir, { recursive: true });
        await execa4("curl", ["-fsSL", SYNAP_BACKEND_TARBALL_URL, "-o", archivePath], {
          stdio: "inherit"
        });
        await execa4("tar", ["-xzf", archivePath, "--strip-components", "1", "-C", targetDir], {
          stdio: "inherit"
        });
      } catch {
        throw new Error(
          `Failed to fetch public synap-backend source into ${targetDir}.
Ensure outbound HTTPS to github.com/codeload.github.com is allowed and no proxy blocks downloads.
You can also pass --synap-repo <path> (or set SYNAP_REPO_ROOT) to an existing checkout.`
        );
      } finally {
        await rm(archivePath, { force: true }).catch(() => void 0);
      }
    }
  }
  if (!looksLikeSynapRepo(targetDir)) {
    throw new Error(`Cloned repo at ${targetDir}, but synap CLI layout was not found.`);
  }
  return targetDir;
}
function setupCommand(program2) {
  program2.command("setup").description("Three-path guided setup: Ollama+gateway, Synap Data Pod, or both (logical prompts)").option("--profile <p>", "inference_only | data_pod | full").option("--dry-run", "Resolve profile and print plan; do not write state or install").option("--synap-repo <path>", "data_pod / full: path to synap-backend checkout").option("--domain <host>", "data_pod / full: synap install --domain (default: localhost, or from saved setup profile)").option("--email <email>", "data_pod / full: required if domain is not localhost").option("--model <m>", "inference_only / full: default Ollama model (default: llama3.1:8b)").option("--with-openclaw", "data_pod / full: synap install --with-openclaw").option("--with-rsshub", "data_pod / full: synap install --with-rsshub").option("--admin-email <email>", "data_pod / full: synap install --admin-email").option("--admin-password <secret>", "data_pod / full: synap install --admin-password (preseed mode)").option("--admin-bootstrap-mode <mode>", "data_pod / full: preseed | token (default token)").option("--from-image", "synap install --from-image").option("--from-source", "synap install --from-source").option("--skip-hardware", "Skip optional hardware summary").option("--nvidia-smi", "With hardware summary in non-interactive mode, run nvidia-smi").option("--ai-mode <m>", "local | provider | hybrid (AI foundation first); default after merge: hybrid").option(
    "--ai-provider <p>",
    "Default provider for Eve provider routing: openrouter | anthropic | openai | ollama"
  ).option("--fallback-provider <p>", "Fallback provider for Eve provider routing").option("--tunnel <provider>", "data_pod | full: pangolin or cloudflare (runs eve legs setup after install)").option("--tunnel-domain <host>", "Hostname for tunnel / ingress (optional)").addHelpText(
    "after",
    "\nWhy three paths\n  inference_only \u2014 Local Ollama + Traefik gateway (Basic auth on :11435). Synap is not installed.\n  data_pod      \u2014 Official Synap stack via synap CLI (Caddy on 80/443). Use Eve for extra Docker apps.\n  full          \u2014 data_pod first, then Ollama on Docker network only + same gateway (no host :11434).\n\nState & manifests\n  Writes .eve/setup-profile.json in the current working directory.\n  Pre-filled profile if ~/.eve/usb-profile.json, /opt/eve/profile.json, or EVE_SETUP_MANIFEST exists.\n\nDocs: hestia-cli/docs/EVE_SETUP_PROFILES.md, hestia-cli/docs/AI_ROUTING_CONSOLIDATION_ADR.md, and hestia-cli/README.md\n"
  ).action(async (opts) => {
    const flags = getGlobalCliFlags3();
    const cwd = process.cwd();
    const existing = await readSetupProfile(cwd);
    let loadedExistingPrefs = false;
    if (!existing && existsSync3(getSetupProfilePath(cwd)) && !flags.nonInteractive && !flags.json && !opts.dryRun) {
      console.log(
        colors.warning(
          `${emojis.warning} ${getSetupProfilePath(cwd)} is present but invalid or unreadable. Fix or remove it to enable "load saved preferences".`
        )
      );
    }
    if (existing && !flags.nonInteractive && !opts.dryRun && !flags.json) {
      const load = await confirm3({
        message: `Load latest saved setup preferences from .eve/setup-profile.json (${existing.profile})?`,
        initialValue: true
      });
      if (isCancel3(load)) {
        console.log(colors.muted("Cancelled."));
        return;
      }
      loadedExistingPrefs = Boolean(load);
    }
    let profile = parseProfile(opts.profile);
    const usb = await readUsbSetupManifest();
    if (!profile && usb) {
      profile = usb.target_profile;
      if (!flags.json) {
        console.log(
          `${emojis.info} Found USB/setup manifest \u2192 suggested profile: ${colors.info(profile)}`
        );
      }
    }
    if (!profile && loadedExistingPrefs && existing?.profile) {
      profile = existing.profile;
    }
    if (!profile && !flags.nonInteractive) {
      const choice = await select3({
        message: "Choose setup profile",
        options: [
          {
            value: "inference_only",
            label: "Ollama + gateway",
            hint: "Local models + Traefik Basic auth on :11435 (Synap not installed)"
          },
          {
            value: "data_pod",
            label: "Eve only",
            hint: "Official synap install (Caddy on 80/443); Eve for extra Docker apps"
          },
          {
            value: "full",
            label: "All",
            hint: "Synap first, then Ollama on eve-network + gateway :11435"
          }
        ],
        initialValue: profile ?? "data_pod"
      });
      if (isCancel3(choice)) {
        console.log(colors.muted("Cancelled."));
        return;
      }
      profile = choice;
    }
    if (!profile) {
      console.error("Profile required: use --profile inference_only|data_pod|full or run interactively.");
      process.exit(1);
    }
    let aiMode = parseAiMode(opts.aiMode) ?? prevAiModeFromUsb(usb) ?? (loadedExistingPrefs ? existing?.aiMode : void 0);
    let defaultProvider = parseAiProvider(opts.aiProvider) ?? (loadedExistingPrefs ? existing?.aiDefaultProvider : void 0);
    let fallbackProvider = parseAiProvider(opts.fallbackProvider) ?? (loadedExistingPrefs ? existing?.aiFallbackProvider : void 0);
    if (!opts.dryRun && !flags.nonInteractive && !flags.json) {
      if (!aiMode) {
        const m = await select3({
          message: "AI foundation: where should inference run?",
          options: [
            { value: "local", label: "Local only", hint: "Ollama on this server" },
            { value: "provider", label: "Provider only", hint: "OpenRouter/Anthropic/OpenAI" },
            { value: "hybrid", label: "Hybrid (recommended)", hint: "Local + provider fallback" }
          ],
          initialValue: "hybrid"
        });
        if (isCancel3(m)) {
          console.log(colors.muted("Cancelled."));
          return;
        }
        aiMode = parseAiMode(String(m));
      }
      if (!defaultProvider && aiMode !== "local") {
        const p = await select3({
          message: "Choose default cloud provider",
          options: [
            { value: "openrouter", label: "OpenRouter", hint: "Multi-provider gateway" },
            { value: "anthropic", label: "Anthropic" },
            { value: "openai", label: "OpenAI" }
          ],
          initialValue: "openrouter"
        });
        if (isCancel3(p)) {
          console.log(colors.muted("Cancelled."));
          return;
        }
        defaultProvider = parseAiProvider(String(p));
      }
      const askFallback = await confirm3({
        message: "Add a fallback provider?",
        initialValue: true
      });
      if (isCancel3(askFallback)) {
        console.log(colors.muted("Cancelled."));
        return;
      }
      if (askFallback && !fallbackProvider) {
        const fp = await select3({
          message: "Fallback provider",
          options: [
            { value: "openrouter", label: "OpenRouter" },
            { value: "anthropic", label: "Anthropic" },
            { value: "openai", label: "OpenAI" },
            { value: "ollama", label: "Ollama local" },
            { value: "none", label: "Skip fallback" }
          ],
          initialValue: aiMode === "local" ? "none" : "ollama"
        });
        if (isCancel3(fp)) {
          console.log(colors.muted("Cancelled."));
          return;
        }
        fallbackProvider = fp === "none" ? void 0 : parseAiProvider(String(fp));
      }
    }
    if (!aiMode) aiMode = "hybrid";
    if (!defaultProvider && aiMode !== "local") defaultProvider = "openrouter";
    if (opts.fromImage && opts.fromSource) {
      console.error("Use only one of --from-image or --from-source.");
      process.exit(1);
    }
    const domainArg = opts.domain?.trim();
    const explicitDomain = domainArg !== void 0 && domainArg.length > 0 ? domainArg : void 0;
    let installDomain = explicitDomain ?? (loadedExistingPrefs ? existing?.network?.synapHost?.trim() || existing?.domainHint?.trim() : void 0) ?? "localhost";
    let installEmail = opts.email?.trim() || process.env.LETSENCRYPT_EMAIL?.trim() || void 0;
    if (!installEmail && loadedExistingPrefs) {
      installEmail = existing?.synapInstall?.tlsEmail?.trim() || installEmail;
    }
    let installMode = opts.fromImage ? "from_image" : opts.fromSource ? "from_source" : "auto";
    if (!opts.fromImage && !opts.fromSource && loadedExistingPrefs && existing?.synapInstall?.mode) {
      installMode = existing.synapInstall.mode;
    }
    let installWithOpenclaw = Boolean(opts.withOpenclaw);
    if (!opts.withOpenclaw && loadedExistingPrefs && typeof existing?.synapInstall?.withOpenclaw === "boolean") {
      installWithOpenclaw = existing.synapInstall.withOpenclaw;
    }
    let installWithRsshub = Boolean(opts.withRsshub);
    if (!opts.withRsshub && loadedExistingPrefs && typeof existing?.synapInstall?.withRsshub === "boolean") {
      installWithRsshub = existing.synapInstall.withRsshub;
    }
    let adminBootstrapMode = opts.adminBootstrapMode === "preseed" || opts.adminBootstrapMode === "token" ? opts.adminBootstrapMode : "token";
    if (!opts.adminBootstrapMode && loadedExistingPrefs && (existing?.synapInstall?.adminBootstrapMode === "preseed" || existing?.synapInstall?.adminBootstrapMode === "token")) {
      adminBootstrapMode = existing.synapInstall.adminBootstrapMode;
    }
    let adminEmail = opts.adminEmail?.trim() || process.env.ADMIN_EMAIL?.trim() || installEmail;
    if (!opts.adminEmail?.trim() && loadedExistingPrefs && existing?.synapInstall?.adminEmail?.trim()) {
      adminEmail = existing.synapInstall.adminEmail.trim();
    }
    let adminPassword = opts.adminPassword?.trim() || process.env.ADMIN_PASSWORD?.trim();
    let exposureMode = installDomain !== "localhost" ? "public" : "local";
    let tunnelProvider = parseTunnel(opts.tunnel) ?? usb?.tunnel_provider;
    if (!opts.tunnel && !usb?.tunnel_provider && loadedExistingPrefs) {
      tunnelProvider = existing?.network?.legs?.tunnelProvider ?? existing?.tunnelProvider;
    }
    let tunnelDomain = (opts.tunnelDomain?.trim() || usb?.tunnel_domain || "").trim() || void 0;
    if (!tunnelDomain && loadedExistingPrefs) {
      tunnelDomain = existing?.network?.legs?.host?.trim() || existing?.tunnelDomain?.trim() || void 0;
    }
    let legsHostStrategy;
    if (loadedExistingPrefs) {
      const prior = existing?.network?.legs?.hostStrategy;
      if (prior === "same_as_synap" || prior === "custom") {
        legsHostStrategy = prior;
      }
    }
    if (!opts.dryRun && (profile === "data_pod" || profile === "full") && !flags.nonInteractive && !flags.json) {
      const accessMode = await select3({
        message: "How should users reach your Synap Data Pod API/auth endpoint?",
        options: [
          {
            value: "local",
            label: "Local only (this machine / private network)",
            hint: "Sets Synap to localhost. Eve side services stay local unless you configure Legs exposure separately."
          },
          {
            value: "public",
            label: "Public domain (internet-accessible)",
            hint: "Sets Synap public URL (Caddy/API/auth). Eve side services are exposed only if Legs/tunnel is enabled."
          }
        ],
        initialValue: installDomain !== "localhost" ? "public" : "local"
      });
      if (isCancel3(accessMode)) {
        console.log(colors.muted("Cancelled."));
        return;
      }
      exposureMode = accessMode;
      if (accessMode === "local") {
        installDomain = "localhost";
      } else {
        const d = await text2({
          message: "Public hostname for Synap (Caddy URL for API/auth, e.g. pod.example.com)",
          initialValue: installDomain !== "localhost" ? installDomain : "",
          placeholder: "pod.example.com"
        });
        if (isCancel3(d)) {
          console.log(colors.muted("Cancelled."));
          return;
        }
        const candidate = d.trim();
        if (!candidate || candidate === "localhost") {
          console.error("Public mode requires a real hostname (not localhost).");
          process.exit(1);
        }
        installDomain = candidate;
      }
      if (installDomain !== "localhost" && !installEmail) {
        const em = await text2({
          message: "Let's Encrypt email for TLS certificates",
          placeholder: "you@example.com",
          initialValue: ""
        });
        if (isCancel3(em)) {
          console.log(colors.muted("Cancelled."));
          return;
        }
        const trimmed = em.trim();
        if (!trimmed) {
          console.error("Non-localhost domain requires --email (or LETSENCRYPT_EMAIL).");
          process.exit(1);
        }
        installEmail = trimmed;
      }
      if (installMode === "auto") {
        const mode = await select3({
          message: "Synap install mode",
          options: [
            { value: "auto", label: "Auto", hint: "Let synap decide (repo-aware default)" },
            { value: "from_image", label: "From image", hint: "Use prebuilt GHCR image" },
            { value: "from_source", label: "From source", hint: "Build locally from repo checkout" }
          ],
          initialValue: "auto"
        });
        if (isCancel3(mode)) {
          console.log(colors.muted("Cancelled."));
          return;
        }
        installMode = mode;
      }
      const bootstrapMode = await select3({
        message: "Admin bootstrap mode for Synap",
        options: [
          {
            value: "token",
            label: "Token (recommended)",
            hint: "Generate bootstrap token; create first admin later in UI/CLI."
          },
          {
            value: "preseed",
            label: "Preseed admin now",
            hint: "Create first admin during install (needs email + password)."
          }
        ],
        initialValue: adminBootstrapMode
      });
      if (isCancel3(bootstrapMode)) {
        console.log(colors.muted("Cancelled."));
        return;
      }
      adminBootstrapMode = bootstrapMode;
      if (adminBootstrapMode === "preseed") {
        const ae = await text2({
          message: "Admin email for initial Synap admin account",
          initialValue: adminEmail ?? "",
          placeholder: "admin@example.com"
        });
        if (isCancel3(ae)) {
          console.log(colors.muted("Cancelled."));
          return;
        }
        adminEmail = ae.trim();
        if (!adminEmail) {
          console.error("Preseed mode requires an admin email.");
          process.exit(1);
        }
        if (!adminPassword) {
          const ap = await text2({
            message: "Admin password for initial account",
            initialValue: "",
            placeholder: "Choose a strong password"
          });
          if (isCancel3(ap)) {
            console.log(colors.muted("Cancelled."));
            return;
          }
          adminPassword = ap.trim();
        }
        if (!adminPassword) {
          console.error("Preseed mode requires an admin password.");
          process.exit(1);
        }
      }
      const askOpenclaw = await confirm3({
        message: adminBootstrapMode === "preseed" ? "Install OpenClaw during Synap install? (A workspace exists after preseed, so the add-on can provision immediately.)" : "Enable OpenClaw for this pod? (Token bootstrap has no workspace yet \u2014 Synap install skips the add-on; the admin UI will offer setup after you register.)",
        initialValue: adminBootstrapMode === "preseed" ? installWithOpenclaw : false
      });
      if (isCancel3(askOpenclaw)) {
        console.log(colors.muted("Cancelled."));
        return;
      }
      installWithOpenclaw = Boolean(askOpenclaw);
      const askRsshub = await confirm3({
        message: "Enable RSSHub during Synap install?",
        initialValue: installWithRsshub
      });
      if (isCancel3(askRsshub)) {
        console.log(colors.muted("Cancelled."));
        return;
      }
      installWithRsshub = Boolean(askRsshub);
      if (!tunnelProvider) {
        const t = await select3({
          message: "Expose Eve Legs (Traefik) via a tunnel after Synap install?",
          options: [
            { value: "none", label: "No tunnel", hint: "Localhost / manual Traefik only" },
            {
              value: "pangolin",
              label: "Pangolin",
              hint: "Installs Pangolin CLI and writes config under /opt/hestia/tunnels"
            },
            {
              value: "cloudflare",
              label: "Cloudflare",
              hint: "cloudflared + ingress config (stub credentials path)"
            }
          ],
          initialValue: "none"
        });
        if (isCancel3(t)) {
          console.log(colors.muted("Cancelled."));
          return;
        }
        tunnelProvider = t === "none" ? void 0 : parseTunnel(String(t));
      }
      if (tunnelProvider && !tunnelDomain) {
        if (installDomain !== "localhost") {
          const strategy = await select3({
            message: "Legs ingress hostname",
            options: [
              {
                value: "same_as_synap",
                label: `Reuse Synap host (${installDomain})`,
                hint: "No extra hostname needed."
              },
              {
                value: "custom",
                label: "Use a different hostname",
                hint: "Example: eve.example.com"
              }
            ],
            initialValue: "same_as_synap"
          });
          if (isCancel3(strategy)) {
            console.log(colors.muted("Cancelled."));
            return;
          }
          legsHostStrategy = strategy;
          if (legsHostStrategy === "same_as_synap") {
            tunnelDomain = installDomain;
          }
        } else {
          legsHostStrategy = "custom";
        }
        if (!tunnelDomain) {
          const d = await text2({
            message: "Public hostname for Eve Legs ingress",
            placeholder: "eve.example.com",
            initialValue: ""
          });
          if (isCancel3(d)) {
            console.log(colors.muted("Cancelled."));
            return;
          }
          tunnelDomain = d.trim() || void 0;
        }
      }
    }
    if (flags.nonInteractive && opts.tunnel && !tunnelProvider) {
      console.error("Invalid --tunnel (use pangolin or cloudflare).");
      process.exit(1);
    }
    if (flags.nonInteractive && opts.aiMode && !parseAiMode(opts.aiMode)) {
      console.error("Invalid --ai-mode (use local|provider|hybrid).");
      process.exit(1);
    }
    if (flags.nonInteractive && opts.aiProvider && !parseAiProvider(opts.aiProvider)) {
      console.error("Invalid --ai-provider (use openrouter|anthropic|openai|ollama).");
      process.exit(1);
    }
    if (flags.nonInteractive && opts.adminBootstrapMode && opts.adminBootstrapMode !== "token" && opts.adminBootstrapMode !== "preseed") {
      console.error("Invalid --admin-bootstrap-mode (use token|preseed).");
      process.exit(1);
    }
    if (installDomain !== "localhost" && !installEmail) {
      console.error("Non-localhost domain requires --email (or LETSENCRYPT_EMAIL).");
      process.exit(1);
    }
    if (adminBootstrapMode === "preseed" && !adminEmail) {
      console.error("Preseed admin bootstrap requires --admin-email (or ADMIN_EMAIL).");
      process.exit(1);
    }
    if (adminBootstrapMode === "preseed" && !adminPassword) {
      console.error("Preseed admin bootstrap requires --admin-password (or ADMIN_PASSWORD).");
      process.exit(1);
    }
    const synapInstallWithOpenclaw = installWithOpenclaw && adminBootstrapMode === "preseed";
    if (installWithOpenclaw && adminBootstrapMode === "token" && !opts.dryRun) {
      if (!flags.json) {
        console.log(
          colors.info(
            "OpenClaw: token bootstrap has no workspace at install time, so `synap install` runs without --with-openclaw. After you finish /admin/bootstrap, use the admin dashboard prompt or run `./synap services add openclaw` on the server."
          )
        );
      }
    }
    if (!flags.json) {
      const synapReachability = installDomain === "localhost" ? "local only (localhost/private network)" : `public via https://${installDomain}`;
      const legsReachability = tunnelProvider ? `enabled (${tunnelProvider}${tunnelDomain ? `, hostname: ${tunnelDomain}` : ""})` : "disabled (no tunnel/public Legs route configured)";
      console.log(
        colors.info(
          `
Network exposure plan:
  - Synap Data Pod (API/auth): ${synapReachability}
  - Eve side services (Legs routes): ${legsReachability}
`
        )
      );
    }
    if (existing && !flags.nonInteractive && !opts.dryRun && !loadedExistingPrefs) {
      const ok = await confirm3({
        message: `Existing setup profile (${existing.profile}). Overwrite and continue?`,
        initialValue: false
      });
      if (isCancel3(ok) || !ok) {
        console.log(colors.muted("Cancelled."));
        return;
      }
    }
    if (opts.dryRun) {
      const plan = {
        profile,
        existing: existing?.profile ?? null,
        usbManifest: usb ? { target_profile: usb.target_profile } : null,
        ai: {
          mode: aiMode ?? null,
          defaultProvider: defaultProvider ?? null,
          fallbackProvider: fallbackProvider ?? null
        },
        tunnel: tunnelProvider ?? null,
        tunnelDomain: tunnelDomain ?? null,
        legsHostStrategy: legsHostStrategy ?? null,
        synap: {
          domain: installDomain,
          email: installEmail ?? null,
          mode: installMode,
          withOpenclaw: installWithOpenclaw,
          synapInstallWithOpenclaw,
          withRsshub: installWithRsshub,
          adminBootstrapMode,
          adminEmail: adminEmail ?? null
        }
      };
      if (flags.json) outputJson2(plan);
      else console.log(JSON.stringify(plan, null, 2));
      return;
    }
    if (!opts.skipHardware && !flags.json) {
      if (flags.nonInteractive) {
        if (opts.nvidiaSmi) {
          const facts = await probeHardware(true);
          console.log(`
${colors.primary("Hardware")}
${formatHardwareReport(facts)}
`);
        }
      } else {
        const showHw = await confirm3({
          message: "Show optional hardware summary (CPU, RAM, OS)?",
          initialValue: false
        });
        if (!isCancel3(showHw) && showHw) {
          const gpu = await confirm3({
            message: "Also run nvidia-smi (may fail if no NVIDIA GPU)?",
            initialValue: false
          });
          const facts = await probeHardware(!isCancel3(gpu) && Boolean(gpu));
          console.log(`
${colors.primary("Hardware")}
${formatHardwareReport(facts)}
`);
        }
      }
    }
    await writeSetupProfile2(
      {
        profile,
        source: usb ? "usb_manifest" : flags.nonInteractive ? "cli" : "wizard",
        domainHint: installDomain,
        hearthName: usb?.hearth_name,
        tunnelProvider,
        tunnelDomain,
        aiMode,
        aiDefaultProvider: defaultProvider,
        aiFallbackProvider: fallbackProvider,
        network: {
          exposureMode,
          synapHost: installDomain,
          legs: tunnelProvider ? {
            tunnelProvider,
            hostStrategy: legsHostStrategy ?? (tunnelDomain ? "custom" : void 0),
            host: tunnelDomain
          } : void 0
        },
        synapInstall: {
          mode: installMode,
          tlsEmail: installEmail,
          withOpenclaw: installWithOpenclaw,
          withRsshub: installWithRsshub,
          adminBootstrapMode,
          adminEmail
        }
      },
      cwd
    );
    const prevSecrets = await readEveSecrets4(cwd);
    const skillsDir = prevSecrets?.builder?.skillsDir?.trim() || process.env.EVE_SKILLS_DIR?.trim() || defaultSkillsDir3();
    const merge = {
      ai: {
        mode: aiMode,
        defaultProvider,
        fallbackProvider,
        syncToSynap: true,
        providers: [
          { id: "ollama", enabled: aiMode !== "provider", baseUrl: prevSecrets?.inference?.ollamaUrl ?? "http://127.0.0.1:11434" },
          {
            id: "openrouter",
            enabled: defaultProvider === "openrouter" || fallbackProvider === "openrouter",
            apiKey: prevSecrets?.ai?.providers?.find((p) => p.id === "openrouter")?.apiKey ?? process.env.OPENROUTER_API_KEY,
            baseUrl: "https://openrouter.ai/api/v1",
            defaultModel: prevSecrets?.ai?.providers?.find((p) => p.id === "openrouter")?.defaultModel ?? process.env.OPENROUTER_MODEL
          },
          {
            id: "anthropic",
            enabled: defaultProvider === "anthropic" || fallbackProvider === "anthropic",
            apiKey: prevSecrets?.ai?.providers?.find((p) => p.id === "anthropic")?.apiKey ?? process.env.ANTHROPIC_API_KEY,
            defaultModel: prevSecrets?.ai?.providers?.find((p) => p.id === "anthropic")?.defaultModel ?? process.env.ANTHROPIC_MODEL
          },
          {
            id: "openai",
            enabled: defaultProvider === "openai" || fallbackProvider === "openai",
            apiKey: prevSecrets?.ai?.providers?.find((p) => p.id === "openai")?.apiKey ?? process.env.OPENAI_API_KEY,
            defaultModel: prevSecrets?.ai?.providers?.find((p) => p.id === "openai")?.defaultModel ?? process.env.OPENAI_MODEL
          }
        ]
      },
      builder: {
        codeEngine: parseCodeEngine(process.env.BUILDER_CODE_ENGINE) ?? prevSecrets?.builder?.codeEngine,
        openclaudeUrl: profile === "data_pod" ? prevSecrets?.builder?.openclaudeUrl ?? (process.env.OPENCLAUDE_BRAIN_URL || void 0) : prevSecrets?.builder?.openclaudeUrl ?? prevSecrets?.inference?.gatewayUrl ?? "http://127.0.0.1:11435",
        dokployApiUrl: prevSecrets?.builder?.dokployApiUrl ?? process.env.DOKPLOY_API_URL ?? "http://127.0.0.1:3000",
        dokployApiKey: ensureSecretValue2(prevSecrets?.builder?.dokployApiKey ?? process.env.DOKPLOY_API_KEY),
        dokployWebhookUrl: prevSecrets?.builder?.dokployWebhookUrl ?? process.env.DOKPLOY_WEBHOOK_URL ?? void 0,
        workspaceDir: prevSecrets?.builder?.workspaceDir ?? join2(homedir(), ".eve", "workspace"),
        skillsDir
      }
    };
    if (profile !== "inference_only") {
      const podKey = ensureSecretValue2(
        prevSecrets?.synap?.apiKey ?? process.env.SYNAP_API_KEY ?? process.env.OPENCLAW_SYNAP_API_KEY
      );
      merge.synap = {
        apiUrl: prevSecrets?.synap?.apiUrl ?? "http://127.0.0.1:4000",
        apiKey: podKey,
        hubBaseUrl: prevSecrets?.synap?.hubBaseUrl ?? process.env.SYNAP_HUB_BASE_URL ?? void 0
      };
      merge.arms = {
        openclaw: { synapApiKey: podKey }
      };
    } else {
      merge.arms = {
        openclaw: {
          synapApiKey: ensureSecretValue2(
            prevSecrets?.arms?.openclaw?.synapApiKey ?? process.env.OPENCLAW_SYNAP_API_KEY
          )
        }
      };
    }
    if (profile !== "data_pod") {
      merge.inference = {
        ollamaUrl: prevSecrets?.inference?.ollamaUrl ?? (profile === "full" ? "http://eve-brain-ollama:11434" : "http://127.0.0.1:11434"),
        gatewayUrl: prevSecrets?.inference?.gatewayUrl ?? "http://127.0.0.1:11435",
        gatewayUser: prevSecrets?.inference?.gatewayUser,
        gatewayPass: prevSecrets?.inference?.gatewayPass
      };
    }
    await writeEveSecrets3(merge, cwd);
    ensureEveSkillsLayout3(skillsDir);
    if (flags.json) {
      outputJson2({ ok: true, profile, persisted: true });
    }
    try {
      if (profile === "inference_only") {
        await runInferenceInit3({
          model: opts.model ?? "llama3.1:8b",
          withGateway: true,
          internalOllamaOnly: false
        });
      } else if (profile === "data_pod") {
        const repo = await ensureSynapRepoForProfile(
          opts.synapRepo,
          cwd,
          Boolean(flags.nonInteractive),
          Boolean(flags.json)
        );
        await runBrainInit3({
          synapRepo: repo,
          domain: installDomain,
          email: installEmail,
          withOpenclaw: synapInstallWithOpenclaw,
          withRsshub: installWithRsshub,
          fromImage: installMode === "from_image",
          fromSource: installMode === "from_source",
          adminBootstrapMode,
          adminEmail,
          adminPassword,
          withAi: false
        });
        if (tunnelProvider) {
          const legsDomain = installDomain !== "localhost" ? installDomain : tunnelDomain ?? void 0;
          await runLegsProxySetup3({
            domain: legsDomain,
            tunnel: tunnelProvider,
            tunnelDomain,
            ssl: false,
            standalone: false
          });
        }
      } else {
        const repo = await ensureSynapRepoForProfile(
          opts.synapRepo,
          cwd,
          Boolean(flags.nonInteractive),
          Boolean(flags.json)
        );
        if (!flags.json) {
          console.log(colors.info("\nFull profile: (1) Data Pod  (2) Ollama internal + gateway\n"));
        }
        await runBrainInit3({
          synapRepo: repo,
          domain: installDomain,
          email: installEmail,
          withOpenclaw: synapInstallWithOpenclaw,
          withRsshub: installWithRsshub,
          fromImage: installMode === "from_image",
          fromSource: installMode === "from_source",
          adminBootstrapMode,
          adminEmail,
          adminPassword,
          withAi: false
        });
        await runInferenceInit3({
          model: opts.model ?? "llama3.1:8b",
          withGateway: true,
          internalOllamaOnly: true
        });
        if (tunnelProvider) {
          const legsDomain = installDomain !== "localhost" ? installDomain : tunnelDomain ?? void 0;
          await runLegsProxySetup3({
            domain: legsDomain,
            tunnel: tunnelProvider,
            tunnelDomain,
            ssl: false,
            standalone: false
          });
        }
      }
      if (!flags.json) {
        console.log(
          `
${emojis.check} Setup complete. Profile: ${colors.success(profile)}  (.eve/setup-profile.json)`
        );
        console.log(
          colors.muted(
            "Ports: Synap Caddy 80/443; inference gateway 127.0.0.1:11435; Ollama direct 127.0.0.1:11434 when published. See hestia-cli/docs/EVE_SETUP_PROFILES.md"
          )
        );
      }
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }
  });
}

// src/commands/remove.ts
import { execa as execa5 } from "execa";
import { join as join3 } from "path";
import { confirm as confirm4, isCancel as isCancel4 } from "@clack/prompts";
import { getGlobalCliFlags as getGlobalCliFlags4 } from "@eve/cli-kit";
import {
  entityStateManager as entityStateManager6
} from "@eve/dna";
import { refreshTraefikRoutes as refreshTraefikRoutes3 } from "@eve/legs";
async function removeTraefik() {
  const spinner = createSpinner("Stopping Traefik...");
  spinner.start();
  try {
    await execa5("docker", ["compose", "down", "--volumes"], {
      cwd: join3(process.cwd(), ".eve", "traefik"),
      stdio: "inherit"
    });
  } catch {
    try {
      const { stdout } = await execa5("docker", ["ps", "-q", "-f", "name=eve-traefik"]);
      if (stdout.trim()) {
        const containers = stdout.trim().split("\n").filter(Boolean);
        await execa5("docker", ["rm", "-f", ...containers], { stdio: "inherit" });
      }
    } catch {
    }
  }
  spinner.succeed("Traefik stopped");
}
async function removeSynap() {
  const spinner = createSpinner("Stopping Synap Data Pod...");
  spinner.start();
  try {
    const deployDir = process.env.SYNAP_DEPLOY_DIR;
    if (deployDir) {
      const composePath = join3(deployDir, "docker-compose.yml");
      await execa5("docker", ["compose", "-f", composePath, "down", "--volumes"], {
        env: { ...process.env, SYNAP_ASSUME_YES: "1" },
        stdio: "inherit"
      });
    } else {
      const { stdout } = await execa5("docker", ["ps", "-q", "-f", "name=eve-synap"]);
      if (stdout.trim()) {
        const containers = stdout.trim().split("\n").filter(Boolean);
        await execa5("docker", ["rm", "-f", ...containers], { stdio: "inherit" });
      }
    }
  } catch {
    printWarning("Synap removal failed \u2014 check manually.");
  }
  spinner.succeed("Synap stopped");
}
async function removeOllama() {
  const spinner = createSpinner("Stopping Ollama...");
  spinner.start();
  try {
    const { stdout } = await execa5("docker", ["ps", "-q", "-f", "name=ollama"]);
    if (stdout.trim()) {
      const containers = stdout.trim().split("\n").filter(Boolean);
      await execa5("docker", ["rm", "-f", ...containers], { stdio: "inherit" });
    }
  } catch {
  }
  spinner.succeed("Ollama stopped");
}
async function removeOpenclaw() {
  const spinner = createSpinner("Removing OpenClaw...");
  spinner.start();
  try {
    const synapScript = process.env.SYNAP_SETUP_SCRIPT;
    if (synapScript && process.platform !== "win32") {
      await execa5("bash", [synapScript, "services", "remove", "openclaw"], {
        env: { ...process.env, SYNAP_DEPLOY_DIR: process.env.SYNAP_DEPLOY_DIR || "", SYNAP_ASSUME_YES: "1" },
        stdio: "inherit"
      });
    } else {
      const { stdout } = await execa5("docker", ["ps", "-q", "-f", "name=openclaw"]);
      if (stdout.trim()) {
        const containers = stdout.trim().split("\n").filter(Boolean);
        await execa5("docker", ["rm", "-f", ...containers], { stdio: "inherit" });
      }
    }
  } catch {
    printWarning("OpenClaw removal failed \u2014 check manually.");
  }
  spinner.succeed("OpenClaw removed");
}
async function removeRsshub() {
  const spinner = createSpinner("Removing RSSHub...");
  spinner.start();
  try {
    const { stdout } = await execa5("docker", ["ps", "-q", "-f", "name=rsshub"]);
    if (stdout.trim()) {
      const containers = stdout.trim().split("\n").filter(Boolean);
      await execa5("docker", ["rm", "-f", ...containers], { stdio: "inherit" });
    }
    const { RSSHubService: RSSHubService2 } = await import("@eve/eyes");
    const rsshub = new RSSHubService2();
    await rsshub.stop();
  } catch {
    printWarning("RSSHub removal failed \u2014 check manually.");
  }
  spinner.succeed("RSSHub removed");
}
async function removeOpenwebui() {
  const spinner = createSpinner("Stopping Open WebUI...");
  spinner.start();
  try {
    const { existsSync: existsSync8 } = await import("fs");
    const deployDir = "/opt/openwebui";
    const composePath = join3(deployDir, "docker-compose.yml");
    if (existsSync8(composePath)) {
      await execa5("docker", ["compose", "down", "--volumes"], {
        cwd: deployDir,
        stdio: "inherit"
      });
    } else {
      const { stdout } = await execa5("docker", ["ps", "-aq", "-f", "name=hestia-openwebui"]);
      if (stdout.trim()) {
        const containers = stdout.trim().split("\n").filter(Boolean);
        await execa5("docker", ["rm", "-f", ...containers], { stdio: "inherit" });
      }
    }
  } catch {
    printWarning("Open WebUI removal failed \u2014 check manually.");
  }
  spinner.succeed("Open WebUI removed");
}
async function runRemove(componentId) {
  if (componentId === "traefik") {
    printError("Traefik is always-installed infrastructure and cannot be removed.");
    printInfo("  To stop it temporarily: docker stop eve-legs-traefik");
    process.exit(1);
  }
  const comp = resolveComponent(componentId);
  const installed = await entityStateManager6.isComponentInstalled(componentId);
  if (!installed) {
    const organ = comp.organ;
    let organReady = false;
    if (organ) {
      const organState = await entityStateManager6.getOrganState(organ);
      organReady = organState.state === "ready";
    }
    if (!organReady) {
      printWarning(`${comp.label} does not appear to be installed.`);
      printInfo('  Run "eve status" to see current state.');
      return;
    }
  }
  const currentComponents = await entityStateManager6.getInstalledComponents();
  const dependents = currentComponents.filter((dep) => {
    const depInfo = COMPONENTS3.find((c) => c.id === dep);
    return depInfo?.requires?.includes(componentId) ?? false;
  });
  if (dependents.length > 0) {
    const depNames = dependents.map((d) => {
      const info = COMPONENTS3.find((c) => c.id === d);
      return info ? info.label : d;
    });
    printWarning(`${comp.label} is a prerequisite for: ${depNames.join(", ")}`);
    printInfo("  Remove dependents first, or proceed with caution:");
    console.log();
  }
  printHeader(`Removing ${comp.label}`, comp.emoji);
  console.log();
  printInfo("This will stop and remove the Docker containers for this component.");
  console.log();
  const flags = getGlobalCliFlags4();
  if (!flags.nonInteractive) {
    const ok = await confirm4({ message: `Remove ${comp.label}? This cannot be undone.` });
    if (isCancel4(ok) || !ok) {
      console.log(colors.muted("Cancelled."));
      return;
    }
  }
  let removeFn;
  try {
    removeFn = buildRemoveStep(comp.id);
  } catch (err) {
    printError(String(err));
    process.exit(1);
  }
  await removeFn();
  await updateStateAfterRemove(comp.id);
  const refresh = await refreshTraefikRoutes3();
  if (refresh.refreshed) {
    printInfo(`Traefik routes refreshed for ${refresh.domain}`);
  }
  console.log();
  printSuccess(`${comp.label} removed successfully!`);
  console.log();
  printInfo("Next steps:");
  printInfo(`  - Run "eve status" to check entity state`);
  printInfo(`  - Run "eve add ${comp.id}" to add it back later`);
  console.log();
}
function buildRemoveStep(componentId) {
  switch (componentId) {
    case "traefik":
      return removeTraefik;
    case "synap":
      return removeSynap;
    case "ollama":
      return removeOllama;
    case "openclaw":
      return removeOpenclaw;
    case "rsshub":
      return removeRsshub;
    case "openwebui":
      return removeOpenwebui;
    case "hermes":
    case "dokploy":
    case "opencode":
    case "openclaude":
      return async () => {
        const info = COMPONENTS3.find((c) => c.id === componentId);
        if (info) {
          printWarning(`${info.label} removal requires manual cleanup.`);
          printInfo('  Run "eve builder stack" to manage builder resources.');
        }
      };
    default:
      throw new Error(`No remove handler for component: ${componentId}`);
  }
}
async function updateStateAfterRemove(componentId) {
  const organMap = {
    synap: "brain",
    ollama: "brain",
    openclaw: "arms",
    hermes: "builder",
    rsshub: "eyes",
    traefik: "legs",
    openwebui: "eyes",
    dokploy: "builder",
    opencode: "builder",
    openclaude: "builder"
  };
  const organ = organMap[componentId];
  if (organ) {
    await entityStateManager6.updateOrgan(organ, "missing");
  }
  await entityStateManager6.updateComponentEntry(componentId, {
    state: "missing"
  });
  const current = await entityStateManager6.getInstalledComponents();
  const updated = current.filter((id) => id !== componentId);
  if (updated.length === 0) {
    await entityStateManager6.updateSetupProfile({ components: ["traefik"] });
    await entityStateManager6.updateComponentEntry("traefik", { state: "ready" });
    await entityStateManager6.updateOrgan("legs", "ready", { version: "0.1.0" });
  } else {
    await entityStateManager6.updateSetupProfile({ components: updated });
  }
}
function removeCommand(program2) {
  program2.command("remove").alias("rm").description("Remove a component from an existing entity").argument("[component]", "Component ID to remove (synap, ollama, openclaw, rsshub, traefik, openwebui)").action(async (component) => {
    if (!component) {
      console.log();
      printHeader("Eve \u2014 Remove Component", emojis.entity);
      console.log();
      printInfo("Usage: eve remove <component>");
      console.log();
      printInfo("Available components:");
      for (const comp of COMPONENTS3) {
        const installed = await entityStateManager6.isComponentInstalled(comp.id);
        const tag = installed ? colors.success(" [installed]") : (await entityStateManager6.getOrganState(comp.organ)).state === "ready" ? colors.success(" [installed]") : colors.muted("[not installed]");
        console.log(`  ${comp.emoji} ${colors.primary.bold(comp.label)}${tag}`);
        console.log(`    ${comp.description.split("\n")[0]}`);
      }
      console.log();
      printWarning("Warning: traefik cannot be removed (always installed).");
      printInfo("Examples:");
      printInfo("  eve remove ollama             # Remove local AI inference");
      printInfo("  eve remove openclaw           # Remove AI agent layer");
      printInfo("  eve remove rsshub             # Remove data perception");
      console.log();
      return;
    }
    await runRemove(component);
  });
}

// src/commands/debug/logs.ts
import { execa as execa6 } from "execa";
function logsCommand(program2) {
  program2.command("logs").description("Docker Compose logs for Eve stack (set EVE_COMPOSE_FILE or run from compose directory)").argument("[service]", "Optional compose service name").option("-f, --follow", "Follow log output", false).option("-n, --tail <lines>", "Number of lines", "100").option("--compose-file <path>", "Path to docker-compose.yml").action(async (service, opts) => {
    const composeFile = opts.composeFile || process.env.EVE_COMPOSE_FILE;
    const args = ["compose"];
    if (composeFile) {
      args.push("-f", composeFile);
    }
    args.push("logs", `--tail=${opts.tail ?? "100"}`);
    if (opts.follow) args.push("-f");
    if (service) args.push(service);
    try {
      printInfo(`docker ${args.join(" ")}`);
      await execa6("docker", args, { stdio: "inherit" });
    } catch (e) {
      printError(
        e instanceof Error ? e.message : "docker compose failed. Set EVE_COMPOSE_FILE or use --compose-file."
      );
      process.exit(1);
    }
  });
}

// src/commands/debug/inspect.ts
import { execa as execa7 } from "execa";
import { entityStateManager as entityStateManager7, configManager } from "@eve/dna";
import { getGlobalCliFlags as getGlobalCliFlags5, outputJson as outputJson3 } from "@eve/cli-kit";
function inspectCommand(program2) {
  program2.command("inspect").description("Dump entity state, config path, and Eve-related containers (JSON)").option("--containers-only", "Only run docker ps filter").action(async (opts) => {
    try {
      let containers = [];
      try {
        const { stdout } = await execa7("docker", [
          "ps",
          "-a",
          "--filter",
          "name=eve-",
          "--format",
          "{{.Names}}	{{.Status}}	{{.Image}}"
        ]);
        containers = stdout.trim().split("\n").filter(Boolean).map((line) => {
          const [name, status, image] = line.split("	");
          return { name: name ?? "", status: status ?? "", image: image ?? "" };
        });
      } catch {
        containers = [];
      }
      if (opts.containersOnly) {
        const payload2 = { containers };
        if (getGlobalCliFlags5().json) {
          outputJson3(payload2);
        } else {
          console.log(JSON.stringify(payload2, null, 2));
        }
        return;
      }
      const state = await entityStateManager7.getState();
      const cfgPath = configManager.getConfigPath();
      const payload = {
        entityState: state,
        configPath: cfgPath,
        containers
      };
      if (getGlobalCliFlags5().json) {
        outputJson3(payload);
      } else {
        console.log(JSON.stringify(payload, null, 2));
        printInfo(`Config file: ${colors.muted(cfgPath)}`);
      }
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });
}

// src/commands/manage/config-cmd.ts
import { readFile } from "fs/promises";
import { configManager as configManager2 } from "@eve/dna";
import { getGlobalCliFlags as getGlobalCliFlags6, outputJson as outputJson4 } from "@eve/cli-kit";
function configCommands(program2) {
  const cfg = program2.command("config").description("Eve YAML config (~/.config/eve/config.yaml)");
  cfg.command("path").description("Print path to config file").action(() => {
    console.log(configManager2.getConfigPath());
  });
  cfg.command("show").description("Load and print config (JSON)").action(async () => {
    try {
      const c = await configManager2.loadConfig();
      const plain = {
        ...c,
        createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
        updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt
      };
      if (getGlobalCliFlags6().json) {
        outputJson4(plain);
      } else {
        console.log(JSON.stringify(plain, null, 2));
      }
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
  cfg.command("dump").description("Print raw YAML file contents").action(async () => {
    try {
      const p = configManager2.getConfigPath();
      const raw = await readFile(p, "utf-8");
      console.log(raw);
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
  cfg.command("set-entity-name").description("Set entity display name in config").argument("<name>", "New entity name").action(async (name) => {
    try {
      await configManager2.updateConfig({ name });
      printInfo(`Updated entity name to ${colors.primary(name)}`);
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
}

// src/commands/manage/backup-update.ts
import { execa as execa8 } from "execa";
import { execSync as execSync4, spawnSync } from "child_process";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { existsSync as existsSync4 } from "fs";
import { join as join4 } from "path";
import { getGlobalCliFlags as getGlobalCliFlags7 } from "@eve/cli-kit";
function getSynapBackendContainer() {
  try {
    const out = execSync4(
      'docker ps --filter "label=com.docker.compose.project=synap-backend" --filter "label=com.docker.compose.service=backend" --format "{{.Names}}"',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim();
    return out.split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
}
function connectToEveNetwork(name) {
  try {
    execSync4(`docker network connect eve-network ${name}`, { stdio: ["pipe", "pipe", "ignore"] });
  } catch {
  }
}
function buildUpdateTargets(deployDir) {
  const targets = [];
  if (deployDir) {
    targets.push({
      id: "synap",
      label: "\u{1F9E0} Synap Data Pod",
      update: async () => {
        const env = { ...process.env, COMPOSE_PROJECT_NAME: "synap-backend" };
        await execa8("docker", ["compose", "pull", "backend", "backend-migrate", "realtime", "--ignore-pull-failures"], { cwd: deployDir, env, stdio: "inherit" });
        await execa8("docker", ["compose", "run", "--rm", "backend-migrate"], { cwd: deployDir, env, stdio: "inherit" });
        await execa8("docker", ["compose", "up", "-d", "--no-deps", "backend", "realtime"], { cwd: deployDir, env, stdio: "inherit" });
        const name = getSynapBackendContainer();
        if (name) connectToEveNetwork(name);
      }
    });
  }
  targets.push({
    id: "ollama",
    label: "\u{1F916} Ollama",
    update: async () => {
      spawnSync("docker", ["pull", "ollama/ollama:latest"], { stdio: "inherit" });
      spawnSync("docker", ["restart", "eve-brain-ollama"], { stdio: "inherit" });
    }
  });
  targets.push({
    id: "openclaw",
    label: "\u{1F9BE} OpenClaw",
    update: async () => {
      spawnSync("docker", ["pull", "ghcr.io/openclaw/openclaw:latest"], { stdio: "inherit" });
      spawnSync("docker", ["restart", "eve-arms-openclaw"], { stdio: "inherit" });
    }
  });
  targets.push({
    id: "rsshub",
    label: "\u{1F441}\uFE0F  RSSHub",
    update: async () => {
      spawnSync("docker", ["pull", "diygod/rsshub:latest"], { stdio: "inherit" });
      spawnSync("docker", ["restart", "eve-eyes-rsshub"], { stdio: "inherit" });
    }
  });
  targets.push({
    id: "traefik",
    label: "\u{1F9BF} Traefik",
    update: async () => {
      spawnSync("docker", ["pull", "traefik:v3.0"], { stdio: "inherit" });
      spawnSync("docker", ["restart", "eve-legs-traefik"], { stdio: "inherit" });
      const name = getSynapBackendContainer();
      if (name) connectToEveNetwork(name);
    }
  });
  targets.push({
    id: "openwebui",
    label: "\u{1F4AC} Open WebUI",
    update: async () => {
      spawnSync("docker", ["pull", "ghcr.io/open-webui/open-webui:main"], { stdio: "inherit" });
      spawnSync("docker", ["restart", "hestia-openwebui"], { stdio: "inherit" });
    }
  });
  return targets;
}
async function confirmDestructiveReset() {
  const flags = getGlobalCliFlags7();
  if (flags.nonInteractive) return true;
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Type 'recreate' to continue: ");
    return answer.trim() === "recreate";
  } finally {
    rl.close();
  }
}
function backupUpdateCommands(program2) {
  program2.command("backup").description("List Eve-related Docker volumes (full backup: stop stack + docker run volume export \u2014 see docs)").action(async () => {
    try {
      const { stdout } = await execa8("docker", ["volume", "ls", "--format", "{{.Name}}"]);
      const vols = stdout.split("\n").filter((n) => n.includes("eve") || n.includes("ollama") || n.includes("synap") || n.includes("openwebui"));
      if (vols.length === 0) {
        printInfo("No matching volumes found. Create the stack with eve brain init first.");
        return;
      }
      console.log(colors.primary.bold("Docker volumes (candidates for backup):\n"));
      for (const v of vols) {
        console.log(`  ${v}`);
      }
      printInfo("\nTip: align volume backups with your synap-backend deploy backup process when on production.");
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
  program2.command("update").description("Pull latest images and restart all Eve organs (Synap, Ollama, OpenClaw, RSSHub, Traefik, Open WebUI)").option("--only <organs>", "Comma-separated organs to update, e.g. synap,ollama").option("--skip <organs>", "Comma-separated organs to skip, e.g. traefik").action(async (opts) => {
    const deployDirs = ["/opt/synap-backend", process.env.SYNAP_DEPLOY_DIR].filter(Boolean);
    const deployDir = deployDirs.find((d) => existsSync4(join4(d, "docker-compose.yml")));
    const targets = buildUpdateTargets(deployDir);
    const only = opts.only ? new Set(opts.only.split(",").map((s) => s.trim())) : null;
    const skip = opts.skip ? new Set(opts.skip.split(",").map((s) => s.trim())) : /* @__PURE__ */ new Set();
    const toUpdate = targets.filter(
      (t) => (!only || only.has(t.id)) && !skip.has(t.id)
    );
    console.log();
    console.log(colors.primary.bold("Eve Update"));
    console.log(colors.muted("\u2500".repeat(50)));
    const results = [];
    for (const target of toUpdate) {
      const spinner = createSpinner(`Updating ${target.label}...`);
      spinner.start();
      try {
        await target.update();
        spinner.succeed(`${target.label} updated`);
        results.push({ label: target.label, ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        spinner.warn(`${target.label} \u2014 skipped (${msg.split("\n")[0]})`);
        results.push({ label: target.label, ok: false, msg });
      }
    }
    console.log();
    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      printSuccess("All organs updated.");
    } else {
      printWarning(`${results.filter((r) => r.ok).length}/${results.length} updated. Skipped:`);
      for (const f of failed) {
        console.log(`  ${colors.muted("\u2192")} ${f.label}: ${colors.muted(f.msg?.split("\n")[0] ?? "")}`);
      }
    }
    console.log();
  });
  program2.command("recreate").description("Full cleanup + full recreation (remove stale Docker data and rebuild stack)").option("--no-prune", "Skip docker system prune").action(async (opts) => {
    try {
      console.log(colors.error.bold("\n\u26A0\uFE0F  Dangerous operation: full cleanup + recreation\n"));
      console.log("This command will:");
      console.log("  - stop and remove all compose resources in the current directory");
      console.log("  - remove project volumes (data loss)");
      if (opts.prune !== false) {
        console.log("  - prune stale Docker containers/images/volumes/networks");
      }
      console.log("");
      const confirmed = await confirmDestructiveReset();
      if (!confirmed) {
        printInfo("Cancelled.");
        return;
      }
      printInfo("Stopping stack and removing compose resources...");
      await execa8("docker", ["compose", "down", "--volumes", "--remove-orphans"], { stdio: "inherit" });
      if (opts.prune !== false) {
        printInfo("Pruning stale Docker resources...");
        await execa8("docker", ["system", "prune", "-a", "-f", "--volumes"], { stdio: "inherit" });
      }
      printInfo("Recreating stack...");
      await execa8("docker", ["compose", "up", "-d"], { stdio: "inherit" });
      printInfo("Done. Stack recreated from clean state.");
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
}

// src/commands/manage/purge.ts
import { execSync as execSync5 } from "child_process";
import { existsSync as existsSync5, rmSync } from "fs";
import { homedir as homedir2 } from "os";
import { join as join5 } from "path";
import { createInterface as createInterface2 } from "readline/promises";
import { stdin as input2, stdout as output2 } from "process";
import { execa as execa9 } from "execa";
import { getGlobalCliFlags as getGlobalCliFlags8 } from "@eve/cli-kit";
var CONTAINER_PREFIXES = [
  "eve-brain-",
  "eve-arms-",
  "eve-eyes-",
  "eve-legs-",
  "eve-builder-",
  "hestia-",
  "synap-backend-"
];
var VOLUME_PATTERNS = ["eve", "synap", "ollama", "openwebui", "librechat"];
var NETWORKS = ["eve-network", "hestia-network"];
var DEPLOY_DIRS = [
  "/opt/synap-backend",
  "/opt/openwebui",
  "/opt/librechat"
];
function listEveContainers() {
  try {
    const out = execSync5('docker ps -a --format "{{.Names}}"', {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"]
    }).trim();
    return out.split("\n").map((n) => n.trim()).filter((n) => n && CONTAINER_PREFIXES.some((prefix) => n.startsWith(prefix)));
  } catch {
    return [];
  }
}
function listEveVolumes() {
  try {
    const out = execSync5('docker volume ls --format "{{.Name}}"', {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"]
    }).trim();
    return out.split("\n").map((n) => n.trim()).filter((n) => n && VOLUME_PATTERNS.some((p) => n.includes(p)));
  } catch {
    return [];
  }
}
function listEveNetworks() {
  try {
    const out = execSync5('docker network ls --format "{{.Name}}"', {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"]
    }).trim();
    return out.split("\n").map((n) => n.trim()).filter((n) => NETWORKS.includes(n));
  } catch {
    return [];
  }
}
async function confirmPhrase(phrase) {
  const flags = getGlobalCliFlags8();
  if (flags.nonInteractive) return true;
  const rl = createInterface2({ input: input2, output: output2 });
  try {
    const answer = await rl.question(`  Type "${phrase}" to confirm: `);
    return answer.trim() === phrase;
  } finally {
    rl.close();
  }
}
async function runPurge(opts = {}) {
  const flags = getGlobalCliFlags8();
  const nonInteractive = Boolean(flags.nonInteractive) || Boolean(opts.yes);
  const containers = listEveContainers();
  const volumes = listEveVolumes();
  const networks = listEveNetworks();
  const stateDir = join5(homedir2(), ".local", "share", "eve");
  const skillsDir = join5(homedir2(), ".eve");
  const deployDirs = DEPLOY_DIRS.filter((d) => existsSync5(d));
  const eveDir = opts.eveDir ?? "/opt/eve";
  console.log();
  console.log(colors.error.bold("\u26A0\uFE0F  Eve Purge \u2014 complete wipe"));
  console.log(colors.muted("\u2500".repeat(50)));
  console.log();
  if (containers.length > 0) {
    console.log(colors.primary.bold(`Containers (${containers.length}):`));
    for (const c of containers) console.log(`  ${colors.muted("\u2022")} ${c}`);
    console.log();
  }
  if (volumes.length > 0) {
    console.log(colors.primary.bold(`Volumes (${volumes.length}):`));
    for (const v of volumes) console.log(`  ${colors.muted("\u2022")} ${v}`);
    console.log();
  }
  if (networks.length > 0) {
    console.log(colors.primary.bold(`Networks (${networks.length}):`));
    for (const n of networks) console.log(`  ${colors.muted("\u2022")} ${n}`);
    console.log();
  }
  const statePaths = [];
  if (existsSync5(stateDir)) statePaths.push(stateDir);
  if (existsSync5(skillsDir)) statePaths.push(skillsDir);
  if (statePaths.length > 0) {
    console.log(colors.primary.bold("State & config files:"));
    for (const p of statePaths) console.log(`  ${colors.muted("\u2022")} ${p}`);
    console.log();
  }
  if (deployDirs.length > 0) {
    console.log(colors.primary.bold("Deploy directories:"));
    for (const d of deployDirs) console.log(`  ${colors.muted("\u2022")} ${d}`);
    console.log();
  }
  if (opts.images) {
    console.log(colors.primary.bold("Docker images:"));
    console.log(`  ${colors.muted("\u2022")} All unused images (docker system prune -a)`);
    console.log();
  }
  if (opts.self && existsSync5(eveDir)) {
    console.log(colors.primary.bold("Eve CLI installation:"));
    console.log(`  ${colors.muted("\u2022")} ${eveDir}`);
    console.log();
  }
  const nothingToDo = containers.length === 0 && volumes.length === 0 && networks.length === 0 && statePaths.length === 0 && deployDirs.length === 0 && !opts.images && !(opts.self && existsSync5(eveDir));
  if (nothingToDo) {
    printInfo("Nothing to purge \u2014 environment looks clean.");
    return;
  }
  if (!nonInteractive) {
    console.log(colors.warning("This operation is irreversible. All data in the listed volumes will be lost."));
    console.log();
    const confirmed = await confirmPhrase("purge");
    if (!confirmed) {
      printInfo("Cancelled.");
      return;
    }
    console.log();
  }
  if (containers.length > 0) {
    const s = createSpinner(`Removing ${containers.length} container(s)...`);
    s.start();
    try {
      await execa9("docker", ["rm", "-f", ...containers], { stdio: "pipe" });
      s.succeed(`Removed ${containers.length} container(s)`);
    } catch (err) {
      s.warn(`Some containers could not be removed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
  }
  const synapDeployDir = ["/opt/synap-backend/deploy", process.env.SYNAP_DEPLOY_DIR].filter(Boolean).find((d) => d && existsSync5(join5(d, "docker-compose.yml")));
  if (synapDeployDir) {
    const s = createSpinner("Tearing down Synap backend compose stack...");
    s.start();
    try {
      await execa9("docker", ["compose", "down", "--volumes", "--remove-orphans"], {
        cwd: synapDeployDir,
        stdio: "pipe"
      });
      s.succeed("Synap compose stack removed");
    } catch {
      s.warn("Synap compose down failed (stack may already be down)");
    }
  }
  const freshVolumes = listEveVolumes();
  if (freshVolumes.length > 0) {
    const s = createSpinner(`Removing ${freshVolumes.length} volume(s)...`);
    s.start();
    const failed = [];
    for (const vol of freshVolumes) {
      try {
        await execa9("docker", ["volume", "rm", vol], { stdio: "pipe" });
      } catch {
        failed.push(vol);
      }
    }
    if (failed.length === 0) {
      s.succeed(`Removed ${freshVolumes.length} volume(s)`);
    } else {
      s.warn(`Removed ${freshVolumes.length - failed.length}/${freshVolumes.length} volumes. In use: ${failed.join(", ")}`);
    }
  }
  const freshNetworks = listEveNetworks();
  if (freshNetworks.length > 0) {
    const s = createSpinner("Removing Docker networks...");
    s.start();
    const failed = [];
    for (const net of freshNetworks) {
      try {
        await execa9("docker", ["network", "rm", net], { stdio: "pipe" });
      } catch {
        failed.push(net);
      }
    }
    if (failed.length === 0) {
      s.succeed(`Removed networks: ${freshNetworks.join(", ")}`);
    } else {
      s.warn(`Could not remove: ${failed.join(", ")} (containers still attached?)`);
    }
  }
  if (existsSync5(stateDir)) {
    const s = createSpinner("Removing Eve state files...");
    s.start();
    try {
      rmSync(stateDir, { recursive: true, force: true });
      s.succeed(`Removed ${stateDir}`);
    } catch (err) {
      s.warn(`Could not remove ${stateDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (existsSync5(skillsDir)) {
    const s = createSpinner("Removing Eve skills & config (~/.eve)...");
    s.start();
    try {
      rmSync(skillsDir, { recursive: true, force: true });
      s.succeed(`Removed ${skillsDir}`);
    } catch (err) {
      s.warn(`Could not remove ${skillsDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const dir of deployDirs) {
    const s = createSpinner(`Removing ${dir}...`);
    s.start();
    try {
      rmSync(dir, { recursive: true, force: true });
      s.succeed(`Removed ${dir}`);
    } catch (err) {
      s.warn(`Could not remove ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (opts.images) {
    const s = createSpinner("Pruning all unused Docker images...");
    s.start();
    try {
      await execa9("docker", ["system", "prune", "-a", "-f", "--volumes"], { stdio: "pipe" });
      s.succeed("Docker system pruned (all unused images removed)");
    } catch (err) {
      s.warn(`docker system prune failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
  }
  if (opts.self && existsSync5(eveDir)) {
    const s = createSpinner(`Removing Eve CLI installation (${eveDir})...`);
    s.start();
    try {
      rmSync(eveDir, { recursive: true, force: true });
      s.succeed(`Removed ${eveDir}`);
    } catch (err) {
      s.warn(`Could not remove ${eveDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log();
  printSuccess("Purge complete. Your server is clean.");
  console.log();
  if (!opts.self) {
    printInfo("Eve CLI is still installed. To reinstall from scratch:");
    printInfo("  eve install");
    console.log();
  }
}
function purgeCommand(program2) {
  program2.command("purge").description("Remove all Eve containers, volumes, networks, and state \u2014 clean slate for reinstall").option("--images", "Also remove all unused Docker images (docker system prune -a)").option("--self", "Also remove the Eve CLI installation directory (/opt/eve)").option("--eve-dir <path>", "Eve install directory (default: /opt/eve, only with --self)").addHelpText("after", `
Examples:
  eve purge                  # Remove containers, volumes, networks, state files
  eve purge --images         # Also wipe all Docker image cache
  eve purge --self           # Also remove /opt/eve (use when decommissioning the server)
  eve --yes purge            # Non-interactive (skip confirmation prompt)

What is NOT removed by default:
  /opt/eve                   # Eve CLI itself (use --self to include)
  Docker images              # Pulled images stay cached (use --images to wipe)
  Other Docker resources     # Only resources matching Eve naming patterns are removed
`).action(async (opts) => {
    try {
      await runPurge(opts);
    } catch (err) {
      printError(`Purge failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
}

// src/commands/ai.ts
import { execa as execa10 } from "execa";
import { OllamaService } from "@eve/brain";
import { getGlobalCliFlags as getGlobalCliFlags9, outputJson as outputJson5 } from "@eve/cli-kit";
import {
  readEveSecrets as readEveSecrets5,
  writeEveSecrets as writeEveSecrets4,
  entityStateManager as entityStateManager8,
  wireAllInstalledComponents as wireAllInstalledComponents2
} from "@eve/dna";
function resolveHubBaseUrlFromSecrets(secrets) {
  const explicit = secrets?.synap?.hubBaseUrl?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const api = secrets?.synap?.apiUrl?.trim();
  if (!api) return null;
  return `${api.replace(/\/$/, "")}/api/hub`;
}
function buildNonSecretProviderRouting(secrets) {
  const providers = (secrets?.ai?.providers ?? []).map((p) => ({
    id: p.id,
    enabled: p.enabled,
    baseUrl: p.baseUrl,
    defaultModel: p.defaultModel
  }));
  return {
    mode: secrets?.ai?.mode,
    defaultProvider: secrets?.ai?.defaultProvider,
    fallbackProvider: secrets?.ai?.fallbackProvider,
    providers,
    syncToSynap: secrets?.ai?.syncToSynap
  };
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== void 0).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function parseProviderId(s) {
  const v = s.trim().toLowerCase();
  if (v === "ollama" || v === "openrouter" || v === "anthropic" || v === "openai") return v;
  throw new Error("Provider must be one of: ollama, openrouter, anthropic, openai");
}
async function applyAiWiring() {
  const secrets = await readEveSecrets5(process.cwd());
  let installed = [];
  try {
    installed = await entityStateManager8.getInstalledComponents();
  } catch {
  }
  if (installed.length === 0) {
    printWarning("No installed components \u2014 nothing to wire.");
    return [];
  }
  console.log();
  console.log(colors.primary.bold("Wiring AI provider into installed components:"));
  const results = wireAllInstalledComponents2(secrets, installed);
  for (const r of results) {
    if (r.outcome === "ok") {
      console.log(`  ${colors.success("\u2713")} ${r.id.padEnd(12)} ${colors.muted(r.summary)}`);
    } else if (r.outcome === "skipped") {
      console.log(`  ${colors.muted("-")} ${r.id.padEnd(12)} ${colors.muted(r.summary)}`);
    } else {
      console.log(`  ${colors.error("\u2717")} ${r.id.padEnd(12)} ${colors.error(r.summary)}`);
      if (r.detail) console.log(`    ${colors.muted(r.detail)}`);
    }
  }
  return results;
}
function aiCommandGroup(program2) {
  const ai = program2.command("ai").description("AI foundation helpers (local Ollama + provider routing)");
  ai.command("status").description("Show AI foundation mode, provider routing, and Ollama status").action(async () => {
    const ollama = new OllamaService();
    try {
      const s = await ollama.getStatus();
      const secrets = await readEveSecrets5(process.cwd());
      const out = {
        ai: secrets?.ai ?? null,
        ollama: s
      };
      if (getGlobalCliFlags9().json) {
        outputJson5(out);
        return;
      }
      console.log(colors.primary.bold("AI Foundation"));
      console.log(`  Mode: ${secrets?.ai?.mode ?? "(unset)"}`);
      console.log(`  Default provider: ${secrets?.ai?.defaultProvider ?? "(unset)"}`);
      console.log(`  Fallback provider: ${secrets?.ai?.fallbackProvider ?? "(unset)"}`);
      const providers2 = secrets?.ai?.providers ?? [];
      if (providers2.length) {
        console.log("  Providers:");
        for (const p of providers2) {
          console.log(`    - ${p.id} enabled=${p.enabled ?? true} model=${p.defaultModel ?? "(unset)"}`);
        }
      }
      console.log("");
      console.log(colors.primary.bold("Ollama"));
      console.log(`  Running: ${s.running ? "yes" : "no"}`);
      console.log(`  Models: ${s.modelsInstalled.length ? s.modelsInstalled.join(", ") : "(none)"}`);
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
  const providers = ai.command("providers").description("Manage cloud/local provider entries in .eve/secrets/secrets.json");
  providers.command("list").description("List configured providers").action(async () => {
    const secrets = await readEveSecrets5(process.cwd());
    const list = secrets?.ai?.providers ?? [];
    if (getGlobalCliFlags9().json) {
      outputJson5({ mode: secrets?.ai?.mode, defaultProvider: secrets?.ai?.defaultProvider, fallbackProvider: secrets?.ai?.fallbackProvider, providers: list });
      return;
    }
    if (!list.length) {
      console.log("No providers configured. Run `eve setup` or `eve ai providers add <id>`");
      return;
    }
    for (const p of list) {
      console.log(`${p.id}	enabled=${p.enabled ?? true}	model=${p.defaultModel ?? "(unset)"}`);
    }
  });
  const DEFAULT_MODELS = {
    anthropic: "claude-sonnet-4-7",
    openai: "gpt-5",
    openrouter: "anthropic/claude-sonnet-4-7",
    // OpenRouter requires a model — this is just a starter
    ollama: "llama3.1:8b"
  };
  providers.command("add <id>").description("Add or update provider credentials/model \u2014 auto-wires every installed component").option("--api-key <key>", "Provider API key (required for cloud providers)").option("--base-url <url>", "Custom provider base URL").option("--model <name>", "Default model (required for openrouter; defaults to the latest for other providers)").option("--disable", "Set enabled=false").option("--no-rewire", "Don't auto-rewire installed components after save").action(async (id, opts) => {
    try {
      const pid = parseProviderId(id);
      const secrets = await readEveSecrets5(process.cwd());
      const list = [...secrets?.ai?.providers ?? []];
      const idx = list.findIndex((p) => p.id === pid);
      const resolvedModel = opts.model ?? list[idx]?.defaultModel ?? DEFAULT_MODELS[pid];
      if (pid === "openrouter" && !opts.model && !list[idx]?.defaultModel) {
        printWarning(`OpenRouter has no useful default \u2014 using "${resolvedModel}" as a starter.`);
        printInfo("  Override with: --model <provider>/<model> (e.g. --model openai/gpt-5)");
      }
      const next = {
        id: pid,
        enabled: opts.disable ? false : true,
        apiKey: opts.apiKey ?? list[idx]?.apiKey,
        baseUrl: opts.baseUrl ?? list[idx]?.baseUrl,
        defaultModel: resolvedModel
      };
      if (idx >= 0) list[idx] = next;
      else list.push(next);
      await writeEveSecrets4({ ai: { providers: list } }, process.cwd());
      printSuccess(`Provider ${pid} saved (model: ${resolvedModel}).`);
      if (opts.rewire !== false) {
        await applyAiWiring();
      } else {
        printInfo("Run `eve ai apply` to push the new key to installed components.");
      }
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
  providers.command("set-default <id>").description("Set default provider").action(async (id) => {
    try {
      const pid = parseProviderId(id);
      await writeEveSecrets4({ ai: { defaultProvider: pid } }, process.cwd());
      printInfo(`Default provider set to ${pid}`);
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
  providers.command("set-fallback <id>").description("Set fallback provider").action(async (id) => {
    try {
      const pid = parseProviderId(id);
      await writeEveSecrets4({ ai: { fallbackProvider: pid } }, process.cwd());
      printInfo(`Fallback provider set to ${pid}`);
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
  ai.command("apply").description("Re-wire every installed component to use the current AI provider config").action(async () => {
    try {
      await applyAiWiring();
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
  ai.command("sync").description("Explicitly sync Eve provider routing policy to Synap workspace settings").requiredOption("--workspace <id>", "Workspace UUID to update").option("--check", "Only compare local policy vs workspace policy; do not write").action(async (opts) => {
    try {
      const secrets = await readEveSecrets5(process.cwd());
      const hubBaseUrl = resolveHubBaseUrlFromSecrets(secrets);
      const apiKey = secrets?.synap?.apiKey?.trim();
      if (!hubBaseUrl) {
        throw new Error("Missing synap.apiUrl/synap.hubBaseUrl in .eve/secrets/secrets.json");
      }
      if (!apiKey) {
        throw new Error("Missing synap.apiKey in .eve/secrets/secrets.json");
      }
      const payload = buildNonSecretProviderRouting(secrets);
      if (opts.check) {
        const getRes = await fetch(
          `${hubBaseUrl}/workspaces/${encodeURIComponent(opts.workspace)}/eve-provider-routing`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${apiKey}`
            }
          }
        );
        const getData = await getRes.json().catch(() => ({}));
        if (!getRes.ok) {
          throw new Error(String(getData.error ?? `Check failed with HTTP ${getRes.status}`));
        }
        const remote = getData.eveProviderRouting ?? null;
        const same = stableJson(remote) === stableJson(payload);
        if (getGlobalCliFlags9().json) {
          outputJson5({ ok: true, workspaceId: opts.workspace, same, local: payload, remote });
          return;
        }
        if (same) {
          printInfo(`Provider routing already in sync for workspace ${opts.workspace}`);
        } else {
          printInfo(`Provider routing differs for workspace ${opts.workspace}`);
        }
        return;
      }
      const res = await fetch(
        `${hubBaseUrl}/workspaces/${encodeURIComponent(opts.workspace)}/eve-provider-routing`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(data.error ?? `Sync failed with HTTP ${res.status}`));
      }
      if (getGlobalCliFlags9().json) {
        outputJson5({ ok: true, workspaceId: opts.workspace, synced: payload });
        return;
      }
      printInfo(`Provider routing synced to workspace ${opts.workspace}`);
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
  ai.command("models").description("List models (docker exec ollama list)").action(async () => {
    const ollama = new OllamaService();
    const models = await ollama.listModels();
    if (getGlobalCliFlags9().json) {
      outputJson5({ models });
      return;
    }
    for (const m of models) {
      console.log(`  ${m}`);
    }
    if (models.length === 0) {
      printInfo("No models or Ollama not running. Try: eve brain init --with-ai");
    }
  });
  ai.command("pull").description("Pull a model into Ollama").argument("<model>", "Model tag e.g. llama3.1:8b").action(async (model) => {
    const ollama = new OllamaService();
    try {
      await ollama.pullModel(model);
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
  ai.command("chat").description("Send a one-shot prompt to ollama run (requires container eve-brain-ollama)").argument("<prompt>", "Prompt text").option("--model <m>", "Model name", "llama3.1:8b").action(async (prompt, opts) => {
    try {
      await execa10(
        "docker",
        ["exec", "-i", "eve-brain-ollama", "ollama", "run", opts.model ?? "llama3.1:8b", prompt],
        { stdio: "inherit" }
      );
    } catch (e) {
      printError(
        e instanceof Error ? e.message : "Failed. Ensure container eve-brain-ollama is running (eve brain init --with-ai)."
      );
      process.exit(1);
    }
  });
}

// src/commands/ui.ts
import { randomBytes } from "crypto";
import { existsSync as existsSync6, writeFileSync } from "fs";
import { join as join6 } from "path";
import { fileURLToPath } from "url";
import { execa as execa11, execaSync } from "execa";
import { readEveSecrets as readEveSecrets6, writeEveSecrets as writeEveSecrets5 } from "@eve/dna";
var __filename = fileURLToPath(import.meta.url);
var packagesDir = join6(__filename, "..", "..", "..");
var SERVICE_NAME = "eve-dashboard.service";
var SERVICE_PATH = `/etc/systemd/system/${SERVICE_NAME}`;
function dashboardDir() {
  return join6(packagesDir, "eve-dashboard");
}
function hasSystemd() {
  try {
    execaSync("systemctl", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function buildSystemdUnit(port, secret, dir) {
  return `[Unit]
Description=Eve Dashboard
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
WorkingDirectory=${dir}
Environment=PORT=${port}
Environment=EVE_DASHBOARD_SECRET=${secret}
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/root/.local/share/pnpm
ExecStart=/usr/bin/env pnpm start --port ${port}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}
async function installSystemdService(port) {
  if (process.platform !== "linux") {
    printError("--install-service is Linux-only (requires systemd).");
    process.exit(1);
  }
  if (!hasSystemd()) {
    printError("systemctl not found. Is systemd available on this host?");
    process.exit(1);
  }
  if (process.getuid && process.getuid() !== 0) {
    printError("--install-service must be run as root (writes /etc/systemd/system/).");
    printInfo("Try: sudo eve ui --install-service");
    process.exit(1);
  }
  const dir = dashboardDir();
  if (!existsSync6(join6(dir, ".next"))) {
    const spinner = createSpinner("Building dashboard before installing service...");
    spinner.start();
    try {
      await execa11("pnpm", ["build"], { cwd: dir, env: { ...process.env } });
      spinner.succeed("Dashboard built");
    } catch (err) {
      spinner.fail("Dashboard build failed");
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
  let secrets = await readEveSecrets6(process.cwd());
  if (!secrets?.dashboard?.secret) {
    const secret = randomBytes(32).toString("hex");
    await writeEveSecrets5({ dashboard: { secret, port } });
    secrets = await readEveSecrets6(process.cwd());
    console.log();
    console.log(colors.primary.bold("Dashboard key generated \u2014 save this somewhere safe:"));
    console.log(colors.muted("\u2500".repeat(66)));
    console.log(colors.primary.bold(secret));
    console.log(colors.muted("\u2500".repeat(66)));
  }
  const dashboardSecret = secrets?.dashboard?.secret ?? "";
  const unit = buildSystemdUnit(port, dashboardSecret, dir);
  console.log();
  printInfo(`Writing ${SERVICE_PATH}...`);
  writeFileSync(SERVICE_PATH, unit, { mode: 420 });
  printInfo("Reloading systemd...");
  await execa11("systemctl", ["daemon-reload"], { stdio: "inherit" });
  printInfo("Enabling and starting eve-dashboard service...");
  await execa11("systemctl", ["enable", "--now", SERVICE_NAME], { stdio: "inherit" });
  await new Promise((r) => setTimeout(r, 2e3));
  const statusResult = execaSync("systemctl", ["is-active", SERVICE_NAME], { reject: false });
  const isActive = statusResult.stdout?.trim() === "active";
  console.log();
  if (isActive) {
    printSuccess(`Eve Dashboard is now running as a systemd service.`);
    printInfo(`  Status:  systemctl status ${SERVICE_NAME}`);
    printInfo(`  Logs:    journalctl -u ${SERVICE_NAME} -f`);
    printInfo(`  Stop:    systemctl stop ${SERVICE_NAME}`);
    printInfo(`  Remove:  eve ui --uninstall-service`);
  } else {
    printError(`Service installed but not active. Check: systemctl status ${SERVICE_NAME}`);
  }
  console.log();
}
async function uninstallSystemdService() {
  if (process.platform !== "linux") {
    printError("--uninstall-service is Linux-only.");
    process.exit(1);
  }
  if (process.getuid && process.getuid() !== 0) {
    printError("--uninstall-service must be run as root.");
    printInfo("Try: sudo eve ui --uninstall-service");
    process.exit(1);
  }
  console.log();
  printInfo("Stopping and disabling eve-dashboard service...");
  try {
    await execa11("systemctl", ["stop", SERVICE_NAME], { stdio: "inherit" });
  } catch {
  }
  try {
    await execa11("systemctl", ["disable", SERVICE_NAME], { stdio: "inherit" });
  } catch {
  }
  if (existsSync6(SERVICE_PATH)) {
    const { unlinkSync: unlinkSync2 } = await import("fs");
    unlinkSync2(SERVICE_PATH);
    printInfo(`Removed ${SERVICE_PATH}`);
  }
  await execa11("systemctl", ["daemon-reload"], { stdio: "inherit" });
  console.log();
  printSuccess("Eve Dashboard service uninstalled.");
  console.log();
}
async function showServiceStatus() {
  if (process.platform !== "linux") {
    printWarning("Service mode is Linux-only \u2014 `eve ui` runs in foreground on this OS.");
    return;
  }
  console.log();
  if (!existsSync6(SERVICE_PATH)) {
    printInfo("Eve Dashboard service is NOT installed.");
    printInfo("  Install with: sudo eve ui --install-service");
    return;
  }
  await execa11("systemctl", ["status", SERVICE_NAME, "--no-pager", "-l"], { stdio: "inherit", reject: false });
}
function uiCommand(program2) {
  program2.command("ui").description("Open the Eve web dashboard (or install it as a systemd service)").option("--port <port>", "Dashboard port", "7979").option("--no-open", "Do not open browser automatically").option("--rebuild", "Force rebuild of the dashboard before starting").option("--install-service", "Install + enable a systemd service so the dashboard auto-starts on boot (Linux, root)").option("--uninstall-service", "Stop, disable, and remove the systemd service").option("--service-status", "Show systemd service status").action(async (opts) => {
    const port = parseInt(opts.port, 10);
    if (opts.installService) return installSystemdService(port);
    if (opts.uninstallService) return uninstallSystemdService();
    if (opts.serviceStatus) return showServiceStatus();
    const dir = dashboardDir();
    let secrets = await readEveSecrets6(process.cwd());
    if (!secrets?.dashboard?.secret) {
      const secret = randomBytes(32).toString("hex");
      await writeEveSecrets5({ dashboard: { secret, port } });
      secrets = await readEveSecrets6(process.cwd());
      console.log();
      console.log(colors.primary.bold("Dashboard key generated \u2014 save this somewhere safe:"));
      console.log(colors.muted("\u2500".repeat(66)));
      console.log(colors.primary.bold(secret));
      console.log(colors.muted("\u2500".repeat(66)));
      console.log(colors.muted("You will be prompted for this key when you open the dashboard."));
    } else {
      console.log();
      console.log(colors.muted("Your dashboard key:"));
      console.log(colors.primary.bold(secrets.dashboard.secret));
    }
    if (process.platform === "linux" && existsSync6(SERVICE_PATH)) {
      try {
        const r = execaSync("systemctl", ["is-active", SERVICE_NAME], { reject: false });
        if (r.stdout?.trim() === "active") {
          console.log();
          printWarning(`A systemd Eve Dashboard service is already running on port ${port}.`);
          printInfo(`  \u2022 View it:   open http://localhost:${port}`);
          printInfo(`  \u2022 Status:    eve ui --service-status`);
          printInfo(`  \u2022 Stop it:   sudo systemctl stop ${SERVICE_NAME}`);
          console.log();
          return;
        }
      } catch {
      }
    }
    const nextDir = join6(dir, ".next");
    if (opts.rebuild || !existsSync6(nextDir)) {
      console.log();
      const spinner = createSpinner("Building dashboard (first run \u2014 takes ~30s)...");
      spinner.start();
      try {
        await execa11("pnpm", ["build"], { cwd: dir, env: { ...process.env } });
        spinner.succeed("Dashboard built");
      } catch (err) {
        spinner.fail("Dashboard build failed");
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }
    const url = `http://localhost:${port}`;
    console.log();
    console.log(`${emojis.entity}  Starting Eve Dashboard \u2192 ${colors.primary(url)}`);
    console.log();
    if (process.platform === "linux") {
      printInfo("Tip: install as a systemd service so it auto-starts on boot:");
      printInfo("  sudo eve ui --install-service");
      console.log();
    }
    if (opts.open) {
      setTimeout(() => {
        const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        execa11(opener, [url]).catch(() => {
        });
      }, 2500);
    }
    const finalSecrets = await readEveSecrets6(process.cwd());
    await execa11("pnpm", ["start", "--port", String(port)], {
      cwd: dir,
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(port),
        EVE_DASHBOARD_SECRET: finalSecrets?.dashboard?.secret ?? ""
      }
    });
  });
}

// src/commands/domain.ts
import { execSync as execSync6 } from "child_process";
import { existsSync as existsSync7, readdirSync, unlinkSync } from "fs";
import { join as join7 } from "path";
import { writeEveSecrets as writeEveSecrets6, readEveSecrets as readEveSecrets7, getAccessUrls as getAccessUrls2, getServerIp as getServerIp3, entityStateManager as entityStateManager9 } from "@eve/dna";
import { TraefikService as TraefikService2 } from "@eve/legs";
function renderProbeTable(probes) {
  console.log(colors.muted("  " + "\u2500".repeat(60)));
  for (const p of probes) {
    const dot = p.outcome === "ok" ? colors.success("\u25CF") : p.outcome === "upstream-down" ? colors.warning("\u25CF") : colors.error("\u25CF");
    const status = p.outcome === "ok" ? colors.success(`${p.httpStatus} reachable`) : p.outcome === "upstream-down" ? colors.warning(`${p.httpStatus} upstream down`) : p.outcome === "not-routing" ? colors.error(`${p.httpStatus} no route match`) : p.outcome === "dns-missing" ? colors.error("DNS missing") : p.outcome === "dns-wrong" ? colors.warning(`DNS \u2192 ${p.dnsResolved}`) : colors.error("timeout");
    console.log(`  ${dot} ${p.host.padEnd(34)} ${status}`);
  }
}
function renderProbeHint(p) {
  switch (p.outcome) {
    case "dns-missing":
      printInfo(`  \u2022 ${p.host}: create A record pointing to your server IP`);
      break;
    case "dns-wrong":
      printInfo(`  \u2022 ${p.host}: DNS resolves to ${p.dnsResolved}; update A record to your server IP`);
      break;
    case "upstream-down":
      printInfo(`  \u2022 ${p.host}: route exists but upstream is down \u2014 check the container is running`);
      break;
    case "not-routing":
      printInfo(`  \u2022 ${p.host}: Traefik has no rule matching \u2014 try \`eve domain repair\``);
      break;
    case "timeout":
      printInfo(`  \u2022 ${p.host}: request timed out \u2014 check Traefik is running on port 80`);
      break;
    case "ok":
      break;
  }
}
function domainCommand(program2) {
  const domain = program2.command("domain").description("Configure domain access and Traefik routing");
  domain.command("set <domain>").description("Set primary domain and configure Traefik subdomains").option("--ssl", "Enable SSL with Let's Encrypt").option("--email <email>", "Email for Let's Encrypt notifications").action(async (domainName, opts) => {
    if (opts.ssl && !opts.email) {
      printWarning("--ssl requires --email <address> for Let's Encrypt certificate provisioning.");
      printWarning("Example: eve domain set " + domainName + " --ssl --email you@example.com");
      process.exit(1);
    }
    await writeEveSecrets6({ domain: { primary: domainName, ssl: !!opts.ssl, email: opts.email } });
    let installedComponents;
    try {
      installedComponents = await entityStateManager9.getInstalledComponents();
    } catch {
    }
    let writeOk = false;
    try {
      const traefik = new TraefikService2();
      await traefik.configureSubdomains(domainName, !!opts.ssl, opts.email, installedComponents);
      writeOk = true;
    } catch (err) {
      printError(`Could not write Traefik config: ${err instanceof Error ? err.message : String(err)}`);
      printInfo("Run this command on your server (where Docker is available).");
      return;
    }
    const secrets = await readEveSecrets7(process.cwd());
    const urls = getAccessUrls2(secrets, installedComponents);
    const serverIp = getServerIp3();
    const subdomainsNeeded = urls.filter((u) => u.domainUrl).map((u) => u.domainUrl.replace(/^https?:\/\//, "").split("/")[0].replace(`.${domainName}`, ""));
    console.log();
    console.log(colors.primary.bold("DNS records you must create:"));
    console.log(colors.muted("\u2500".repeat(60)));
    console.log(colors.muted("  Type   Name                          Value"));
    for (const sub of subdomainsNeeded) {
      const name = `${sub}.${domainName}`.padEnd(32);
      const value = serverIp ?? colors.warning("<your-server-ip>");
      console.log(`  ${colors.primary("A")}      ${name}${value}`);
    }
    console.log(colors.muted("\u2500".repeat(60)));
    if (!serverIp) printInfo("Could not detect server IP \u2014 replace <your-server-ip> above.");
    if (writeOk) {
      console.log();
      console.log(colors.primary.bold("Verifying routes (probing each subdomain)..."));
      await new Promise((r) => setTimeout(r, 1500));
      const probes = probeRoutes(urls);
      renderProbeTable(probes);
      const verdict = probeVerdict(probes);
      console.log();
      if (verdict === "ok") {
        printSuccess(`Domain configured and all ${probes.length} routes are healthy.`);
      } else if (verdict === "partial") {
        const broken = probes.filter((p) => p.outcome !== "ok");
        printWarning(`Domain configured, but ${broken.length}/${probes.length} routes need attention:`);
        for (const p of broken) renderProbeHint(p);
      } else {
        printError(`Domain configured but no routes are reachable yet.`);
        for (const p of probes) renderProbeHint(p);
      }
      if (opts.ssl) {
        console.log();
        printInfo("SSL certificates will provision automatically once DNS propagates (1\u20135 min).");
      }
    }
    console.log();
  });
  domain.command("show").description("Show all access URLs (local, server IP, domain)").action(async () => {
    const secrets = await readEveSecrets7(process.cwd());
    let installedComponents;
    try {
      installedComponents = await entityStateManager9.getInstalledComponents();
    } catch {
    }
    const urls = getAccessUrls2(secrets, installedComponents);
    const domainSet = !!secrets?.domain?.primary;
    console.log();
    console.log(colors.primary.bold("Eve \u2014 Access URLs"));
    console.log(colors.muted("\u2500".repeat(70)));
    for (const svc of urls) {
      console.log();
      console.log(`  ${svc.emoji}  ${colors.primary.bold(svc.label)}`);
      console.log(`     ${colors.muted("Local:")}    ${svc.localUrl}`);
      if (svc.serverUrl) console.log(`     ${colors.muted("Server:")}   ${svc.serverUrl}`);
      if (svc.domainUrl) console.log(`     ${colors.muted("Domain:")}   ${colors.primary(svc.domainUrl)}`);
    }
    console.log();
    if (!domainSet) {
      console.log(colors.muted("  Tip: run `eve domain set yourdomain.com --ssl` to configure domain access"));
    }
  });
  domain.command("check").description("Verify Traefik is running and routes are reachable").action(async () => {
    const TRAEFIK_CONFIG = "/opt/traefik/traefik.yml";
    const TRAEFIK_DYNAMIC = "/opt/traefik/dynamic/eve-routes.yml";
    console.log();
    console.log(colors.primary.bold("Eve \u2014 Domain / Traefik diagnostic"));
    console.log(colors.muted("\u2500".repeat(60)));
    console.log();
    const tick = colors.success("\u2713");
    const cross = colors.error("\u2717");
    const warn = colors.warning("!");
    let traefikRunning = false;
    try {
      const out = execSync6('docker ps --filter "name=eve-legs-traefik" --format "{{.Names}}"', {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"]
      }).trim();
      traefikRunning = out.length > 0;
    } catch {
    }
    console.log(traefikRunning ? `  ${tick}  Traefik container:   running (eve-legs-traefik)` : `  ${cross}  Traefik container:   NOT running \u2014 run: eve install --components=traefik`);
    const staticOk = existsSync7(TRAEFIK_CONFIG);
    const dynamicOk = existsSync7(TRAEFIK_DYNAMIC);
    console.log(staticOk ? `  ${tick}  Static config:       ${TRAEFIK_CONFIG}` : `  ${cross}  Static config:       MISSING`);
    console.log(dynamicOk ? `  ${tick}  Dynamic routes:      ${TRAEFIK_DYNAMIC}` : `  ${cross}  Dynamic routes:      MISSING \u2014 run: eve domain set <yourdomain>`);
    if (!traefikRunning || !dynamicOk) {
      console.log();
      printError("Cannot continue diagnostic \u2014 Traefik or routes missing.");
      return;
    }
    const secrets = await readEveSecrets7(process.cwd());
    const configuredDomain = secrets?.domain?.primary;
    console.log(configuredDomain ? `  ${tick}  Configured domain:   ${configuredDomain}` : `  ${warn}  Configured domain:   none \u2014 run: eve domain set <yourdomain>`);
    if (!configuredDomain) {
      console.log();
      printWarning("No domain set \u2014 nothing to verify.");
      return;
    }
    console.log();
    console.log(colors.primary.bold("  Per-route probe (Host header \u2192 Traefik \u2192 upstream):"));
    let installedComponents;
    try {
      installedComponents = await entityStateManager9.getInstalledComponents();
    } catch {
    }
    const urls = getAccessUrls2(secrets, installedComponents);
    const probes = probeRoutes(urls);
    renderProbeTable(probes);
    console.log();
    console.log(colors.primary.bold("  Routers loaded inside Traefik (via admin API :8080):"));
    console.log(colors.muted("  " + "\u2500".repeat(58)));
    let loadedRouters = [];
    try {
      const apiOut = execSync6("curl -s --max-time 3 http://localhost:8080/api/http/routers", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"]
      }).trim();
      if (apiOut) {
        const parsed = JSON.parse(apiOut);
        loadedRouters = parsed.map((r) => ({ name: r.name, rule: r.rule, status: r.status ?? "unknown" }));
      }
    } catch {
    }
    if (loadedRouters.length === 0) {
      console.log(`    ${cross} ${colors.error("NO ROUTERS LOADED!")} Traefik can't see your config file.`);
      console.log();
      console.log(colors.warning("  Likely causes:"));
      console.log(colors.warning("    1. Volume mount broken \u2014 re-create container"));
      console.log(colors.warning("    2. YAML syntax error \u2014 Traefik silently dropped the config"));
      console.log(colors.warning("    3. Static config missing providers.file directive"));
    } else {
      for (const r of loadedRouters) {
        const enabled = r.status === "enabled" ? colors.success("enabled") : colors.error(r.status);
        console.log(`    ${r.name.padEnd(28)} ${enabled}  ${colors.muted(r.rule)}`);
      }
    }
    console.log();
    console.log(colors.primary.bold("  What Traefik container sees (docker exec):"));
    console.log(colors.muted("  " + "\u2500".repeat(58)));
    try {
      const containerStaticHead = execSync6(
        "docker exec eve-legs-traefik cat /etc/traefik/traefik.yml 2>&1 | head -8",
        { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
      ).trim();
      console.log(colors.muted("    /etc/traefik/traefik.yml (first 8 lines):"));
      for (const line of containerStaticHead.split("\n")) {
        console.log(`      ${colors.muted(line)}`);
      }
    } catch {
      console.log(`    ${cross} Could not read static config inside container`);
    }
    try {
      const containerLs = execSync6(
        "docker exec eve-legs-traefik ls -la /etc/traefik/dynamic/ 2>&1",
        { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
      ).trim();
      console.log();
      console.log(colors.muted("    /etc/traefik/dynamic/ (container view):"));
      for (const line of containerLs.split("\n")) {
        console.log(`      ${colors.muted(line)}`);
      }
    } catch {
      console.log(`    ${cross} Could not list dynamic dir inside container`);
    }
    console.log();
    console.log(colors.muted("  Traefik errors / config events (last 30 relevant lines):"));
    try {
      const logs = execSync6(
        'docker logs eve-legs-traefik 2>&1 | grep -iE "error|warn|provider|configuration|cannot|failed|unable|loaded|started" | grep -v "Peeking first byte" | tail -30 || echo ""',
        { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
      ).trim();
      if (!logs) {
        console.log(`    ${colors.muted("(no relevant log entries)")}`);
      } else {
        for (const line of logs.split("\n")) {
          const isError = /error|ERR|level=error|fail|unable|cannot/i.test(line);
          console.log(`    ${isError ? colors.error(line) : colors.muted(line)}`);
        }
      }
    } catch {
      console.log(colors.muted("    (could not read logs)"));
    }
    console.log();
    console.log(colors.primary.bold("  Hints:"));
    console.log(colors.muted("  " + "\u2500".repeat(58)));
    if (loadedRouters.length === 0) {
      printError("  Traefik has NO routers loaded \u2014 your routes file is being ignored.");
      printInfo("  Try re-running: eve domain set <yourdomain>");
      printInfo("  If that doesn't fix it, recreate the Traefik container:");
      printInfo("    docker rm -f eve-legs-traefik");
      printInfo("    eve install --components=traefik");
      printInfo("    eve domain set <yourdomain>");
    } else {
      printInfo("  \u2022 404 with routers loaded = Host header mismatch. Test with:");
      printInfo('      curl -v -H "Host: eve.<domain>" http://localhost/');
      printInfo("  \u2022 502 = route matched, upstream down. Check upstream containers.");
      printInfo("  \u2022 Eve dashboard runs on the HOST (port 7979), not in Docker.");
      printInfo("      Start it with: cd /opt/eve && npx eve ui");
    }
    console.log();
  });
  domain.command("repair").description("Recreate Traefik with clean state \u2014 fixes stale routes & broken volume mounts").action(async () => {
    const secrets = await readEveSecrets7(process.cwd());
    const domainName = secrets?.domain?.primary;
    if (!domainName) {
      printError("No domain configured. Run: eve domain set <yourdomain> first.");
      process.exit(1);
    }
    console.log();
    console.log(colors.primary.bold("Eve \u2014 Traefik repair"));
    console.log(colors.muted("\u2500".repeat(60)));
    console.log();
    printInfo("Removing existing Traefik container...");
    try {
      execSync6("docker rm -f eve-legs-traefik", { stdio: "inherit" });
    } catch {
    }
    const HOST_DYNAMIC_DIR = "/opt/traefik/dynamic";
    const HOST_STATIC_CONFIG = "/opt/traefik/traefik.yml";
    if (existsSync7(HOST_DYNAMIC_DIR)) {
      printInfo("Cleaning stale dynamic config files...");
      try {
        for (const file of readdirSync(HOST_DYNAMIC_DIR)) {
          if (file.endsWith(".yml") || file.endsWith(".yaml")) {
            const path = join7(HOST_DYNAMIC_DIR, file);
            try {
              unlinkSync(path);
              console.log(`  ${colors.muted("\u2022")} removed ${file}`);
            } catch (err) {
              printWarning(`  could not remove ${file}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      } catch (err) {
        printWarning(`  could not read ${HOST_DYNAMIC_DIR}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (existsSync7(HOST_STATIC_CONFIG)) {
      try {
        unlinkSync(HOST_STATIC_CONFIG);
        console.log(`  ${colors.muted("\u2022")} removed traefik.yml`);
      } catch {
      }
    }
    printInfo("Reinstalling Traefik (fresh container)...");
    const traefik = new TraefikService2();
    await traefik.install();
    printInfo("Applying domain routes...");
    let installedComponents;
    try {
      installedComponents = await entityStateManager9.getInstalledComponents();
    } catch {
    }
    await traefik.configureSubdomains(domainName, !!secrets?.domain?.ssl, secrets?.domain?.email, installedComponents);
    console.log();
    printSuccess("Repair complete. Run `eve domain check` to verify.");
    console.log();
  });
  domain.command("unset").description("Remove domain configuration").action(async () => {
    const secrets = await readEveSecrets7(process.cwd());
    if (secrets?.domain?.primary) {
      await writeEveSecrets6({ domain: { primary: void 0, ssl: void 0, email: void 0 } });
      printSuccess("Domain configuration removed");
    } else {
      printInfo("No domain configured");
    }
  });
}

// src/index.ts
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname = dirname2(__filename2);
var pkg = JSON.parse(readFileSync(join8(__dirname, "../package.json"), "utf-8"));
var program = new Command();
program.configureHelp({
  sortSubcommands: true,
  sortOptions: true
});
program.name("eve").description(`${emojis.entity} Eve \u2014 Entity Creation System`).version(pkg.version, "-v, --version").option("--json", "Machine-readable output where supported").option("-y, --yes", "Non-interactive / assume confirm").option("--verbose", "Verbose logs").hook("preAction", () => {
  const o = program.opts();
  setGlobalCliFlags({
    json: Boolean(o.json),
    nonInteractive: Boolean(o.yes),
    verbose: Boolean(o.verbose)
  });
});
program.addHelpText(
  "before",
  `
${colors.primary.bold("Eve \u2014 sovereign stack installer & operator")}

${emojis.brain} Brain   Synap + data stores + optional Ollama
${emojis.arms} Arms    OpenClaw (agent messaging layer)
${emojis.builder} Builder OpenCode / OpenClaude / Dokploy
${emojis.eyes} Eyes    RSSHub
${emojis.legs} Legs    Traefik / domains
`
);
program.addHelpText(
  "after",
  `
${colors.muted("Categories:")}
  ${colors.primary("Lifecycle")}  setup, init, grow, birth, status
  ${colors.primary("Organs")}     brain, arms, eyes, legs, builder
  ${colors.primary("Debug")}      doctor, logs, inspect
  ${colors.primary("Management")} config, backup, update, recreate
  ${colors.primary("AI")}         ai \u2026
`
);
setupCommand(program);
installCommand(program);
addCommand(program);
removeCommand(program);
program.command("init").description("Alias for `eve install` \u2014 composable installer").option("--components <list>", "Comma-separated component IDs").option("--domain <host>", "Public hostname", "localhost").option("--email <email>", "Let's Encrypt email").option("--model <model>", "Ollama model", "llama3.1:8b").option("--synap-repo <path>", "Path to synap-backend checkout").option("--from-image", "Install Synap from Docker image").option("--admin-email <email>", "Admin bootstrap email").option("--admin-password <secret>", "Admin password (preseed mode)").option("--admin-bootstrap-mode <mode>", "token | preseed").option("--dry-run", "Print plan without executing").action(async (opts) => {
  try {
    await runInstall({
      components: opts.components ? opts.components.split(",").map((s) => s.trim()) : void 0,
      domain: opts.domain,
      email: opts.email,
      model: opts.model,
      synapRepo: opts.synapRepo,
      fromImage: opts.fromImage,
      adminEmail: opts.adminEmail,
      adminPassword: opts.adminPassword,
      adminBootstrapMode: opts.adminBootstrapMode,
      dryRun: opts.dryRun
    });
  } catch (err) {
    console.error(String(err));
    process.exit(1);
  }
});
birthCommand(program);
statusCommand(program);
growCommand(program);
doctorCommand(program);
logsCommand(program);
inspectCommand(program);
configCommands(program);
backupUpdateCommands(program);
purgeCommand(program);
aiCommandGroup(program);
uiCommand(program);
domainCommand(program);
var brain = program.command("brain").description("Intelligence & memory (Synap, Ollama)");
registerBrainCommands(brain);
var arms = program.command("arms").description("Action \u2014 OpenClaw (agent messaging layer)");
registerArmsCommands(arms);
var eyes = program.command("eyes").description("Perception \u2014 RSSHub");
registerEyesCommands(eyes);
var legs = program.command("legs").description("Exposure \u2014 Traefik & domains");
registerLegsCommands(legs);
var builder = program.command("builder").description("Creation \u2014 OpenCode / OpenClaude / Dokploy");
registerBuilderCommands(builder);
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled:", reason);
  process.exit(1);
});
program.parse();
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
//# sourceMappingURL=index.js.map