/**
 * Refresh Traefik routes to match the current installed-components list.
 *
 * Called (through the `traefik-routes` materializer) from `eve add` /
 * `eve remove`, `eve domain set|apply|repair` and after every component
 * update, so a route the generator gained in an Eve release reaches the pod
 * on its next `eve update`, and installing a component wires its subdomain.
 *
 * No-op if no domain has been configured yet — the user hasn't asked for
 * external routing, so we leave Traefik alone.
 */

import { readEveSecrets, entityStateManager } from '@eve/dna';
import { TraefikService } from './traefik.js';

export interface RefreshResult {
  refreshed: boolean;
  domain: string | null;
  /** The routes files differed from what was on disk (Traefik restarted). */
  changed?: boolean;
  reason?: string;
}

export async function refreshTraefikRoutes(cwd?: string): Promise<RefreshResult> {
  // `readEveSecrets()` already defaults to `EVE_HOME || process.cwd()`. Passing
  // `?? process.cwd()` DEFEATED that default: running `eve` from any directory
  // other than the Eve home (e.g. `cd /opt/freellmapi && eve add ...`) read no
  // secrets, found no domain, and skipped route generation in SILENCE.
  const secrets = await readEveSecrets(cwd);
  const domain = secrets?.domain?.primary;
  if (!domain) {
    return { refreshed: false, domain: null, reason: 'no domain configured' };
  }

  // Routes are generated for the INSTALLED components only. An unreadable
  // state file is not "nothing installed": generating from an empty list would
  // drop every component route on the pod, so leave the routes as they are.
  let installedComponents: string[];
  try {
    installedComponents = await entityStateManager.getInstalledComponents();
  } catch (err) {
    return {
      refreshed: false,
      domain,
      reason: `installed components unreadable (${err instanceof Error ? err.message : String(err)}) — routes left as they were`,
    };
  }

  try {
    const traefik = new TraefikService();
    const { changed } = await traefik.configureSubdomains(
      domain,
      secrets?.domain?.ssl !== false,
      secrets?.domain?.email,
      installedComponents,
      !!secrets?.domain?.behindProxy,
      secrets?.domain?.customRoutes,
    );
    return { refreshed: true, domain, changed };
  } catch (err) {
    return {
      refreshed: false,
      domain,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
