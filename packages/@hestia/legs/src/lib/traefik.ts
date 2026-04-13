import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { EntityState } from '@hestia/dna';

export interface Route {
  path: string;
  target: string;
  domain?: string;
  ssl?: boolean;
}

export class TraefikService {
  private configDir: string;
  private traefikConfigPath: string;
  private dynamicConfigDir: string;
  private state: EntityState;

  constructor(configDir: string = '/opt/traefik') {
    this.configDir = configDir;
    this.traefikConfigPath = join(configDir, 'traefik.yml');
    this.dynamicConfigDir = join(configDir, 'dynamic');
    this.state = new EntityState('legs');
  }

  async install(): Promise<void> {
    console.log('Installing Traefik...');

    // Create directories
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
    if (!existsSync(this.dynamicConfigDir)) {
      mkdirSync(this.dynamicConfigDir, { recursive: true });
    }

    // Check if running under Dokploy
    const isDokploy = existsSync('/opt/dokploy');

    if (isDokploy) {
      console.log('Detected Dokploy - using existing Traefik installation');
      await this.configureDokployTraefik();
    } else {
      await this.installStandalone();
    }

    await this.state.update({ status: 'installed', installedAt: new Date().toISOString() });
    console.log('Traefik installation complete');
  }

  private async installStandalone(): Promise<void> {
    // Create main Traefik configuration
    const traefikConfig = `
api:
  dashboard: true
  insecure: true

entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

providers:
  file:
    directory: "${this.dynamicConfigDir}"
    watch: true
  docker:
    exposedByDefault: false

log:
  level: INFO

accessLog: {}

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@hestia.local
      storage: ${join(this.configDir, 'acme.json')}
      httpChallenge:
        entryPoint: web
`;

    writeFileSync(this.traefikConfigPath, traefikConfig.trim());

    // Install Traefik binary
    try {
      execSync('which traefik', { stdio: 'ignore' });
      console.log('Traefik binary already exists');
    } catch {
      console.log('Installing Traefik binary...');
      execSync(`
        curl -fsSL https://github.com/traefik/traefik/releases/download/v3.0.0/traefik_v3.0.0_linux_amd64.tar.gz | \
        tar -xzf - -C /usr/local/bin traefik
      `, { stdio: 'inherit' });
    }

    // Create systemd service
    const systemdService = `
[Unit]
Description=Traefik
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/traefik --configFile=${this.traefikConfigPath}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;

    writeFileSync('/etc/systemd/system/traefik.service', systemdService.trim());
    execSync('systemctl daemon-reload', { stdio: 'inherit' });
  }

  private async configureDokployTraefik(): Promise<void> {
    // Dokploy manages Traefik, we just ensure our dynamic config directory is loaded
    const dokployTraefikDir = '/opt/dokploy/traefik';
    if (!existsSync(dokployTraefikDir)) {
      throw new Error('Dokploy Traefik directory not found');
    }

    // Create symlink to our dynamic configs
    const hestiaDynamicDir = join(dokployTraefikDir, 'dynamic', 'hestia');
    if (!existsSync(hestiaDynamicDir)) {
      execSync(`ln -sf ${this.dynamicConfigDir} ${hestiaDynamicDir}`, { stdio: 'inherit' });
    }
  }

  async start(): Promise<void> {
    console.log('Starting Traefik...');

    const isDokploy = existsSync('/opt/dokploy');

    if (isDokploy) {
      execSync('docker restart dokploy-traefik', { stdio: 'inherit' });
    } else {
      execSync('systemctl enable --now traefik', { stdio: 'inherit' });
    }

    await this.state.update({ status: 'running' });
    console.log('Traefik started successfully');
  }

  async addRoute(path: string, target: string, options: { domain?: string; ssl?: boolean } = {}): Promise<void> {
    console.log(`Adding route: ${path} -> ${target}`);

    const routeName = path.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const domain = options.domain || 'localhost';

    const routeConfig = `
http:
  routers:
    ${routeName}:
      rule: "Host(\`${domain}\`) && PathPrefix(\`${path}\`)"
      service: ${routeName}
      ${options.ssl ? 'tls:\n        certResolver: letsencrypt' : ''}

  services:
    ${routeName}:
      loadBalancer:
        servers:
          - url: "${target}"
`;

    const configPath = join(this.dynamicConfigDir, `${routeName}.yml`);
    writeFileSync(configPath, routeConfig.trim());

    // Update state with new route
    const routes = await this.getRoutes();
    routes.push({ path, target, domain: options.domain, ssl: options.ssl });
    await this.state.update({ routes });

    console.log(`Route ${path} configured`);
  }

  async removeRoute(path: string): Promise<void> {
    console.log(`Removing route: ${path}`);

    const routeName = path.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const configPath = join(this.dynamicConfigDir, `${routeName}.yml`);

    if (existsSync(configPath)) {
      execSync(`rm ${configPath}`, { stdio: 'inherit' });
    }

    // Update state
    const routes = (await this.getRoutes()).filter(r => r.path !== path);
    await this.state.update({ routes });

    console.log(`Route ${path} removed`);
  }

  async configureDomain(domain: string): Promise<void> {
    console.log(`Configuring domain: ${domain}`);

    // Update all routes to use the new domain
    const routes = await this.getRoutes();
    for (const route of routes) {
      await this.addRoute(route.path, route.target, { domain, ssl: route.ssl });
    }

    await this.state.update({ domain });
    console.log(`Domain ${domain} configured`);
  }

  async enableSSL(): Promise<void> {
    console.log('Enabling SSL with Let\'s Encrypt...');

    const routes = await this.getRoutes();
    const domain = (await this.state.get()).domain;

    if (!domain || domain === 'localhost') {
      throw new Error('Cannot enable SSL without a custom domain');
    }

    for (const route of routes) {
      await this.addRoute(route.path, route.target, { domain, ssl: true });
    }

    await this.state.update({ ssl: true });
    console.log('SSL enabled for all routes');
  }

  async getRoutes(): Promise<Route[]> {
    const state = await this.state.get();
    return state.routes || [];
  }

  async getStatus(): Promise<{ status: string; domain?: string; ssl?: boolean; routes: Route[] }> {
    const state = await this.state.get();
    return {
      status: state.status || 'unknown',
      domain: state.domain,
      ssl: state.ssl,
      routes: state.routes || []
    };
  }
}
