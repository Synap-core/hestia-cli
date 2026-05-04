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
    longDescription: `OpenClaw turns your AI from a chat companion into an agent that can actually do things. It runs as a sandboxed Linux environment with shell access, a filesystem, network tooling, and a skill system that scopes what an agent is allowed to touch.

Eve wires OpenClaw against Synap IS as its OpenAI-compatible provider, so the agent's brain can be any provider you've configured (Anthropic, OpenAI, OpenRouter, local Ollama). When the agent reads or writes data, it goes through Synap's Hub Protocol — full audit trail, governance via proposals when permissions don't allow direct writes.

This is the heart of the arms organ. Without OpenClaw, your stack can think and store; with it, the stack can act on your behalf.`,
    homepage: 'https://github.com/synap-core/openclaw',
    category: 'agent',
    requires: ['synap'],
    service: {
      containerName: 'eve-arms-openclaw',
      // OpenClaw's gateway/canvas listens on 18789 inside the container —
      // observable via `[canvas] host mounted at http://0.0.0.0:18789/`
      // in the startup logs. The earlier 3000 mapping was wrong; it
      // exposed a port nothing was actually serving, so Traefik routes
      // for openclaw.<domain> 502'd with "connection refused."
      internalPort: 18789,
      hostPort: 18789,
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
    longDescription: `Hermes is the builder that lets your stack grow itself. It accepts high-level intents ("scaffold a Next.js app for tracking my reading", "deploy a Telegram bot for my notes") and produces real code, real Dockerfiles, real deployments — all through OpenClaw's actions and Synap's data.

Hermes runs as a CLI helper rather than a long-running service: the agent invokes it on demand. That's why it has no UI of its own and no port — its surface lives inside the conversations you have with the agent.

Pair this with Dokploy or OpenCode if you want a full AI-driven development loop on your own server.`,
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
  },
  {
    id: 'openclaude',
    label: 'OpenClaude',
    emoji: '🤖',
    description: 'Claude Code as a service. Exposes Claude Code to your agent for advanced coding tasks.',
    longDescription: `OpenClaude wraps Claude Code as a long-running service so your agents can delegate hard coding tasks to it. Where OpenClaw is general-purpose action, OpenClaude is specifically the heavyweight coding sub-agent.

Use this when you want the best-in-class coding model on tap from inside your stack — without exposing your codebase to a third party that doesn't run on your hardware.`,
    category: 'add-on',
  },
  {
    id: 'openwebui',
    label: 'Open WebUI',
    emoji: '💬',
    description: 'Self-hosted chat UI wired to Synap IS (AI provider). No external DB — SQLite by default. Pipelines sidecar enables Synap memory and channel sync.',
    longDescription: `Open WebUI is the chat interface for everyone in your household or team — looks like ChatGPT, runs on your stack. Eve wires it against Synap IS as the OpenAI-compatible backend, so any provider you've configured (Anthropic, OpenAI, OpenRouter, Ollama) is available behind a normal model picker.

State (conversations, users, settings) lives in a local SQLite by default — no external database. Once you install the Pipelines sidecar, conversations sync into Synap as channels and your agents can read them as context.

This is usually the most-used UI in a daily stack: it's where humans talk to the AI, while OpenClaw handles the actions and Hermes builds.`,
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
  },
  {
    id: 'openwebui-pipelines',
    label: 'Open WebUI Pipelines',
    emoji: '🪈',
    description: 'Python pipelines sidecar for Open WebUI. Wires chat into Synap memory + channel sync + Hermes job dispatch.',
    longDescription: `Open WebUI Pipelines is the bridge between everyday chat and your agent stack. It runs as a small Python service alongside Open WebUI; Open WebUI calls it as an OpenAI-compatible "filter" endpoint, and the pipelines decide what to do.

Three reference pipelines ship by default:
  - Synap memory injection — pre-prompt hook that pulls relevant entities from your pod via Hub Protocol and injects them as context, so the model sees what you actually have.
  - Channel sync — every conversation in Open WebUI becomes a Synap channel; messages flow both ways.
  - Hermes job dispatch — slash commands in chat ("/scaffold a Telegram bot") are picked up by Hermes and the result is reported back as a channel message.

This is what turns Open WebUI from a generic chat front-end into the Synap-aware chat front-end. Without it, Open WebUI is just a model picker.`,
    homepage: 'https://docs.openwebui.com/pipelines/',
    category: 'add-on',
    requires: ['openwebui', 'synap'],
    service: {
      containerName: 'eve-openwebui-pipelines',
      internalPort: 9099,
      hostPort: null, // internal-only — Open WebUI calls it on the docker network
      subdomain: null,
    },
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
 * (openwebui-pipelines, openclaw, sandbox). The container resolves the
 * hostname via Docker DNS and connects directly on the bridge — no
 * round-trip out to the public internet, no Traefik in the path.
 *
 * For host-side reads (CLI, doctor, dashboard), use `resolveSynapUrl`
 * which returns the public Traefik URL.
 */
export const SYNAP_BACKEND_INTERNAL_URL = 'http://synap-backend-backend-1:4000';

/**
 * Single source of truth for the Synap pod URL. Every CLI command, every
 * lifecycle hook, every doctor probe goes through here — there is no
 * other correct way to read the pod URL. Replaces direct reads of
 * `secrets.synap.apiUrl`, which drift the moment the user changes their
 * domain config.
 *
 * Resolution order (first match wins):
 *
 *   1. **Stored non-loopback `apiUrl`** — someone explicitly pointed Eve
 *      at a remote pod (`apiUrl: "https://pod.acme.com"`). We trust them.
 *
 *   2. **Derived from `domain.primary`** — when a public domain is
 *      configured we ALWAYS prefer the Traefik route. synap-backend has
 *      no host port mapping; the public route is the actual designed
 *      path. SSL defaults to `true` because every standard install runs
 *      Let's Encrypt — only an explicit `domain.ssl: false` opts out.
 *
 *   3. **Stored loopback** — pure local dev. Use whatever was stored
 *      (typically `http://127.0.0.1:4000`).
 *
 *   4. **Hardcoded loopback** — never-installed-yet fallback so callers
 *      don't have to special-case `null`.
 *
 * Why a function and not a stored field: storing the URL means rewriting
 * it on every domain change, every install, every reconcile. We tried
 * that — it created the loopback drift bug that's been wasting our time.
 * Pure derivation is simpler AND impossible to drift.
 */
export function resolveSynapUrl(
  secrets: { synap?: { apiUrl?: string }; domain?: { primary?: string; ssl?: boolean } } | null | undefined,
): string {
  const stored = secrets?.synap?.apiUrl?.trim();
  if (stored && !isLoopbackUrl(stored)) return stored;

  const domain = secrets?.domain?.primary?.trim();
  if (domain && domain !== 'localhost') {
    const ssl = secrets?.domain?.ssl !== false; // default true
    return `${ssl ? 'https' : 'http'}://pod.${domain}`;
  }

  return stored || 'http://127.0.0.1:4000';
}
