/**
 * Centralised channel credentials + routing endpoint.
 *
 * GET   /api/channels  → returns per-platform config (tokens masked) + routing map
 * PATCH /api/channels  → saves per-platform creds + routing, rewires Hermes env
 *
 * Design: credentials live in `secrets.channels.*` (agent-agnostic).
 * `secrets.channelRouting` maps platform → agent slug (default: "hermes").
 * Any agent install flow reads from this single source, so switching agent
 * providers requires only a routing change — credentials never need to move.
 */

import { NextResponse } from "next/server";
import {
  readEveSecrets, writeEveSecrets, writeHermesEnvFile, restartHermesIfRunning,
} from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

type Platform = "telegram" | "discord" | "whatsapp" | "signal" | "matrix" | "slack";
const PLATFORMS: Platform[] = ["telegram", "discord", "whatsapp", "signal", "matrix", "slack"];

function mask(token?: string): string | undefined {
  if (!token) return undefined;
  if (token.length <= 8) return "***";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function hasToken(token?: string): boolean {
  return !!(token && token.trim().length > 0);
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  const channels = secrets?.channels ?? {};
  const routing = secrets?.channelRouting ?? {};

  return NextResponse.json({
    routing,
    telegram: {
      enabled: channels.telegram?.enabled ?? false,
      hasToken: hasToken(channels.telegram?.botToken),
      tokenMasked: mask(channels.telegram?.botToken),
      hasWebhookSecret: hasToken(channels.telegram?.webhookSecret),
    },
    discord: {
      enabled: channels.discord?.enabled ?? false,
      hasToken: hasToken(channels.discord?.botToken),
      tokenMasked: mask(channels.discord?.botToken),
      guildId: channels.discord?.guildId ?? null,
      applicationId: channels.discord?.applicationId ?? null,
    },
    whatsapp: {
      enabled: channels.whatsapp?.enabled ?? false,
      phoneNumberId: channels.whatsapp?.phoneNumberId ?? null,
      hasAccessToken: hasToken(channels.whatsapp?.accessToken),
      accessTokenMasked: mask(channels.whatsapp?.accessToken),
      hasVerifyToken: hasToken(channels.whatsapp?.verifyToken),
    },
    signal: {
      enabled: channels.signal?.enabled ?? false,
      phoneNumber: channels.signal?.phoneNumber ?? null,
      apiUrl: channels.signal?.apiUrl ?? null,
    },
    matrix: {
      enabled: channels.matrix?.enabled ?? false,
      homeserverUrl: channels.matrix?.homeserverUrl ?? null,
      hasAccessToken: hasToken(channels.matrix?.accessToken),
      accessTokenMasked: mask(channels.matrix?.accessToken),
      roomId: channels.matrix?.roomId ?? null,
    },
    slack: {
      enabled: channels.slack?.enabled ?? false,
      hasToken: hasToken(channels.slack?.botToken),
      tokenMasked: mask(channels.slack?.botToken),
      hasSigningSecret: hasToken(channels.slack?.signingSecret),
      hasAppToken: hasToken(channels.slack?.appToken),
    },
  });
}

export async function PATCH(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({})) as {
    /** Override the routing for one or more platforms. null = reset to default (hermes). */
    routing?: Partial<Record<Platform, string | null>>;
    telegram?: { enabled?: boolean; botToken?: string | null; webhookSecret?: string | null };
    discord?: { enabled?: boolean; botToken?: string | null; guildId?: string | null; applicationId?: string | null };
    whatsapp?: { enabled?: boolean; phoneNumberId?: string | null; accessToken?: string | null; verifyToken?: string | null };
    signal?: { enabled?: boolean; phoneNumber?: string | null; apiUrl?: string | null };
    matrix?: { enabled?: boolean; homeserverUrl?: string | null; accessToken?: string | null; roomId?: string | null };
    slack?: { enabled?: boolean; botToken?: string | null; signingSecret?: string | null; appToken?: string | null };
  };

  const current = await readEveSecrets();
  const existingChannels = current?.channels ?? {};
  const existingRouting = current?.channelRouting ?? {};

  // Merge routing (null = delete key → falls back to default "hermes")
  let newRouting = existingRouting;
  if (body.routing) {
    const merged: Record<string, string> = { ...existingRouting };
    for (const [platform, agent] of Object.entries(body.routing)) {
      if (agent === null) delete merged[platform];
      else if (agent) merged[platform] = agent;
    }
    newRouting = merged;
  }

  // Deep-merge each platform config (null values clear the field)
  function mergePlatform<T extends Record<string, unknown>>(
    existing: T | undefined,
    patch: Partial<Record<keyof T, unknown>> | undefined,
  ): T | undefined {
    if (!patch) return existing;
    const result = { ...(existing ?? {}) } as T;
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete (result as Record<string, unknown>)[k];
      else if (v !== undefined) (result as Record<string, unknown>)[k] = v;
    }
    return result;
  }

  const newChannels = {
    ...existingChannels,
    ...(body.telegram ? { telegram: mergePlatform(existingChannels.telegram, body.telegram) } : {}),
    ...(body.discord ? { discord: mergePlatform(existingChannels.discord, body.discord) } : {}),
    ...(body.whatsapp ? { whatsapp: mergePlatform(existingChannels.whatsapp, body.whatsapp) } : {}),
    ...(body.signal ? { signal: mergePlatform(existingChannels.signal, body.signal) } : {}),
    ...(body.matrix ? { matrix: mergePlatform(existingChannels.matrix, body.matrix) } : {}),
    ...(body.slack ? { slack: mergePlatform(existingChannels.slack, body.slack) } : {}),
  };

  await writeEveSecrets({
    channels: newChannels as Parameters<typeof writeEveSecrets>[0]["channels"],
    channelRouting: newRouting,
  });

  // Rewire Hermes env so the new channel tokens land in the running container.
  // Fire-and-forget: if Hermes isn't installed, this is a no-op.
  let hermesRewired = false;
  let hermesRestarted = false;
  try {
    await writeHermesEnvFile();
    hermesRewired = true;
    hermesRestarted = restartHermesIfRunning();
  } catch { /* hermes not installed */ }

  return NextResponse.json({ ok: true, hermesRewired, hermesRestarted });
}
