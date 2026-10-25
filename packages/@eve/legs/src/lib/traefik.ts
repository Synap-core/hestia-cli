import { execSync, spawnSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, chmodSync, unlinkSync } from 'fs';
import { join } from 'path';
import { COMPONENTS } from '@eve/dna';

export interface Route {
  path: string;
  target: string;
  domain?: string;
  ssl?: boolean;
}

// Paths on the HOST filesystem that are mounted into the Traefik container.
// Container sees these at /etc/traefik/* (mapped in the docker-compose volumes).
const HOST_CONFIG_DIR = '/opt/traefik';
const HOST_DYNAMIC_DIR = '/opt/traefik/dynamic';

// Paths as seen INSIDE the Traefik container (mounted from the host above).
const CONTAINER_DYNAMIC_DIR = '/etc/traefik/dynamic';
const CONTAINER_ACME_FILE = '/etc/traefik/acme.json';

/**
 * Finds the synap-backend API container (managed by the synap CLI's docker-compose,
 * project name = "synap-backend", service = "backend").
 * Returns the container name, or null if not running.
 */
function getSynapBackendContainer(): string | null {
  return findComposeContainer('backend');
}

/**
 * Finds the pod-admin container (same compose project as the backend, service
 * = "pod-admin"). Returns the container name, or null if not running.
 */
function getSynapPodAdminContainer(): string | null {
  return findComposeContainer('pod-admin');
}

function findComposeContainer(service: string): string | null {
  try {
    const out = execSync(
      `docker ps --filter "label=com.docker.compose.project=synap-backend" --filter "label=com.docker.compose.service=${service}" --format "{{.Names}}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    return out.split('\n')[0]?.trim() || null;
  } catch {
    return null;
  }
}

// The backend's own default (synap-backend packages/core config.ts) and the
// literal the pod compose file sets.
const DEFAULT_STORAGE_BUCKET = 'synap-storage';
// S3 bucket naming rule. Also keeps the value safe to interpolate into a
// Traefik rule.
const S3_BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/**
 * The bucket the pod backend signs file links for: its MINIO_BUCKET_NAME ||
 * MINIO_BUCKET (the backend's precedence), else the backend's default. Read
 * from the running container's environment, the value the backend really uses.
 * `null` = the name it reports is not a valid bucket name (no route is safer
 * than a route built from it).
 */
function readPodStorageBucket(backendContainer: string | null): string | null {
  if (!backendContainer) {
    console.warn(`  Warning: Synap backend container not found — assuming storage bucket "${DEFAULT_STORAGE_BUCKET}"`);
    return DEFAULT_STORAGE_BUCKET;
  }
  let env: string[];
  try {
    env = JSON.parse(execSync(
      `docker inspect --format "{{json .Config.Env}}" ${backendContainer}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim()) as string[];
  } catch {
    console.warn(`  Warning: could not read ${backendContainer}'s environment — assuming storage bucket "${DEFAULT_STORAGE_BUCKET}"`);
    return DEFAULT_STORAGE_BUCKET;
  }
  const value = (key: string) =>
    env.find(e => e.startsWith(`${key}=`))?.slice(key.length + 1);
  const bucket = value('MINIO_BUCKET_NAME') || value('MINIO_BUCKET') || DEFAULT_STORAGE_BUCKET;
  if (!S3_BUCKET_NAME.test(bucket)) {
    console.warn(`  Warning: the pod's storage bucket "${bucket}" is not a valid bucket name — no /${bucket}/ route`);
    return null;
  }
  return bucket;
}

/**
 * Connect a container to eve-network with an optional DNS alias.
 *
 * Eve's compose templates (OpenWebUI, Hermes, Pipelines) and `wire-ai`
 * defaults call the Synap backend by the hostname `eve-brain-synap`, but
 * the Synap pod is installed via `synap-backend`'s own compose project,
 * yielding a runtime container name of `synap-backend-backend-1`. Without
 * an alias, OWUI sees `socket.gaierror: Name or service not known` when
 * fetching `/v1/models` — which silently empties the user-side model
 * picker. Passing `alias` registers the expected name on the network.
 *
 * If the container is already on eve-network without the alias, we
 * disconnect and reconnect with it so existing installs are repaired.
 */
function connectToEveNetwork(containerName: string, alias?: string): void {
  if (alias) {
    try {
      const inspect = execSync(
        `docker inspect --format "{{json .NetworkSettings.Networks}}" ${containerName}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
      ).trim();
      const networks = JSON.parse(inspect) as Record<string, { Aliases?: string[] | null }>;
      const eve = networks['eve-network'];
      if (eve) {
        if ((eve.Aliases ?? []).includes(alias)) return; // already correct
        try {
          execSync(`docker network disconnect eve-network ${containerName}`, {
            stdio: ['pipe', 'pipe', 'ignore'],
          });
        } catch {
          // disconnect failed — try connect anyway; worst case it's still wrong
        }
      }
    } catch {
      // inspect failed — proceed with connect attempt
    }
  }

  const aliasArg = alias ? ` --alias ${alias}` : '';
  try {
    execSync(`docker network connect${aliasArg} eve-network ${containerName}`, {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    // Already connected or container doesn't exist — both are fine
  }
}

// Private IP ranges we trust for forwarded headers in behind-proxy mode.
const TRUSTED_PROXY_IPS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.1/32',
];

function buildStaticConfig(ssl: boolean, email?: string): string {
  const acmeSection = ssl && email
    ? `
certificatesResolvers:
  letsencrypt:
    acme:
      email: ${email}
      storage: ${CONTAINER_ACME_FILE}
      tlsChallenge: {}
`
    : '';

  return `# Traefik static config — generated by Eve
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

providers:
  file:
    directory: ${CONTAINER_DYNAMIC_DIR}
    watch: true
${acmeSection}
api:
  dashboard: true
  insecure: true

log:
  level: INFO

accessLog: {}
`.trimStart();
}

function buildProxyModeStaticConfig(): string {
  const trustedIps = TRUSTED_PROXY_IPS.map(ip => `        - "${ip}"`).join('\n');
  return `# Traefik static config — generated by Eve (behind-proxy mode)
# External proxy handles SSL termination. Traefik listens on HTTP only.
entryPoints:
  web:
    address: ":80"
    forwardedHeaders:
      trustedIPs:
${trustedIps}

providers:
  file:
    directory: ${CONTAINER_DYNAMIC_DIR}
    watch: true

api:
  dashboard: true
  insecure: true

log:
  level: INFO

accessLog: {}
`.trimStart();
}


/**
 * Detect the Docker host gateway IP for reaching host-level services.
 * On Linux: 172.17.0.1 (docker0 bridge)
 * On Mac/Windows: host.docker.internal works via DNS
 */
function getDockerHostGateway(): string {
  // Reach the host machine from inside a Docker container where PM2 apps run.
  // The Docker network gateway (e.g., 172.18.0.1 for eve-network) routes to the host.
  try {
    const gw = execSync(
      "docker network inspect eve-network --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null",
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    if (gw) return gw;
  } catch { /* try next */ }
  
  try {
    const gw = execSync(
      "docker network inspect bridge --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null",
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    if (gw) return gw;
  } catch { /* fallback */ }
  
  return '172.17.0.1';
}

/**
 * Add UFW rules to allow Docker bridge networks to reach host ports.
 * This is needed when PM2 apps run on the host and Traefik runs in Docker.
 */
function allowDockerToHostPorts(ports: number[]): void {
  try {
    // Get Docker network CIDRs
    const networks = execSync(
      "docker network ls --format '{{.Name}}' | grep -E 'eve-network|bridge' | while read net; do docker network inspect \$net --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null; done",
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim().split('\n').filter(Boolean);
    
    for (const cidr of networks) {
      for (const port of ports) {
        try {
          execSync(`ufw allow from ${cidr} to any port ${port} 2>/dev/null`, {
            stdio: ['pipe', 'pipe', 'ignore'],
          });
        } catch { /* rule may already exist */ }
      }
    }
  } catch { /* UFW not available or not running */ }
}

/** A file's content, or null when it is absent or unreadable (then it differs from anything we write). */
function readFileOrNull(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null;
  } catch {
    return null;
  }
}

export class TraefikService {
  private configDir: string;
  private traefikConfigPath: string;
  private dynamicConfigDir: string;

  constructor(configDir: string = HOST_CONFIG_DIR) {
    this.configDir = configDir;
    this.traefikConfigPath = join(configDir, 'traefik.yml');
    this.dynamicConfigDir = join(configDir, 'dynamic');
  }

  async install(): Promise<void> {
    console.log('Installing Traefik...');

    if (!existsSync(this.configDir)) mkdirSync(this.configDir, { recursive: true });
    if (!existsSync(this.dynamicConfigDir)) mkdirSync(this.dynamicConfigDir, { recursive: true });

    const isDokploy = existsSync('/opt/dokploy');
    if (isDokploy) {
      console.log('Detected Dokploy — using existing Traefik installation');
      await this.configureDokployTraefik();
    } else {
      await this.installStandalone();
    }

    console.log('Traefik installation complete');
  }

  private async installStandalone(): Promise<void> {
    writeFileSync(this.traefikConfigPath, buildStaticConfig(false));
    console.log('Created Traefik static config');

    try {
      execSync('docker network create eve-network', { stdio: 'ignore' });
    } catch { /* already exists */ }

    // Ensure acme.json exists as a file with correct permissions
    const acmePath = join(this.configDir, 'acme.json');
    if (!existsSync(acmePath)) {
      writeFileSync(acmePath, '', { mode: 0o600 });
    } else {
      // Fix permissions if wrong
      try { chmodSync(acmePath, 0o600); } catch { /* non-fatal */ }
    }

    // Silent because the container often doesn't exist on first install or
    // after `domain repair` — surfacing "No such container" to the user is noise.
    spawnSync('docker', ['rm', '-f', 'eve-legs-traefik'], { stdio: 'ignore' });

    const result = spawnSync('docker', [
      'run', '-d',
      '--name', 'eve-legs-traefik',
      '--restart', 'unless-stopped',
      '-p', '80:80',
      '-p', '443:443',
      '-p', '8080:8080',
      '-v', '/var/run/docker.sock:/var/run/docker.sock:ro',
      '-v', `${this.configDir}/traefik.yml:/etc/traefik/traefik.yml:ro`,
      '-v', `${this.dynamicConfigDir}:/etc/traefik/dynamic:ro`,
      '-v', `${acmePath}:/etc/traefik/acme.json`,
      '--network', 'eve-network',
      'traefik:v3.0',
    ], { stdio: 'inherit' });

    if (result.status !== 0) throw new Error(`docker run exited with code ${result.status}`);
    console.log('Traefik container started');
  }

  private async configureDokployTraefik(): Promise<void> {
    console.log('Using Dokploy-managed Traefik');
  }

  /**
   * Regenerate the static config and `dynamic/eve-routes.yml` for `domain`.
   *
   * Traefik is restarted only when one of the two files actually changed:
   * every `eve update` regenerates the routes, and a restart there would drop
   * every route on the pod for a few seconds even though nothing moved.
   * Returns whether anything changed.
   */
  async configureSubdomains(domain: string, ssl: boolean, email?: string, installedComponents?: string[], behindProxy = false, customRoutes?: Array<{ subdomain: string; port: number; domain?: string }>): Promise<{ changed: boolean }> {
    // Synap backend runs in its own docker-compose project. Connect it to
    // eve-network so Traefik (also on eve-network) can resolve it by name.
    const synapContainer = getSynapBackendContainer();
    if (synapContainer) {
      // Alias 'eve-brain-synap' so OWUI/Hermes/wire-ai can resolve the pod
      // by the hostname every compose template + default base URL assumes.
      connectToEveNetwork(synapContainer, 'eve-brain-synap');
      console.log(`  Connected ${synapContainer} → eve-network (alias: eve-brain-synap)`);
    } else if (!installedComponents || installedComponents.includes('synap')) {
      console.warn('  Warning: Synap backend container not found — pod.domain routing will 502 until `eve brain init` is run');
    }

    // Pod admin ships with the synap-backend compose project — when synap is
    // installed, pod-admin runs alongside it. Auto-enrol so route generation
    // picks it up without operators needing a separate `eve install pod-admin`.
    const podAdminContainer = getSynapPodAdminContainer();
    if (podAdminContainer) {
      connectToEveNetwork(podAdminContainer, 'eve-brain-pod-admin');
      console.log(`  Connected ${podAdminContainer} → eve-network (alias: eve-brain-pod-admin)`);
    }
    let effectiveInstalled = installedComponents;
    if (
      effectiveInstalled &&
      effectiveInstalled.includes('synap') &&
      !effectiveInstalled.includes('pod-admin')
    ) {
      effectiveInstalled = [...effectiveInstalled, 'pod-admin'];
    }

    // Build routes from the component registry — single source of truth.
    // Every routed service (including the Eve dashboard) is a Docker container
    // on eve-network, addressable by its container name.
    const services: Array<{ id: string; subdomain: string; upstream: string; requires: string | null; domain?: string; priority?: number }> = [];
    const pathRoutes: Array<{ id: string; subdomain: string; path: string; upstream: string; requires: string | null }> = [];

    for (const comp of COMPONENTS) {
      if (!comp.service || !comp.service.subdomain) continue;
      if (effectiveInstalled && !effectiveInstalled.includes(comp.id)) continue;

      let containerName = comp.service.containerName;
      if (comp.id === 'synap' && synapContainer) containerName = synapContainer;
      if (comp.id === 'pod-admin' && podAdminContainer) containerName = podAdminContainer;

      services.push({
        id: comp.id,
        subdomain: comp.service.subdomain,
        upstream: `http://${containerName}:${comp.service.internalPort}`,
        requires: comp.id,
      });

      // Register additional subdomains (e.g. Nango Connect UI on port 3009)
      for (const extra of comp.service.additionalSubdomains ?? []) {
        services.push({
          id: `${comp.id}-${extra.subdomain}`,
          subdomain: extra.subdomain,
          upstream: `http://${containerName}:${extra.internalPort}`,
          requires: comp.id,
          priority: 1,
        });
        // Path proxies: specific paths on this subdomain routed to a different port
        // (higher priority so they win over the catch-all SPA router above)
        for (const proxy of extra.pathProxies ?? []) {
          pathRoutes.push({
            id: `${comp.id}-${extra.subdomain}-${proxy.path.replace(/\//g, '')}`,
            subdomain: extra.subdomain,
            path: proxy.path,
            upstream: `http://${containerName}:${proxy.internalPort}`,
            requires: comp.id,
          });
        }
      }
    }

    // Add custom routes from eve domain add
    if (customRoutes && customRoutes.length > 0) {
      // Ensure Docker can reach host ports (UFW fix)
      allowDockerToHostPorts(customRoutes.map(r => r.port));
      
      for (const route of customRoutes) {
        const routeDomain = route.domain || domain;
        const subdomain = route.subdomain;
        const hostGateway = getDockerHostGateway();
        const upstream = `http://${hostGateway}:${route.port}`;
        
        services.push({
          id: `custom-${subdomain}`,
          subdomain,
          upstream,
          requires: null,
          domain: routeDomain,
        });
        
        console.log(`  Added custom route: ${subdomain}.${routeDomain} → ${upstream}`);
      }
    }

    // Build routers:
    //   behindProxy: HTTP only, no redirects, no TLS — the upstream proxy handles that.
    //   ssl:         HTTP redirects → HTTPS, HTTPS carries real cert.
    //   plain:       HTTP + HTTPS with self-signed (less confusing than protocol error).
    const routersYaml = services.map(s => {
      const routeDomain = s.domain || domain;
      const host = `${s.subdomain}.${routeDomain}`;
      if (behindProxy) {
        // Single HTTP router — external proxy already terminated TLS.
        // forward-https middleware rewrites X-Forwarded-Proto so backend
        // apps (e.g. Nango) that read req.protocol see "https" not "http".
        return (
          `    ${s.id}:\n` +
          `      rule: "Host(\`${host}\`)"\n` +
          (s.priority !== undefined ? `      priority: ${s.priority}\n` : '') +
          `      entryPoints:\n` +
          `        - web\n` +
          `      middlewares:\n` +
          `        - forward-https\n` +
          `      service: ${s.id}-svc`
        );
      }
      if (ssl) {
        return (
          // HTTP → HTTPS redirect router
          `    ${s.id}-http:\n` +
          `      rule: "Host(\`${host}\`)"\n` +
          `      entryPoints:\n` +
          `        - web\n` +
          `      middlewares:\n` +
          `        - redirect-to-https\n` +
          `      service: ${s.id}-svc\n` +
          // HTTPS router with real cert
          `    ${s.id}:\n` +
          `      rule: "Host(\`${host}\`)"\n` +
          `      entryPoints:\n` +
          `        - websecure\n` +
          `      tls:\n` +
          `        certResolver: letsencrypt\n` +
          `      service: ${s.id}-svc`
        );
      }
      // No SSL: serve on HTTP, and also on HTTPS with Traefik's default
      // self-signed cert. Without tls: {}, Traefik won't terminate TLS for
      // websecure routers → browser gets ERR_SSL_PROTOCOL_ERROR instead of
      // a cert warning. With tls: {}, HTTPS works (browser warns about
      // self-signed cert) — far less confusing than a hard connection error.
      // Run `eve domain set <domain> --ssl --email <e>` to get a real cert.
      return (
        `    ${s.id}-http:\n` +
        `      rule: "Host(\`${host}\`)"\n` +
        `      entryPoints:\n` +
        `        - web\n` +
        `      service: ${s.id}-svc\n` +
        `    ${s.id}-https:\n` +
        `      rule: "Host(\`${host}\`)"\n` +
        `      entryPoints:\n` +
        `        - websecure\n` +
        `      tls: {}\n` +
        `      service: ${s.id}-svc`
      );
    }).join('\n');

    const servicesYaml = services.map(s =>
      `    ${s.id}-svc:\n` +
      `      loadBalancer:\n` +
      (behindProxy ? `        passHostHeader: true\n` : '') +
      `        servers:\n` +
      `          - url: "${s.upstream}"`
    ).join('\n');

    // Path-scoped routers on the pod host that must beat the catch-all `synap`
    // router (priority 100). Each = one (router, service) pair in the same
    // behind-proxy / ssl / plain shape as the host routers above.
    // `middlewares` apply to the routers that serve the request (not to the
    // HTTP→HTTPS redirect router). `service` names an existing service (e.g.
    // `noop@internal`) instead of building one for `upstream`.
    const buildPriorityPathRoute = (
      id: string,
      rule: string,
      opts: { upstream?: string; service?: string; middlewares?: string[]; priority?: number },
    ) => {
      const { middlewares = [], priority = 100 } = opts;
      const serviceName = opts.service ?? `${id}-svc`;
      const middlewaresBlock = (names: string[]) =>
        names.length === 0 ? '' : `      middlewares:\n` + names.map(n => `        - ${n}\n`).join('');
      let router: string;
      if (behindProxy) {
        router =
          `\n    ${id}:\n` +
          `      rule: "${rule}"\n` +
          `      priority: ${priority}\n` +
          `      entryPoints:\n` +
          `        - web\n` +
          middlewaresBlock(['forward-https', ...middlewares]) +
          `      service: ${serviceName}`;
      } else if (ssl) {
        router =
          `\n    ${id}-http:\n` +
          `      rule: "${rule}"\n` +
          `      priority: ${priority}\n` +
          `      entryPoints:\n` +
          `        - web\n` +
          `      middlewares:\n` +
          `        - redirect-to-https\n` +
          `      service: ${serviceName}\n` +
          `    ${id}:\n` +
          `      rule: "${rule}"\n` +
          `      priority: ${priority}\n` +
          `      entryPoints:\n` +
          `        - websecure\n` +
          middlewaresBlock(middlewares) +
          `      tls:\n` +
          `        certResolver: letsencrypt\n` +
          `      service: ${serviceName}`;
      } else {
        router =
          `\n    ${id}-http:\n` +
          `      rule: "${rule}"\n` +
          `      priority: ${priority}\n` +
          `      entryPoints:\n` +
          `        - web\n` +
          middlewaresBlock(middlewares) +
          `      service: ${serviceName}\n` +
          `    ${id}-https:\n` +
          `      rule: "${rule}"\n` +
          `      priority: ${priority}\n` +
          `      entryPoints:\n` +
          `        - websecure\n` +
          middlewaresBlock(middlewares) +
          `      tls: {}\n` +
          `      service: ${serviceName}`;
      }
      // passHostHeader is Traefik's default (true) — pinned explicitly because
      // SigV4 signs the Host header: a rewritten Host fails every presigned URL.
      const service = opts.service ? '' :
        `\n    ${id}-svc:\n` +
        `      loadBalancer:\n` +
        `        passHostHeader: true\n` +
        `        servers:\n` +
        `          - url: "${opts.upstream}"`;
      return { router, service };
    };

    const synapService = services.find(s => s.id === 'synap');
    let realtimeRouterYaml = '';
    let realtimeServiceYaml = '';
    let storageRouterYaml = '';
    let storageServiceYaml = '';
    let storageMiddlewareYaml = '';
    if (synapService) {
      const podHost = `${synapService.subdomain}.${domain}`;

      // Socket.IO / realtime — needs a dedicated higher-priority router so WebSocket
      // upgrade requests reach the realtime container (port 4001), not the API backend (4000).
      const synapRealtimeContainer = findComposeContainer('realtime');
      if (synapRealtimeContainer) {
        connectToEveNetwork(synapRealtimeContainer);
        const r = buildPriorityPathRoute(
          'synap-realtime',
          `Host(\`${podHost}\`) && (PathPrefix(\`/socket.io/\`) || PathPrefix(\`/realtime/\`))`,
          { upstream: `http://${synapRealtimeContainer}:4001` },
        );
        realtimeRouterYaml = r.router;
        realtimeServiceYaml = r.service;
      }

      // Signed file links — `pod.<domain>/<bucket>/*` → MinIO S3 API (:9000),
      // Host preserved. Mirrors the pod Caddyfile's `handle /synap-storage/*`:
      // the backend signs links for MINIO_PUBLIC_URL (= the pod origin), path
      // /<bucket>/<key> — downloads (getSignedUrl, GET) and uploads
      // (getSignedUploadUrl, PUT). Without this router the catch-all `synap`
      // router sends them to the backend, which answers 404.
      //
      // Methods: GET/HEAD read, PUT uploads, OPTIONS is the browser's CORS
      // preflight for a cross-origin PUT (MinIO answers it). The backend signs
      // no POST: multipart uploads are server-side, on the internal endpoint.
      //
      // MinIO CVE-2026-41145 / CVE-2026-40344 (never fixed in the free builds):
      // an upload declaring an UNSIGNED trailer is written without its signature
      // being checked, so anyone holding a presigned URL could write any object.
      // As the Caddyfile does, a higher-priority router refuses the two request
      // shapes (that trailer mode, and any Snowball auto-extract header) with a
      // 403: `ipAllowList` on a range no client has, then `noop@internal`, so
      // the request never reaches MinIO. Header() is an exact match on any value
      // of the header; HeaderRegexp(`.*`) matches the header with any value.
      //
      // The sandbox CSP mirrors the Caddyfile: a blob is served with its upload
      // Content-Type on the pod origin, so an SVG opened directly would run as
      // the pod. `sandbox` gives it an opaque origin and no script.
      //
      // minio reaches eve-network through the Eve compose override (alias
      // eve-brain-minio, survives recreates); the connect below covers a pod
      // whose override is user-owned, until its next recreate.
      const minioContainer = findComposeContainer('minio');
      const bucket = minioContainer ? readPodStorageBucket(synapContainer) : null;
      if (minioContainer && bucket) {
        connectToEveNetwork(minioContainer, 'eve-brain-minio');
        const storagePath = `Host(\`${podHost}\`) && PathPrefix(\`/${bucket}/\`)`;
        const guard = buildPriorityPathRoute(
          'synap-storage-cve-guard',
          `${storagePath} && (Header(\`X-Amz-Content-Sha256\`, \`STREAMING-UNSIGNED-PAYLOAD-TRAILER\`) || HeaderRegexp(\`X-Amz-Meta-Snowball-Auto-Extract\`, \`.*\`))`,
          { service: 'noop@internal', middlewares: ['synap-storage-refuse'], priority: 200 },
        );
        const r = buildPriorityPathRoute(
          'synap-storage',
          `${storagePath} && (Method(\`GET\`) || Method(\`HEAD\`) || Method(\`PUT\`) || Method(\`OPTIONS\`))`,
          { upstream: `http://${minioContainer}:9000`, middlewares: ['synap-storage-csp'] },
        );
        storageRouterYaml = guard.router + r.router;
        storageServiceYaml = r.service;
        storageMiddlewareYaml =
          `    synap-storage-csp:\n` +
          `      headers:\n` +
          // customResponseHeaders overwrite a same-named upstream header (Caddy's `header`)
          `        customResponseHeaders:\n` +
          `          Content-Security-Policy: "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:"\n` +
          // No client has this address: every request through it gets a 403.
          `    synap-storage-refuse:\n` +
          `      ipAllowList:\n` +
          `        sourceRange:\n` +
          `          - "255.255.255.255/32"\n`;
      }
    }

    const modeMiddlewareYaml = behindProxy
      // In proxy mode: inject X-Forwarded-Proto so backend apps see "https"
      ? `    forward-https:\n      headers:\n        customRequestHeaders:\n          X-Forwarded-Proto: "https"\n`
      : (!ssl ? '' : `    redirect-to-https:\n      redirectScheme:\n        scheme: https\n        permanent: true\n`);
    const middlewaresYaml = modeMiddlewareYaml || storageMiddlewareYaml
      ? `  middlewares:\n${modeMiddlewareYaml}${storageMiddlewareYaml}`
      : '';

    // Path-proxy routes: high-priority routers for specific paths on additional subdomains
    // (e.g. connect./env.js → API port 3003, all other connect. → SPA port 3009)
    const pathRoutesYaml = pathRoutes.length === 0 ? '' : '\n' + pathRoutes.map(p => {
      const host = `${p.subdomain}.${domain}`;
      if (behindProxy) {
        return (
          `    ${p.id}:\n` +
          `      rule: "Host(\`${host}\`) && Path(\`${p.path}\`)"\n` +
          `      priority: 10\n` +
          `      entryPoints:\n` +
          `        - web\n` +
          `      middlewares:\n` +
          `        - forward-https\n` +
          `      service: ${p.id}-svc`
        );
      }
      if (ssl) {
        return (
          `    ${p.id}:\n` +
          `      rule: "Host(\`${host}\`) && Path(\`${p.path}\`)"\n` +
          `      priority: 10\n` +
          `      entryPoints:\n` +
          `        - websecure\n` +
          `      tls:\n` +
          `        certResolver: letsencrypt\n` +
          `      service: ${p.id}-svc`
        );
      }
      return (
        `    ${p.id}:\n` +
        `      rule: "Host(\`${host}\`) && Path(\`${p.path}\`)"\n` +
        `      priority: 10\n` +
        `      entryPoints:\n` +
        `        - web\n` +
        `      service: ${p.id}-svc`
      );
    }).join('\n');

    const pathServicesYaml = pathRoutes.length === 0 ? '' : '\n' + pathRoutes.map(p =>
      `    ${p.id}-svc:\n` +
      `      loadBalancer:\n` +
      (behindProxy ? `        passHostHeader: true\n` : '') +
      `        servers:\n` +
      `          - url: "${p.upstream}"`
    ).join('\n');

    const modeComment = behindProxy ? 'behind-proxy' : ssl ? 'ssl' : 'plain';
    const dynamicConfig =
      `# Eve subdomain routes — generated by \`eve domain set\`\n` +
      `# Domain: ${domain} | Mode: ${modeComment}\n` +
      `http:\n` +
      `${middlewaresYaml}` +
      `  routers:\n${routersYaml}${realtimeRouterYaml}${storageRouterYaml}${pathRoutesYaml}\n` +
      `  services:\n${servicesYaml}${realtimeServiceYaml}${storageServiceYaml}${pathServicesYaml}\n`;

    const staticConfig = behindProxy ? buildProxyModeStaticConfig() : buildStaticConfig(ssl, email);
    const routesPath = join(this.dynamicConfigDir, 'eve-routes.yml');
    const changed =
      readFileOrNull(this.traefikConfigPath) !== staticConfig ||
      readFileOrNull(routesPath) !== dynamicConfig;
    if (!changed) {
      console.log('  Traefik routes already current — no restart');
      return { changed: false };
    }

    // Write static config (proxy mode skips SSL/cert sections)
    if (!existsSync(this.configDir)) mkdirSync(this.configDir, { recursive: true });
    writeFileSync(this.traefikConfigPath, staticConfig);

    // Write dynamic routes config
    if (!existsSync(this.dynamicConfigDir)) mkdirSync(this.dynamicConfigDir, { recursive: true });
    writeFileSync(routesPath, dynamicConfig, 'utf-8');

    // Restart Traefik so it picks up the updated static config + new volumes
    try {
      execSync('docker restart eve-legs-traefik', { stdio: 'ignore' });
      console.log('  Traefik restarted');
    } catch {
      console.warn('  Could not restart Traefik automatically — run: docker restart eve-legs-traefik');
    }
    return { changed: true };
  }

  // ---------------------------------------------------------------------------
  // Proxy mode
  // ---------------------------------------------------------------------------

  /**
   * Detect whether Traefik is currently running in behind-proxy mode by
   * checking whether the static config has no `websecure` entrypoint.
   */
  getProxyModeStatus(): { enabled: boolean; ssl: boolean; entrypoints: string[] } {
    try {
      const config = readFileSync(this.traefikConfigPath, 'utf-8');
      const enabled = !config.includes('websecure');
      const ssl = config.includes('certificatesResolvers');
      return {
        enabled,
        ssl: !enabled && ssl,
        entrypoints: enabled ? ['web'] : ['web', 'websecure'],
      };
    } catch {
      return { enabled: false, ssl: false, entrypoints: [] };
    }
  }

  /**
   * Switch Traefik to behind-proxy mode:
   *   - HTTP-only static config (no websecure, no cert resolver, trusted IPs)
   *   - Dynamic routes without redirects or TLS
   *   - Recreate container without port 443 binding
   */
  async enableProxyMode(domain: string, installedComponents?: string[]): Promise<void> {
    if (!existsSync(this.configDir)) mkdirSync(this.configDir, { recursive: true });
    if (!existsSync(this.dynamicConfigDir)) mkdirSync(this.dynamicConfigDir, { recursive: true });

    writeFileSync(this.traefikConfigPath, buildProxyModeStaticConfig());

    const synapContainer = getSynapBackendContainer();
    // Always pass the canonical alias — without it, every other code path
    // that calls this without the alias would silently strip it on the
    // disconnect/reconnect cycle, and OWUI's container would lose its
    // ability to resolve `eve-brain-synap`. Same alias used by the SSL
    // path above (line ~248) so behavior is symmetric.
    if (synapContainer) connectToEveNetwork(synapContainer, 'eve-brain-synap');

    // Rewrite routes — HTTP only, no SSL
    await this.configureSubdomains(domain, false, undefined, installedComponents, true);

    const acmePath = join(this.configDir, 'acme.json');
    if (!existsSync(acmePath)) {
      writeFileSync(acmePath, '', { mode: 0o600 });
    } else {
      try { chmodSync(acmePath, 0o600); } catch { /* non-fatal */ }
    }
    this.recreateTraefikContainer(['80:80', '8080:8080'], acmePath);
  }

  /**
   * Restore standalone mode (Traefik handles its own SSL).
   */
  async disableProxyMode(domain: string, ssl: boolean, email?: string, installedComponents?: string[]): Promise<void> {
    if (!existsSync(this.configDir)) mkdirSync(this.configDir, { recursive: true });

    // configureSubdomains also rewrites the static config — no need to write separately.
    await this.configureSubdomains(domain, ssl, email, installedComponents, false);

    const acmePath = join(this.configDir, 'acme.json');
    if (!existsSync(acmePath)) {
      writeFileSync(acmePath, '', { mode: 0o600 });
    } else {
      try { chmodSync(acmePath, 0o600); } catch { /* non-fatal */ }
    }
    this.recreateTraefikContainer(['80:80', '443:443', '8080:8080'], acmePath);
  }

  /** Stop + remove + relaunch the Traefik container with the given port bindings. */
  private recreateTraefikContainer(ports: string[], acmePath: string): void {
    spawnSync('docker', ['rm', '-f', 'eve-legs-traefik'], { stdio: 'ignore' });

    const result = spawnSync('docker', [
      'run', '-d',
      '--name', 'eve-legs-traefik',
      '--restart', 'unless-stopped',
      ...ports.flatMap(p => ['-p', p]),
      '-v', '/var/run/docker.sock:/var/run/docker.sock:ro',
      '-v', `${this.traefikConfigPath}:/etc/traefik/traefik.yml:ro`,
      '-v', `${this.dynamicConfigDir}:/etc/traefik/dynamic:ro`,
      '-v', `${acmePath}:/etc/traefik/acme.json`,
      '--network', 'eve-network',
      'traefik:v3.0',
    ], { stdio: 'inherit' });

    if (result.status !== 0) throw new Error(`docker run exited with code ${result.status}`);
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  async addRoute(route: Route): Promise<void> {
    const configFile = join(this.dynamicConfigDir, `${route.path.replace(/\//g, '_')}.yml`);
    const routeConfig =
      `http:\n` +
      `  routers:\n` +
      `    ${route.path.replace(/[^a-zA-Z0-9]/g, '_')}:\n` +
      `      rule: "Host(\`${route.domain || 'localhost'}\`) && PathPrefix(\`${route.path}\`)"\n` +
      `      service: ${route.path.replace(/[^a-zA-Z0-9]/g, '_')}\n` +
      (route.ssl ? `      tls: {}\n` : '') +
      `  services:\n` +
      `    ${route.path.replace(/[^a-zA-Z0-9]/g, '_')}:\n` +
      `      loadBalancer:\n` +
      `        servers:\n` +
      `          - url: "${route.target}"\n`;
    writeFileSync(configFile, routeConfig);
  }

  async removeRoute(path: string): Promise<void> {
    const configFile = join(this.dynamicConfigDir, `${path.replace(/\//g, '_')}.yml`);
    if (existsSync(configFile)) writeFileSync(configFile, '');
  }

  async configureDomain(domain: string): Promise<void> {
    const routes = this.getRoutes();
    for (const route of routes) await this.addRoute({ ...route, domain });
  }

  async enableSSL(): Promise<void> {
    const routes = this.getRoutes();
    for (const route of routes) {
      if (route.domain) await this.addRoute({ ...route, ssl: true });
    }
  }

  getRoutes(): Route[] {
    // Legacy: path-based route files written by addRoute()
    try {
      if (!existsSync(this.dynamicConfigDir)) return [];
      const files = readdirSafe(this.dynamicConfigDir).filter(f => f.endsWith('.yml') && f !== 'eve-routes.yml');
      return files.flatMap(file => {
        const content = readFileSync(join(this.dynamicConfigDir, file), 'utf-8');
        const pathMatch = content.match(/PathPrefix\(`(.+)`\)/);
        const urlMatch = content.match(/url: "(.+)"/);
        if (!pathMatch || !urlMatch) return [];
        return [{
          path: pathMatch[1],
          target: urlMatch[1],
          domain: content.match(/Host\(`(.+?)`\)/)?.[1],
          ssl: content.includes('tls:'),
        }];
      });
    } catch {
      return [];
    }
  }

  /**
   * The primary domain the current `eve-routes.yml` was generated for, from
   * its `# Domain: <domain> | Mode: …` header (written since 2026-04), else
   * from its first `Host(...)` rule minus the subdomain, as `getStatus` reads
   * it. `missing` = no file yet (first install). `unreadable` = the file is
   * there but could not be read: a different fact from "no domain in it".
   */
  readRoutesDomain():
    | { state: 'missing' }
    | { state: 'unreadable'; error: string }
    | { state: 'found'; domain: string | null; path: string } {
    const path = join(this.dynamicConfigDir, 'eve-routes.yml');
    if (!existsSync(path)) return { state: 'missing' };
    let content: string;
    try {
      content = readFileSync(path, 'utf-8');
    } catch (err) {
      return { state: 'unreadable', error: err instanceof Error ? err.message : String(err) };
    }
    const header = content.match(/^# Domain: (\S+) \|/m)?.[1];
    if (header) return { state: 'found', domain: header, path };
    const host = content.match(/Host\(`([^`]+)`\)/)?.[1];
    if (!host) return { state: 'found', domain: null, path };
    const parts = host.split('.');
    return { state: 'found', domain: parts.length > 2 ? parts.slice(1).join('.') : host, path };
  }

  getStatus(): { installed: boolean; running: boolean; domain: string | null; ssl: boolean; behindProxy: boolean; routes: Route[] } {
    const installed = existsSync(this.traefikConfigPath);
    let running = false;
    try {
      const out = execSync('docker ps --filter "name=eve-legs-traefik" --format "{{.Names}}"', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      running = out.length > 0;
    } catch {}
    const routes = this.getRoutes();
    const proxyStatus = this.getProxyModeStatus();

    // Read domain and SSL from eve-routes.yml (the main routes file)
    let domain: string | null = routes.find(r => r.domain)?.domain ?? null;
    let ssl = routes.some(r => r.ssl);
    const eveRoutesPath = join(this.dynamicConfigDir, 'eve-routes.yml');
    if (existsSync(eveRoutesPath)) {
      try {
        const content = readFileSync(eveRoutesPath, 'utf-8');
        const hostMatch = content.match(/Host\(`([^`]+)`\)/);
        if (hostMatch) {
          // Strip the subdomain prefix to get the bare domain
          const host = hostMatch[1];
          const parts = host.split('.');
          domain = parts.length > 2 ? parts.slice(1).join('.') : host;
        }
        ssl = content.includes('certResolver:');
      } catch { /* non-fatal */ }
    }

    return {
      installed,
      running,
      domain,
      ssl,
      behindProxy: proxyStatus.enabled,
      routes,
    };
  }

  cleanConfig(): void {
    if (existsSync(this.dynamicConfigDir)) {
      for (const file of readdirSafe(this.dynamicConfigDir)) {
        if (file.endsWith('.yml') || file.endsWith('.yaml')) {
          try { unlinkSync(join(this.dynamicConfigDir, file)); } catch { /* non-fatal */ }
        }
      }
    }
    if (existsSync(this.traefikConfigPath)) {
      try { unlinkSync(this.traefikConfigPath); } catch { /* non-fatal */ }
    }
  }
}

function readdirSafe(dir: string): string[] {
  // `readdirSync` is imported at module top — using `require()` here was
  // a silent ESM/CJS bug: in the bundled ESM output, `require` is undefined,
  // every call threw ReferenceError, and the catch returned `[]` for what
  // was supposed to be a real directory listing.
  try {
    return readdirSync(dir) as string[];
  } catch {
    return [];
  }
}
