/**
 * Shared component registry used by install, add, and remove commands.
 */

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
  },
  {
    id: 'ollama',
    organ: 'brain',
    label: 'Ollama',
    emoji: '🧠',
    description: 'Local AI inference engine. Runs open-source models (Llama, Mistral, etc.) on your server. Keeps your data private.',
    category: 'data',
    requires: ['traefik'],
  },
  {
    id: 'synap',
    organ: 'brain',
    label: 'Synap Data Pod',
    emoji: '🧠',
    description: 'Your sovereign second brain. Stores and organises all your data — notes, tasks, contacts, bookmarks. The foundation of your personal AI infrastructure.',
    category: 'data',
    requires: ['traefik'],
  },
  {
    id: 'openclaw',
    organ: 'arms',
    label: 'OpenClaw',
    emoji: '🦾',
    description: 'AI action layer. Gives your AI agent the ability to execute commands, access your files, and interact with the world.',
    category: 'agent',
    requires: ['synap'],
  },
  {
    id: 'hermes',
    organ: 'builder',
    label: 'Hermes',
    emoji: '🏗️',
    description: 'AI builder system. Enables the agent to create, deploy, and manage new applications and services automatically.',
    category: 'builder',
    requires: ['synap'],
  },
  {
    id: 'rsshub',
    organ: 'eyes',
    label: 'RSSHub',
    emoji: '👁️',
    description: 'Data perception layer. Turns any website into RSS feeds so your AI can stay informed about what matters.',
    category: 'perception',
    requires: ['synap'],
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
  },
];

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
