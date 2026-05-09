/**
 * Validate messaging channel credentials by calling the platform's own
 * "who am I" endpoint. Returns early so `eve arms messaging configure`
 * can refuse a bad token instead of silently persisting it.
 *
 * Hermes handles channel ingress internally (long-poll for Telegram /
 * Discord gateway connect / Matrix sync / Slack RTM), so there is no
 * pod-side webhook URL to register here. Validation is purely a
 * "does this credential authenticate?" probe.
 */

import type { ChannelCredentialInput } from './channel-credentials.js';

export interface ChannelValidationResult {
  ok: boolean;
  /** Short human-readable summary on success — bot username, account id, etc. */
  details?: string;
  error?: string;
  /** True when the platform has no first-party validation endpoint Eve uses today. */
  skipped?: boolean;
}

export interface ValidateChannelOptions {
  timeoutMs?: number;
  /** Inject a custom fetch for tests. */
  fetch?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8000;

export async function validateChannelCredentials(
  input: ChannelCredentialInput,
  opts: ValidateChannelOptions = {},
): Promise<ChannelValidationResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const f = opts.fetch ?? fetch;
  const ctrl = AbortSignal.timeout(timeoutMs);

  try {
    switch (input.platform) {
      case 'telegram':
        return await validateTelegram(input.botToken, f, ctrl);
      case 'discord':
        return await validateDiscord(input.botToken, f, ctrl);
      case 'slack':
        return await validateSlack(input.botToken, f, ctrl);
      case 'matrix':
        return await validateMatrix(input.homeserverUrl, input.accessToken, f, ctrl);
      case 'signal':
        return { ok: true, skipped: true, details: 'no remote validation endpoint' };
      case 'whatsapp':
        return await validateWhatsAppCloudApi(input.phoneNumberId, input.accessToken, f, ctrl);
    }
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

async function validateTelegram(
  botToken: string,
  f: typeof fetch,
  signal: AbortSignal,
): Promise<ChannelValidationResult> {
  const res = await f(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/getMe`, { signal });
  if (!res.ok) return { ok: false, error: `Telegram getMe ${res.status}` };
  const body = (await res.json()) as { ok?: boolean; result?: { username?: string; id?: number }; description?: string };
  if (!body.ok) return { ok: false, error: body.description ?? 'Telegram getMe returned ok=false' };
  const username = body.result?.username;
  return { ok: true, details: username ? `@${username}` : `bot id ${body.result?.id}` };
}

async function validateDiscord(
  botToken: string,
  f: typeof fetch,
  signal: AbortSignal,
): Promise<ChannelValidationResult> {
  const res = await f('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bot ${botToken}` },
    signal,
  });
  if (res.status === 401) return { ok: false, error: 'Discord rejected the bot token (401)' };
  if (!res.ok) return { ok: false, error: `Discord users/@me ${res.status}` };
  const body = (await res.json()) as { username?: string; discriminator?: string; id?: string };
  const tag = body.discriminator && body.discriminator !== '0' ? `${body.username}#${body.discriminator}` : body.username;
  return { ok: true, details: tag ?? `bot id ${body.id}` };
}

async function validateSlack(
  botToken: string,
  f: typeof fetch,
  signal: AbortSignal,
): Promise<ChannelValidationResult> {
  const res = await f('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    signal,
  });
  if (!res.ok) return { ok: false, error: `Slack auth.test ${res.status}` };
  const body = (await res.json()) as { ok?: boolean; team?: string; user?: string; error?: string };
  if (!body.ok) return { ok: false, error: body.error ?? 'Slack auth.test returned ok=false' };
  return { ok: true, details: body.team ? `${body.user}@${body.team}` : (body.user ?? 'authenticated') };
}

async function validateMatrix(
  homeserverUrl: string,
  accessToken: string,
  f: typeof fetch,
  signal: AbortSignal,
): Promise<ChannelValidationResult> {
  const base = homeserverUrl.replace(/\/$/, '');
  const res = await f(`${base}/_matrix/client/v3/account/whoami`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (res.status === 401) return { ok: false, error: 'Matrix rejected the access token (401)' };
  if (!res.ok) return { ok: false, error: `Matrix whoami ${res.status}` };
  const body = (await res.json()) as { user_id?: string };
  return { ok: true, details: body.user_id ?? 'authenticated' };
}

async function validateWhatsAppCloudApi(
  phoneNumberId: string,
  accessToken: string,
  f: typeof fetch,
  signal: AbortSignal,
): Promise<ChannelValidationResult> {
  const url = `https://graph.facebook.com/v17.0/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number%2Cverified_name&access_token=${encodeURIComponent(accessToken)}`;
  const res = await f(url, { signal });
  const body = (await res.json()) as {
    display_phone_number?: string;
    verified_name?: string;
    id?: string;
    error?: { message?: string; code?: number };
  };
  if (!res.ok || body.error) {
    const msg = body.error?.message ?? `Meta Graph API ${res.status}`;
    return { ok: false, error: msg };
  }
  const label = body.display_phone_number ?? body.id ?? phoneNumberId;
  const name = body.verified_name ? ` (${body.verified_name})` : '';
  return { ok: true, details: `${label}${name}` };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.name === 'TimeoutError' ? 'request timed out' : err.message;
  return String(err);
}
