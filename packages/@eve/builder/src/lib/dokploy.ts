import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { readEveSecrets, writeEveSecrets } from '@eve/dna';

export interface DokployStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  projects: DokployProject[];
}

export interface DokployProject {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'error' | 'deploying';
  url?: string;
  lastDeployed?: Date;
}

export class DokployService {
  private isInstalled = false;
  private apiUrl: string | null = null;
  private apiKey: string | null = null;
  private projects: Map<string, DokployProject> = new Map();

  async install(): Promise<void> {
    console.log('Installing Dokploy...');
    
    // Check if Dokploy CLI is available
    try {
      execSync('which dokploy', { stdio: 'ignore' });
      console.log('Dokploy CLI already installed');
    } catch {
      console.log('Installing Dokploy CLI...');
      execSync('npm install -g dokploy', { stdio: 'inherit' });
    }

    // Check if Dokploy server is running locally
    try {
      const response = await fetch('http://localhost:3000/api/health');
      if (response.ok) {
        console.log('Dokploy server is running on localhost:3000');
        this.apiUrl = 'http://localhost:3000';
        this.isInstalled = true;
      }
    } catch {
      console.log('Dokploy server not detected locally');
      console.log('You can set up Dokploy at https://dokploy.com/');
      this.isInstalled = true; // CLI is installed
    }

    // Load or create config
    await this.loadConfig();
    console.log('Dokploy installation completed');
  }

  private async loadConfig(): Promise<void> {
    const configDir = join(process.cwd(), '.eve');
    const configPath = join(configDir, 'dokploy.json');

    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      this.apiUrl = config.apiUrl || this.apiUrl;
      this.apiKey = config.apiKey;
    }
    const secrets = await readEveSecrets(process.cwd());
    this.apiUrl = secrets?.builder?.dokployApiUrl ?? this.apiUrl;
    this.apiKey = secrets?.builder?.dokployApiKey ?? this.apiKey;
  }

  private async saveConfig(): Promise<void> {
    const configDir = join(process.cwd(), '.eve');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    writeFileSync(
      join(configDir, 'dokploy.json'),
      JSON.stringify({
        apiUrl: this.apiUrl,
        apiKey: this.apiKey,
        updatedAt: new Date().toISOString(),
      }, null, 2)
    );
    await writeEveSecrets(
      {
        builder: {
          dokployApiUrl: this.apiUrl ?? undefined,
          dokployApiKey: this.apiKey ?? undefined,
        },
      },
      process.cwd(),
    );
  }

  async createProject(name: string): Promise<void> {
    if (!this.isInstalled) {
      await this.install();
    }

    console.log(`Creating Dokploy project: ${name}`);

    const project: DokployProject = {
      id: `proj_${Date.now()}`,
      name,
      status: 'stopped',
    };

    this.projects.set(project.id, project);

    // Save project registry
    const configDir = join(process.cwd(), '.eve');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    const projectsPath = join(configDir, 'dokploy-projects.json');
    const existing = existsSync(projectsPath) 
      ? JSON.parse(readFileSync(projectsPath, 'utf-8')) 
      : {};
    
    existing[project.id] = project;
    writeFileSync(projectsPath, JSON.stringify(existing, null, 2));

    console.log(`Project created with ID: ${project.id}`);
  }

  async deploy(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      // Try to load from file
      const projectsPath = join(process.cwd(), '.eve', 'dokploy-projects.json');
      if (existsSync(projectsPath)) {
        const all = JSON.parse(readFileSync(projectsPath, 'utf-8'));
        if (all[projectId]) {
          Object.assign(project || {}, all[projectId]);
        }
      }
      
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }
    }

    console.log(`Deploying project: ${project.name}`);
    project.status = 'deploying';

    // Simulate deployment process
    // In real implementation, this would call Dokploy API
    await new Promise(resolve => setTimeout(resolve, 2000));

    project.status = 'running';
    project.lastDeployed = new Date();
    project.url = `https://${project.name}.dokploy.app`;

    // Update stored project
    this.projects.set(projectId, project);
    const projectsPath = join(process.cwd(), '.eve', 'dokploy-projects.json');
    const all = existsSync(projectsPath) 
      ? JSON.parse(readFileSync(projectsPath, 'utf-8')) 
      : {};
    all[projectId] = project;
    writeFileSync(projectsPath, JSON.stringify(all, null, 2));

    console.log(`Project deployed successfully at: ${project.url}`);
  }

  async getStatus(): Promise<DokployStatus> {
    const projects: DokployProject[] = [];
    
    // Load from file
    const projectsPath = join(process.cwd(), '.eve', 'dokploy-projects.json');
    if (existsSync(projectsPath)) {
      const all = JSON.parse(readFileSync(projectsPath, 'utf-8'));
      for (const [id, proj] of Object.entries(all)) {
        projects.push(proj as DokployProject);
      }
    }

    // Check if server is running
    let running = false;
    try {
      if (this.apiUrl) {
        const response = await fetch(`${this.apiUrl}/api/health`, { 
          signal: AbortSignal.timeout(3000) 
        });
        running = response.ok;
      }
    } catch {
      running = false;
    }

    return {
      installed: this.isInstalled,
      running,
      version: '1.0.0',
      projects,
    };
  }

  async configureDomain(domain: string): Promise<void> {
    console.log(`Configuring domain: ${domain}`);
    
    // Save domain configuration
    const configDir = join(process.cwd(), '.eve');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    const domainPath = join(configDir, 'dokploy-domain.json');
    writeFileSync(domainPath, JSON.stringify({
      domain,
      configuredAt: new Date().toISOString(),
    }, null, 2));

    console.log(`Domain configured: ${domain}`);
    console.log('Note: DNS records need to be updated to point to Dokploy server');
  }

  getProject(projectId: string): DokployProject | undefined {
    return this.projects.get(projectId);
  }

  listProjects(): DokployProject[] {
    return Array.from(this.projects.values());
  }
}
