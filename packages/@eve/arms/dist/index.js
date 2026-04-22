// src/lib/openclaw.ts
import { spawn } from "child_process";
import { setTimeout } from "timers/promises";
var OPENCLAW_CONTAINER = "eve-arms-openclaw";
var OPENCLAW_PORT = 3e3;
var OpenClawService = class {
  config = {
    ollamaUrl: "http://eve-brain-ollama:11434",
    model: "llama3.2"
  };
  /**
   * Install OpenClaw container
   */
  async install() {
    console.log("\u{1F4E6} Installing OpenClaw...");
    await this.runDockerCommand([
      "pull",
      "ghcr.io/openclaw/openclaw:latest"
    ]);
    console.log("\u2705 OpenClaw image pulled");
  }
  /**
   * Configure OpenClaw to use Ollama
   */
  async configure(ollamaUrl) {
    this.config.ollamaUrl = ollamaUrl;
    console.log(`\u2699\uFE0F  Configured OpenClaw to use Ollama at ${ollamaUrl}`);
  }
  setIntegration(integration) {
    this.config.synapApiUrl = integration.synapApiUrl;
    this.config.synapApiKey = integration.synapApiKey;
    this.config.dokployApiUrl = integration.dokployApiUrl;
  }
  /**
   * Configure messaging platform (Telegram, Signal, Matrix).
   * Writes config and updates running container with env vars.
   */
  async configureMessaging(platform, config) {
    console.log(`Configuring ${platform} messaging...`);
    this.config.messaging = { ...this.config.messaging, enabled: true, platform, ...config };
    console.log(`\u2705 ${platform} messaging configured`);
  }
  /**
   * Configure voice/telephony (Twilio, Signal, self-hosted SIP).
   */
  async configureVoice(config) {
    console.log("Configuring voice/telephony...");
    this.config.voice = { ...this.config.voice, enabled: true, ...config };
    console.log("\u2705 Voice configured");
  }
  /**
   * Start OpenClaw container
   */
  async start() {
    const isRunning = await this.isRunning();
    if (isRunning) {
      console.log("\u{1F916} OpenClaw is already running");
      return;
    }
    console.log("\u{1F680} Starting OpenClaw...");
    await this.runDockerCommand([
      "run",
      "-d",
      "--name",
      OPENCLAW_CONTAINER,
      "--network",
      "eve-network",
      "-p",
      `${OPENCLAW_PORT}:3000`,
      "-e",
      `OLLAMA_URL=${this.config.ollamaUrl}`,
      "-e",
      `DEFAULT_MODEL=${this.config.model}`,
      "-e",
      `SYNAP_API_URL=${this.config.synapApiUrl ?? ""}`,
      "-e",
      `SYNAP_API_KEY=${this.config.synapApiKey ?? ""}`,
      "-e",
      `DOKPLOY_API_URL=${this.config.dokployApiUrl ?? ""}`,
      "-e",
      `MESSAGING_ENABLED=${this.config.messaging?.enabled ?? false}`,
      "-e",
      `MESSAGING_PLATFORM=${this.config.messaging?.platform ?? ""}`,
      "-e",
      `MESSAGING_BOT_TOKEN=${this.config.messaging?.botToken ?? ""}`,
      "-e",
      `VOICE_ENABLED=${this.config.voice?.enabled ?? false}`,
      "-e",
      `VOICE_PROVIDER=${this.config.voice?.provider ?? ""}`,
      "-e",
      `VOICE_PHONE_NUMBER=${this.config.voice?.phoneNumber ?? ""}`,
      "-e",
      `VOICE_SIP_URI=${this.config.voice?.sipUri ?? ""}`,
      "-v",
      "eve-arms-openclaw-data:/data",
      "--restart",
      "unless-stopped",
      "ghcr.io/openclaw/openclaw:latest"
    ]);
    await setTimeout(3e3);
    console.log(`\u2705 OpenClaw started on port ${OPENCLAW_PORT}`);
  }
  /**
   * Stop OpenClaw container
   */
  async stop() {
    const isRunning = await this.isRunning();
    if (!isRunning) {
      console.log("\u{1F916} OpenClaw is not running");
      return;
    }
    console.log("\u{1F6D1} Stopping OpenClaw...");
    await this.runDockerCommand(["stop", OPENCLAW_CONTAINER]);
    await this.runDockerCommand(["rm", OPENCLAW_CONTAINER]);
    console.log("\u2705 OpenClaw stopped");
  }
  /**
   * Check if OpenClaw is running
   */
  async isRunning() {
    try {
      const output = await this.runDockerCommand(
        ["ps", "--filter", `name=${OPENCLAW_CONTAINER}`, "--format", "{{.Names}}"],
        true
      );
      return output.includes(OPENCLAW_CONTAINER);
    } catch {
      return false;
    }
  }
  /**
   * Install an MCP server
   */
  async installMCPServer(name, config) {
    console.log(`\u{1F50C} Installing MCP server: ${name}...`);
    const mcpConfig = {
      mcpServers: {
        [name]: config
      }
    };
    const configJson = JSON.stringify(mcpConfig);
    await this.runDockerCommand([
      "exec",
      OPENCLAW_CONTAINER,
      "sh",
      "-c",
      `echo '${configJson}' > /data/mcp-${name}.json`
    ]);
    console.log(`\u2705 MCP server ${name} installed`);
  }
  /**
   * List installed MCP servers
   */
  async listMCPServers() {
    try {
      const output = await this.runDockerCommand(
        ["exec", OPENCLAW_CONTAINER, "ls", "/data/"],
        true
      );
      return output.split("\n").filter((f) => f.startsWith("mcp-") && f.endsWith(".json")).map((f) => f.replace("mcp-", "").replace(".json", ""));
    } catch {
      return [];
    }
  }
  /**
   * Get OpenClaw status
   */
  async getStatus() {
    const running = await this.isRunning();
    return {
      running,
      url: `http://localhost:${OPENCLAW_PORT}`,
      model: this.config.model || "llama3.2"
    };
  }
  /**
   * Run a Docker command and return output
   */
  runDockerCommand(args, returnOutput = false) {
    return new Promise((resolve, reject) => {
      const proc = spawn("docker", args, {
        stdio: returnOutput ? ["ignore", "pipe", "pipe"] : "inherit"
      });
      let output = "";
      if (returnOutput) {
        proc.stdout?.on("data", (data) => {
          output += data.toString();
        });
      }
      proc.on("close", (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Docker command failed with code ${code}`));
        }
      });
      proc.on("error", reject);
    });
  }
};
var openclaw = new OpenClawService();

// src/commands/install.ts
import { EntityStateManager, readEveSecrets } from "@eve/dna";
import { execa, resolveSynapDelegate } from "@eve/brain";
function installCommand(program) {
  program.command("install").description("Install OpenClaw AI assistant").action(async () => {
    try {
      console.log("\u{1F9BE} Eve Arms - Installing OpenClaw...\n");
      const stateManager = new EntityStateManager();
      const state = await stateManager.getState();
      const brainStatus = state.organs.brain;
      if (brainStatus.state !== "ready") {
        console.error('\u274C Brain is not ready. Please run "eve brain init" first.');
        process.exit(1);
      }
      console.log("\u2705 Brain is ready");
      const synapPod = resolveSynapDelegate();
      if (synapPod) {
        console.log("\u2705 Synap Data Pod detected \u2014 using synap profiles + services\n");
        await execa("bash", [synapPod.synapScript, "profiles", "enable", "openclaw"], {
          cwd: synapPod.repoRoot,
          env: { ...process.env, SYNAP_DEPLOY_DIR: synapPod.deployDir },
          stdio: "inherit"
        });
        await execa("bash", [synapPod.synapScript, "services", "add", "openclaw"], {
          cwd: synapPod.repoRoot,
          env: { ...process.env, SYNAP_DEPLOY_DIR: synapPod.deployDir, SYNAP_ASSUME_YES: "1" },
          stdio: "inherit"
        });
        await stateManager.updateOrgan("arms", "ready");
        console.log("\n\u{1F389} OpenClaw provisioned via Synap.");
        console.log("   See: synap services status openclaw");
        return;
      }
      if (state.aiModel === "none") {
        console.error('\u274C Ollama is not configured. Please run "eve brain init --with-ai" first.');
        process.exit(1);
      }
      console.log("\u2705 Ollama is configured");
      const openclaw2 = new OpenClawService();
      await openclaw2.install();
      const secrets = await readEveSecrets(process.cwd());
      const ollamaUrl = secrets?.inference?.gatewayUrl ?? secrets?.inference?.ollamaUrl ?? "http://eve-brain-ollama:11434";
      await openclaw2.configure(ollamaUrl);
      openclaw2.setIntegration({
        synapApiUrl: secrets?.synap?.apiUrl,
        synapApiKey: secrets?.arms?.openclaw?.synapApiKey ?? secrets?.synap?.apiKey,
        dokployApiUrl: secrets?.builder?.dokployApiUrl
      });
      await openclaw2.start();
      await stateManager.updateOrgan("arms", "ready");
      console.log("\n\u{1F389} OpenClaw installed successfully!");
      console.log("   Access it at: http://localhost:3000");
      console.log("\n   Next steps:");
      console.log("   - eve arms mcp list        # List MCP servers");
      console.log("   - eve arms mcp preset      # Install an MCP server preset");
      console.log("   - eve arms messaging configure # Configure messaging bridge");
      console.log("   - eve arms voice configure   # Configure voice/telephony");
    } catch (error) {
      console.error("\u274C Installation failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
}

// src/commands/start.ts
function startCommand(program) {
  program.command("start").description("Start OpenClaw AI assistant").action(async () => {
    try {
      console.log("\u{1F680} Starting OpenClaw...\n");
      await openclaw.start();
      const status = await openclaw.getStatus();
      console.log("\n\u{1F389} OpenClaw is ready!");
      console.log(`   URL: ${status.url}`);
      console.log(`   Model: ${status.model}`);
    } catch (error) {
      console.error("\u274C Failed to start OpenClaw:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
}

// src/commands/stop.ts
function stopCommand(program) {
  program.command("stop").description("Stop OpenClaw AI assistant").action(async () => {
    try {
      console.log("\u{1F6D1} Stopping OpenClaw...\n");
      await openclaw.stop();
      console.log("\n\u2705 OpenClaw stopped");
    } catch (error) {
      console.error("\u274C Failed to stop OpenClaw:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
}

// src/commands/mcp.ts
function mcpCommand(program) {
  const mcp = program.command("mcp").description("Manage MCP (Model Context Protocol) servers");
  mcp.command("list").description("List installed MCP servers").action(async () => {
    try {
      const servers = await openclaw.listMCPServers();
      if (servers.length === 0) {
        console.log("No MCP servers installed");
        console.log("\nInstall one with: eve arms mcp install <name>");
        return;
      }
      console.log("Installed MCP servers:\n");
      servers.forEach((name) => {
        console.log(`  \u2022 ${name}`);
      });
    } catch (error) {
      console.error("\u274C Failed to list MCP servers:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
  mcp.command("install <name>").description("Install an MCP server").option("-c, --command <cmd>", "Command to run the MCP server", "npx").option("-a, --args <args>", "Arguments (comma-separated)", "-y,@modelcontextprotocol/server-filesystem").action(async (name, options) => {
    try {
      console.log(`\u{1F50C} Installing MCP server: ${name}...
`);
      const config = {
        command: options.command,
        args: options.args.split(",")
      };
      await openclaw.installMCPServer(name, config);
      console.log(`
\u2705 MCP server "${name}" installed`);
      console.log("   Restart OpenClaw to apply changes:");
      console.log("   eve arms stop && eve arms start");
    } catch (error) {
      console.error("\u274C Failed to install MCP server:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
  mcp.command("preset <name>").description("Install a preset MCP server (filesystem, github, postgres, etc.)").action(async (name) => {
    try {
      const presets = {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
        },
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"]
        },
        postgres: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/db"]
        },
        sqlite: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-sqlite", "/path/to/db.sqlite"]
        },
        puppeteer: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-puppeteer"]
        }
      };
      const preset = presets[name];
      if (!preset) {
        console.error(`\u274C Unknown preset: ${name}`);
        console.log("\nAvailable presets:");
        Object.keys(presets).forEach((p) => console.log(`  \u2022 ${p}`));
        process.exit(1);
      }
      console.log(`\u{1F50C} Installing MCP preset: ${name}...
`);
      await openclaw.installMCPServer(name, preset);
      console.log(`
\u2705 MCP preset "${name}" installed`);
      console.log("   Restart OpenClaw to apply changes");
    } catch (error) {
      console.error("\u274C Failed to install MCP preset:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
}

// src/commands/messaging.ts
function messagingCommand(program) {
  const messaging = program.command("messaging").description("Manage messaging platform bridges (Telegram, Signal, Matrix)");
  messaging.command("status").description("Show current messaging configuration").action(async () => {
    try {
      const status = await openclaw.getStatus();
      if (!status.running) {
        console.log("\u274C OpenClaw is not running \u2014 messaging is unavailable");
        return;
      }
      console.log("Messaging configuration:");
      console.log(`  Platform: ${openclaw["config"].messaging?.platform ?? "(not configured)"}`);
      console.log(`  Enabled: ${openclaw["config"].messaging?.enabled ?? false}`);
      console.log(`  Bot Token: ${openclaw["config"].messaging?.botToken ? "***configured***" : "(not set)"}`);
    } catch (error) {
      console.error("\u274C Failed to get messaging status:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
  messaging.command("configure <platform>").description("Configure a messaging platform (telegram, signal, matrix)").option("-t, --token <token>", "Bot token").action(async (platform, options) => {
    try {
      if (!options.token) {
        console.error(`\u274C --token is required for ${platform} configuration`);
        console.log("\nGet your bot token from:");
        console.log(`  - Telegram: @BotFather on Telegram`);
        console.log(`  - Signal: check your Signal configuration`);
        console.log(`  - Matrix: check your Matrix Synapse configuration`);
        process.exit(1);
      }
      await openclaw.configureMessaging(platform, { botToken: options.token });
      console.log("\n\u2705 Messaging configured for " + platform);
      console.log("   Restart OpenClaw to apply changes:");
      console.log("   eve arms stop && eve arms start");
    } catch (error) {
      console.error("\u274C Failed to configure messaging:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
  messaging.command("remove").description("Remove messaging configuration").action(async () => {
    try {
      console.log("Removing messaging configuration...");
      console.log("\u2705 Messaging disabled (will persist until reconfigured)");
      console.log("   Restart OpenClaw to apply changes:");
      console.log("   eve arms stop && eve arms start");
    } catch (error) {
      console.error("\u274C Failed to remove messaging:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
}

// src/commands/voice.ts
function voiceCommand(program) {
  const voice = program.command("voice").description("Manage voice/telephony configuration (Twilio, Signal, SIP)");
  voice.command("status").description("Show current voice configuration").action(async () => {
    try {
      const status = await openclaw.getStatus();
      if (!status.running) {
        console.log("\u274C OpenClaw is not running \u2014 voice is unavailable");
        return;
      }
      console.log("Voice configuration:");
      console.log(`  Provider: ${openclaw["config"].voice?.provider ?? "(not configured)"}`);
      console.log(`  Enabled: ${openclaw["config"].voice?.enabled ?? false}`);
      if (openclaw["config"].voice?.phoneNumber) {
        console.log(`  Phone Number: ${openclaw["config"].voice.phoneNumber}`);
      }
      if (openclaw["config"].voice?.sipUri) {
        console.log(`  SIP URI: ${openclaw["config"].voice.sipUri}`);
      }
    } catch (error) {
      console.error("\u274C Failed to get voice status:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
  voice.command("configure <provider>").description("Configure voice provider (twilio, signal, selfhosted)").option("-p, --phone <number>", "Phone number (e.g. +1234567890)").option("-s, --sip-uri <uri>", "SIP URI (e.g. sip:bot@example.com)").action(async (provider, options) => {
    try {
      const voiceConfig = {
        provider
      };
      if (options.phone) voiceConfig.phoneNumber = options.phone;
      if (options.sipUri) voiceConfig.sipUri = options.sipUri;
      if (provider === "twilio" && !options.phone) {
        console.error("\u274C --phone is required for twilio configuration");
        process.exit(1);
      }
      if (provider === "selfhosted" && !options.sipUri) {
        console.error("\u274C --sip-uri is required for selfhosted configuration");
        process.exit(1);
      }
      await openclaw.configureVoice(voiceConfig);
      console.log("\n\u2705 Voice configured for " + provider);
      console.log("   Restart OpenClaw to apply changes:");
      console.log("   eve arms stop && eve arms start");
    } catch (error) {
      console.error("\u274C Failed to configure voice:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
}

// src/index.ts
function registerArmsCommands(arms) {
  installCommand(arms);
  startCommand(arms);
  stopCommand(arms);
  mcpCommand(arms);
  messagingCommand(arms);
  voiceCommand(arms);
  arms.command("status").description("Check OpenClaw status").action(async () => {
    try {
      const status = await openclaw.getStatus();
      console.log("\u{1F9BE} Arms Status:\n");
      console.log(`  Running: ${status.running ? "\u2705 Yes" : "\u274C No"}`);
      console.log(`  URL: ${status.url}`);
      console.log(`  Model: ${status.model}`);
    } catch (error) {
      console.error("\u274C Failed to get status:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
}
function registerCommands(program) {
  const arms = program.command("arms").description("Manage OpenClaw AI assistant and MCP servers");
  registerArmsCommands(arms);
}
export {
  OpenClawService,
  installCommand,
  mcpCommand,
  messagingCommand,
  openclaw,
  registerArmsCommands,
  registerCommands,
  startCommand,
  stopCommand,
  voiceCommand
};
