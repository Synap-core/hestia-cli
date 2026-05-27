/**
 * Sync OWUI users → Synap sub-tokens.
 *
 * Lists every user in OpenWebUI via the admin API and ensures each one has a
 * Synap sub-token minted via `provisionOwuiUserInSynap`. New tokens (first
 * mint only) are persisted to `secrets.builder.openwebui.userTokens` keyed
 * by OWUI user ID.
 *
 * Called at the end of `syncOpenwebuiExtras` so it runs automatically after
 * every `eve openwebui sync` / `eve update`. Also exported so callers can
 * invoke it on-demand (e.g. after a new user signs up to OWUI).
 */

import { resolveOpenwebuiAdminUrl, getAdminJwtPostHealth } from './openwebui-admin.js';
import { provisionOwuiUserInSynap } from './openwebui-user-provision.js';
import { readEveSecrets, writeEveSecrets } from './secrets-contract.js';
import type { EveSecrets } from './secrets-contract.js';

export interface OwuiUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface UsersSyncResult {
  total: number;
  provisioned: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
}

/**
 * Fetch all users from the OWUI admin API.
 * Returns an empty array when the JWT is unavailable or the call fails.
 */
async function listOwuiUsers(jwt: string): Promise<OwuiUser[]> {
  const baseUrl = resolveOpenwebuiAdminUrl();
  try {
    const res = await fetch(`${baseUrl}/api/v1/users/`, {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return data as OwuiUser[];
  } catch {
    return [];
  }
}

/**
 * Provision Synap sub-tokens for all OWUI users that don't have one yet.
 *
 * - Reads existing tokens from `secrets.builder.openwebui.userTokens` to
 *   skip users that were already provisioned in a previous run.
 * - Persists newly minted tokens in a single `writeEveSecrets` call at the end.
 * - Never throws — all errors are captured in `errorMessages`.
 *
 * @param cwd  Working directory for secrets resolution (defaults to process.cwd()).
 * @param secrets  Pre-loaded secrets. When provided, skips the read from disk.
 */
export async function syncOwuiUsersToSynap(
  cwd: string = process.cwd(),
  secrets?: EveSecrets | null,
): Promise<UsersSyncResult> {
  const result: UsersSyncResult = {
    total: 0,
    provisioned: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  };

  // Resolve pod URL + parent agent key from secrets or env.
  const resolvedSecrets = secrets ?? (await readEveSecrets(cwd));
  const podUrl = (
    resolvedSecrets?.synap?.apiUrl ??
    process.env.SYNAP_POD_URL ??
    ''
  ).replace(/\/+$/, '');
  const agentApiKey =
    resolvedSecrets?.agents?.['openwebui']?.hubApiKey?.trim() ||
    resolvedSecrets?.agents?.['eve']?.hubApiKey?.trim() ||
    process.env.SYNAP_AGENT_API_KEY ||
    '';

  if (!podUrl || !agentApiKey) {
    result.errorMessages.push('syncOwuiUsersToSynap: podUrl or agentApiKey not available — skipping');
    result.errors = 1;
    return result;
  }

  // Need an admin JWT to call the OWUI user list endpoint.
  const jwt = await getAdminJwtPostHealth();
  if (!jwt) {
    result.errorMessages.push('syncOwuiUsersToSynap: could not forge admin JWT — is OpenWebUI healthy?');
    result.errors = 1;
    return result;
  }

  const users = await listOwuiUsers(jwt);
  result.total = users.length;
  if (users.length === 0) return result;

  // Existing token map: skip users already provisioned.
  const existingTokens: Record<string, string> =
    resolvedSecrets?.builder?.openwebui?.userTokens ?? {};

  const newTokens: Record<string, string> = {};

  for (const user of users) {
    if (existingTokens[user.id]) {
      result.skipped++;
      continue;
    }
    try {
      const provision = await provisionOwuiUserInSynap({
        owuiUserId: user.id,
        owuiUserName: user.name,
        podUrl,
        agentApiKey,
      });
      if (provision.token) {
        newTokens[user.id] = provision.token;
        result.provisioned++;
      } else {
        // reused=true: token existed server-side but wasn't in our secrets.
        // We can't recover the plaintext — record it as skipped.
        result.skipped++;
      }
    } catch (err) {
      result.errors++;
      result.errorMessages.push(
        `user ${user.id} (${user.email}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Persist newly minted tokens in one write.
  if (Object.keys(newTokens).length > 0) {
    const merged = { ...existingTokens, ...newTokens };
    await writeEveSecrets(
      {
        builder: {
          ...(resolvedSecrets?.builder ?? {}),
          openwebui: {
            ...(resolvedSecrets?.builder?.openwebui ?? {}),
            userTokens: merged,
          },
        },
      },
      cwd,
    );
  }

  return result;
}
