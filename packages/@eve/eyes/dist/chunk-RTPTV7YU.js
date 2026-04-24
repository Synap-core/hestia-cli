// src/lib/rsshub.ts
import { exec } from "child_process";
import { promisify } from "util";
import { execa, resolveSynapDelegate } from "@eve/brain";
var execAsync = promisify(exec);
var RSSHubService = class {
  config;
  feeds = [];
  constructor(config = {}) {
    this.config = {
      port: config.port ?? 1200
    };
  }
  /**
   * Check if RSSHub is installed
   */
  async isInstalled() {
    try {
      const { stdout } = await execAsync(
        'docker images rsshub/rsshub --format "{{.Repository}}"'
      );
      return stdout.trim() === "rsshub/rsshub";
    } catch {
      return false;
    }
  }
  /**
   * Check if RSSHub container is running
   */
  async isRunning() {
    try {
      const { stdout } = await execAsync(
        'docker ps --filter "name=eve-eyes-rsshub" --format "{{.Names}}"'
      );
      return stdout.trim() === "eve-eyes-rsshub";
    } catch {
      return false;
    }
  }
  /**
   * Install RSSHub container
   */
  async install(config) {
    const synapPod = resolveSynapDelegate();
    if (synapPod) {
      console.log("RSSHub: enabling Synap compose profile (rsshub + browserless)...");
      await execa("bash", [synapPod.synapScript, "profiles", "enable", "rsshub"], {
        cwd: synapPod.repoRoot,
        env: { ...process.env, SYNAP_DEPLOY_DIR: synapPod.deployDir },
        stdio: "inherit"
      });
      return;
    }
    const port = config?.port ?? this.config.port;
    console.log(`Pulling RSSHub image...`);
    await execAsync("docker pull rsshub/rsshub:latest");
    console.log(`Starting RSSHub on port ${port}...`);
    await execAsync(
      `docker run -d --name eve-eyes-rsshub --network eve-network -p ${port}:1200 rsshub/rsshub:latest`
    );
  }
  /**
   * Start RSSHub container
   */
  async start() {
    const synapPod = resolveSynapDelegate();
    if (synapPod) {
      await execa("bash", [synapPod.synapScript, "profiles", "enable", "rsshub"], {
        cwd: synapPod.repoRoot,
        env: { ...process.env, SYNAP_DEPLOY_DIR: synapPod.deployDir },
        stdio: "inherit"
      });
      console.log("RSSHub profile started (Synap stack)");
      return;
    }
    if (await this.isRunning()) {
      console.log("RSSHub is already running");
      return;
    }
    await execAsync("docker start eve-eyes-rsshub");
    console.log("RSSHub started");
  }
  /**
   * Stop RSSHub container
   */
  async stop() {
    await execAsync("docker stop eve-eyes-rsshub");
    console.log("RSSHub stopped");
  }
  /**
   * Add a feed
   */
  async addFeed(name, url) {
    this.feeds.push({
      name,
      url,
      status: "active",
      lastFetch: /* @__PURE__ */ new Date()
    });
    console.log(`Feed "${name}" added`);
  }
  /**
   * List all feeds
   */
  async listFeeds() {
    return this.feeds;
  }
  /**
   * Remove a feed
   */
  async removeFeed(name) {
    this.feeds = this.feeds.filter((f) => f.name !== name);
    console.log(`Feed "${name}" removed`);
  }
  /**
   * Sync feeds to Brain
   */
  async syncToBrain() {
    console.log(`Syncing ${this.feeds.length} feeds to Brain...`);
  }
};

export {
  RSSHubService
};
