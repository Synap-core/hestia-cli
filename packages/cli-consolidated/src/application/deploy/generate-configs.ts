/**
 * Generate Configs Use Case
 * 
 * Generates Docker Compose and environment configuration files
 * for Hestia deployment.
 * 
 * Pure business logic - no UI dependencies.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ProgressReporter, OperationResult } from '../types.js';

export type DeployProfile = 'minimal' | 'full' | 'ai-heavy';
export type AIProvider = 'opencode' | 'openclaude' | 'both';

export interface GenerateConfigsInput {
  /** Domain name for the deployment */
  domain: string;
  /** Deployment profile */
  profile: DeployProfile;
  /** AI provider selection */
  provider: AIProvider;
  /** Include website deployment */
  website?: boolean;
  /** Deployment directory */
  deployDir: string;
  /** Additional environment variables */
  extraEnv?: Record<string, string>;
}

export interface GenerateConfigsOutput {
  filesCreated: string[];
  services: string[];
}

/**
 * Generate deployment configurations
 * 
 * @param input - Configuration options
 * @param progress - Progress reporter
 * @returns Generation result
 */
export async function generateConfigs(
  input: GenerateConfigsInput,
  progress: ProgressReporter
): Promise<OperationResult<GenerateConfigsOutput>> {
  const { domain, profile, provider, website, deployDir, extraEnv } = input;
  
  progress.report('Generating deployment configurations...');
  progress.onProgress(0);

  const result: GenerateConfigsOutput = {
    filesCreated: [],
    services: [],
  };

  try {
    // Ensure deploy directory exists
    await fs.mkdir(deployDir, { recursive: true });
    progress.onProgress(10);

    // Generate Docker Compose
    progress.report('Generating Docker Compose configuration...');
    const dockerCompose = generateDockerCompose({
      domain,
      profile,
      provider,
      website,
    });
    
    const composePath = path.join(deployDir, 'docker-compose.yml');
    await fs.writeFile(composePath, dockerCompose, 'utf-8');
    result.filesCreated.push('docker-compose.yml');
    progress.onProgress(40);

    // Generate environment file
    progress.report('Generating environment configuration...');
    const envContent = generateEnvFile({
      domain,
      profile,
      provider,
      extraEnv,
    });
    
    const envPath = path.join(deployDir, '.env');
    await fs.writeFile(envPath, envContent, 'utf-8');
    result.filesCreated.push('.env');
    progress.onProgress(70);

    // Generate deployment metadata
    progress.report('Generating deployment metadata...');
    const metadata = {
      domain,
      profile,
      provider,
      website,
      deployedAt: new Date().toISOString(),
      deployDir,
    };
    
    const metadataPath = path.join(deployDir, 'deployment.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    result.filesCreated.push('deployment.json');
    progress.onProgress(90);

    // Determine services
    result.services = getServicesForProfile(profile, provider, website);

    progress.onProgress(100);
    progress.report('Configuration generation complete');

    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to generate configurations',
    };
  }
}

/**
 * Generate Docker Compose configuration
 */
function generateDockerCompose(config: {
  domain: string;
  profile: DeployProfile;
  provider: AIProvider;
  website?: boolean;
}): string {
  const { domain, profile, provider, website } = config;
  
  const services: string[] = [];
  
  // Core services (always included)
  services.push(generateSynapBackendService(domain));
  services.push(generatePostgresService());
  services.push(generateRedisService());
  
  // Profile-based services
  if (profile === 'full' || profile === 'ai-heavy') {
    services.push(generateTypesenseService());
    services.push(generateNangoService());
  }
  
  if (profile === 'ai-heavy') {
    services.push(generateOllamaService());
  }
  
  // AI provider services
  if (provider === 'opencode' || provider === 'both') {
    services.push(generateOpenCodeService(domain));
  }
  
  if (provider === 'openclaude' || provider === 'both') {
    services.push(generateOpenClaudeService(domain));
  }
  
  // Website service
  if (website) {
    services.push(generateWebsiteService(domain));
  }
  
  return `version: '3.8'

services:
${services.join('\n\n')}

networks:
  hestia-network:
    driver: bridge
    
volumes:
  postgres-data:
  redis-data:
  typesense-data:
  synap-data:
`;
}

/**
 * Generate environment file content
 */
function generateEnvFile(config: {
  domain: string;
  profile: DeployProfile;
  provider: AIProvider;
  extraEnv?: Record<string, string>;
}): string {
  const { domain, profile, provider, extraEnv } = config;
  
  let content = `# Hestia Environment Configuration
# Generated: ${new Date().toISOString()}
# Domain: ${domain}
# Profile: ${profile}

# Core Settings
NODE_ENV=production
DOMAIN=${domain}
DEPLOY_PROFILE=${profile}

# Database
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/synap
POSTGRES_PASSWORD=postgres
POSTGRES_DB=synap

# Redis
REDIS_URL=redis://redis:6379

# Synap Backend
SYNAP_API_PORT=4000
SYNAP_API_URL=https://${domain}
JWT_SECRET=${generateRandomString(32)}

# Typesense
TYPESENSE_API_KEY=${generateRandomString(32)}
TYPESENSE_DATA_DIR=/data
`;

  // Add AI provider config
  if (provider === 'opencode' || provider === 'both') {
    content += `
# OpenCode
OPENCODE_PORT=3000
OPENCODE_URL=https://dev.${domain}
`;
  }
  
  if (provider === 'openclaude' || provider === 'both') {
    content += `
# OpenClaude
OPENCLAUDE_API_KEY=${generateRandomString(32)}
`;
  }
  
  // Add extra environment variables
  if (extraEnv) {
    content += '\n# Custom Environment Variables\n';
    for (const [key, value] of Object.entries(extraEnv)) {
      content += `${key}=${value}\n`;
    }
  }
  
  return content;
}

/**
 * Get list of services for a profile
 */
function getServicesForProfile(
  profile: DeployProfile,
  provider: AIProvider,
  website?: boolean
): string[] {
  const services = ['synap-backend', 'postgres', 'redis'];
  
  if (profile === 'full' || profile === 'ai-heavy') {
    services.push('typesense', 'nango');
  }
  
  if (profile === 'ai-heavy') {
    services.push('ollama');
  }
  
  if (provider === 'opencode' || provider === 'both') {
    services.push('opencode');
  }
  
  if (provider === 'openclaude' || provider === 'both') {
    services.push('openclaude');
  }
  
  if (website) {
    services.push('website');
  }
  
  return services;
}

// Service generators
function generateSynapBackendService(domain: string): string {
  return `  synap-backend:
    image: ghcr.io/synap-dev/synap-backend:latest
    container_name: synap-backend
    ports:
      - "4000:4000"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/synap
      - REDIS_URL=redis://redis:6379
      - NODE_ENV=production
    volumes:
      - synap-data:/app/data
    depends_on:
      - postgres
      - redis
    networks:
      - hestia-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.synap.rule=Host(\`${domain}\`)"
      - "traefik.http.routers.synap.tls=true"
      - "traefik.http.routers.synap.tls.certresolver=letsencrypt"`;
}

function generatePostgresService(): string {
  return `  postgres:
    image: postgres:15-alpine
    container_name: hestia-postgres
    environment:
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=synap
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - hestia-network`;
}

function generateRedisService(): string {
  return `  redis:
    image: redis:7-alpine
    container_name: hestia-redis
    volumes:
      - redis-data:/data
    networks:
      - hestia-network`;
}

function generateTypesenseService(): string {
  return `  typesense:
    image: typesense/typesense:0.25.2
    container_name: hestia-typesense
    ports:
      - "8108:8108"
    environment:
      - TYPESENSE_API_KEY=xyz
      - TYPESENSE_DATA_DIR=/data
    volumes:
      - typesense-data:/data
    networks:
      - hestia-network`;
}

function generateNangoService(): string {
  return `  nango:
    image: nangohq/nango-server:latest
    container_name: hestia-nango
    environment:
      - NANGO_DB_HOST=postgres
      - NANGO_DB_PORT=5432
      - NANGO_DB_NAME=nango
      - NANGO_DB_USER=postgres
      - NANGO_DB_PASSWORD=postgres
    depends_on:
      - postgres
    networks:
      - hestia-network`;
}

function generateOllamaService(): string {
  return `  ollama:
    image: ollama/ollama:latest
    container_name: hestia-ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama
    networks:
      - hestia-network`;
}

function generateOpenCodeService(domain: string): string {
  return `  opencode:
    image: ghcr.io/opencode/opencode:latest
    container_name: hestia-opencode
    ports:
      - "3000:3000"
    environment:
      - SYNAP_URL=https://${domain}
    networks:
      - hestia-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.opencode.rule=Host(\`dev.${domain}\`)"
      - "traefik.http.routers.opencode.tls=true"
      - "traefik.http.routers.opencode.tls.certresolver=letsencrypt"`;
}

function generateOpenClaudeService(domain: string): string {
  return `  openclaude:
    image: ghcr.io/openclaude/openclaude:latest
    container_name: hestia-openclaude
    environment:
      - SYNAP_URL=https://${domain}
    networks:
      - hestia-network`;
}

function generateWebsiteService(domain: string): string {
  return `  website:
    image: ghcr.io/synap-dev/synap-starter-website:latest
    container_name: hestia-website
    environment:
      - NEXT_PUBLIC_SYNAP_URL=https://${domain}
    networks:
      - hestia-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.website.rule=Host(\`www.${domain}\`)"
      - "traefik.http.routers.website.tls=true"
      - "traefik.http.routers.website.tls.certresolver=letsencrypt"`;
}

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
