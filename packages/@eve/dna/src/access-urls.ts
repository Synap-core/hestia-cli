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
}

const SERVICE_DEFS = [
  { id: 'eve', label: 'Eve Dashboard', emoji: '🌿', port: 7979, subdomain: 'eve' },
  { id: 'pod', label: 'Synap Pod', emoji: '🧠', port: 4000, subdomain: 'pod' },
  { id: 'openclaw', label: 'OpenClaw', emoji: '🦾', port: 3000, subdomain: 'openclaw' },
  { id: 'feeds', label: 'RSSHub Feeds', emoji: '👁️', port: 1200, subdomain: 'feeds' },
  { id: 'ollama', label: 'Ollama AI', emoji: '🤖', port: 11434, subdomain: 'ai' },
  { id: 'traefik', label: 'Traefik Dashboard', emoji: '🦿', port: 8080, subdomain: 'traefik' },
] as const;

export function getAccessUrls(secrets: EveSecrets | null): ServiceAccess[] {
  const serverIp = getServerIp();
  const domain = secrets?.domain?.primary;
  const ssl = secrets?.domain?.ssl ?? false;
  const protocol = ssl ? 'https' : 'http';

  return SERVICE_DEFS.map(def => ({
    id: def.id,
    label: def.label,
    emoji: def.emoji,
    port: def.port,
    localUrl: `http://localhost:${def.port}`,
    serverUrl: serverIp ? `http://${serverIp}:${def.port}` : null,
    domainUrl: domain ? `${protocol}://${def.subdomain}.${domain}` : null,
  }));
}
