import { execSync, spawnSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

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

  constructor(configDir: string = '/opt/traefik') {
    this.configDir = configDir;
    this.traefikConfigPath = join(configDir, 'traefik.yml');
    this.dynamicConfigDir = join(configDir, 'dynamic');
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

    console.log('Traefik installation complete');
  }

  private async installStandalone(): Promise<void> {
    // Create traefik.yml static config
    const staticConfig = `
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

providers:
  file:
    directory: ${this.dynamicConfigDir}
    watch: true

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@localhost
      storage: /etc/traefik/acme.json
      tlsChallenge: {}

api:
  dashboard: true
  insecure: false

log:
  level: INFO

accessLog: {}
`;

    writeFileSync(this.traefikConfigPath, staticConfig.trim());
    console.log('Created Traefik static config');

    // Create Docker network if it doesn't exist
    try {
      execSync('docker network create eve-network', { stdio: 'ignore' });
    } catch {
      // Network already exists
    }

    // Remove existing traefik container (idempotent re-run)
    try {
      spawnSync('docker', ['rm', '-f', 'traefik'], { stdio: 'inherit' });
    } catch {
      // container doesn't exist — safe to ignore
    }

    // Run Traefik container
    const dockerArgs = [
      'run', '-d',
      '--name', 'traefik',
      '--restart', 'unless-stopped',
      '-p', '80:80',
      '-p', '443:443',
      '-p', '8080:8080',
      '-v', `${this.configDir}/traefik.yml:/etc/traefik/traefik.yml`,
      '-v', `${this.dynamicConfigDir}:${this.dynamicConfigDir}`,
      '-v', '/var/run/docker.sock:/var/run/docker.sock',
      '--network', 'eve-network',
      'traefik:v3.0',
    ];

    const result = spawnSync('docker', dockerArgs, { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`docker run exited with code ${result.status}`);
    }
    console.log('Traefik container started');
  }

  private async configureDokployTraefik(): Promise<void> {
    console.log('Configuring Dokploy Traefik...');
    // Dokploy manages its own Traefik - we just need to configure routes
    console.log('Using Dokploy-managed Traefik');
  }

  async addRoute(route: Route): Promise<void> {
    console.log(`Adding route: ${route.path} -> ${route.target}`);

    const configFile = join(this.dynamicConfigDir, `${route.path.replace(/\//g, '_')}.yml`);
    
    const routeConfig = `
http:
  routers:
    ${route.path.replace(/[^a-zA-Z0-9]/g, '_')}:
      rule: "Host(\`${route.domain || 'localhost'}\`) && PathPrefix(\`${route.path}\`)"
      service: ${route.path.replace(/[^a-zA-Z0-9]/g, '_')}
      ${route.ssl ? 'tls: {}' : ''}
  
  services:
    ${route.path.replace(/[^a-zA-Z0-9]/g, '_')}:
      loadBalancer:
        servers:
          - url: "${route.target}"
`;

    writeFileSync(configFile, routeConfig.trim());
    console.log(`Route added: ${route.path}`);
  }

  async removeRoute(path: string): Promise<void> {
    console.log(`Removing route: ${path}`);
    
    const configFile = join(this.dynamicConfigDir, `${path.replace(/\//g, '_')}.yml`);
    
    if (existsSync(configFile)) {
      writeFileSync(configFile, '');
      console.log(`Route removed: ${path}`);
    } else {
      console.log(`Route not found: ${path}`);
    }
  }

  async configureDomain(domain: string): Promise<void> {
    console.log(`Configuring domain: ${domain}`);
    
    // Update all routes to use this domain
    const routes = this.getRoutes();
    for (const route of routes) {
      await this.addRoute({ ...route, domain });
    }
    
    console.log(`Domain configured: ${domain}`);
  }

  async enableSSL(): Promise<void> {
    console.log('Enabling SSL with Let\'s Encrypt...');
    
    const routes = this.getRoutes();
    for (const route of routes) {
      if (route.domain) {
        await this.addRoute({ ...route, ssl: true });
      }
    }
    
    console.log('SSL enabled for all routes with domains');
  }

  getRoutes(): Route[] {
    try {
      const routes: Route[] = [];
      const files = existsSync(this.dynamicConfigDir) 
        ? readFileSync(this.dynamicConfigDir, 'utf-8').split('\n')
        : [];
      
      // Simple parsing - in reality would parse YAML
      for (const file of files) {
        if (file.endsWith('.yml')) {
          const content = readFileSync(join(this.dynamicConfigDir, file), 'utf-8');
          const pathMatch = content.match(/PathPrefix\(`(.+)`\)/);
          const urlMatch = content.match(/url: "(.+)"/);
          
          if (pathMatch && urlMatch) {
            routes.push({
              path: pathMatch[1],
              target: urlMatch[1],
              domain: content.match(/Host\(`(.+)`\)/)?.[1],
              ssl: content.includes('tls:'),
            });
          }
        }
      }
      
      return routes;
    } catch {
      return [];
    }
  }

  async configureSubdomains(domain: string, ssl: boolean, email?: string): Promise<void> {
    const entryPoint = ssl ? 'websecure' : 'web';
    const tlsBlock = (routerName: string) =>
      ssl ? `\n      tls:\n        certResolver: letsencrypt` : '';

    const services: Array<{ id: string; subdomain: string; upstream: string }> = [
      { id: 'eve-dashboard', subdomain: 'eve', upstream: 'http://host.docker.internal:7979' },
      { id: 'pod', subdomain: 'pod', upstream: 'http://eve-brain-synap:4000' },
      { id: 'openclaw', subdomain: 'openclaw', upstream: 'http://eve-arms-openclaw:3000' },
      { id: 'feeds', subdomain: 'feeds', upstream: 'http://eve-eyes-rsshub:1200' },
      { id: 'ollama', subdomain: 'ai', upstream: 'http://eve-brain-ollama:11434' },
    ];

    const routersYaml = services
      .map(
        s => `    ${s.id}:
      rule: "Host(\`${s.subdomain}.${domain}\`)"
      service: ${s.id}-svc
      entryPoints:
        - ${entryPoint}${tlsBlock(s.id)}`,
      )
      .join('\n');

    const servicesYaml = services
      .map(
        s => `    ${s.id}-svc:
      loadBalancer:
        servers:
          - url: "${s.upstream}"`,
      )
      .join('\n');

    const acmeSection = ssl && email
      ? `\ncertificatesResolvers:\n  letsencrypt:\n    acme:\n      email: ${email}\n      storage: /etc/traefik/acme.json\n      tlsChallenge: {}\n`
      : '';

    const config = `# Eve subdomain routes — generated by \`eve domain set\`
# Domain: ${domain} | SSL: ${ssl}
${acmeSection}
http:
  routers:
${routersYaml}
  services:
${servicesYaml}
`;

    const dynamicDir = this.dynamicConfigDir;
    try {
      if (!existsSync(dynamicDir)) mkdirSync(dynamicDir, { recursive: true });
      writeFileSync(join(dynamicDir, 'eve-routes.yml'), config, 'utf-8');
    } catch (err) {
      console.warn(`  Warning: could not write Traefik config to ${dynamicDir}: ${(err as Error).message}`);
      console.warn('  The config will be applied the next time Traefik runs on a server.');
    }
  }

  getStatus(): { installed: boolean; running: boolean; domain: string | null; ssl: boolean; routes: Route[] } {
    const installed = existsSync(this.traefikConfigPath);
    
    let running = false;
    try {
      execSync('docker ps --filter "name=traefik" --format "{{.Names}}"', { stdio: 'pipe' });
      running = true;
    } catch {
      running = false;
    }
    
    const routes = this.getRoutes();
    const domain = routes.find(r => r.domain)?.domain || null;
    const ssl = routes.some(r => r.ssl);
    
    return { installed, running, domain, ssl, routes };
  }
}
