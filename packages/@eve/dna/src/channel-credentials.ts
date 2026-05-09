/**
 * Centralised messaging channel credential management.
 *
 * Pure functions that persist credentials into `secrets.channels.<platform>`
 * and run the standard config cascade (`reconcile()`) so Hermes' env file is
 * regenerated and the daemon picks up the new tokens.
 *
 * Single source of truth: secrets.json. Switching the active agent (Hermes,
 * OpenClaw, …) only requires a routing change — credentials never move.
 *
 * WhatsApp supports two modes:
 *   - cloud-api: Meta WhatsApp Cloud API (phoneNumberId + accessToken + verifyToken)
 *   - browser:   Baileys QR-scan via the Agents browser app (no CLI path)
 */

import type { EveSecrets } from './secrets-contract.js';
import { readEveSecrets, writeEveSecrets } from './secrets-contract.js';
import { reconcile, type ReconcileResult } from './reconcile.js';

export type ChannelPlatform =
  | 'telegram'
  | 'discord'
  | 'whatsapp'
  | 'signal'
  | 'matrix'
  | 'slack';

export type ChannelCredentialInput =
  | { platform: 'telegram'; botToken: string; webhookSecret?: string }
  | { platform: 'discord'; botToken: string; guildId?: string; applicationId?: string }
  | { platform: 'slack'; botToken: string; signingSecret?: string; appToken?: string }
  | { platform: 'signal'; phoneNumber: string; apiUrl?: string }
  | { platform: 'matrix'; homeserverUrl: string; accessToken: string; roomId?: string }
  | { platform: 'whatsapp'; mode: 'cloud-api'; phoneNumberId: string; accessToken: string; verifyToken: string };

export interface ConfigureChannelOptions {
  /**
   * Which agent should serve this platform. Defaults to 'hermes' when
   * unset. Persisted to `secrets.channelRouting[platform]`.
   */
  routing?: 'hermes' | 'openclaw';
}

export interface ConfigureChannelResult {
  /**
   * True when the cascade (Hermes env regeneration / container restart) ran
   * cleanly. False when downstream wiring is unavailable (e.g. Hermes not
   * installed yet) — the durable secrets write itself still succeeded.
   */
  wired: boolean;
  /** Human-readable summary of what reconcile() did. */
  reconcileSummary: string;
}

const ALL_PLATFORMS: ReadonlyArray<ChannelPlatform> = [
  'telegram',
  'discord',
  'whatsapp',
  'signal',
  'matrix',
  'slack',
];

type ChannelsSection = NonNullable<EveSecrets['channels']>;

/**
 * Build the per-platform credentials object for `secrets.channels.<platform>`.
 * Always sets `enabled: true` since the caller is configuring the channel.
 */
function buildChannelEntry(input: ChannelCredentialInput): ChannelsSection {
  switch (input.platform) {
    case 'telegram':
      return {
        telegram: {
          enabled: true,
          botToken: input.botToken,
          ...(input.webhookSecret ? { webhookSecret: input.webhookSecret } : {}),
        },
      };
    case 'discord':
      return {
        discord: {
          enabled: true,
          botToken: input.botToken,
          ...(input.guildId ? { guildId: input.guildId } : {}),
          ...(input.applicationId ? { applicationId: input.applicationId } : {}),
        },
      };
    case 'slack':
      return {
        slack: {
          enabled: true,
          botToken: input.botToken,
          ...(input.signingSecret ? { signingSecret: input.signingSecret } : {}),
          ...(input.appToken ? { appToken: input.appToken } : {}),
        },
      };
    case 'signal':
      return {
        signal: {
          enabled: true,
          phoneNumber: input.phoneNumber,
          ...(input.apiUrl ? { apiUrl: input.apiUrl } : {}),
        },
      };
    case 'matrix':
      return {
        matrix: {
          enabled: true,
          homeserverUrl: input.homeserverUrl,
          accessToken: input.accessToken,
          ...(input.roomId ? { roomId: input.roomId } : {}),
        },
      };
    case 'whatsapp':
      return {
        whatsapp: {
          enabled: true,
          phoneNumberId: input.phoneNumberId,
          accessToken: input.accessToken,
          verifyToken: input.verifyToken,
        },
      };
  }
}

function summariseReconcile(result: ReconcileResult): string {
  const parts: string[] = [];
  if (result.envSync) parts.push('Hermes env updated');
  if (result.containerRecreates.length > 0) {
    parts.push(`recreate: ${result.containerRecreates.join(', ')}`);
  }
  if (result.aiWiring.length > 0) {
    parts.push(`ai-wired: ${result.aiWiring.length}`);
  }
  if (parts.length === 0) return 'No downstream changes needed';
  return parts.join('; ');
}

/**
 * Persist credentials for one platform into `secrets.channels.<platform>`,
 * optionally update routing, then re-run the config cascade so Hermes (or
 * the routed agent) picks up the new tokens.
 *
 * Throws on platforms not handled by this CLI flow (currently: WhatsApp,
 * which uses the Agents browser app's Baileys QR-scan).
 */
export async function configureChannel(
  cwd: string,
  input: ChannelCredentialInput,
  opts: ConfigureChannelOptions = {},
): Promise<ConfigureChannelResult> {
  // Guard against browser-mode WhatsApp — only cloud-api mode is supported via CLI.
  const inputPlatform = (input as { platform: string }).platform;
  const inputMode = (input as { mode?: string }).mode;
  if (inputPlatform === 'whatsapp' && inputMode !== 'cloud-api') {
    throw new Error(
      'WhatsApp browser/QR-scan must be onboarded via the Agents browser app, not the CLI. ' +
      'For WhatsApp Cloud API, use --cloud-api.',
    );
  }

  const channelsPatch = buildChannelEntry(input);

  const current = await readEveSecrets(cwd);
  const existingRouting = current?.channelRouting ?? {};
  const desiredAgent = opts.routing ?? 'hermes';
  const nextRouting: Record<string, string> = { ...existingRouting };
  // Only persist the routing entry when it differs from the default — keeps
  // secrets.json minimal for the common case (no explicit override).
  if (desiredAgent !== 'hermes') {
    nextRouting[input.platform] = desiredAgent;
  } else if (existingRouting[input.platform]) {
    // Caller explicitly requested 'hermes' — clear any prior override.
    delete nextRouting[input.platform];
  }

  const existingChannels = current?.channels ?? {};
  const mergedChannels: ChannelsSection = {
    ...existingChannels,
    ...channelsPatch,
  };

  const written = await writeEveSecrets(
    {
      channels: mergedChannels,
      channelRouting: nextRouting,
    },
    cwd,
  );

  // writeEveSecrets() already invokes reconcile() best-effort. We re-run it
  // here only to capture a structured summary for the caller; the cascade is
  // idempotent so a second pass is safe.
  let reconcileSummary = 'Reconcile skipped';
  let wired = false;
  try {
    const result = await reconcile(written, ['channels', 'channelRouting']);
    reconcileSummary = summariseReconcile(result);
    wired = result.envSync;
  } catch (err) {
    reconcileSummary = `Reconcile failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  return { wired, reconcileSummary };
}

/**
 * Set `secrets.channels.<platform>.enabled = false`, leaving credentials in
 * place so re-enabling does not require re-entry. Triggers reconcile so the
 * Hermes env file drops the corresponding env vars on the next write.
 */
export async function disableChannel(
  cwd: string,
  platform: ChannelPlatform,
): Promise<void> {
  const current = await readEveSecrets(cwd);
  const existingChannels = (current?.channels ?? {}) as ChannelsSection;
  const existingPlatform =
    (existingChannels as Record<string, Record<string, unknown> | undefined>)[platform] ?? {};

  const nextChannels: ChannelsSection = {
    ...existingChannels,
    [platform]: { ...existingPlatform, enabled: false },
  } as ChannelsSection;

  const written = await writeEveSecrets({ channels: nextChannels }, cwd);

  try {
    await reconcile(written, ['channels']);
  } catch {
    /* non-fatal — Hermes may not be installed */
  }
}

export interface ChannelStatusEntry {
  platform: ChannelPlatform;
  enabled: boolean;
  hasCredentials: boolean;
  /** Effective routing target — 'hermes' when no explicit override is set. */
  routing: string;
}

/** Per-platform required-credential keys that must all be present (truthy). */
const REQUIRED_CRED_KEYS: Record<ChannelPlatform, ReadonlyArray<string>> = {
  telegram: ['botToken'],
  discord: ['botToken'],
  whatsapp: ['accessToken', 'phoneNumberId'],
  signal: ['phoneNumber'],
  matrix: ['homeserverUrl', 'accessToken'],
  slack: ['botToken', 'signingSecret'],
};

function platformHasCredentials(
  platform: ChannelPlatform,
  entry: Record<string, unknown> | undefined,
): boolean {
  if (!entry) return false;
  const required = REQUIRED_CRED_KEYS[platform];
  return required.every((key) => {
    const v = entry[key];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

/**
 * Read-only view of the durable channel state. Used by `eve arms messaging
 * status` and any UI that surfaces the current configuration.
 */
export async function readChannelStatus(cwd: string): Promise<ChannelStatusEntry[]> {
  const secrets = await readEveSecrets(cwd);
  const channels = (secrets?.channels ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const routing = secrets?.channelRouting ?? {};

  return ALL_PLATFORMS.map((platform) => {
    const entry = channels[platform];
    return {
      platform,
      enabled: Boolean(entry?.enabled),
      hasCredentials: platformHasCredentials(platform, entry),
      routing: routing[platform] ?? 'hermes',
    };
  });
}
