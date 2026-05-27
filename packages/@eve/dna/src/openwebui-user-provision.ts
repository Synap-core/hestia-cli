/**
 * TODO: call provisionOwuiUserInSynap from the OpenWebUI session init hook.
 *
 * OpenWebUI user provisioning against the Synap sub-token system.
 *
 * Each OWUI user needs their own Synap identity so their AI interactions are
 * attributed to the right user row on the pod. Eve holds a single parent Hub
 * API key (secrets.agents.eve.hubApiKey); this module mints a per-user child
 * key ("sub-token") from it the first time a given OWUI user is seen.
 *
 * Usage pattern (Mode 2 — sub-token, correct choice for OWUI):
 *   1. On first login / first message, call provisionOwuiUserInSynap().
 *   2. Persist the returned token alongside the OWUI user record.
 *   3. Use that token as the Authorization header for all subsequent
 *      Synap Hub Protocol calls made on behalf of that user.
 *
 * The endpoint is idempotent: if a sub-token already exists for the
 * (parentKey, owuiUserId) pair, it returns `token: null` with `reused: true`.
 * The plaintext is only ever returned on the first mint — callers must persist
 * it then, as it cannot be recovered later.
 */

export interface ProvisionOwuiUserOptions {
  /** The OWUI user's internal ID (opaque string — passed as externalUserId). */
  owuiUserId: string;
  /** Optional display name shown in Synap's user table. */
  owuiUserName?: string;
  /** Synap pod base URL. Defaults to SYNAP_POD_URL env var. */
  podUrl?: string;
  /** Eve's parent Hub API key. Defaults to SYNAP_AGENT_API_KEY env var. */
  agentApiKey?: string;
}

export interface ProvisionOwuiUserResult {
  /**
   * Plaintext sub-token. Present ONLY on first mint — store it now.
   * Null on subsequent calls (reused: true) or on failure.
   */
  token: string | null;
  /** The Synap userId row created or resolved for this OWUI user. */
  synapUserId: string;
  /** True when a sub-token was already minted and this call reused it. */
  reused: boolean;
}

/**
 * Provision a Synap sub-token for an OpenWebUI user.
 *
 * Call this on first login to OWUI. Store the returned token alongside the
 * OWUI user record. Use the stored token as the Bearer for all subsequent
 * Synap Hub Protocol calls made on behalf of that user.
 *
 * Never throws — all failure modes are surfaced via the thrown Error so
 * callers can decide whether to surface them to the user or log and continue.
 */
export async function provisionOwuiUserInSynap(
  opts: ProvisionOwuiUserOptions,
): Promise<ProvisionOwuiUserResult> {
  const podUrl = (opts.podUrl ?? process.env.SYNAP_POD_URL ?? '').replace(/\/+$/, '');
  const agentKey = opts.agentApiKey ?? process.env.SYNAP_AGENT_API_KEY ?? '';

  if (!podUrl) throw new Error('podUrl / SYNAP_POD_URL must be set');
  if (!agentKey) throw new Error('agentApiKey / SYNAP_AGENT_API_KEY must be set');

  const resp = await fetch(`${podUrl}/api/hub/setup/external-user`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${agentKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      externalUserId: opts.owuiUserId,
      name: opts.owuiUserName,
      mintSubToken: true,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Synap provisioning failed: ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as {
    token?: string;
    synapUserId: string;
    reused?: boolean;
  };

  return {
    token: data.token ?? null,
    synapUserId: data.synapUserId,
    reused: data.reused ?? false,
  };
}
