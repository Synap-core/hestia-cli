import { getServerIp } from './server-ip.js';
import type { EveSecrets } from './secrets-contract.js';

export interface ServiceAccess {
  id: string;
  label: string;
  emoji: string;
  localUrl: string;
  serverUrl: string | null;
  domainUrl: string | null;
  port: number;
  /** Component ID that must be installed for this service to be available. null = always shown. */
  requires: string | null;
}

/**
 * Map of service → component ID required. null = always present (eve dashboard itself).
 * Port is the HOST port used for direct access (bypassing Traefik).
 */
const SERVICE_DEFS: Array<{
  id: string;
  label: string;
  emoji: string;
  port: number;
  subdomain: string;
  requires: string | null;
}> = [
  { id: 'eve',       label: 'Eve Dashboard', emoji: '🌿', port: 7979,  subdomain: 'eve',      requires: null },
  { id: 'pod',       label: 'Synap Pod',     emoji: '🧠', port: 4000,  subdomain: 'pod',      requires: 'synap' },
  { id: 'openclaw',  label: 'OpenClaw',      emoji: '🦾', port: 3000,  subdomain: 'openclaw', requires: 'openclaw' },
  { id: 'feeds',     label: 'RSSHub Feeds',  emoji: '👁️', port: 1200,  subdomain: 'feeds',    requires: 'rsshub' },
  { id: 'ollama',    label: 'Ollama AI',     emoji: '🤖', port: 11434, subdomain: 'ai',       requires: 'ollama' },
  { id: 'openwebui', label: 'Open WebUI',    emoji: '💬', port: 3011,  subdomain: 'chat',     requires: 'openwebui' },
];

/**
 * Returns access URLs for installed services.
 *
 * @param secrets          Eve secrets (domain config)
 * @param installedComponents  List of installed component IDs from entity state.
 *                             When omitted, all services are returned (backward compat / pre-init).
 */
export function getAccessUrls(secrets: EveSecrets | null, installedComponents?: string[]): ServiceAccess[] {
  const serverIp = getServerIp();
  const domain = secrets?.domain?.primary;
  const ssl = secrets?.domain?.ssl ?? false;
  const protocol = ssl ? 'https' : 'http';

  return SERVICE_DEFS
    .filter(def => !installedComponents || def.requires === null || installedComponents.includes(def.requires))
    .map(def => ({
      id: def.id,
      label: def.label,
      emoji: def.emoji,
      port: def.port,
      requires: def.requires,
      localUrl: `http://localhost:${def.port}`,
      serverUrl: serverIp ? `http://${serverIp}:${def.port}` : null,
      domainUrl: domain ? `${protocol}://${def.subdomain}.${domain}` : null,
    }));
}
