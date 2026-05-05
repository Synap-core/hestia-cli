/**
 * OpenClaw configuration — MCP servers (docker-exec'd) + voice/messaging
 * (persisted in secrets.json).
 *
 * Mirrors what `eve arms mcp/voice/messaging` does via the @eve/arms
 * package. The dashboard reaches into the OpenClaw container the same way
 * the CLI does.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readEveSecrets, writeEveSecrets } from "@eve/dna";

const execFileAsync = promisify(execFile);

/**
 * Pipe `data` to the stdin of `docker exec <CONTAINER> sh -c '<command>'`.
 *
 * Used by `installMcpPreset` to drop a JSON config into the container without
 * embedding the JSON in the shell command (single quotes are unsafe for
 * arbitrary content; even the JSON we generate could contain quotes via a
 * future preset name).
 */
function pipeToContainer(args: string[], data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (b) => { stderr += b.toString("utf-8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker exited ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(data);
  });
}

const CONTAINER = "eve-arms-openclaw";

// ---------------------------------------------------------------------------
// MCP — installed servers live as `/data/mcp-<name>.json` inside the
// OpenClaw container. Each file is the MCP config for that server.
// ---------------------------------------------------------------------------

export interface McpServer {
  name: string;
  command: string;
  args: string[];
}

export const MCP_PRESETS: Record<string, { command: string; args: string[]; description: string }> = {
  filesystem: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
    description: "Read + write files in /home/user from inside OpenClaw.",
  },
  github: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    description: "Search code, read PRs/issues, post comments via the GitHub API.",
  },
  postgres: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/db"],
    description: "Query Postgres databases (edit the connection string after install).",
  },
  sqlite: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite", "/path/to/db.sqlite"],
    description: "Query a local SQLite database.",
  },
  puppeteer: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    description: "Drive a headless Chrome browser for scraping + automation.",
  },
};

export async function listMcpServers(): Promise<McpServer[]> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["exec", CONTAINER, "ls", "/data/"],
      { encoding: "utf-8" },
    );
    const names = stdout
      .split("\n")
      .filter(f => f.startsWith("mcp-") && f.endsWith(".json"))
      .map(f => f.replace(/^mcp-/, "").replace(/\.json$/, ""));

    // Read each config in parallel — best effort; missing/invalid files
    // just become empty entries with default command/args.
    const servers = await Promise.all(names.map(async (name): Promise<McpServer> => {
      try {
        const { stdout: raw } = await execFileAsync(
          "docker",
          ["exec", CONTAINER, "cat", `/data/mcp-${name}.json`],
          { encoding: "utf-8" },
        );
        const cfg = JSON.parse(raw) as { mcpServers?: Record<string, { command?: string; args?: string[] }> };
        const inner = cfg.mcpServers?.[name];
        return {
          name,
          command: inner?.command ?? "",
          args: inner?.args ?? [],
        };
      } catch {
        return { name, command: "", args: [] };
      }
    }));

    return servers;
  } catch {
    return [];
  }
}

export async function installMcpPreset(presetName: string): Promise<McpServer> {
  if (!/^[a-zA-Z0-9_-]+$/.test(presetName)) {
    throw new Error(`Invalid MCP preset name: ${presetName}`);
  }
  const preset = MCP_PRESETS[presetName];
  if (!preset) throw new Error(`Unknown MCP preset: ${presetName}`);

  const config = JSON.stringify({
    mcpServers: { [presetName]: { command: preset.command, args: preset.args } },
  });

  // Pipe via stdin so the JSON never travels through the shell. Safe under
  // arbitrary content (quotes, $, backticks). The presetName is regex-validated
  // above so `/data/mcp-${presetName}.json` is also safe.
  await pipeToContainer(
    ["exec", "-i", CONTAINER, "sh", "-c", `cat > /data/mcp-${presetName}.json`],
    config,
  );

  return { name: presetName, command: preset.command, args: preset.args };
}

export async function removeMcpServer(name: string): Promise<void> {
  // Refuse path traversal — the name shows up in a shell command.
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid MCP server name: ${name}`);
  }
  await execFileAsync("docker", [
    "exec", CONTAINER, "rm", "-f", `/data/mcp-${name}.json`,
  ]);
}

// ---------------------------------------------------------------------------
// Voice + messaging — persisted under secrets.json `arms.voice` / `arms.messaging`.
// ---------------------------------------------------------------------------

export type VoiceProvider = "twilio" | "signal" | "selfhosted";

export interface VoiceConfig {
  enabled: boolean;
  provider?: VoiceProvider;
  phoneNumber?: string;
  sipUri?: string;
}

export type MessagingPlatform = "telegram" | "discord" | "signal" | "matrix";

export interface MessagingConfig {
  enabled: boolean;
  platform?: MessagingPlatform;
  /** Returned redacted on read; clients must explicitly send a new token to update. */
  hasToken: boolean;
}

export async function getVoiceConfig(): Promise<VoiceConfig> {
  const s = await readEveSecrets();
  const v = s?.arms?.voice;
  return {
    enabled: v?.enabled ?? false,
    provider: v?.provider,
    phoneNumber: v?.phoneNumber,
    sipUri: v?.sipUri,
  };
}

export async function setVoiceConfig(input: Partial<VoiceConfig>): Promise<VoiceConfig> {
  await writeEveSecrets({
    arms: {
      voice: {
        enabled: input.enabled ?? false,
        provider: input.provider,
        phoneNumber: input.phoneNumber,
        sipUri: input.sipUri,
      },
    },
  });
  return getVoiceConfig();
}

export async function getMessagingConfig(): Promise<MessagingConfig> {
  const s = await readEveSecrets();
  const m = s?.arms?.messaging;
  return {
    enabled: m?.enabled ?? false,
    platform: m?.platform,
    hasToken: Boolean(m?.botToken && m.botToken.length > 0),
  };
}

export async function setMessagingConfig(input: {
  enabled: boolean;
  platform?: MessagingPlatform;
  botToken?: string;  // when undefined, the existing token is preserved
}): Promise<MessagingConfig> {
  // Preserve the token when the caller didn't send one — simplifies the UI
  // (forms can update enabled/platform without re-typing the secret).
  const current = await readEveSecrets();
  const existingToken = current?.arms?.messaging?.botToken;

  await writeEveSecrets({
    arms: {
      messaging: {
        enabled: input.enabled,
        platform: input.platform,
        botToken: input.botToken !== undefined ? input.botToken : existingToken,
      },
    },
  });
  return getMessagingConfig();
}
