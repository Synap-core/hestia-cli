import {
  RSSHubService
} from "./chunk-RTPTV7YU.js";

// src/commands/install.ts
import { EntityStateManager } from "@eve/dna";
function installCommand(program) {
  program.command("install").description("Install RSSHub for RSS aggregation").option("-p, --port <port>", "RSSHub port", "1200").action(async (options) => {
    try {
      console.log("\u{1F441}\uFE0F  Eve Eyes - Installing RSSHub...\n");
      const rsshub = new RSSHubService();
      const isInstalled = await rsshub.isInstalled();
      if (isInstalled) {
        console.log("\u2705 RSSHub is already installed");
        console.log('   Use "eve eyes:start" to start it\n');
        return;
      }
      console.log("\u{1F4E6} Installing RSSHub...");
      await rsshub.install({
        port: parseInt(options.port, 10)
      });
      const stateManager = new EntityStateManager();
      await stateManager.updateOrgan("eyes", "ready");
      console.log("\n\u2705 RSSHub installed successfully!");
      console.log(`   URL: http://localhost:${options.port}`);
      console.log('   Use "eve eyes:start" to start it\n');
    } catch (error) {
      console.error("\u274C Installation failed:", error);
      process.exit(1);
    }
  });
}

// src/commands/add-feed.ts
function addFeedCommand(program) {
  program.command("add-feed <name> <url>").description("Add an RSS feed to monitor").action(async (name, url) => {
    try {
      console.log(`\u{1F441}\uFE0F  Adding feed: ${name}
`);
      const rsshub = new RSSHubService();
      await rsshub.addFeed(name, url);
      console.log(`
\u2705 Feed "${name}" added successfully!`);
      console.log(`   URL: ${url}`);
      console.log("\nYou can now:");
      console.log("  - List feeds: eve eyes:list-feeds");
      console.log("  - Sync to Brain: eve eyes:sync");
    } catch (error) {
      console.error("\u274C Failed to add feed:", error);
      process.exit(1);
    }
  });
}

// src/commands/list-feeds.ts
function listFeedsCommand(program) {
  program.command("list-feeds").alias("eyes:ls").description("List all RSS feeds").action(async () => {
    try {
      console.log("\u{1F441}\uFE0F  Eve Eyes - Listing feeds...\n");
      const rsshub = new RSSHubService();
      const feeds = await rsshub.listFeeds();
      if (feeds.length === 0) {
        console.log("No feeds configured yet.");
        console.log("Add one with: eve eyes:add-feed <name> <url>");
      } else {
        console.log(`Found ${feeds.length} feed(s):
`);
        feeds.forEach((feed, i) => {
          console.log(`  ${i + 1}. ${feed.name}`);
          console.log(`     URL: ${feed.url}`);
          console.log(`     Status: ${feed.status}
`);
        });
      }
    } catch (error) {
      console.error("\u274C Failed to list feeds:", error);
      process.exit(1);
    }
  });
}

// src/commands/remove-feed.ts
function removeFeedCommand(program) {
  program.command("remove-feed <name>").alias("eyes:rm").description("Remove an RSS feed").action(async (name) => {
    try {
      console.log(`\u{1F441}\uFE0F  Removing feed: ${name}
`);
      const rsshub = new RSSHubService();
      await rsshub.removeFeed(name);
      console.log(`
\u2705 Feed "${name}" removed successfully!`);
    } catch (error) {
      console.error("\u274C Failed to remove feed:", error);
      process.exit(1);
    }
  });
}

// src/commands/start.ts
function startCommand(program) {
  program.command("start").description("Start RSSHub service").action(async () => {
    try {
      console.log("\u{1F441}\uFE0F  Starting RSSHub...\n");
      const rsshub = new RSSHubService();
      await rsshub.start();
      console.log("\n\u2705 RSSHub started successfully!");
    } catch (error) {
      console.error("\u274C Failed to start:", error);
      process.exit(1);
    }
  });
}

// src/commands/stop.ts
function stopCommand(program) {
  program.command("stop").description("Stop RSSHub service").action(async () => {
    try {
      console.log("\u{1F441}\uFE0F  Stopping RSSHub...\n");
      const rsshub = new RSSHubService();
      await rsshub.stop();
      console.log("\n\u2705 RSSHub stopped successfully!");
    } catch (error) {
      console.error("\u274C Failed to stop:", error);
      process.exit(1);
    }
  });
}

// src/commands/sync.ts
function syncCommand(program) {
  program.command("sync").description("Sync RSS feeds to Brain").action(async () => {
    try {
      console.log("\u{1F441}\uFE0F  Syncing feeds to Brain...\n");
      const rsshub = new RSSHubService();
      await rsshub.syncToBrain();
      console.log("\n\u2705 Feeds synced successfully!");
    } catch (error) {
      console.error("\u274C Failed to sync:", error);
      process.exit(1);
    }
  });
}

// src/commands/database.ts
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
function parsePostgresUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return null;
    const database = u.pathname.replace(/^\//, "").split("/")[0] ?? "";
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database,
      ssl: u.searchParams.get("sslmode") === "require" || u.searchParams.get("ssl") === "true"
    };
  } catch {
    return null;
  }
}
function eyesDir(cwd) {
  return join(cwd, ".eve", "eyes");
}
function databaseCommand(program) {
  const db = program.command("database").description("Outerbase Studio (npm CLI) for Postgres \u2014 see https://www.npmjs.com/package/@outerbase/studio");
  db.command("init").description("Write outerbase.json template (Postgres via DATABASE_URL)").requiredOption("--database-url <url>", "postgres://user:pass@host:5432/dbname").option("--port <n>", "Studio listen port", "4000").option("--user <u>", "HTTP Basic auth user for Studio UI").option("--pass <p>", "HTTP Basic auth password for Studio UI").action((opts) => {
    const cwd = process.cwd();
    const parsed = parsePostgresUrl(opts.databaseUrl);
    if (!parsed) {
      console.error("Invalid --database-url (expected postgres://...)");
      process.exit(1);
    }
    const dir = eyesDir(cwd);
    mkdirSync(dir, { recursive: true });
    const config = {
      driver: "postgres",
      port: Number(opts.port) || 4e3,
      connection: {
        database: parsed.database,
        host: parsed.host,
        port: parsed.port,
        user: parsed.user,
        password: parsed.password,
        ssl: parsed.ssl
      },
      ...opts.user && opts.pass ? { auth: { username: opts.user, password: opts.pass } } : {}
    };
    const path = join(dir, "outerbase.json");
    writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
    console.log(`Wrote ${path}`);
    console.log(
      "Note: @outerbase/studio embeds UI from studio.outerbase.com \u2014 offline/air-gapped hosts cannot render the UI."
    );
  });
  const COMPOSE = `services:
  outerbase-studio:
    image: node:22-bookworm-slim
    container_name: eve-eyes-outerbase
    restart: unless-stopped
    working_dir: /config
    volumes:
      - ./outerbase.json:/config/outerbase.json:ro
    ports:
      - "127.0.0.1:\${OUTERBASE_HOST_PORT}:4000"
    command: ["bash", "-lc", "npm install -g @outerbase/studio@0.2.7 && exec studio --config=/config/outerbase.json --port=4000"]
    networks:
      - eve-network

networks:
  eve-network:
    external: true
`.trim();
  db.command("up").description("docker compose up Outerbase Studio (run database init first)").option("--port <n>", "Host port to bind", "4005").action((opts) => {
    const cwd = process.cwd();
    const dir = eyesDir(cwd);
    const cfg = join(dir, "outerbase.json");
    if (!existsSync(cfg)) {
      console.error("Missing outerbase.json. Run: eve eyes database init --database-url ...");
      process.exit(1);
    }
    const composeFile = join(dir, "outerbase-compose.yml");
    mkdirSync(dir, { recursive: true });
    writeFileSync(composeFile, COMPOSE, "utf-8");
    try {
      execSync("docker network create eve-network", { stdio: "ignore" });
    } catch {
    }
    const env = {
      ...process.env,
      OUTERBASE_HOST_PORT: opts.port ?? "4005"
    };
    execSync(`docker compose -f "${composeFile}" up -d`, {
      stdio: "inherit",
      cwd: dir,
      env
    });
    console.log(`
Outerbase Studio: http://127.0.0.1:${opts.port ?? "4005"}
`);
  });
  db.command("down").description("Stop Outerbase Studio container").action(() => {
    const cwd = process.cwd();
    const dir = eyesDir(cwd);
    const composeFile = join(dir, "outerbase-compose.yml");
    if (!existsSync(composeFile)) {
      console.log("No compose file");
      return;
    }
    execSync(`docker compose -f "${composeFile}" down`, { stdio: "inherit", cwd: dir });
  });
}

// src/index.ts
function registerEyesCommands(eyes) {
  installCommand(eyes);
  addFeedCommand(eyes);
  listFeedsCommand(eyes);
  removeFeedCommand(eyes);
  startCommand(eyes);
  stopCommand(eyes);
  syncCommand(eyes);
  databaseCommand(eyes);
}
async function createRSSHubService(config) {
  const { RSSHubService: RSSHubService2 } = await import("./rsshub-JREOU6CE.js");
  return new RSSHubService2(config);
}
export {
  RSSHubService,
  addFeedCommand,
  createRSSHubService,
  databaseCommand,
  installCommand,
  listFeedsCommand,
  registerEyesCommands,
  removeFeedCommand,
  startCommand,
  stopCommand,
  syncCommand
};
