#!/usr/bin/env node

// src/index.ts
import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath as fileURLToPath2 } from "url";
import { dirname as dirname2, join as join6 } from "path";
import { execa as execa11 } from "execa";
import { setGlobalCliFlags } from "@eve/cli-kit";
import {
  registerBrainCommands,
  runBrainInit as runBrainInit5
} from "@eve/brain";
import { registerArmsCommands } from "@eve/arms";
import { registerLegsCommands } from "@eve/legs";
import { registerEyesCommands } from "@eve/eyes";
import { registerBuilderCommands } from "@eve/builder";

// src/commands/status.ts
import Table from "cli-table3";
import { execSync } from "child_process";
import { entityStateManager } from "@eve/dna";
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
function createSpinner(text2) {
  let interval;
  const frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  let i = 0;
  return {
    start() {
      process.stdout.write(colors.info(`${frames[0]} ${text2}`));
      interval = setInterval(() => {
        process.stdout.write(`\r${colors.info(`${frames[i]} ${text2}`)}`);
        i = (i + 1) % frames.length;
      }, 80);
    },
    succeed(msg) {
      clearInterval(interval);
      console.log(`\r${colors.success(`${emojis.check} ${msg || text2}`)}`);
    },
    fail(msg) {
      clearInterval(interval);
      console.log(`\r${colors.error(`${emojis.cross} ${msg || text2}`)}`);
    },
    warn(msg) {
      clearInterval(interval);
      console.log(`\r${colors.warning(`${emojis.warning} ${msg || text2}`)}`);
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
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
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
  const components = state.installed;
  if (components && Object.keys(components).length > 0) {
    const compTable = new Table({
      head: [
        colors.primary.bold("Component"),
        colors.primary.bold("Status"),
        colors.primary.bold("Version"),
        colors.primary.bold("Managed By")
      ],
      colWidths: [18, 12, 12, 14],
      style: {
        head: [],
        border: ["grey"]
      }
    });
    const COMPONENT_LABELS = {
      synap: "Synap",
      openclaw: "OpenClaw",
      hermes: "Hermes",
      rsshub: "RSSHub",
      traefik: "Traefik",
      ollama: "Ollama"
    };
    for (const [id, comp] of Object.entries(components)) {
      const statusColor = getStatusColor(comp.state);
      const managedByColor = comp.managedBy === "eve" ? colors.success : comp.managedBy === "synap" ? colors.warning : colors.muted;
      compTable.push([
        COMPONENT_LABELS[id] || id,
        statusColor(comp.state),
        comp.version || "-",
        managedByColor(comp.managedBy || "\u2014")
      ]);
    }
    console.log(compTable.toString());
    console.log();
  }
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
  console.log();
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
import { entityStateManager as entityStateManager2 } from "@eve/dna";
function doctorCommand(program2) {
  program2.command("doctor").alias("doc").description("Run comprehensive diagnostics on the entity").option("-f, --fix", "Attempt to fix issues automatically").option("-v, --verbose", "Show verbose output").action(async (options) => {
    try {
      await runDiagnostics(options.fix, options.verbose);
    } catch (error) {
      printError("Diagnostics failed: " + String(error));
      process.exit(1);
    }
  });
}
async function runDiagnostics(attemptFix = false, verbose = false) {
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
  const EXPECTED_CONTAINERS = {
    "eve-brain-synap": "brain",
    "eve-brain-ollama": "brain",
    "eve-arms-openclaw": "arms",
    "eve-eyes-rsshub": "eyes",
    "eve-legs-traefik": "legs"
  };
  const containerCheck = createSpinner("Checking running containers...");
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
    for (const [containerName, organ] of Object.entries(EXPECTED_CONTAINERS)) {
      if (running.has(containerName)) {
        checks.push({
          name: containerName,
          status: "pass",
          message: `Running \u2014 ${running.get(containerName)}`
        });
      } else if (all.has(containerName)) {
        checks.push({
          name: containerName,
          status: "fail",
          message: `Stopped \u2014 ${all.get(containerName)}`,
          fix: `docker start ${containerName}  or  eve install --components=${organ}`
        });
      }
    }
  } catch {
    containerCheck.fail("Could not query Docker containers");
    checks.push({ name: "Containers", status: "fail", message: "docker ps failed \u2014 is Docker running?" });
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
    if (attemptFix) {
      console.log();
      printInfo("Automatic fixes are not implemented yet. Follow the Fix hints above or run eve inspect.");
    }
  }
  console.log();
}

// src/commands/grow.ts
import { confirm, select, isCancel } from "@clack/prompts";
import { entityStateManager as entityStateManager3 } from "@eve/dna";
import { runBrainInit } from "@eve/brain";
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
  console.clear();
  console.log();
  console.log(colors.primary.bold(`${emojis.sparkles} Eve Entity Growth`));
  console.log();
  const state = await entityStateManager3.getState();
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
async function growOrgan(organ, options) {
  const valid = ["brain", "arms", "builder", "eyes", "legs"];
  if (!valid.includes(organ)) {
    printError(`Unknown organ: ${organ}. Use: ${valid.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log();
  printHeader(`Growing ${organ.charAt(0).toUpperCase() + organ.slice(1)}`, emojis.sparkles);
  console.log();
  if (options.dryRun) {
    printInfo("Dry run \u2014 planned steps:");
    for (const step of getInstallationSteps(organ)) {
      console.log(`  ${colors.muted("\u2022")} ${step.name}`);
    }
    if (organ === "brain") {
      printInfo("Run without --dry-run to execute: eve brain init (same as grow organ brain)");
    } else {
      printInfo(`Run without --dry-run: use eve ${organ} install (or organ-specific commands).`);
    }
    return;
  }
  const shouldProceed = await confirm({
    message: `Install the ${organ} organ? This will set up necessary services.`,
    initialValue: true
  });
  if (isCancel(shouldProceed)) {
    console.log(colors.muted("\nCancelled."));
    return;
  }
  if (!shouldProceed) {
    console.log(colors.muted("\nGrowth cancelled"));
    return;
  }
  if (organ === "brain") {
    try {
      await runBrainInit({
        withAi: options.withAi === true,
        model: "llama3.1:8b",
        synapRepo: process.env.SYNAP_REPO_ROOT
      });
    } catch {
      process.exit(1);
    }
    return;
  }
  const steps = getInstallationSteps(organ);
  for (const step of steps) {
    const spinner = createSpinner(step.name);
    spinner.start();
    await sleep(800);
    spinner.succeed(step.name);
  }
  printInfo(
    `Automated install for "${organ}" is not fully wired yet. Run: ${colors.info(`eve ${organ} install`)} (or see eve ${organ} --help).`
  );
  await entityStateManager3.updateOrgan(organ, "ready");
  printSuccess(`${organ} marked ready in entity state (verify with eve ${organ} status).`);
  console.log();
}
async function growCapability() {
  const state = await entityStateManager3.getState();
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
function getInstallationSteps(organ) {
  const steps = {
    brain: [
      { name: "Docker network eve-network" },
      { name: "Synap Data Pod install" },
      { name: "Optional: Ollama + model pull" }
    ],
    arms: [{ name: "eve arms install" }],
    eyes: [{ name: "eve eyes install" }],
    legs: [{ name: "eve legs setup" }],
    builder: [{ name: "eve builder init <project>" }]
  };
  return steps[organ] || [{ name: "See eve <organ> --help" }];
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
import { select as select2, isCancel as isCancel2 } from "@clack/prompts";
import { existsSync } from "fs";
import { join } from "path";
import {
  entityStateManager as entityStateManager4,
  writeSetupProfile,
  readEveSecrets,
  writeEveSecrets,
  ensureEveSkillsLayout,
  defaultSkillsDir,
  ensureSecretValue,
  getServerIp
} from "@eve/dna";
import { getGlobalCliFlags as getGlobalCliFlags2, outputJson } from "@eve/cli-kit";
import { runBrainInit as runBrainInit2, runInferenceInit, resolveSynapDelegate } from "@eve/brain";
import { runLegsProxySetup } from "@eve/legs";

// src/lib/components.ts
var COMPONENTS = [
  {
    id: "traefik",
    organ: "legs",
    label: "Traefik",
    emoji: "\u{1F9BF}",
    description: "Reverse proxy & routing. Handles domain exposure, SSL termination, and service discovery for all Eve services. Always installed.",
    category: "infrastructure",
    alwaysInstall: true
  },
  {
    id: "ollama",
    organ: "brain",
    label: "Ollama",
    emoji: "\u{1F9E0}",
    description: "Local AI inference engine. Runs open-source models (Llama, Mistral, etc.) on your server. Keeps your data private.",
    category: "data",
    requires: ["traefik"]
  },
  {
    id: "synap",
    organ: "brain",
    label: "Synap Data Pod",
    emoji: "\u{1F9E0}",
    description: "Your sovereign second brain. Stores and organises all your data \u2014 notes, tasks, contacts, bookmarks. The foundation of your personal AI infrastructure.",
    category: "data",
    requires: ["traefik"]
  },
  {
    id: "openclaw",
    organ: "arms",
    label: "OpenClaw",
    emoji: "\u{1F9BE}",
    description: "AI action layer. Gives your AI agent the ability to execute commands, access your files, and interact with the world.",
    category: "agent",
    requires: ["synap"]
  },
  {
    id: "hermes",
    organ: "builder",
    label: "Hermes",
    emoji: "\u{1F3D7}\uFE0F",
    description: "AI builder system. Enables the agent to create, deploy, and manage new applications and services automatically.",
    category: "builder",
    requires: ["synap"]
  },
  {
    id: "rsshub",
    organ: "eyes",
    label: "RSSHub",
    emoji: "\u{1F441}\uFE0F",
    description: "Data perception layer. Turns any website into RSS feeds so your AI can stay informed about what matters.",
    category: "perception",
    requires: ["synap"]
  },
  {
    id: "dokploy",
    label: "Dokploy",
    emoji: "\u{1F527}",
    description: "Low-code PaaS for deploying applications. Optional \u2014 install later if you need a visual deployment dashboard.",
    category: "add-on"
  },
  {
    id: "opencode",
    label: "OpenCode",
    emoji: "\u{1F4BB}",
    description: "AI-powered code editor. Lets your agent write and edit code directly on your server.",
    category: "add-on"
  },
  {
    id: "openclaude",
    label: "OpenClaude",
    emoji: "\u{1F916}",
    description: "Claude Code as a service. Exposes Claude Code to your agent for advanced coding tasks.",
    category: "add-on"
  }
];
function resolveComponent(id) {
  const comp = COMPONENTS.find((c) => c.id === id);
  if (!comp) {
    throw new Error(`Unknown component: ${id}. Available: ${COMPONENTS.map((c) => c.id).join(", ")}`);
  }
  return comp;
}
function selectedIds(selected) {
  return COMPONENTS.filter((c) => selected[c.id]).map((c) => c.id);
}

// src/commands/lifecycle/install.ts
import { RSSHubService } from "@eve/eyes";
async function runInstall(opts) {
  const flags = getGlobalCliFlags2();
  const jsonMode = Boolean(flags.json);
  const nonInteractive = Boolean(flags.nonInteractive) || Boolean(opts.skipInteractive);
  let componentSet;
  if (opts.components && opts.components.length > 0) {
    componentSet = {};
    for (const id of opts.components) {
      const comp = COMPONENTS.find((c) => c.id === id);
      if (!comp) {
        throw new Error(`Unknown component: ${id}. Available: ${COMPONENTS.map((c) => c.id).join(", ")}`);
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
  for (const comp of COMPONENTS) {
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
      const { stdout } = await execa2("which", ["docker"]);
      if (stdout) dockerPath = stdout;
    } catch {
      const candidates = [
        "/usr/local/bin/docker",
        "/usr/bin/docker",
        "/usr/bin/containerd"
      ];
      for (const c of candidates) {
        if (existsSync(c)) {
          dockerPath = c;
          break;
        }
      }
    }
    let dockerOk = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await execa2(dockerPath, ["version"]);
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
        printInfo();
        printInfo("If not running, start it:");
        printInfo("  sudo systemctl start docker");
        printInfo("  # wait ~5 seconds for it to initialize");
        printInfo();
        printInfo("If Docker is not installed, run:");
        printInfo("  curl -fsSL https://get.docker.com | sudo bash");
      }
      console.log();
      process.exit(1);
    }
  }
  if (!opts.dryRun) {
    const cwd = process.cwd();
    const skillsDir = defaultSkillsDir();
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
    const prevSecrets = await readEveSecrets(cwd);
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
    await writeEveSecrets(merge, cwd);
    ensureEveSkillsLayout(skillsDir);
  }
  if (!jsonMode) {
    console.log();
    printHeader("Eve Install Plan", emojis.entity);
    console.log();
    for (const comp of COMPONENTS) {
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
    const serverIp = getServerIp();
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
        await runLegsProxySetup({
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
        await runInferenceInit({
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
            const { homedir: homedir2 } = await import("os");
            const { existsSync: existsSync6 } = await import("fs");
            const podConfigPath = join(homedir2(), ".synap", "pod-config.json");
            if (existsSync6(podConfigPath)) {
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
  if (hasBuilder) {
    const builderNames = [hasHermes && "Hermes", hasDokploy && "Dokploy", hasOpenCode && "OpenCode", hasOpenClaude && "OpenClaude"].filter(Boolean).join(", ");
    steps.push({
      label: "Builder organ",
      async fn() {
        console.log(`  Skipping: builder organ (${builderNames}) requires manual configuration.`);
        console.log('  Run "eve builder init" to set up.');
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
      await entityStateManager4.updateOrgan(organ, "ready", { version: "0.1.0" });
    }
    await entityStateManager4.updateComponentEntry(compId, {
      state: "ready",
      version: "0.1.0",
      managedBy: "eve"
    });
  }
  await entityStateManager4.updateSetupProfile({ components });
}
async function interactiveComponentSelect() {
  const result = {};
  console.log();
  console.log(colors.primary.bold(`${emojis.entity} Eve \u2014 Composable Installer`));
  console.log();
  printInfo("Choose which components to install. You can always add more later.");
  console.log();
  const categories = /* @__PURE__ */ new Map();
  for (const comp of COMPONENTS) {
    const existing = categories.get(comp.category) || [];
    existing.push(comp);
    categories.set(comp.category, existing);
  }
  for (const [category, comps] of categories) {
    const label = category.charAt(0).toUpperCase() + category.slice(1);
    console.log(colors.primary.bold(`${label}:`));
    for (const comp of comps) {
      const checked = comp.alwaysInstall ? colors.muted("(always)") : "";
      console.log(`  ${comp.emoji} ${comp.label}: ${comp.description.split("\n")[0]}${checked}`);
    }
    console.log();
  }
  const defaultSelected = COMPONENTS.filter((c) => c.category !== "add-on").map((c) => c.id);
  const defaultSelectedStr = defaultSelected.join(", ");
  const defaultLabels = COMPONENTS.filter((c) => c.category !== "add-on").map((c) => c.label);
  const selectedText = await select2({
    message: "Which components do you want?",
    options: [
      { value: defaultSelectedStr, label: defaultLabels.join(", ") },
      { value: "custom", label: "Custom selection...", hint: "Pick individually" },
      { value: "minimal", label: "Minimal (Traefik only)", hint: "Set up routing first, add later" },
      { value: "none", label: "Skip for now", hint: 'Run "eve install" again later' }
    ],
    initialValue: defaultSelectedStr
  });
  if (isCancel2(selectedText)) return result;
  if (selectedText === "custom") {
    const configurable = COMPONENTS.filter((c) => !c.alwaysInstall);
    const selected = /* @__PURE__ */ new Set();
    for (const comp of configurable) {
      if (comp.category !== "add-on") selected.add(comp.id);
    }
    let running = true;
    while (running) {
      const opts = configurable.map((c) => ({
        value: c.id,
        label: `${selected.has(c.id) ? "\u2713" : "\u25CB"} ${c.emoji} ${c.label}`,
        hint: selected.has(c.id) ? "On" : "Off"
      }));
      const chosen = await select2({
        message: "Toggle components, then End to confirm",
        options: [...opts, { value: "end", label: "End", hint: "Proceed with current selection" }],
        // Pre-select first non-selected if any, else first selected
        initialValue: opts.find((o) => !selected.has(o.value))?.value ?? opts[0]?.value ?? "end"
      });
      if (isCancel2(chosen)) return result;
      if (chosen === "end") break;
      if (selected.has(chosen)) {
        selected.delete(chosen);
      } else {
        selected.add(chosen);
      }
    }
    for (const comp of COMPONENTS) {
      if (comp.alwaysInstall) result[comp.id] = true;
    }
    for (const id of selected) {
      result[id] = true;
    }
    return result;
  }
  if (selectedText === "minimal") {
    return { traefik: true };
  }
  if (selectedText === "none") {
    return {};
  }
  for (const id of selectedText.split(",").map((s) => s.trim())) {
    result[id] = true;
  }
  for (const comp of COMPONENTS) {
    if (comp.alwaysInstall) result[comp.id] = true;
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
    "Comma-separated component IDs (traefik,synap,ollama,openclaw,hermes,rsshub,dokploy,opencode,openclaude)"
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
function execa2(cmd, args, opts) {
  return import("execa").then((mod) => mod.execa(cmd, args, { ...opts || {}, shell: true }));
}
function spawnAsync(cmd, args, opts) {
  return import("execa").then(
    (mod) => mod.spawn(cmd, args, {
      env: { ...process.env, ...opts?.env || {} },
      cwd: opts?.cwd,
      stdio: "inherit"
    }).on("spawn", () => {
    }).on("close", ({ exitCode }) => {
      if (exitCode !== 0) {
        throw new Error(`${cmd} exited with code ${exitCode}`);
      }
    })
  );
}

// src/commands/setup.ts
import { select as select3, confirm as confirm3, isCancel as isCancel3, text } from "@clack/prompts";
import { homedir, tmpdir } from "os";
import { existsSync as existsSync2 } from "fs";
import { mkdir, readdir, rm } from "fs/promises";
import { dirname, join as join2, resolve } from "path";
import { execa as execa3 } from "execa";
import {
  readSetupProfile,
  writeSetupProfile as writeSetupProfile2,
  getSetupProfilePath,
  readUsbSetupManifest,
  probeHardware,
  formatHardwareReport,
  readEveSecrets as readEveSecrets2,
  writeEveSecrets as writeEveSecrets2,
  ensureSecretValue as ensureSecretValue2,
  defaultSkillsDir as defaultSkillsDir2,
  ensureEveSkillsLayout as ensureEveSkillsLayout2
} from "@eve/dna";
import { runBrainInit as runBrainInit3, runInferenceInit as runInferenceInit2 } from "@eve/brain";
import { runLegsProxySetup as runLegsProxySetup2 } from "@eve/legs";
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
  return existsSync2(join2(repoRoot, "synap")) && existsSync2(join2(repoRoot, "deploy", "docker-compose.yml"));
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
    const maybePath = await text({
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
  if (existsSync2(targetDir) && !looksLikeSynapRepo(targetDir)) {
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
  if (!existsSync2(targetDir)) {
    if (!jsonMode) {
      console.log(`${emojis.info} Cloning synap-backend to ${colors.info(targetDir)} \u2026`);
    }
    try {
      await execa3(
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
        await execa3("curl", ["-fsSL", SYNAP_BACKEND_TARBALL_URL, "-o", archivePath], {
          stdio: "inherit"
        });
        await execa3("tar", ["-xzf", archivePath, "--strip-components", "1", "-C", targetDir], {
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
    if (!existing && existsSync2(getSetupProfilePath(cwd)) && !flags.nonInteractive && !flags.json && !opts.dryRun) {
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
        const d = await text({
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
        const em = await text({
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
        const ae = await text({
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
          const ap = await text({
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
          const d = await text({
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
    const prevSecrets = await readEveSecrets2(cwd);
    const skillsDir = prevSecrets?.builder?.skillsDir?.trim() || process.env.EVE_SKILLS_DIR?.trim() || defaultSkillsDir2();
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
        openclawSynapApiKey: podKey
      };
    } else {
      merge.arms = {
        openclawSynapApiKey: ensureSecretValue2(
          prevSecrets?.arms?.openclawSynapApiKey ?? process.env.OPENCLAW_SYNAP_API_KEY
        )
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
    await writeEveSecrets2(merge, cwd);
    ensureEveSkillsLayout2(skillsDir);
    if (flags.json) {
      outputJson2({ ok: true, profile, persisted: true });
    }
    try {
      if (profile === "inference_only") {
        await runInferenceInit2({
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
          await runLegsProxySetup2({
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
        await runInferenceInit2({
          model: opts.model ?? "llama3.1:8b",
          withGateway: true,
          internalOllamaOnly: true
        });
        if (tunnelProvider) {
          const legsDomain = installDomain !== "localhost" ? installDomain : tunnelDomain ?? void 0;
          await runLegsProxySetup2({
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

// src/commands/add.ts
import { execa as execa4 } from "execa";
import { existsSync as existsSync3 } from "fs";
import {
  entityStateManager as entityStateManager5
} from "@eve/dna";
import { runBrainInit as runBrainInit4, runInferenceInit as runInferenceInit3 } from "@eve/brain";
import { runLegsProxySetup as runLegsProxySetup3 } from "@eve/legs";
async function addTraefik() {
  await runLegsProxySetup3({ standalone: true });
}
async function addSynap() {
  const envRepo = process.env.SYNAP_REPO_ROOT;
  if (!envRepo || !existsSync3(envRepo)) {
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
  await runBrainInit4({
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
  await runInferenceInit3({ model, withGateway: true, internalOllamaOnly: true });
}
async function addOpenclaw() {
  const state = await entityStateManager5.getState();
  const brainStatus = state.organs.brain;
  if (brainStatus.state !== "ready") {
    printError("Brain is not ready. Please install Synap first: `eve add synap`");
    process.exit(1);
  }
  const synapScript = process.env.SYNAP_SETUP_SCRIPT;
  if (synapScript && existsSync3(synapScript)) {
    await execa4("bash", [synapScript, "profiles", "enable", "openclaw"], {
      env: { ...process.env, SYNAP_DEPLOY_DIR: process.env.SYNAP_DEPLOY_DIR || "", SYNAP_ASSUME_YES: "1" },
      stdio: "inherit"
    });
    await execa4("bash", [synapScript, "services", "add", "openclaw"], {
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
  const state = await entityStateManager5.getState();
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
  await entityStateManager5.updateOrgan("eyes", "ready");
  printSuccess("RSSHub installed successfully!");
  printInfo("  URL: http://localhost:1200");
}
async function runAdd(componentId, opts = {}) {
  const comp = resolveComponent(componentId);
  const existing = await entityStateManager5.isComponentInstalled(componentId);
  if (existing) {
    printWarning(`${comp.label} is already installed.`);
    printInfo(`  Run "eve ${comp.organ} status" to check its state.`);
    return;
  }
  const currentComponents = await entityStateManager5.getInstalledComponents();
  const missingDeps = (comp.requires ?? []).filter((dep) => !currentComponents.includes(dep));
  if (missingDeps.length > 0) {
    const depNames = missingDeps.map((dep) => {
      const info = COMPONENTS.find((c) => c.id === dep);
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
  await updateStateAfterAdd(comp.id);
  console.log();
  printSuccess(`${comp.label} added successfully!`);
  console.log();
  printInfo("Next steps:");
  printInfo(`  - Run "eve status" to check entity state`);
  printInfo(`  - Run "eve ${comp.organ} status" for ${comp.label} status`);
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
    case "hermes":
    case "dokploy":
    case "opencode":
    case "openclaude":
      return {
        label: "Builder organ (manual setup)",
        async fn() {
          const info = COMPONENTS.find((c) => c.id === componentId);
          if (info) {
            printWarning(`${info.label} requires manual configuration.`);
            printInfo(`  Run "eve builder init" to set up the builder organ with all add-ons.`);
          }
        }
      };
    default:
      throw new Error(`No add handler for component: ${componentId}`);
  }
}
async function updateStateAfterAdd(componentId) {
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
  const organ = organMap[componentId];
  if (organ) {
    await entityStateManager5.updateOrgan(organ, "ready", { version: "0.1.0" });
  }
  await entityStateManager5.updateComponentEntry(componentId, {
    state: "ready",
    version: "0.1.0",
    managedBy: "eve"
  });
  const current = await entityStateManager5.getInstalledComponents();
  if (!current.includes(componentId)) {
    await entityStateManager5.updateSetupProfile({ components: [...current, componentId] });
  }
}
function addCommand(program2) {
  program2.command("add").description("Add a component to an existing entity").argument("[component]", "Component ID to add (traefik, synap, ollama, openclaw, rsshub, hermes, dokploy, opencode, openclaude)").option("--synap-repo <path>", "Path to synap-backend checkout (for synap component)").option("--model <model>", "Ollama model (for ollama component)", "llama3.1:8b").action(async (component, opts) => {
    if (!component) {
      console.log();
      printHeader("Eve \u2014 Add Component", emojis.entity);
      console.log();
      printInfo("Usage: eve add <component>");
      console.log();
      printInfo("Available components:");
      for (const comp of COMPONENTS) {
        const installed = await entityStateManager5.isComponentInstalled(comp.id);
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

// src/commands/remove.ts
import { execa as execa5 } from "execa";
import { join as join3 } from "path";
import {
  entityStateManager as entityStateManager6
} from "@eve/dna";
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
    if (deployDir && process.platform !== "win32") {
      await execa5("bash", ["-c", `[ -f "${deployDir}/docker-compose.yml" ] && docker compose -f "${deployDir}/docker-compose.yml" down --volumes`], {
        shell: "/bin/bash",
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
async function runRemove(componentId) {
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
    const depInfo = COMPONENTS.find((c) => c.id === dep);
    return depInfo?.requires?.includes(componentId) ?? false;
  });
  if (dependents.length > 0) {
    const depNames = dependents.map((d) => {
      const info = COMPONENTS.find((c) => c.id === d);
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
  let removeFn;
  try {
    removeFn = buildRemoveStep(comp.id);
  } catch (err) {
    printError(String(err));
    process.exit(1);
  }
  await removeFn();
  await updateStateAfterRemove(comp.id);
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
    case "hermes":
    case "dokploy":
    case "opencode":
    case "openclaude":
      return async () => {
        const info = COMPONENTS.find((c) => c.id === componentId);
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
  program2.command("remove").alias("rm").description("Remove a component from an existing entity").argument("[component]", "Component ID to remove (synap, ollama, openclaw, rsshub, traefik)").action(async (component) => {
    if (!component) {
      console.log();
      printHeader("Eve \u2014 Remove Component", emojis.entity);
      console.log();
      printInfo("Usage: eve remove <component>");
      console.log();
      printInfo("Available components:");
      for (const comp of COMPONENTS) {
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
import { getGlobalCliFlags as getGlobalCliFlags4, outputJson as outputJson3 } from "@eve/cli-kit";
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
        if (getGlobalCliFlags4().json) {
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
      if (getGlobalCliFlags4().json) {
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
import { getGlobalCliFlags as getGlobalCliFlags5, outputJson as outputJson4 } from "@eve/cli-kit";
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
      if (getGlobalCliFlags5().json) {
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
import { execSync as execSync2, spawnSync } from "child_process";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { existsSync as existsSync4 } from "fs";
import { join as join4 } from "path";
import { getGlobalCliFlags as getGlobalCliFlags6 } from "@eve/cli-kit";
function getSynapBackendContainer() {
  try {
    const out = execSync2(
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
    execSync2(`docker network connect eve-network ${name}`, { stdio: ["pipe", "pipe", "ignore"] });
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
        await execa8("docker", ["compose", "pull", "backend", "realtime", "--ignore-pull-failures"], { cwd: deployDir, env, stdio: "inherit" });
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
  return targets;
}
async function confirmDestructiveReset() {
  const flags = getGlobalCliFlags6();
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
      const vols = stdout.split("\n").filter((n) => n.includes("eve") || n.includes("ollama") || n.includes("synap"));
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
  program2.command("update").description("Pull latest images and restart all Eve organs (Synap, Ollama, OpenClaw, RSSHub, Traefik)").option("--only <organs>", "Comma-separated organs to update, e.g. synap,ollama").option("--skip <organs>", "Comma-separated organs to skip, e.g. traefik").action(async (opts) => {
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

// src/commands/ai.ts
import { execa as execa9 } from "execa";
import { OllamaService } from "@eve/brain";
import { getGlobalCliFlags as getGlobalCliFlags7, outputJson as outputJson5 } from "@eve/cli-kit";
import { readEveSecrets as readEveSecrets4, writeEveSecrets as writeEveSecrets4 } from "@eve/dna";
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
function aiCommandGroup(program2) {
  const ai = program2.command("ai").description("AI foundation helpers (local Ollama + provider routing)");
  ai.command("status").description("Show AI foundation mode, provider routing, and Ollama status").action(async () => {
    const ollama = new OllamaService();
    try {
      const s = await ollama.getStatus();
      const secrets = await readEveSecrets4(process.cwd());
      const out = {
        ai: secrets?.ai ?? null,
        ollama: s
      };
      if (getGlobalCliFlags7().json) {
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
    const secrets = await readEveSecrets4(process.cwd());
    const list = secrets?.ai?.providers ?? [];
    if (getGlobalCliFlags7().json) {
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
  providers.command("add <id>").description("Add or update provider credentials/model").option("--api-key <key>", "Provider API key").option("--base-url <url>", "Custom provider base URL").option("--model <name>", "Default model name").option("--disable", "Set enabled=false").action(async (id, opts) => {
    try {
      const pid = parseProviderId(id);
      const secrets = await readEveSecrets4(process.cwd());
      const list = [...secrets?.ai?.providers ?? []];
      const idx = list.findIndex((p) => p.id === pid);
      const next = {
        id: pid,
        enabled: opts.disable ? false : true,
        apiKey: opts.apiKey ?? list[idx]?.apiKey,
        baseUrl: opts.baseUrl ?? list[idx]?.baseUrl,
        defaultModel: opts.model ?? list[idx]?.defaultModel
      };
      if (idx >= 0) list[idx] = next;
      else list.push(next);
      await writeEveSecrets4({ ai: { providers: list } }, process.cwd());
      printInfo(`Provider ${pid} saved.`);
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
  ai.command("sync").description("Explicitly sync Eve provider routing policy to Synap workspace settings").requiredOption("--workspace <id>", "Workspace UUID to update").option("--check", "Only compare local policy vs workspace policy; do not write").action(async (opts) => {
    try {
      const secrets = await readEveSecrets4(process.cwd());
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
        if (getGlobalCliFlags7().json) {
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
      if (getGlobalCliFlags7().json) {
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
    if (getGlobalCliFlags7().json) {
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
      await execa9(
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
import { existsSync as existsSync5 } from "fs";
import { join as join5 } from "path";
import { fileURLToPath } from "url";
import { execa as execa10 } from "execa";
import { readEveSecrets as readEveSecrets5, writeEveSecrets as writeEveSecrets5 } from "@eve/dna";
var __filename = fileURLToPath(import.meta.url);
var packagesDir = join5(__filename, "..", "..", "..");
function dashboardDir() {
  return join5(packagesDir, "eve-dashboard");
}
function uiCommand(program2) {
  program2.command("ui").description("Open the Eve web dashboard").option("--port <port>", "Dashboard port", "7979").option("--no-open", "Do not open browser automatically").option("--rebuild", "Force rebuild of the dashboard before starting").action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const dir = dashboardDir();
    let secrets = await readEveSecrets5(process.cwd());
    if (!secrets?.dashboard?.secret) {
      const secret = randomBytes(32).toString("hex");
      await writeEveSecrets5({ dashboard: { secret, port } });
      secrets = await readEveSecrets5(process.cwd());
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
    const nextDir = join5(dir, ".next");
    if (opts.rebuild || !existsSync5(nextDir)) {
      console.log();
      const spinner = createSpinner("Building dashboard (first run \u2014 takes ~30s)...");
      spinner.start();
      try {
        await execa10("pnpm", ["build"], { cwd: dir, env: { ...process.env } });
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
    if (opts.open) {
      setTimeout(() => {
        const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        execa10(opener, [url]).catch(() => {
        });
      }, 2500);
    }
    const finalSecrets = await readEveSecrets5(process.cwd());
    await execa10("pnpm", ["start", "--port", String(port)], {
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
import { writeEveSecrets as writeEveSecrets6, readEveSecrets as readEveSecrets6, getAccessUrls, getServerIp as getServerIp2 } from "@eve/dna";
import { TraefikService } from "@eve/legs";
function domainCommand(program2) {
  const domain = program2.command("domain").description("Configure domain access and Traefik routing");
  domain.command("set <domain>").description("Set primary domain and configure Traefik subdomains").option("--ssl", "Enable SSL with Let's Encrypt").option("--email <email>", "Email for Let's Encrypt notifications").action(async (domainName, opts) => {
    if (opts.ssl && !opts.email) {
      printWarning("--ssl requires --email <address> for Let's Encrypt certificate provisioning.");
      printWarning("Example: eve domain set " + domainName + " --ssl --email you@example.com");
      process.exit(1);
    }
    await writeEveSecrets6({ domain: { primary: domainName, ssl: !!opts.ssl, email: opts.email } });
    try {
      const traefik = new TraefikService();
      await traefik.configureSubdomains(domainName, !!opts.ssl, opts.email);
      printSuccess(`Traefik routes configured for ${domainName}`);
    } catch {
      printInfo("Traefik config could not be written \u2014 run this command on your server to apply routes.");
    }
    const secrets = await readEveSecrets6(process.cwd());
    const urls = getAccessUrls(secrets);
    console.log();
    console.log(colors.primary.bold("Access URLs:"));
    console.log(colors.muted("\u2500".repeat(60)));
    for (const svc of urls) {
      if (svc.domainUrl) {
        console.log(`  ${svc.emoji}  ${svc.label.padEnd(20)} ${colors.primary(svc.domainUrl)}`);
      }
    }
    const serverIp = getServerIp2();
    const subdomains = ["eve", "pod", "openclaw", "feeds", "ai"];
    console.log();
    console.log(colors.primary.bold("DNS records to create:"));
    console.log(colors.muted("\u2500".repeat(60)));
    console.log(colors.muted(`  Type   Name                        Value`));
    console.log(colors.muted("\u2500".repeat(60)));
    for (const sub of subdomains) {
      const name = `${sub}.${domainName}`.padEnd(30);
      const value = serverIp ?? colors.warning("<your-server-ip>");
      console.log(`  ${colors.primary("A")}      ${name}  ${value}`);
    }
    console.log(colors.muted("\u2500".repeat(60)));
    if (!serverIp) {
      printInfo("Could not detect server IP automatically \u2014 replace <your-server-ip> above.");
    }
    if (opts.ssl) {
      console.log();
      printInfo("SSL will provision automatically once DNS records propagate (usually 1\u20135 min).");
    }
  });
  domain.command("show").description("Show all access URLs (local, server IP, domain)").action(async () => {
    const secrets = await readEveSecrets6(process.cwd());
    const urls = getAccessUrls(secrets);
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
  domain.command("unset").description("Remove domain configuration").action(async () => {
    const secrets = await readEveSecrets6(process.cwd());
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
var pkg = JSON.parse(readFileSync(join6(__dirname, "../package.json"), "utf-8"));
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
${emojis.arms} Arms    OpenClaw / MCP
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
program.command("init").description(
  "Alias for setup; forwards to setup flow by default, brain init only when synap repo is explicit."
).option("--profile <p>", "inference_only | data_pod | full").option("--with-ai", "Include Ollama for local AI").option("--model <model>", "AI model", "llama3.1:8b").option("--synap-repo <path>", "synap-backend checkout \u2192 official synap install").option("--domain <host>", "With --synap-repo: synap install --domain (default: localhost in brain init)").option("--email <email>", "With --synap-repo: required when domain isn't localhost").option("--with-openclaw", "With --synap-repo: synap install --with-openclaw").option("--with-rsshub", "With --synap-repo: synap install --with-rsshub").option("--from-image", "With --synap-repo: synap install --from-image").option("--from-source", "With --synap-repo: synap install --from-source").option("--admin-email <email>", "With --synap-repo: synap install --admin-email").option("--admin-password <secret>", "With --synap-repo: synap install --admin-password (preseed mode)").option("--admin-bootstrap-mode <mode>", "With --synap-repo: token | preseed (default token)").action(
  async (opts) => {
    try {
      if (!opts.synapRepo && !process.env.SYNAP_REPO_ROOT) {
        const rootFlags = program.opts();
        const profile = opts.profile ?? (opts.withAi ? "full" : "data_pod");
        const forwardArgs = ["setup", "--profile", profile];
        if (rootFlags.yes) forwardArgs.push("--yes");
        if (rootFlags.json) forwardArgs.push("--json");
        if (opts.domain) forwardArgs.push("--domain", opts.domain);
        if (opts.email) forwardArgs.push("--email", opts.email);
        if (opts.withOpenclaw) forwardArgs.push("--with-openclaw");
        if (opts.withRsshub) forwardArgs.push("--with-rsshub");
        if (opts.fromImage) forwardArgs.push("--from-image");
        if (opts.fromSource) forwardArgs.push("--from-source");
        if (opts.adminEmail) forwardArgs.push("--admin-email", opts.adminEmail);
        if (opts.adminPassword) forwardArgs.push("--admin-password", opts.adminPassword);
        if (opts.adminBootstrapMode) {
          forwardArgs.push("--admin-bootstrap-mode", opts.adminBootstrapMode);
        }
        await execa11("node", [__filename2, ...forwardArgs], {
          stdio: "inherit",
          env: process.env
        });
        return;
      }
      await runBrainInit5({
        withAi: opts.withAi,
        model: opts.model,
        synapRepo: opts.synapRepo,
        domain: opts.domain,
        email: opts.email,
        withOpenclaw: opts.withOpenclaw,
        withRsshub: opts.withRsshub,
        fromImage: opts.fromImage,
        fromSource: opts.fromSource,
        adminEmail: opts.adminEmail,
        adminPassword: opts.adminPassword,
        adminBootstrapMode: opts.adminBootstrapMode
      });
    } catch {
      process.exit(1);
    }
  }
);
birthCommand(program);
statusCommand(program);
growCommand(program);
doctorCommand(program);
logsCommand(program);
inspectCommand(program);
configCommands(program);
backupUpdateCommands(program);
aiCommandGroup(program);
uiCommand(program);
domainCommand(program);
var brain = program.command("brain").description("Intelligence & memory (Synap, Ollama)");
registerBrainCommands(brain);
var arms = program.command("arms").description("Action \u2014 OpenClaw & MCP");
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