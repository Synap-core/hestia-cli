import { getServerIp } from './server-ip.js';
import type { EveSecrets } from './secrets-contract.js';
import { COMPONENTS } from './components.js';

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
  // Default to HTTPS for real domains. Only localhost/127.x stays HTTP.
  const isLocalDomain = !domain || /^(localhost|127\.)/.test(domain);
  const ssl = secrets?.domain?.ssl ?? !isLocalDomain;
  const protocol = ssl ? 'https' : 'http';

  const out: ServiceAccess[] = [];

  // Routed services come straight from the component registry — including
  // the Eve dashboard, which is now a regular Docker service.
  for (const comp of COMPONENTS) {
    if (!comp.service || comp.service.subdomain === null) continue;
    // The dashboard is always shown (it's the UI itself); other components
    // require explicit install. `requires: null` → always shown.
    const requires = comp.id === 'eve-dashboard' ? null : comp.id;
    if (installedComponents && requires && !installedComponents.includes(comp.id)) continue;

    const port = comp.service.hostPort ?? comp.service.internalPort;
    out.push({
      id: comp.id,
      label: comp.label,
      emoji: comp.emoji,
      requires,
      port,
      localUrl: comp.service.hostPort ? `http://localhost:${port}` : null,
      serverUrl: comp.service.hostPort && serverIp ? `http://${serverIp}:${port}` : null,
      domainUrl: domain ? `${protocol}://${comp.service.subdomain}.${domain}` : null,
      dnsReady: null,
    });
  }

  return out;
}
