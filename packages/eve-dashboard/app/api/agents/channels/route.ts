/**
 * Channel registry — server fan-out.
 *
 * Returns a unified `UnifiedChannel[]` for the Agents page strip. Combines:
 *
 *   1. Local OpenClaw messaging config (Telegram/Discord/Signal/Matrix)
 *      via `getMessagingConfig()` → eve-dashboard's existing helper.
 *   2. Local WhatsApp Baileys session via `getStatus()` from the
 *      session-manager singleton.
 *   3. Synap personal channel via Hub Protocol REST `/channels/personal`.
 *      One round-trip; falls back gracefully when pod isn't paired.
 *   4. (Future) A2A pipes — currently unused; placeholder for when the
 *      intelligence-hub exposes them via Hub Protocol.
 *
 * Each source is wrapped in try/catch so one failure (e.g. pod offline)
 * doesn't blank the whole strip — `partial: true` + the per-kind error
 * map lets the UI render a softened banner.
 *
 * Auth: requires the local dashboard `eve-session` cookie (the Eve UI's
 * own auth, NOT the CP OAuth token). Hub Protocol calls use the
 * pod-paired API key from `~/.eve/secrets.json`.
 */

import { NextResponse } from "next/server";
import { readEveSecrets, resolvePodUrl } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { getMessagingConfig, type MessagingPlatform } from "@/lib/openclaw-config";
import { getStatus as getWhatsAppStatus } from "../../components/openclaw/whatsapp/session-manager";
import { getStatus as getDiscordStatus } from "../../components/openclaw/discord/session-manager";
import type {
  UnifiedChannel,
  ChannelRegistryResponse,
  ChannelConnectionStatus,
  ChannelKind,
} from "../../../(os)/agents/lib/channel-types";

// ─── Source: OpenClaw messaging (Telegram / Discord / Signal / Matrix) ──────

async function loadOpenclawMessaging(): Promise<UnifiedChannel | null> {
  const config = await getMessagingConfig();
  if (!config.enabled || !config.platform) return null;

  const kind = mapMessagingKind(config.platform);
  if (!kind) return null;

  const status: ChannelConnectionStatus = config.hasToken
    ? "connected"
    : "needs_attention";

  return {
    id: `${kind}:openclaw`,
    kind,
    label: humanLabelForKind(kind),
    hint: config.hasToken ? "via OpenClaw" : "no token",
    participants: ["openclaw", "synap"],
    connectionStatus: status,
    openTarget: openTargetForKind(kind),
  };
}

function mapMessagingKind(p: MessagingPlatform): ChannelKind | null {
  switch (p) {
    case "telegram": return "telegram";
    case "discord":  return "discord";
    case "signal":   return "signal";
    case "matrix":   return "matrix";
    default:         return null;
  }
}

function humanLabelForKind(kind: ChannelKind): string {
  switch (kind) {
    case "telegram": return "Telegram";
    case "discord":  return "Discord";
    case "whatsapp": return "WhatsApp";
    case "signal":   return "Signal";
    case "matrix":   return "Matrix";
    case "synap":    return "Personal channel";
    case "a2a":      return "Agent-to-agent";
  }
}

/**
 * Best-effort URL scheme + http fallback for external messaging
 * platforms. Click-back lands on the user's own client when the scheme
 * is registered; falls back to the web client otherwise.
 */
function openTargetForKind(kind: ChannelKind): UnifiedChannel["openTarget"] {
  switch (kind) {
    case "telegram":
      return { kind: "external", scheme: "tg://", httpFallback: "https://web.telegram.org/" };
    case "discord":
      return { kind: "external", scheme: "discord://", httpFallback: "https://discord.com/channels/@me" };
    case "whatsapp":
      return { kind: "external", scheme: "whatsapp://", httpFallback: "https://web.whatsapp.com/" };
    case "signal":
      return { kind: "external", scheme: "sgnl://", httpFallback: "https://signal.org/download/" };
    case "matrix":
      return { kind: "external", scheme: "matrix:", httpFallback: "https://app.element.io/" };
    default:
      return { kind: "internal", href: "/agents" };
  }
}

// ─── Source: WhatsApp (Baileys session) ──────────────────────────────────────

function loadWhatsApp(): UnifiedChannel | null {
  const status = getWhatsAppStatus();
  if (status.kind === "disconnected") return null;

  let connectionStatus: ChannelConnectionStatus;
  let hint: string | undefined;
  const metadata: Record<string, unknown> = {};
  switch (status.kind) {
    case "connected":
      connectionStatus = "connected";
      hint = status.phoneNumber;
      break;
    case "awaiting_scan":
      connectionStatus = "connecting";
      hint = "awaiting scan";
      metadata.qrDataUrl = status.qrDataUrl;
      break;
    case "connecting":
      connectionStatus = "connecting";
      hint = "connecting";
      break;
    case "error":
      connectionStatus = "needs_attention";
      hint = status.message;
      break;
    default:
      return null;
  }

  return {
    id: "whatsapp:baileys",
    kind: "whatsapp",
    label: "WhatsApp",
    hint,
    participants: ["openclaw", "synap"],
    connectionStatus,
    openTarget: openTargetForKind("whatsapp"),
    metadata,
  };
}

// ─── Source: Discord (Discord.js bot session) ────────────────────────────────

function loadDiscord(): UnifiedChannel | null {
  const status = getDiscordStatus();
  if (status.kind === "disconnected") return null;

  let connectionStatus: ChannelConnectionStatus;
  let hint: string | undefined;
  switch (status.kind) {
    case "connected":
      connectionStatus = "connected";
      hint = `@${status.botName}`;
      break;
    case "connecting":
      connectionStatus = "connecting";
      hint = "connecting";
      break;
    case "error":
      connectionStatus = "needs_attention";
      hint = status.message;
      break;
    default:
      return null;
  }

  return {
    id: "discord:bot",
    kind: "discord",
    label: "Discord",
    hint,
    participants: ["openclaw", "synap"],
    connectionStatus,
    openTarget: openTargetForKind("discord"),
  };
}

// ─── Source: Synap personal channel ─────────────────────────────────────────

async function loadSynapPersonal(
  podUrl: string,
  apiKey: string,
): Promise<UnifiedChannel | null> {
  // Hub Protocol /channels/personal is workspace-scoped. We don't have a
  // workspace ID here — the personal channel resolution falls back to the
  // user's first accessible workspace by default. When the pod-pairing
  // handshake learns the workspace ID we'll thread it through.
  const res = await fetch(`${podUrl}/api/hub/channels/personal`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) return null;

  // Normalize: backend returns { channel: Channel } or { channelId, ... }.
  // The channels REST module is in flux — accept either shape defensively.
  const json = (await res.json().catch(() => null)) as
    | { channel?: { id: string; title?: string; updatedAt?: string } }
    | { channelId?: string; updatedAt?: string }
    | null;
  if (!json) return null;

  let channelId: string | undefined;
  let title: string | undefined;
  let updatedAt: string | undefined;
  if ("channel" in json && json.channel) {
    channelId = json.channel.id;
    title = json.channel.title;
    updatedAt = json.channel.updatedAt;
  } else if ("channelId" in json && json.channelId) {
    channelId = json.channelId;
    updatedAt = json.updatedAt;
  }
  if (!channelId) return null;

  return {
    id: `synap:${channelId}`,
    kind: "synap",
    label: title ?? "Personal channel",
    hint: "Synap pod",
    participants: ["synap"],
    connectionStatus: "connected",
    lastEventAt: updatedAt,
    openTarget: {
      kind: "synap",
      href: `https://app.synap.live/c/${channelId}`,
    },
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<NextResponse<ChannelRegistryResponse>> {
  const auth = await requireAuth();
  if ("error" in auth) {
    return auth.error as NextResponse<ChannelRegistryResponse>;
  }

  const channels: UnifiedChannel[] = [];
  const errors: Partial<Record<ChannelKind, string>> = {};

  // OpenClaw messaging — local; no network. Resolve the active platform
  // first so the error map gets keyed correctly when the load throws
  // mid-config-read (Discord-active config error → errors.discord, not
  // a hard-coded `errors.telegram`).
  try {
    const ch = await loadOpenclawMessaging();
    if (ch) channels.push(ch);
  } catch (e) {
    const platform =
      (await getMessagingConfig().catch(() => null))?.platform ?? null;
    const kind = platform ? mapMessagingKind(platform) : null;
    const fallbackKind: ChannelKind = kind ?? "telegram";
    errors[fallbackKind] = e instanceof Error ? e.message : "Unknown error";
  }

  // WhatsApp — local; no network.
  try {
    const ch = loadWhatsApp();
    if (ch) channels.push(ch);
  } catch (e) {
    errors.whatsapp = e instanceof Error ? e.message : "Unknown error";
  }

  // Discord — local; no network.
  try {
    const ch = loadDiscord();
    if (ch) channels.push(ch);
  } catch (e) {
    errors.discord = e instanceof Error ? e.message : "Unknown error";
  }

  // Synap personal channel — needs paired pod. Soft-fail when not paired
  // so the rest of the strip still renders.
  try {
    const secrets = await readEveSecrets();
    const apiKey = secrets?.synap?.apiKey;
    const podUrl = await resolvePodUrl(undefined, req.url, req.headers);
    if (apiKey && podUrl) {
      const ch = await loadSynapPersonal(podUrl, apiKey);
      if (ch) channels.push(ch);
    }
  } catch (e) {
    errors.synap = e instanceof Error ? e.message : "Unknown error";
  }

  // (Future) A2A pipes — left as a comment until the IS exposes a list
  // endpoint via Hub Protocol. The agents page already renders A2A edges
  // when event names imply collaboration; the channel strip just won't
  // surface them as discrete rows yet.

  return NextResponse.json(
    {
      channels,
      partial: Object.keys(errors).length > 0,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
