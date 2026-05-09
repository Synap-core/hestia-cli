/**
 * Discord.js bot session manager (module-scoped singleton).
 *
 * Eve's "Connect Discord" path uses Discord.js to listen for messages via the
 * Gateway API. The bot token is read from `~/.eve/secrets.json` (stored by
 * the Connect Channels modal or `eve messaging configure discord`).
 *
 * Each inbound message is normalized and POSTed to the Synap pod's Hub
 * Protocol channel-gateway inbound endpoint, making Discord messages appear
 * in Synap and the Agents page event stream.
 *
 * IMPORTANT — Privileged Intents: this bot requires the "Message Content"
 * privileged intent to be enabled in the Discord Developer Portal under
 * Bot → Privileged Gateway Intents. Without it, `message.content` will
 * be empty for messages not directed at the bot.
 *
 * Lifecycle:
 *   • initSession()   — login with stored token, wire messageCreate listener
 *   • getStatus()     — read current state without side effects
 *   • disconnect()    — logout + reset state
 *
 * Not-safe-for-multiple-Next-instances: dev-mode HMR will reload this module
 * and lose the in-memory client. For production (`next start`) the module is
 * loaded once and the client lives for the lifetime of the process.
 */

import { readEveSecrets, resolvePodUrl, readAgentKeyOrLegacySync } from "@eve/dna";

// Discord.js is loaded lazily so the heavy gateway modules only initialize
// when the API route is actually hit.
type DiscordModule = typeof import("discord.js");
let discordPromise: Promise<DiscordModule> | null = null;

function loadDiscord(): Promise<DiscordModule> {
  if (!discordPromise) {
    discordPromise = import("discord.js");
  }
  return discordPromise;
}

export type DiscordStatus =
  | { kind: "disconnected" }
  | { kind: "connecting" }
  | { kind: "connected"; botName: string; botId: string }
  | { kind: "error"; message: string };

interface InternalState {
  status: DiscordStatus;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any | null;
}

const state: InternalState = {
  status: { kind: "disconnected" },
  client: null,
};

/**
 * Boot a new Discord.js Client with the stored bot token. If already
 * connected, returns the current status without restarting.
 */
export async function initSession(): Promise<DiscordStatus> {
  if (state.status.kind === "connected") return state.status;

  const secrets = await readEveSecrets();
  const token = secrets?.channels?.discord?.botToken;
  if (!token) {
    state.status = { kind: "error", message: "No Discord bot token configured. Save one via the Connect Channels modal." };
    return state.status;
  }

  // Tear down any stale client before creating a new one.
  if (state.client) {
    try { await state.client.destroy(); } catch { /* ignore */ }
    state.client = null;
  }

  const { Client, GatewayIntentBits } = await loadDiscord();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  state.client = client;
  state.status = { kind: "connecting" };

  client.once("ready", (bot: { user: { username: string; id: string } }) => {
    state.status = { kind: "connected", botName: bot.user.username, botId: bot.user.id };
    console.log(`[discord] bot ready: @${bot.user.username} (${bot.user.id})`);
  });

  client.on("error", (err: Error) => {
    console.error("[discord] client error:", err.message);
    state.status = { kind: "error", message: err.message };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.on("messageCreate", async (message: any) => {
    if (message.author?.bot) return;
    await forwardToGateway(message);
  });

  try {
    await client.login(token);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Login failed — check your bot token";
    console.error("[discord] login failed:", message);
    state.status = { kind: "error", message };
    state.client = null;
  }

  return state.status;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function forwardToGateway(message: any): Promise<void> {
  try {
    const secrets = await readEveSecrets();
    const podUrl = await resolvePodUrl();
    if (!podUrl) {
      console.warn("[discord] no pod URL configured — cannot forward message");
      return;
    }

    const apiKey = readAgentKeyOrLegacySync("hermes", secrets);
    if (!apiKey) {
      console.warn("[discord] no agent API key configured — cannot forward message");
      return;
    }

    const payload = {
      platform: "discord",
      channelId: `discord:${message.channelId as string}`,
      messageId: message.id as string,
      content: (message.content as string) || "",
      author: {
        id: message.author.id as string,
        username: message.author.username as string,
        displayName: (message.author.displayName ?? message.author.username) as string,
      },
      guildId: (message.guildId as string | null) ?? null,
      timestamp: (message.createdAt as Date).toISOString(),
    };

    const res = await fetch(`${podUrl}/api/hub/channels/gateway/inbound`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[discord] gateway inbound returned HTTP ${res.status}`);
    }
  } catch (err) {
    // Non-fatal — log but never crash the bot event loop.
    console.error("[discord] forwardToGateway error:", err instanceof Error ? err.message : err);
  }
}

export function getStatus(): DiscordStatus {
  return state.status;
}

/**
 * Logout the bot and reset state. The next `initSession()` call will
 * create a fresh client.
 */
export async function disconnect(): Promise<void> {
  try {
    await state.client?.destroy?.();
  } catch {
    // best effort
  }
  state.client = null;
  state.status = { kind: "disconnected" };
}
