#!/usr/bin/env node

// src/index.ts
import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname as dirname2, join as join2 } from "path";
import { setGlobalCliFlags } from "@eve/cli-kit";
import {
  registerBrainCommands,
  runBrainInit as runBrainInit3
} from "@eve/brain";
import { registerArmsCommands } from "@eve/arms";
import { registerLegsCommands } from "@eve/legs";
import { registerEyesCommands } from "@eve/eyes";
import { registerBuilderCommands } from "@eve/builder";

// src/commands/status.ts
import Table from "cli-table3";
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
function createSpinner(text) {
  let interval;
  const frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  let i = 0;
  return {
    start() {
      process.stdout.write(colors.info(`${frames[0]} ${text}`));
      interval = setInterval(() => {
        process.stdout.write(`\r${colors.info(`${frames[i]} ${text}`)}`);
        i = (i + 1) % frames.length;
      }, 80);
    },
    succeed(msg) {
      clearInterval(interval);
      console.log(`\r${colors.success(`${emojis.check} ${msg || text}`)}`);
    },
    fail(msg) {
      clearInterval(interval);
      console.log(`\r${colors.error(`${emojis.cross} ${msg || text}`)}`);
    },
    warn(msg) {
      clearInterval(interval);
      console.log(`\r${colors.warning(`${emojis.warning} ${msg || text}`)}`);
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
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      colors.primary.bold("Version"),
      colors.primary.bold("Last Check")
    ],
    colWidths: [15, 12, 12, 25],
    style: {
      head: [],
      border: ["grey"]
    }
  });
  const organs = ["brain", "arms", "builder", "eyes", "legs"];
  for (const organ of organs) {
    const organState = state.organs[organ];
    const statusColor = getStatusColor(organState.state);
    table.push([
      formatOrgan(organ),
      statusColor(organState.state),
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
  const missingOrgans = organs.filter((o) => state.organs[o].state === "missing");
  if (missingOrgans.length > 0) {
    console.log();
    console.log(colors.warning.bold(`${emojis.info} Next Steps:`));
    for (const organ of missingOrgans) {
      console.log(`  ${colors.muted("\u2192")} Install ${formatOrgan(organ)}: ${colors.info(`eve ${organ} install`)}`);
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
          name: `${formatOrgan(organ)}`,
          status: "pass",
          message: "Organ is healthy"
        });
      } else if (organState.state === "error") {
        checks.push({
          name: `${formatOrgan(organ)}`,
          status: "fail",
          message: organState.errorMessage || "Organ has errors",
          fix: `Run: eve ${organ} status`
        });
      } else if (organState.state === "missing") {
        checks.push({
          name: `${formatOrgan(organ)}`,
          status: "warn",
          message: "Organ not installed",
          fix: `Run: eve ${organ} install`
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
      { name: "Synap backend + Postgres + Redis" },
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
import { execa as execa2 } from "execa";
import { createRequire } from "module";
import { dirname, join } from "path";
import { getCreateUsbScriptPath } from "@eve/usb";
var require2 = createRequire(import.meta.url);
function resolveInstallScript() {
  try {
    const pkgJson = require2.resolve("@eve/install/package.json");
    return join(dirname(pkgJson), "src", "install.sh");
  } catch {
    return "";
  }
}
function birthCommand(program2) {
  const birth = program2.command("birth").description("Bare-metal provisioning (USB) and host install scripts");
  birth.command("usb").description(
    "Create a bootable USB with Ventoy + autoinstall (runs bash script). After hestia usb create, copy ~/.eve/usb-profile.json to /opt/eve/profile.json on the server for eve setup to pick up the profile."
  ).argument("[device]", "Block device e.g. /dev/sdb (omit for interactive script)").action(async (device) => {
    try {
      const script = getCreateUsbScriptPath();
      const args = device ? [script, device] : [script];
      printInfo(`${emojis.info} Running USB creation script...
`);
      await execa2("bash", args, { stdio: "inherit" });
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
  birth.command("install").description("Run server install script from @eve/install (phase scripts)").option("--phase <n>", "Run only phase1 | phase2 | phase3 | all", "all").action(async (opts) => {
    const script = resolveInstallScript();
    if (!script) {
      printError("@eve/install not found. Add workspace dependency and pnpm install.");
      process.exit(1);
    }
    printInfo(`${emojis.info} Install script: ${script}`);
    printInfo(`Phase filter: ${opts.phase ?? "all"} (pass through to script if supported)
`);
    try {
      await execa2("bash", [script], { stdio: "inherit" });
    } catch {
      process.exit(1);
    }
  });
}

// src/commands/setup.ts
import { select as select2, confirm as confirm2, isCancel as isCancel2 } from "@clack/prompts";
import {
  readSetupProfile,
  writeSetupProfile,
  readUsbSetupManifest,
  probeHardware,
  formatHardwareReport
} from "@eve/dna";
import { runBrainInit as runBrainInit2, runInferenceInit } from "@eve/brain";
import { getGlobalCliFlags as getGlobalCliFlags2, outputJson } from "@eve/cli-kit";
function parseProfile(s) {
  if (!s) return null;
  const v = s.trim().toLowerCase().replace(/-/g, "_");
  if (v === "inference_only" || v === "inferenceonly") return "inference_only";
  if (v === "data_pod" || v === "datapod") return "data_pod";
  if (v === "full") return "full";
  return null;
}
function setupCommand(program2) {
  program2.command("setup").description("Three-path guided setup: Ollama+gateway, Synap Data Pod, or both (logical prompts)").option("--profile <p>", "inference_only | data_pod | full").option("--dry-run", "Resolve profile and print plan; do not write state or install").option("--synap-repo <path>", "data_pod / full: path to synap-backend checkout").option("--domain <host>", "data_pod / full: synap install --domain", "localhost").option("--email <email>", "data_pod / full: required if domain is not localhost").option("--model <m>", "inference_only / full: default Ollama model", "llama3.1:8b").option("--with-openclaw", "data_pod / full: synap install --with-openclaw").option("--with-rsshub", "data_pod / full: synap install --with-rsshub").option("--from-image", "synap install --from-image").option("--from-source", "synap install --from-source").option("--skip-hardware", "Skip optional hardware summary").option("--nvidia-smi", "With hardware summary in non-interactive mode, run nvidia-smi").addHelpText(
    "after",
    "\nWhy three paths\n  inference_only \u2014 Local Ollama + Traefik gateway (Basic auth on :11435). Synap is not installed.\n  data_pod      \u2014 Official Synap stack via synap CLI (Caddy on 80/443). Use Eve for extra Docker apps.\n  full          \u2014 data_pod first, then Ollama on Docker network only + same gateway (no host :11434).\n\nState & manifests\n  Writes .eve/setup-profile.json in the current working directory.\n  Pre-filled profile if ~/.eve/usb-profile.json, /opt/eve/profile.json, or EVE_SETUP_MANIFEST exists.\n\nDocs: hestia-cli/docs/EVE_SETUP_PROFILES.md and hestia-cli/README.md\n"
  ).action(async (opts) => {
    const flags = getGlobalCliFlags2();
    const cwd = process.cwd();
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
    if (!profile && !flags.nonInteractive) {
      const choice = await select2({
        message: "Choose setup profile",
        options: [
          {
            value: "inference_only",
            label: "Ollama + gateway",
            hint: "Local models + Traefik Basic auth on :11435 (Synap not installed)"
          },
          {
            value: "data_pod",
            label: "Synap Data Pod only",
            hint: "Official synap install (Caddy on 80/443); Eve for extra Docker apps"
          },
          {
            value: "full",
            label: "Data Pod + Ollama",
            hint: "Synap first, then Ollama on eve-network + gateway :11435"
          }
        ],
        initialValue: profile ?? "data_pod"
      });
      if (isCancel2(choice)) {
        console.log(colors.muted("Cancelled."));
        return;
      }
      profile = choice;
    }
    if (!profile) {
      console.error("Profile required: use --profile inference_only|data_pod|full or run interactively.");
      process.exit(1);
    }
    const existing = await readSetupProfile(cwd);
    if (existing && !flags.nonInteractive && !opts.dryRun) {
      const ok = await confirm2({
        message: `Existing setup profile (${existing.profile}). Overwrite and continue?`,
        initialValue: false
      });
      if (isCancel2(ok) || !ok) {
        console.log(colors.muted("Cancelled."));
        return;
      }
    }
    if (opts.dryRun) {
      const plan = {
        profile,
        existing: existing?.profile ?? null,
        usbManifest: usb ? { target_profile: usb.target_profile } : null
      };
      if (flags.json) outputJson(plan);
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
        const showHw = await confirm2({
          message: "Show optional hardware summary (CPU, RAM, OS)?",
          initialValue: false
        });
        if (!isCancel2(showHw) && showHw) {
          const gpu = await confirm2({
            message: "Also run nvidia-smi (may fail if no NVIDIA GPU)?",
            initialValue: false
          });
          const facts = await probeHardware(!isCancel2(gpu) && Boolean(gpu));
          console.log(`
${colors.primary("Hardware")}
${formatHardwareReport(facts)}
`);
        }
      }
    }
    await writeSetupProfile(
      {
        profile,
        source: usb ? "usb_manifest" : flags.nonInteractive ? "cli" : "wizard",
        domainHint: opts.domain,
        hearthName: usb?.hearth_name
      },
      cwd
    );
    if (flags.json) {
      outputJson({ ok: true, profile, persisted: true });
    }
    try {
      if (profile === "inference_only") {
        await runInferenceInit({
          model: opts.model,
          withGateway: true,
          internalOllamaOnly: false
        });
      } else if (profile === "data_pod") {
        const repo = opts.synapRepo?.trim() || process.env.SYNAP_REPO_ROOT?.trim();
        if (!repo) {
          console.error("data_pod requires --synap-repo or SYNAP_REPO_ROOT");
          process.exit(1);
        }
        await runBrainInit2({
          synapRepo: repo,
          domain: opts.domain,
          email: opts.email,
          withOpenclaw: opts.withOpenclaw,
          withRsshub: opts.withRsshub,
          fromImage: opts.fromImage,
          fromSource: opts.fromSource,
          withAi: false
        });
      } else {
        const repo = opts.synapRepo?.trim() || process.env.SYNAP_REPO_ROOT?.trim();
        if (!repo) {
          console.error("full requires --synap-repo or SYNAP_REPO_ROOT");
          process.exit(1);
        }
        if (!flags.json) {
          console.log(colors.info("\nFull profile: (1) Data Pod  (2) Ollama internal + gateway\n"));
        }
        await runBrainInit2({
          synapRepo: repo,
          domain: opts.domain,
          email: opts.email,
          withOpenclaw: opts.withOpenclaw,
          withRsshub: opts.withRsshub,
          fromImage: opts.fromImage,
          fromSource: opts.fromSource,
          withAi: false
        });
        await runInferenceInit({
          model: opts.model,
          withGateway: true,
          internalOllamaOnly: true
        });
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

// src/commands/debug/logs.ts
import { execa as execa3 } from "execa";
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
      await execa3("docker", args, { stdio: "inherit" });
    } catch (e) {
      printError(
        e instanceof Error ? e.message : "docker compose failed. Set EVE_COMPOSE_FILE or use --compose-file."
      );
      process.exit(1);
    }
  });
}

// src/commands/debug/inspect.ts
import { execa as execa4 } from "execa";
import { entityStateManager as entityStateManager4, configManager } from "@eve/dna";
import { getGlobalCliFlags as getGlobalCliFlags3, outputJson as outputJson2 } from "@eve/cli-kit";
function inspectCommand(program2) {
  program2.command("inspect").description("Dump entity state, config path, and Eve-related containers (JSON)").option("--containers-only", "Only run docker ps filter").action(async (opts) => {
    try {
      let containers = [];
      try {
        const { stdout } = await execa4("docker", [
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
        if (getGlobalCliFlags3().json) {
          outputJson2(payload2);
        } else {
          console.log(JSON.stringify(payload2, null, 2));
        }
        return;
      }
      const state = await entityStateManager4.getState();
      const cfgPath = configManager.getConfigPath();
      const payload = {
        entityState: state,
        configPath: cfgPath,
        containers
      };
      if (getGlobalCliFlags3().json) {
        outputJson2(payload);
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
import { getGlobalCliFlags as getGlobalCliFlags4, outputJson as outputJson3 } from "@eve/cli-kit";
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
      if (getGlobalCliFlags4().json) {
        outputJson3(plain);
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
import { execa as execa5 } from "execa";
function backupUpdateCommands(program2) {
  program2.command("backup").description("List Eve-related Docker volumes (full backup: stop stack + docker run volume export \u2014 see docs)").action(async () => {
    try {
      const { stdout } = await execa5("docker", ["volume", "ls", "--format", "{{.Name}}"]);
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
  program2.command("update").description("Guidance for updating Eve / Synap images (use synap-backend deploy on the Data Pod)").action(() => {
    printInfo(
      "Eve does not replace your Data Pod updater. For Synap: use your deploy directory `./synap update` or pull new images and run migrations as documented in synap-backend/deploy."
    );
    printInfo(`Compose hint: ${colors.muted("docker compose pull && docker compose up -d")} in the directory that owns your stack.`);
  });
}

// src/commands/ai.ts
import { execa as execa6 } from "execa";
import { OllamaService } from "@eve/brain";
import { getGlobalCliFlags as getGlobalCliFlags5, outputJson as outputJson4 } from "@eve/cli-kit";
function aiCommandGroup(program2) {
  const ai = program2.command("ai").description("Local AI (Ollama) helpers");
  ai.command("status").description("Show whether Ollama is running and list models").action(async () => {
    const ollama = new OllamaService();
    try {
      const s = await ollama.getStatus();
      if (getGlobalCliFlags5().json) {
        outputJson4(s);
        return;
      }
      console.log(colors.primary.bold("Ollama"));
      console.log(`  Running: ${s.running ? "yes" : "no"}`);
      console.log(`  Models: ${s.modelsInstalled.length ? s.modelsInstalled.join(", ") : "(none)"}`);
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });
  ai.command("models").description("List models (docker exec ollama list)").action(async () => {
    const ollama = new OllamaService();
    const models = await ollama.listModels();
    if (getGlobalCliFlags5().json) {
      outputJson4({ models });
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
  ai.command("chat").description("Send a one-shot prompt to ollama run (requires CLI on host or use docker exec)").argument("<prompt>", "Prompt text").option("--model <m>", "Model name", "llama3.1:8b").action(async (prompt, opts) => {
    try {
      await execa6(
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

// src/index.ts
var __dirname = dirname2(fileURLToPath(import.meta.url));
var pkg = JSON.parse(readFileSync(join2(__dirname, "../package.json"), "utf-8"));
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
  ${colors.primary("Management")} config, backup, update
  ${colors.primary("AI")}         ai \u2026
`
);
setupCommand(program);
program.command("init").description(
  "Alias for brain init (Eve Docker brain, or full Data Pod with --synap-repo / SYNAP_REPO_ROOT)"
).option("--with-ai", "Include Ollama for local AI").option("--model <model>", "AI model", "llama3.1:8b").option("--synap-repo <path>", "synap-backend checkout \u2192 official synap install").option("--domain <host>", "With --synap-repo: synap install --domain", "localhost").option("--email <email>", "With --synap-repo: required when domain isn't localhost").option("--with-openclaw", "With --synap-repo: synap install --with-openclaw").option("--with-rsshub", "With --synap-repo: synap install --with-rsshub").option("--from-image", "With --synap-repo: synap install --from-image").option("--from-source", "With --synap-repo: synap install --from-source").action(
  async (opts) => {
    try {
      await runBrainInit3({
        withAi: opts.withAi,
        model: opts.model,
        synapRepo: opts.synapRepo,
        domain: opts.domain,
        email: opts.email,
        withOpenclaw: opts.withOpenclaw,
        withRsshub: opts.withRsshub,
        fromImage: opts.fromImage,
        fromSource: opts.fromSource
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
var brain = program.command("brain").description("Intelligence & memory (Synap, DB, Redis, Ollama)");
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