/**
 * Refresh Traefik routes to match the current installed-components list.
 *
 * Called from `eve add` / `eve remove` so installing a new component
 * automatically wires up its subdomain (and removing one tears it down).
 *
 * No-op if no domain has been configured yet — the user hasn't asked for
 * external routing, so we leave Traefik alone.
 */

import { readEveSecrets, entityStateManager } from '@eve/dna';
import { TraefikService } from './traefik.js';

export interface RefreshResult {
  refreshed: boolean;
  domain: string | null;
  reason?: string;
}

export async function refreshTraefikRoutes(cwd?: string): Promise<RefreshResult> {
  const secrets = await readEveSecrets(cwd ?? process.cwd());
  const domain = secrets?.domain?.primary;
  if (!domain) {
    return { refreshed: false, domain: null, reason: 'no domain configured' };
  }

  let installedComponents: string[] = [];
  try {
    installedComponents = await entityStateManager.getInstalledComponents();
  } catch {
    // State unreadable — fall back to routing everything
  }

  try {
    const traefik = new TraefikService();
    await traefik.configureSubdomains(
      domain,
      secrets?.domain?.ssl !== false,
      secrets?.domain?.email,
      installedComponents,
      !!secrets?.domain?.behindProxy,
    );
    return { refreshed: true, domain };
  } catch (err) {
    return {
      refreshed: false,
      domain,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
