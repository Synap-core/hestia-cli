/**
 * Shared connector / capability-template catalog.
 *
 * ONE typed source describing what kinds of connectors Eve can seed. It spans
 * BOTH paths:
 *
 *   - `oauth2` entries  → declared in Nango via `eve connectors setup` (the
 *                          existing OAuth-app flow). Listed here for discovery
 *                          and a uniform `eve capabilities list`; the actual
 *                          OAuth-app declaration stays in connectors.ts.
 *   - everything else   → seeded headlessly through the backend's
 *                          `/api/hub/capabilities/apply` door, either by a
 *                          backend-resolved `templateKey` or a local
 *                          definition file.
 *
 * This keeps the connector taxonomy from diverging across the CLI: the
 * `authMode` union lives with `ProviderSpec` in connectors.ts and is re-used
 * here, so adding a connector type is a single-place change.
 */

import type { ConnectorAuthMode } from './connectors.js';

/**
 * A catalog entry an operator can pick from. `templateKey` points at a seed
 * template the BACKEND resolves (e.g. "generic-apikey" shipped in
 * synap-backend/templates/capabilities/). Entries without a `templateKey`
 * (today: the oauth2 ones) are informational — they route through the Nango
 * `setup` flow instead.
 */
export interface CapabilityCatalogEntry {
  /** Stable selector key, e.g. "generic-apikey". */
  key: string;
  /** Human label for prompts / listings. */
  label: string;
  /** How this connector authenticates. */
  authMode: ConnectorAuthMode;
  /** One-line description. */
  description: string;
  /**
   * Backend seed-template key to pass through to `/capabilities/apply`.
   * Present only for headlessly-seedable types (non-oauth2). When absent the
   * entry is OAuth-via-Nango and is handled by `eve connectors setup`.
   */
  templateKey?: string;
}

/**
 * The capability templates the backend can resolve by key today. Mirrors the
 * seeds in `synap-backend/templates/capabilities/`. Extend in lockstep with
 * that directory (or pass a local definition file for ad-hoc types).
 */
export const CAPABILITY_TEMPLATES: CapabilityCatalogEntry[] = [
  {
    key: 'generic-apikey',
    label: 'Generic API-key connector',
    authMode: 'api_key',
    description:
      'Provider-neutral: stores one API key in the vault, registers one HTTP ' +
      'API tool, and seeds a fetch-and-propose skill. Customize via params.',
    templateKey: 'generic-apikey',
  },
  {
    key: 'unipile-linkedin',
    label: 'Unipile — LinkedIn',
    authMode: 'api_key',
    description:
      'LinkedIn outreach via Unipile (X-API-KEY in vault): a search-profiles ' +
      'skill (proposes people) and a send-invitation skill, both proposal-gated.',
    templateKey: 'unipile-linkedin',
  },
  {
    key: 'nango-gmail',
    label: 'Nango — Gmail',
    authMode: 'oauth2',
    description:
      'Send follow-up email via Gmail through Nango OAuth (no vault secret). ' +
      'Seeds a proposal-gated gmail_send skill. Requires the gmail Nango integration.',
    templateKey: 'nango-gmail',
  },
  {
    key: 'discord-bot',
    label: 'Discord Bot',
    authMode: 'api_key',
    description:
      'Post to a Discord channel via a bot (bot token in vault): a proposal-gated ' +
      'discord_send_message skill that sends a channel message and notes the post.',
    templateKey: 'discord-bot',
  },
];

/** Look up a catalog entry by key (case-insensitive). */
export function findCapabilityTemplate(key: string): CapabilityCatalogEntry | undefined {
  const lower = key.toLowerCase();
  return CAPABILITY_TEMPLATES.find((t) => t.key.toLowerCase() === lower);
}
