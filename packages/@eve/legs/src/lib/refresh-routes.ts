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

import { readEveSecrets, entityStateManager, secretsPath } from '@eve/dna';
import { TraefikService } from './traefik.js';

export interface RefreshResult {
  refreshed: boolean;
  domain: string | null;
  /** The routes files differed from what was on disk (Traefik restarted). */
  changed?: boolean;
  reason?: string;
  /** Set when the routes were left alone because they belong to another domain. */
  refusal?: 'domain-mismatch' | 'routes-unreadable';
}

export interface RefreshOptions {
  /**
   * The caller is changing the primary domain on purpose (`eve domain set`,
   * the dashboard's domain form): routes generated for another domain are
   * expected to be replaced. Every other caller leaves this off.
   */
  allowDomainChange?: boolean;
}

export async function refreshTraefikRoutes(cwd?: string, opts: RefreshOptions = {}): Promise<RefreshResult> {
  // `readEveSecrets()` already defaults to `EVE_HOME || process.cwd()`. Passing
  // `?? process.cwd()` DEFEATED that default: running `eve` from any directory
  // other than the Eve home (e.g. `cd /opt/freellmapi && eve add ...`) read no
  // secrets, found no domain, and skipped route generation in SILENCE.
  const secrets = await readEveSecrets(cwd);
  const domain = secrets?.domain?.primary;
  if (!domain) {
    return { refreshed: false, domain: null, reason: 'no domain configured' };
  }

  // The Eve settings are read from EVE_HOME, else the CURRENT DIRECTORY, and a
  // host can carry more than one `.eve/` (CT101: /opt/hestia-cli/.eve and a
  // stale /root/.eve on another domain). Routes generated from the wrong one
  // would serve every host of the pod under a domain nobody points at it: the
  // whole pod goes dark. So when the live routes were generated for another
  // domain, leave them alone and say which settings were read — unless the
  // caller is changing the domain on purpose. No routes file yet: no guard.
  const traefik = new TraefikService();
  if (!opts.allowDomainChange) {
    const live = traefik.readRoutesDomain();
    const settings = secretsPath(cwd);
    if (live.state === 'unreadable') {
      return {
        refreshed: false,
        domain,
        refusal: 'routes-unreadable',
        reason: `cannot read the current eve-routes.yml to check which domain it serves (${live.error}) — routes left as they were`,
      };
    }
    if (live.state === 'found' && live.domain && live.domain.toLowerCase() !== domain.trim().toLowerCase()) {
      return {
        refreshed: false,
        domain,
        refusal: 'domain-mismatch',
        reason:
          `${live.path} serves ${live.domain}, but the Eve settings read here (${settings}) say ${domain} — ` +
          `routes left as they were. Run eve from the Eve home that holds ${live.domain} (cd into it, or set EVE_HOME); ` +
          `to move the pod to ${domain} on purpose, run: eve domain set ${domain}`,
      };
    }
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
