import { getServerIp } from './server-ip.js';
import type { EveSecrets } from './secrets-contract.js';
import { COMPONENTS, EVE_DASHBOARD_SERVICE } from './components.js';

export interface ServiceAccess {
  id: string;
  label: string;
  emoji: string;
  localUrl: string | null;
  serverUrl: string | null;
  domainUrl: string | null;
  port: number;
  /** Component ID required for this service. null = always shown (e.g. dashboard). */
  requires: string | null;
  /** True when DNS for the domain URL resolves to this server. Null = not yet checked. */
  dnsReady: boolean | null;
}

/**
 * Returns access URLs for installed services, derived from the component registry.
 *
 * @param secrets             Eve secrets (domain config)
 * @param installedComponents List of installed component IDs.
 *                            When omitted, all routable services are returned.
 */
export function getAccessUrls(secrets: EveSecrets | null, installedComponents?: string[]): ServiceAccess[] {
  const serverIp = getServerIp();
  const domain = secrets?.domain?.primary;
  const ssl = secrets?.domain?.ssl ?? false;
  const protocol = ssl ? 'https' : 'http';

  const out: ServiceAccess[] = [];

  // 1. Eve dashboard (always shown — it's the UI itself)
  out.push({
    id: EVE_DASHBOARD_SERVICE.id,
    label: EVE_DASHBOARD_SERVICE.label,
    emoji: EVE_DASHBOARD_SERVICE.emoji,
    requires: null,
    port: EVE_DASHBOARD_SERVICE.service.hostPort ?? EVE_DASHBOARD_SERVICE.service.internalPort,
    localUrl: `http://localhost:${EVE_DASHBOARD_SERVICE.service.hostPort ?? EVE_DASHBOARD_SERVICE.service.internalPort}`,
    serverUrl: serverIp ? `http://${serverIp}:${EVE_DASHBOARD_SERVICE.service.hostPort ?? EVE_DASHBOARD_SERVICE.service.internalPort}` : null,
    domainUrl: domain && EVE_DASHBOARD_SERVICE.service.subdomain
      ? `${protocol}://${EVE_DASHBOARD_SERVICE.service.subdomain}.${domain}`
      : null,
    dnsReady: null,
  });

  // 2. Components with services, filtered to what's installed
  for (const comp of COMPONENTS) {
    if (!comp.service || comp.service.subdomain === null) continue;
    if (installedComponents && !installedComponents.includes(comp.id)) continue;

    const port = comp.service.hostPort ?? comp.service.internalPort;
    out.push({
      id: comp.id,
      label: comp.label,
      emoji: comp.emoji,
      requires: comp.id,
      port,
      localUrl: comp.service.hostPort ? `http://localhost:${port}` : null,
      serverUrl: comp.service.hostPort && serverIp ? `http://${serverIp}:${port}` : null,
      domainUrl: domain ? `${protocol}://${comp.service.subdomain}.${domain}` : null,
      dnsReady: null,
    });
  }

  return out;
}
