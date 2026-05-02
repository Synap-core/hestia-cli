/**
 * Single source of truth for Eve components.
 *
 * Every component declares its install metadata (label, organ, prerequisites)
 * AND its network identity (container name, ports, subdomain). Downstream
 * features (access URLs, Traefik routes, doctor checks) MUST derive from this
 * — never hardcode container names or ports elsewhere.
 */

/**
 * Network identity of a component once installed. Present only for components
 * that expose an HTTP-ish service. Pure-config components (e.g. opencode, dokploy)
 * leave this undefined.
 */
export interface ServiceInfo {
  /** Docker container name once running. */
  containerName: string;
  /** Port the container listens on internally (used by Traefik upstream URL). */
  internalPort: number;
  /** Host port mapped to the container, if any. null = not exposed on host. */
  hostPort: number | null;
  /** Traefik subdomain (e.g. 'pod' for pod.<domain>). null = not routed. */
  subdomain: string | null;
  /** Health check path that should return 2xx/3xx when the service is up. */
  healthPath?: string;
}

export interface ComponentInfo {
  id: string;
  organ?: string;
  label: string;
  emoji: string;
  description: string;
  category: 'infrastructure' | 'data' | 'agent' | 'builder' | 'perception' | 'add-on';
  /** Whether this is always installed as infrastructure */
  alwaysInstall?: boolean;
  /** Prerequisites (other component IDs that must be installed first) */
  requires?: string[];
  /** Network identity — only present for HTTP-exposed services. */
  service?: ServiceInfo;
}

export const COMPONENTS: ComponentInfo[] = [
  {
    id: 'traefik',
    organ: 'legs',
    label: 'Traefik',
    emoji: '🦿',
    description: 'Reverse proxy & routing. Handles domain exposure, SSL termination, and service discovery for all Eve services. Always installed.',
    category: 'infrastructure',
    alwaysInstall: true,
    service: {
      containerName: 'eve-legs-traefik',
      internalPort: 80,
      hostPort: 80,
      subdomain: null, // Traefik itself isn't routed by Traefik
      healthPath: '/',
    },
  },
  {
    id: 'ollama',
    organ: 'brain',
    label: 'Ollama',
    emoji: '🤖',
    description: 'Local AI inference engine. Runs open-source models (Llama, Mistral, etc.) on your server. Keeps your data private.',
    category: 'data',
    requires: ['traefik'],
    service: {
      containerName: 'eve-brain-ollama',
      internalPort: 11434,
      hostPort: 11434,
      subdomain: 'ai',
      healthPath: '/',
    },
  },
  {
    id: 'synap',
    organ: 'brain',
    label: 'Synap Data Pod',
    emoji: '🧠',
    description: 'Your sovereign second brain. Stores and organises all your data — notes, tasks, contacts, bookmarks. The foundation of your personal AI infrastructure.',
    category: 'data',
    requires: ['traefik'],
    service: {
      containerName: 'synap-backend-backend-1',
      internalPort: 4000,
      hostPort: null, // bound only inside docker network
      subdomain: 'pod',
      healthPath: '/health',
    },
  },
  {
    id: 'openclaw',
    organ: 'arms',
    label: 'OpenClaw',
    emoji: '🦾',
    description: 'AI action layer. Gives your AI agent the ability to execute commands, access your files, and interact with the world.',
    category: 'agent',
    requires: ['synap'],
    service: {
      containerName: 'eve-arms-openclaw',
      internalPort: 3000,
      hostPort: 3000,
      subdomain: 'openclaw',
      // healthPath omitted: OpenClaw's web UI may not respond to GET / with
      // 2xx (auth-gated, redirects, etc.). Container-running is enough for
      // the verify step; browser users hit the UI via Traefik directly.
    },
  },
  {
    id: 'hermes',
    organ: 'builder',
    label: 'Hermes',
    emoji: '🏗️',
    description: 'AI builder system. Enables the agent to create, deploy, and manage new applications and services automatically.',
    category: 'builder',
    requires: ['synap'],
    // No service — Hermes is a CLI helper, not a network service
  },
  {
    id: 'rsshub',
    organ: 'eyes',
    label: 'RSSHub Feeds',
    emoji: '👁️',
    description: 'Data perception layer. Turns any website into RSS feeds so your AI can stay informed about what matters.',
    category: 'perception',
    requires: ['synap'],
    service: {
      containerName: 'eve-eyes-rsshub',
      internalPort: 1200,
      hostPort: 1200,
      subdomain: 'feeds',
      healthPath: '/',
    },
  },
  {
    id: 'dokploy',
    label: 'Dokploy',
    emoji: '🔧',
    description: 'Low-code PaaS for deploying applications. Optional — install later if you need a visual deployment dashboard.',
    category: 'add-on',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    emoji: '💻',
    description: 'AI-powered code editor. Lets your agent write and edit code directly on your server.',
    category: 'add-on',
  },
  {
    id: 'openclaude',
    label: 'OpenClaude',
    emoji: '🤖',
    description: 'Claude Code as a service. Exposes Claude Code to your agent for advanced coding tasks.',
    category: 'add-on',
  },
  {
    id: 'openwebui',
    label: 'Open WebUI',
    emoji: '💬',
    description: 'Self-hosted chat UI wired to Synap IS (AI provider). No external DB — SQLite by default. Pipelines sidecar enables Synap memory and channel sync.',
    category: 'add-on',
    requires: ['synap'],
    service: {
      containerName: 'hestia-openwebui',
      internalPort: 8080,
      hostPort: 3011,
      subdomain: 'chat',
      healthPath: '/health',
    },
  },
];

/**
 * Special pseudo-component for the Eve Dashboard. Not in COMPONENTS because
 * it's not installed via `eve add`, but downstream features (access URLs,
 * Traefik routes) treat it like any other service.
 */
export const EVE_DASHBOARD_SERVICE = {
  id: 'eve-dashboard',
  label: 'Eve Dashboard',
  emoji: '🌿',
  service: {
    containerName: null as string | null, // null = host process (started by `eve ui`)
    internalPort: 7979,
    hostPort: 7979,
    subdomain: 'eve' as string | null,
    healthPath: '/api/state',
  },
} as const;

/** Resolve a component by ID; throws if not found. */
export function resolveComponent(id: string): ComponentInfo {
  const comp = COMPONENTS.find(c => c.id === id);
  if (!comp) {
    throw new Error(`Unknown component: ${id}. Available: ${COMPONENTS.map(c => c.id).join(', ')}`);
  }
  return comp;
}

/** All component IDs sorted by install priority (infrastructure first, add-ons last). */
export function allComponentIds(): string[] {
  return COMPONENTS.filter(c => !c.category.includes('add-on')).map(c => c.id);
}

/** Add-on component IDs (can be added/removed freely). */
export function addonComponentIds(): string[] {
  return COMPONENTS.filter(c => c.category === 'add-on').map(c => c.id);
}

/** Filter component list to only those selected by a boolean map. */
export function selectedIds(selected: Record<string, boolean>): string[] {
  return COMPONENTS.filter(c => selected[c.id]).map(c => c.id);
}

/** Components that expose an HTTP service (eligible for Traefik routing). */
export function serviceComponents(): ComponentInfo[] {
  return COMPONENTS.filter(c => c.service !== undefined && c.service.subdomain !== null);
}
