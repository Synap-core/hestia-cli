import type {
  ComponentDoctorMetadata,
  ComponentHealth,
  ComponentLifecycle,
  MaterializerTarget,
} from './operational.js';

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
  /** One-sentence summary used in lists and tooltips. */
  description: string;
  /**
   * Multi-paragraph plain-language explanation rendered on the component
   * detail panel. Tells the user what it is, why a sovereign stack uses it,
   * and what they can do with it once it's running. Optional — falls back
   * to `description` when missing.
   */
  longDescription?: string;
  /** Project URL for the underlying upstream — shown in the "Learn more" link. */
  homepage?: string;
  category: 'infrastructure' | 'data' | 'agent' | 'builder' | 'perception' | 'add-on';
  /** Whether this is always installed as infrastructure */
  alwaysInstall?: boolean;
  /** Prerequisites (other component IDs that must be installed first) */
  requires?: string[];
  /** Network identity — only present for HTTP-exposed services. */
  service?: ServiceInfo;
  /** Materialized outputs that should be refreshed when config changes. */
  materializers?: MaterializerTarget[];
  /** Health strategy used by Doctor and dashboard surfaces. */
  health?: ComponentHealth;
  /** Lifecycle/restart semantics for config application. */
  lifecycle?: ComponentLifecycle;
  /** Doctor criticality and integration grouping metadata. */
  doctor?: ComponentDoctorMetadata;
  /**
   * When true, the component is superseded by a better alternative.
   * The component still installs and runs — users who have it keep it.
   * `deprecationNotice` explains what to use instead and why.
   */
  deprecated?: boolean;
  deprecationNotice?: string;
  /** Recommended replacement component id, if any. */
  replacedBy?: string;
}

export const COMPONENTS: ComponentInfo[] = [
  {
    id: 'traefik',
    organ: 'legs',
    label: 'Traefik',
    emoji: '🦿',
    description: 'Reverse proxy & routing. Handles domain exposure, SSL termination, and service discovery for all Eve services. Always installed.',
    longDescription: `Traefik is the front door of your stack. It listens on ports 80 and 443, terminates SSL with automatic Let's Encrypt certificates, and routes incoming requests to the right container based on the hostname.

Every other Eve service hides behind it — Synap pod, Open WebUI, OpenClaw, the dashboard itself. When you set a domain (e.g. \`mystack.com\`), Traefik provisions certs for every \`<service>.mystack.com\` subdomain and routes traffic by container name on the shared \`eve-network\`.

Traefik is always-on infrastructure. It can't be removed; the rest of the stack depends on it for any externally-reachable URL.`,
    homepage: 'https://traefik.io',
    category: 'infrastructure',
    alwaysInstall: true,
    service: {
      containerName: 'eve-legs-traefik',
      internalPort: 80,
      hostPort: 80,
      subdomain: null, // Traefik itself isn't routed by Traefik
      healthPath: '/',
    },
    materializers: ['traefik-routes'],
    health: { kind: 'docker' },
    lifecycle: { restartStrategy: 'restart' },
    doctor: { critical: true },
  },
  {
    id: 'nango',
    organ: 'arms',
    label: 'Nango',
    emoji: '🔗',
    description: 'Self-hosted OAuth integration platform. Connects Google, Slack, GitHub and 300+ services to your pod — tokens stay on your server.',
    longDescription: `Nango is the integration layer that lets your pod speak OAuth with the outside world. Connect Google Contacts, Gmail, Google Calendar, Slack, GitHub, and hundreds more — without routing credentials through any third-party cloud.

Why a sovereign stack needs Nango: most SaaS APIs require OAuth. Without it, you either paste API keys manually or give a cloud service access to your tokens. Nango self-hosted handles the full OAuth dance on your machine — the access tokens and refresh tokens never leave your server.

Once Nango is running, Synap's CRM can sync Google Contacts → contacts, Gmail threads → notes, and Google Calendar events → activity. Eve can trigger real-time enrichment from any connected service. You configure OAuth app credentials once (Google Cloud Console, Slack app settings) and Nango handles the rest.

Requires Postgres (already part of the Brain). Listens on port 3003, accessible only within the Eve network — not exposed publicly.`,
    homepage: 'https://nango.dev',
    category: 'infrastructure',
    requires: ['traefik', 'synap'],
    service: {
      containerName: 'eve-arms-nango',
      internalPort: 3003,
      hostPort: null,
      subdomain: 'nango',
      healthPath: '/health',
    },
    health: { kind: 'http', path: '/health' },
    lifecycle: { restartStrategy: 'restart' },
    doctor: { critical: false },
  },
  {
    id: 'ollama',
    organ: 'brain',
    label: 'Ollama',
    emoji: '🤖',
    description: 'Local AI inference engine. Runs open-source models (Llama, Mistral, etc.) on your server. Keeps your data private.',
    longDescription: `Ollama is a local model runtime — a self-contained LLM server you can pull models into and call via an OpenAI-compatible API. Llama, Mistral, Qwen, Gemma — pick what fits your hardware.

Why a sovereign stack runs Ollama: your prompts and outputs never leave the machine. Synap IS will route to Ollama as a provider just like it routes to Anthropic or OpenAI, so agents and Open WebUI can use a local model without any code change.

Heads up: model quality and speed depend heavily on your server's RAM and GPU. A 7B model is the practical baseline on CPU; 13B+ benefits from a GPU.`,
    homepage: 'https://ollama.ai',
    category: 'data',
    requires: ['traefik'],
    service: {
      containerName: 'eve-brain-ollama',
      internalPort: 11434,
      hostPort: 11434,
      subdomain: 'ai',
      healthPath: '/',
    },
    health: { kind: 'http', path: '/' },
    lifecycle: { restartStrategy: 'restart' },
    doctor: { critical: false },
  },
  {
    id: 'synap',
    organ: 'brain',
    label: 'Synap Data Pod',
    emoji: '🧠',
    description: 'Your sovereign second brain. Stores and organises all your data — notes, tasks, contacts, bookmarks. The foundation of your personal AI infrastructure.',
    longDescription: `Synap is the data store every other component reads from. It captures notes, tasks, contacts, bookmarks, and any other entity type you define — typed JSONB profiles in Postgres, indexed by Typesense and pgvector for full-text and semantic search.

The pod exposes both a tRPC API (for the Synap web/desktop apps) and a REST Hub Protocol (for AI agents like OpenClaw and external connectors). Once installed, agents can read and write data through Synap rather than each maintaining their own private store.

This is the brain of the brain organ — most of what makes your stack feel intelligent depends on Synap being healthy. Watch its logs first when something feels off.`,
    homepage: 'https://github.com/synap-core/synap-backend',
    category: 'data',
    requires: ['traefik'],
    service: {
      containerName: 'eve-brain-synap',
      internalPort: 4000,
      hostPort: null, // bound only inside docker network
      subdomain: 'pod',
      healthPath: '/health',
    },
    materializers: ['backend-env', 'ai-wiring'],
    health: { kind: 'http', path: '/health' },
    lifecycle: { restartStrategy: 'compose-up', envBound: true },
    doctor: { critical: true, integrationId: 'synap' },
  },
  {
    id: 'pod-admin',
    organ: 'brain',
    label: 'Pod Admin Console',
    emoji: '🛠️',
    description: 'Operator console for the Synap pod — workspaces, users, audit. Replaces the legacy admin SPA.',
    longDescription: `Pod Admin is the Next.js operator console for your Synap Data Pod. It's where you manage workspaces, users, agent provisioning, and audit logs. After Kratos login the browser redirects here, so it's the surface humans interact with most.

Co-located with the synap pod (same docker-compose project, same image release cadence) but exposed on its own subdomain (\`pod-admin.<root>\`) so the API origin (\`pod.<root>\`) and the UI origin stay clean. Kratos session cookies are scoped to the bare root domain so login at one carries over to the other.`,
    homepage: 'https://github.com/synap-core/synap-backend',
    category: 'data',
    requires: ['synap'],
    service: {
      containerName: 'eve-brain-pod-admin',
      internalPort: 3000,
      hostPort: null,
      subdomain: 'pod-admin',
      healthPath: '/',
    },
    health: { kind: 'http', path: '/' },
    lifecycle: { restartStrategy: 'compose-up', envBound: true },
    doctor: { critical: false, integrationId: 'synap' },
  },
  {
    id: 'openclaw',
    organ: 'arms',
    label: 'OpenClaw',
    emoji: '🦾',
    description: 'AI action layer. Connects your stack to 24+ messaging platforms and executes agent skills. Prefer Hermes for new installs.',
    longDescription: `OpenClaw turns your AI from a chat companion into an agent that can act across 24+ platforms — Telegram, Discord, WhatsApp, iMessage, Slack, Signal, Matrix, and more. It runs as a sandboxed Node.js gateway with shell access, a filesystem, MCP server mode (exposing channels to Claude Code and other MCP clients), and a skill system backed by the ClawHub registry (5,400+ community skills).

Eve wires OpenClaw against Synap as its OpenAI-compatible provider, so the agent's brain is any provider you've configured. When the agent reads or writes data it goes through Synap's Hub Protocol — full audit trail, proposals when permissions don't allow direct writes.

**Note:** For new installs, Hermes is the recommended agent. Hermes has a contractual memory plugin that guarantees 100% of conversations sync to your Synap pod, better multi-agent orchestration, and a stronger security record. OpenClaw remains fully supported and is the better choice if you need MCP server mode for Claude Code or iMessage support.`,
    homepage: 'https://openclaw.ai',
    category: 'agent',
    requires: ['synap'],
    deprecated: true,
    deprecationNotice: 'Prefer Hermes for new installs — it has native memory plugin integration with Synap, better security, and true multi-agent orchestration. OpenClaw stays fully functional and is the right choice for MCP bridge or iMessage. See docs/openclaw-vs-hermes.md.',
    replacedBy: 'hermes',
    service: {
      containerName: 'eve-arms-openclaw',
      internalPort: 18789,
      hostPort: 18789,
      subdomain: 'openclaw',
    },
    materializers: ['openclaw-config', 'ai-wiring'],
    health: { kind: 'docker' },
    lifecycle: { restartStrategy: 'recreate', envBound: true },
    doctor: { critical: false, integrationId: 'openclaw-synap' },
  },
  {
    id: 'hermes',
    organ: 'arms',
    label: 'Hermes',
    emoji: '🧠',
    description: 'AI agent with sovereign memory. Routes all conversations and channel messages to your Synap pod — nothing is lost.',
    longDescription: `Hermes is the primary AI agent for your Eve stack. It runs as a headless gateway (port 8642) that handles messaging from Telegram, Discord, WhatsApp, Signal, Matrix, Slack, and 14 more platforms. Unlike other agents, Hermes has a contractual memory architecture: a custom Synap plugin (auto-generated by Eve) guarantees that 100% of every conversation turn is synced to your Data Pod.

Key capabilities: true multi-agent orchestration (spawn specialised sub-agents), 7 terminal backends (local, Docker, SSH, Modal, Daytona), 61 built-in tools, self-improving skills (the agent creates and refines its own skills during use), and a dashboard on port 9119.

The Synap plugin is the crown jewel: Eve generates \`synap_provider.py\` into the Hermes plugin directory. Hermes loads it on startup and from that point every turn — prefetch (memory context injected before each reply) + sync_turn (conversation written to Synap after each reply) + on_session_end (facts extracted at the end) — all route through Hub Protocol to your pod. Hermes stays stateless; Synap is the brain.`,
    homepage: 'https://hermes-agent.nousresearch.com',
    category: 'agent',
    requires: ['synap'],
    service: {
      containerName: 'eve-builder-hermes',
      internalPort: 8642,
      hostPort: 8642,
      subdomain: 'hermes',
      healthPath: '/health',
    },
    materializers: ['hermes-env', 'ai-wiring'],
    health: { kind: 'http', path: '/health' },
    lifecycle: { restartStrategy: 'recreate', envBound: true },
    doctor: { critical: false, integrationId: 'hermes-synap' },
  },
  {
    id: 'rsshub',
    organ: 'eyes',
    label: 'RSSHub Feeds',
    emoji: '👁️',
    description: 'Data perception layer. Turns any website into RSS feeds so your AI can stay informed about what matters.',
    longDescription: `RSSHub generates RSS feeds for sources that don't expose them — Twitter accounts, GitHub issues, LinkedIn updates, news sites, anything that publishes regularly without a feed. It runs ~1,000 source adapters out of the box.

For a sovereign stack this matters because it's how your AI keeps up with the world without any external service in the loop. Synap subscribes to RSSHub feeds, captures items as bookmark entities, and your agents see new content in their context the same way they see your manually-captured notes.

This is the eyes organ — the part of your stack that watches things you care about so you don't have to.`,
    homepage: 'https://docs.rsshub.app',
    category: 'perception',
    requires: ['synap'],
    service: {
      containerName: 'eve-eyes-rsshub',
      internalPort: 1200,
      hostPort: 1200,
      subdomain: 'feeds',
      healthPath: '/',
    },
    health: { kind: 'http', path: '/' },
    lifecycle: { restartStrategy: 'restart' },
    doctor: { critical: false },
  },
  {
    id: 'dokploy',
    label: 'Dokploy',
    emoji: '🔧',
    description: 'Low-code PaaS for deploying applications. Optional — install later if you need a visual deployment dashboard.',
    longDescription: `Dokploy is a self-hosted PaaS — think Heroku or Railway, running on your own server. It manages app deployments, databases, and SSL through a visual UI, sitting alongside Eve's Traefik (or replacing it if you prefer Dokploy's routing).

Install this if you want a clicky deploy story for the apps Hermes generates — push code, click deploy, get a URL. Skip it if you're happy running compose files by hand.`,
    homepage: 'https://dokploy.com',
    category: 'add-on',
    lifecycle: { restartStrategy: 'none' },
    doctor: { critical: false },
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    emoji: '💻',
    description: 'AI-powered code editor. Lets your agent write and edit code directly on your server.',
    longDescription: `OpenCode is an AI-augmented code editor exposed as a service. Your agents (and you) can open files, edit them, run commands — all from the same machine your stack lives on, with Synap's data as context.

This is how a sovereign stack does development without bouncing through someone else's cloud IDE. It pairs especially well with Hermes for "describe what you want, watch the agent write it" loops.`,
    homepage: 'https://github.com/sst/opencode',
    category: 'add-on',
    lifecycle: { restartStrategy: 'none' },
    doctor: { critical: false },
  },
  {
    id: 'openclaude',
    label: 'OpenClaude',
    emoji: '🤖',
    description: 'Claude Code as a service. Exposes Claude Code to your agent for advanced coding tasks.',
    longDescription: `OpenClaude wraps Claude Code as a long-running service so your agents can delegate hard coding tasks to it. Where OpenClaw is general-purpose action, OpenClaude is specifically the heavyweight coding sub-agent.

Use this when you want the best-in-class coding model on tap from inside your stack — without exposing your codebase to a third party that doesn't run on your hardware.`,
    category: 'add-on',
    lifecycle: { restartStrategy: 'none' },
    doctor: { critical: false },
  },
  {
    id: 'claude-code',
    label: 'Claude Code CLI',
    emoji: '⚡',
    description: 'Anthropic\'s Claude Code CLI installed on your server. Run AI-powered coding sessions directly from the terminal.',
    longDescription: `Claude Code is Anthropic's official AI coding assistant that runs in your terminal. It can read, write and edit files, run tests, execute commands, and navigate large codebases — all from a single CLI.

Installing it on your server means your Eve agents (especially Hermes) can spawn a Claude Code session on the server itself to tackle complex coding tasks. It's also just useful to have available when you SSH in.

Requires an Anthropic API key. After install, run \`claude\` to start a session or \`claude --help\` for all options.`,
    homepage: 'https://claude.ai/code',
    category: 'add-on',
    lifecycle: { restartStrategy: 'none' },
    doctor: { critical: false },
  },
  {
    id: 'openwebui',
    label: 'Open WebUI',
    emoji: '💬',
    description: 'Self-hosted chat UI wired to Synap IS. No external DB — SQLite by default. Eve installs inline Filter Functions for memory injection + channel sync.',
    longDescription: `Open WebUI is the chat interface for everyone in your household or team — looks like ChatGPT, runs on your stack. Eve wires it against Synap IS as the OpenAI-compatible backend, so any provider you've configured (Anthropic, OpenAI, OpenRouter, Ollama) is available behind a normal model picker.

State (conversations, users, settings) lives in a local SQLite by default — no external database.

Eve also installs two inline Filter Functions directly into Open WebUI:
  - Synap Memory Injection — pre-prompt hook that pulls relevant entities + memories from your pod and injects them as context.
  - Synap Channel Sync — mirrors every conversation into a Synap thread so your agents can read it as context.

The other Hub Protocol operations (entity create, knowledge search, calendar lookup, …) are exposed as model-callable tools via the registered OpenAPI tool server, so the model decides when to invoke them.`,
    homepage: 'https://openwebui.com',
    category: 'add-on',
    requires: ['synap'],
    service: {
      containerName: 'hestia-openwebui',
      internalPort: 8080,
      hostPort: 3011,
      subdomain: 'chat',
      healthPath: '/health',
    },
    materializers: ['openwebui-config', 'ai-wiring'],
    health: { kind: 'http', path: '/health' },
    lifecycle: { restartStrategy: 'compose-up', envBound: true },
    doctor: { critical: false, integrationId: 'openwebui-synap' },
  },
  {
    id: 'eve-dashboard',
    label: 'Eve Dashboard',
    emoji: '🌿',
    description: 'Web dashboard for Eve — view installed components, manage AI providers, configure your stack from a browser.',
    longDescription: `The Eve Dashboard is the meta-UI you're looking at right now: a Next.js app shipped as a Docker container that joins the same network as everything else. It reads your stack's secrets and state via mounted host paths and talks to Docker via the daemon socket.

It's the front door — the place where you check that your stack is alive, jump into other components' UIs, and configure the plumbing every component needs (AI keys, domain, SSL). The actual work happens in the apps it launches you into.

Always-on infrastructure, like Traefik. Removing it would leave you with no UI control plane.`,
    category: 'infrastructure',
    requires: ['traefik'],
    alwaysInstall: true,
    service: {
      containerName: 'eve-dashboard',
      // Internal port the Next standalone server listens on (PORT env, default 3000).
      internalPort: 3000,
      // Host port for direct localhost access (when no domain is configured).
      hostPort: 7979,
      subdomain: 'eve',
      healthPath: '/api/state',
    },
    materializers: ['traefik-routes'],
    health: { kind: 'http', path: '/api/state' },
    lifecycle: { restartStrategy: 'recreate', envBound: true },
    doctor: { critical: true },
  },
];

/**
 * @deprecated Use resolveComponent('eve-dashboard') instead. The dashboard is
 * now a regular Docker service registered in COMPONENTS. Kept as a re-export
 * for one release so callers don't break mid-migration.
 */
export const EVE_DASHBOARD_SERVICE = {
  id: 'eve-dashboard',
  label: 'Eve Dashboard',
  emoji: '🌿',
  service: {
    containerName: 'eve-dashboard',
    internalPort: 3000,
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

/**
 * Validate that a string passed as a "primary domain" looks like a bare root
 * (e.g. `example.com` or `team.thearchitech.xyz`) and not a service subdomain
 * (e.g. `pod.example.com`, `pod-admin.example.com`).
 *
 * Why this exists: every registered component owns a Traefik subdomain. When
 * `eve domain set <X>` is called with `<X>` already prefixed by a known
 * component subdomain, the Traefik route generator faithfully appends every
 * subdomain on top — producing `pod.pod.example.com`, `eve.pod.example.com`,
 * etc. The user has no way to recover except `eve domain set` again with the
 * right value. Catch it at the entry point instead.
 *
 * Returns null if the input is acceptable, or an error message string when
 * the first label collides with a known service subdomain.
 */
export function validateBaseDomain(input: string): string | null {
  const trimmed = input.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!trimmed.includes('.')) return null; // single-label or localhost — let other checks handle
  const firstLabel = trimmed.split('.')[0]!;
  const reserved = new Set(
    COMPONENTS
      .map(c => c.service?.subdomain)
      .filter((s): s is string => typeof s === 'string' && s.length > 0),
  );
  if (reserved.has(firstLabel)) {
    const root = trimmed.slice(firstLabel.length + 1);
    return (
      `"${trimmed}" looks like a service subdomain (first label "${firstLabel}" matches a registered component). ` +
      `Pass the bare root domain instead, e.g. "${root}". ` +
      `Eve will append component subdomains automatically (pod.${root}, pod-admin.${root}, eve.${root}, …).`
    );
  }
  return null;
}

/**
 * Build the public Traefik URL for a component, e.g. `https://pod.example.com`
 * for `componentId='synap'` + `domain='example.com'` + `ssl=true`.
 *
 * Returns `null` when:
 *   - the domain is missing or `localhost` (no public routing → caller should
 *     fall back to a host-port loopback URL or container DNS)
 *   - the component has no subdomain (not Traefik-routed)
 *
 * Why this lives in @eve/dna: the subdomain mapping (synap → 'pod', openclaw →
 * 'openclaw', …) is owned by COMPONENTS. Anything that wants a public URL —
 * setup write site, doctor, lifecycle reconcile — should derive it from one
 * helper instead of re-stringifying `https://pod.${domain}` in five places
 * and drifting when we rename a subdomain.
 */
export function publicComponentUrl(
  componentId: string,
  domain: string | undefined | null,
  ssl: boolean,
): string | null {
  const cleanDomain = domain?.trim();
  if (!cleanDomain || cleanDomain === 'localhost') return null;
  const comp = COMPONENTS.find(c => c.id === componentId);
  if (!comp || !comp.service?.subdomain) return null;
  const scheme = ssl ? 'https' : 'http';
  return `${scheme}://${comp.service.subdomain}.${cleanDomain}`;
}

/** True if a URL points at a host-loopback address (127.0.0.1, ::1, localhost). */
export function isLoopbackUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.hostname === '127.0.0.1' ||
      u.hostname === 'localhost' ||
      u.hostname === '::1' ||
      u.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

/**
 * In-network URL for the synap-backend container, addressable from any
 * other container on `eve-network`. NOT for host-side use — the host has
 * no DNS for this name (synap-backend's compose project is separate).
 *
 * Use this when WRITING SYNAP_API_URL into a sidecar container's env
 * (openwebui Functions, openclaw, sandbox). The container resolves the
 * hostname via Docker DNS and connects directly on the bridge — no
 * round-trip out to the public internet, no Traefik in the path.
 *
 * For host-side reads (CLI, doctor, dashboard), use `resolveSynapUrl`
 * which returns the public Traefik URL.
 */
export const SYNAP_BACKEND_INTERNAL_URL = 'http://eve-brain-synap:4000';
/** Host loopback port where Eve publishes the backend for on-host CLI access. */
export const SYNAP_HOST_LOOPBACK_PORT = 14000;

/**
 * Pure derivation of the Synap pod URL — no I/O, no probing, just
 * reads from the secrets shape. Used in two contexts:
 *
 *   - **Container env files** (sandbox env, OpenClaw env, OpenWebUI
 *     Function valves, etc.): the value baked here is what other
 *     containers resolve when they call `fetch(SYNAP_API_URL)`. They reach the
 *     backend via Docker DNS on `eve-network`, not via host loopback,
 *     so this function returns the public URL — that's what bridges
 *     non-eve-network callers AND the off-host case.
 *
 *   - **Off-host CLI** (`eve` invoked from a laptop): no loopback to
 *     probe, the public URL is the only correct answer.
 *
 * For **on-host CLI runtime**, prefer `resolveSynapUrlOnHost(secrets)`
 * (in `./loopback-probe.ts`). That helper probes the loopback port
 * Eve publishes via its `docker-compose.override.yml` and returns
 * `http://127.0.0.1:14000` when reachable — same-host, sub-millisecond,
 * doesn't depend on DNS or certs. It falls back to this function when
 * the loopback isn't there. See
 * `synap-team-docs/content/team/devops/eve-cli-transports.mdx` for the
 * full transport-selection design.
 *
 * Resolution order (first match wins):
 *
 *   1. **Stored non-loopback `apiUrl`** — someone explicitly pointed Eve
 *      at a remote pod (`apiUrl: "https://pod.acme.com"`). We trust them.
 *
 *   2. **Derived from `domain.primary`** — when a public domain is
 *      configured we ALWAYS prefer the Traefik route. SSL defaults to
 *      `true` because every standard install runs Let's Encrypt — only
 *      an explicit `domain.ssl: false` opts out.
 *
 *   3. **Stored loopback** — pure local dev. Use whatever was stored
 *      (typically `http://127.0.0.1:4000`).
 *
 *   4. **Hardcoded loopback** — never-installed-yet fallback so callers
 *      don't have to special-case `null`.
 *
 * Why a function and not a stored field: storing the URL means rewriting
 * it on every domain change, every install, every reconcile. We tried
 * that — it created the loopback drift bug that wasted days. Pure
 * derivation is simpler AND impossible to drift.
 */
export function resolveSynapUrl(
  secrets: { synap?: { apiUrl?: string }; domain?: { primary?: string; ssl?: boolean } } | null | undefined,
): string {
  const stored = secrets?.synap?.apiUrl?.trim();
  if (stored && !isLoopbackUrl(stored)) return stored;

  const domain = secrets?.domain?.primary?.trim();
  if (domain && domain !== 'localhost') {
    const ssl = secrets?.domain?.ssl ?? false; // default false — must opt-in with --ssl
    return `${ssl ? 'https' : 'http'}://pod.${domain}`;
  }

  // Stored loopback URL is a last resort — only used when the caller
  // already knows the backend is reachable there (e.g. docker-in-docker).
  // Returning empty string here lets callers surface a proper "run eve
  // setup" error instead of silently attempting an unreachable localhost.
  if (stored) return stored;
  return '';
}
