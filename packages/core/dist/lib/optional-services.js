/**
 * Optional Services Registry
 *
 * Service registry for optional components including:
 * - Network: Traefik (reverse proxy), Pangolin (tunnel)
 * - Database: WhoDB (database UI)
 * - AI/UI: LobeChat, OpenWebUI, LibreChat
 */
import { execa } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';
import YAML from 'yaml';
import { logger } from './logger.js';
// Default service configurations
const defaultServiceConfigs = {
    traefik: {
        enabled: false,
        autoStart: true,
        ports: {
            http: 80,
            https: 443,
            dashboard: 8080,
        },
        environment: {
            TRAEFIK_LOG_LEVEL: 'INFO',
            TRAEFIK_ACCESS_LOG: 'true',
        },
    },
    pangolin: {
        enabled: false,
        autoStart: true,
        ports: {
            http: 3001,
            tunnel: 8080,
        },
        environment: {
            PANGOLIN_LOG_LEVEL: 'info',
        },
    },
    whodb: {
        enabled: false,
        autoStart: true,
        ports: {
            http: 8081,
        },
        environment: {
            WHODB_POSTGRES_URL: 'postgresql://hestia:hestia@localhost:5432/hestia',
        },
    },
    lobechat: {
        enabled: false,
        autoStart: true,
        ports: {
            http: 3002,
        },
        environment: {
            OPENAI_API_KEY: '',
            OLLAMA_URL: 'http://localhost:11434',
        },
    },
    openwebui: {
        enabled: false,
        autoStart: true,
        ports: {
            http: 3003,
        },
        environment: {
            OLLAMA_BASE_URL: 'http://localhost:11434',
            WEBUI_SECRET_KEY: '',
        },
    },
    librechat: {
        enabled: false,
        autoStart: true,
        ports: {
            http: 3004,
        },
        environment: {
            MONGO_URI: 'mongodb://localhost:27017/librechat',
            OPENAI_API_KEY: '',
        },
    },
};
// Service metadata definitions
const serviceMetadata = {
    traefik: {
        name: 'traefik',
        displayName: 'Traefik',
        description: 'Cloud-native reverse proxy and load balancer (alternative to Nginx)',
        category: 'network',
        icon: '🔄',
        defaultPort: 80,
        ports: [
            { internal: 80, external: 80, protocol: 'tcp', description: 'HTTP' },
            { internal: 443, external: 443, protocol: 'tcp', description: 'HTTPS' },
            { internal: 8080, external: 8080, protocol: 'tcp', description: 'Dashboard' },
        ],
        dependencies: [],
        dockerComposeProfile: 'traefik',
    },
    pangolin: {
        name: 'pangolin',
        displayName: 'Pangolin',
        description: 'Remote tunnel for exposing local services (home server solution)',
        category: 'network',
        icon: '🕳️',
        defaultPort: 3001,
        ports: [
            { internal: 3001, external: 3001, protocol: 'tcp', description: 'Web UI' },
            { internal: 8080, external: 8080, protocol: 'tcp', description: 'Tunnel endpoint' },
        ],
        dependencies: [],
        dockerComposeProfile: 'pangolin',
    },
    whodb: {
        name: 'whodb',
        displayName: 'WhoDB',
        description: 'Web-based database explorer and management UI',
        category: 'database',
        icon: '🗄️',
        defaultPort: 8081,
        ports: [
            { internal: 8081, external: 8081, protocol: 'tcp', description: 'Web UI' },
        ],
        dependencies: [
            { name: 'postgres', type: 'service', optional: true },
        ],
        dockerComposeProfile: 'whodb',
    },
    lobechat: {
        name: 'lobechat',
        displayName: 'LobeChat',
        description: 'Modern AI chat interface with plugin support',
        category: 'ai',
        icon: '💬',
        defaultPort: 3002,
        ports: [
            { internal: 3002, external: 3002, protocol: 'tcp', description: 'Web UI' },
        ],
        dependencies: [
            { name: 'ollama', type: 'service', optional: true },
        ],
        dockerComposeProfile: 'lobechat',
    },
    openwebui: {
        name: 'openwebui',
        displayName: 'Open WebUI',
        description: 'Ollama-native web interface for local LLMs',
        category: 'ai',
        icon: '🌐',
        defaultPort: 3003,
        ports: [
            { internal: 3003, external: 3003, protocol: 'tcp', description: 'Web UI' },
        ],
        dependencies: [
            { name: 'ollama', type: 'service', optional: true },
        ],
        dockerComposeProfile: 'openwebui',
    },
    librechat: {
        name: 'librechat',
        displayName: 'LibreChat',
        description: 'ChatGPT-like interface supporting multiple providers',
        category: 'ai',
        icon: '🤖',
        defaultPort: 3004,
        ports: [
            { internal: 3004, external: 3004, protocol: 'tcp', description: 'Web UI' },
        ],
        dependencies: [
            { name: 'mongodb', type: 'service', optional: false },
            { name: 'ollama', type: 'service', optional: true },
        ],
        dockerComposeProfile: 'librechat',
    },
};
// Helper functions for service operations
async function getHestiaTarget() {
    return process.env.HESTIA_TARGET || '/opt/hestia';
}
async function getDockerComposePath() {
    const target = await getHestiaTarget();
    return path.join(target, 'docker-compose.yml');
}
async function loadDockerCompose() {
    try {
        const composePath = await getDockerComposePath();
        const content = await fs.readFile(composePath, 'utf-8');
        return YAML.parse(content) || { services: {}, networks: {}, volumes: {} };
    }
    catch {
        return { services: {}, networks: {}, volumes: {} };
    }
}
async function saveDockerCompose(compose) {
    const composePath = await getDockerComposePath();
    const yaml = YAML.stringify(compose, { indent: 2, lineWidth: 120 });
    await fs.writeFile(composePath, yaml, 'utf-8');
}
async function getServiceConfigPath(serviceName) {
    const target = await getHestiaTarget();
    return path.join(target, 'config', 'services', `${serviceName}.yaml`);
}
async function loadServiceConfig(serviceName) {
    try {
        const configPath = await getServiceConfigPath(serviceName);
        const content = await fs.readFile(configPath, 'utf-8');
        return { ...defaultServiceConfigs[serviceName], ...YAML.parse(content) };
    }
    catch {
        return defaultServiceConfigs[serviceName] || { enabled: false, autoStart: false };
    }
}
async function saveServiceConfig(serviceName, config) {
    const configPath = await getServiceConfigPath(serviceName);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const yaml = YAML.stringify(config, { indent: 2 });
    await fs.writeFile(configPath, yaml, 'utf-8');
}
// Create the full service implementation
function createService(name) {
    const metadata = serviceMetadata[name];
    if (!metadata) {
        throw new Error(`Unknown service: ${name}`);
    }
    return {
        ...metadata,
        async install() {
            logger.info(`Installing ${metadata.displayName}...`);
            // Ensure config directory exists
            const configPath = await getServiceConfigPath(name);
            await fs.mkdir(path.dirname(configPath), { recursive: true });
            // Initialize default config if not exists
            const config = await loadServiceConfig(name);
            if (!config.enabled) {
                await saveServiceConfig(name, { ...config, enabled: false });
            }
            // Add service to docker-compose if profile-based
            if (metadata.dockerComposeProfile) {
                const compose = await loadDockerCompose();
                if (!compose.services[name]) {
                    compose.services[name] = buildDockerComposeService(name);
                    await saveDockerCompose(compose);
                }
            }
            logger.success(`${metadata.displayName} installed successfully`);
        },
        async configure(config) {
            logger.info(`Configuring ${metadata.displayName}...`);
            const currentConfig = await loadServiceConfig(name);
            const updatedConfig = {
                ...currentConfig,
                ...config,
                customConfig: { ...currentConfig.customConfig, ...config },
            };
            await saveServiceConfig(name, updatedConfig);
            // Update docker-compose if needed
            if (metadata.dockerComposeProfile) {
                const compose = await loadDockerCompose();
                if (compose.services[name]) {
                    compose.services[name] = {
                        ...compose.services[name],
                        environment: updatedConfig.environment,
                        ports: buildPortMappings(name, updatedConfig.ports),
                    };
                    await saveDockerCompose(compose);
                }
            }
            logger.success(`${metadata.displayName} configured successfully`);
        },
        async start() {
            const config = await loadServiceConfig(name);
            if (!config.enabled) {
                throw new Error(`${metadata.displayName} is not enabled. Run 'hestia services:enable ${name}' first.`);
            }
            logger.info(`Starting ${metadata.displayName}...`);
            const target = await getHestiaTarget();
            const composePath = await getDockerComposePath();
            if (metadata.dockerComposeProfile) {
                await execa('docker', [
                    'compose',
                    '-f', composePath,
                    '--profile', metadata.dockerComposeProfile,
                    'up', '-d', name,
                ], { cwd: target });
            }
            logger.success(`${metadata.displayName} started`);
        },
        async stop() {
            logger.info(`Stopping ${metadata.displayName}...`);
            const target = await getHestiaTarget();
            const composePath = await getDockerComposePath();
            if (metadata.dockerComposeProfile) {
                await execa('docker', [
                    'compose',
                    '-f', composePath,
                    '--profile', metadata.dockerComposeProfile,
                    'stop', name,
                ], { cwd: target });
            }
            logger.success(`${metadata.displayName} stopped`);
        },
        async status() {
            try {
                const config = await loadServiceConfig(name);
                const installed = await this.isInstalled();
                if (!installed) {
                    return { status: 'not-installed' };
                }
                if (!config.enabled) {
                    return { status: 'installed' };
                }
                // Check if container is running
                const { stdout } = await execa('docker', ['ps', '--format', '{{.Names}} {{.State}}']);
                const containerName = `hestia-${name}`;
                const lines = stdout.split('\n');
                const containerLine = lines.find(l => l.includes(containerName));
                if (containerLine && containerLine.includes('running')) {
                    return {
                        status: 'running',
                        url: `http://localhost:${metadata.defaultPort}`,
                        ports: metadata.ports,
                    };
                }
                return { status: 'stopped' };
            }
            catch (error) {
                return {
                    status: 'error',
                    message: error instanceof Error ? error.message : String(error),
                };
            }
        },
        async isInstalled() {
            try {
                const configPath = await getServiceConfigPath(name);
                await fs.access(configPath);
                return true;
            }
            catch {
                return false;
            }
        },
        isEnabled() {
            // Synchronous check - reads from a cache or simple file check
            try {
                const configPath = path.join(process.env.HESTIA_TARGET || '/opt/hestia', 'config', 'services', `${name}.yaml`);
                // Note: This is a simplified check. In production, you'd want caching
                return fs.access(configPath).then(() => true).catch(() => false);
            }
            catch {
                return false;
            }
        },
        async getLogs(lines = 100) {
            try {
                const target = await getHestiaTarget();
                const composePath = await getDockerComposePath();
                const { stdout } = await execa('docker', [
                    'compose',
                    '-f', composePath,
                    'logs',
                    '--tail', String(lines),
                    name,
                ], { cwd: target });
                return stdout;
            }
            catch (error) {
                return `Failed to get logs: ${error instanceof Error ? error.message : String(error)}`;
            }
        },
    };
}
// Build Docker Compose service definition
function buildDockerComposeService(name) {
    const metadata = serviceMetadata[name];
    const config = defaultServiceConfigs[name];
    const services = {
        traefik: {
            image: 'traefik:v3.0',
            container_name: 'hestia-traefik',
            restart: 'unless-stopped',
            profiles: ['traefik'],
            command: [
                '--api.insecure=true',
                '--providers.docker=true',
                '--providers.docker.exposedbydefault=false',
                '--entrypoints.web.address=:80',
                '--entrypoints.websecure.address=:443',
                '--log.level=INFO',
                '--accesslog=true',
            ],
            ports: [
                '80:80',
                '443:443',
                '8080:8080',
            ],
            volumes: [
                '/var/run/docker.sock:/var/run/docker.sock:ro',
            ],
            networks: ['hestia'],
        },
        pangolin: {
            image: 'fosrl/pangolin:latest',
            container_name: 'hestia-pangolin',
            restart: 'unless-stopped',
            profiles: ['pangolin'],
            environment: {
                PANGOLIN_LOG_LEVEL: 'info',
            },
            ports: [
                '3001:3001',
                '8080:8080',
            ],
            volumes: [
                './data/pangolin:/app/data',
            ],
            networks: ['hestia'],
        },
        whodb: {
            image: 'clidey/whodb:latest',
            container_name: 'hestia-whodb',
            restart: 'unless-stopped',
            profiles: ['whodb'],
            environment: {
                WHODB_POSTGRES_URL: config.environment?.WHODB_POSTGRES_URL || '',
            },
            ports: [
                '8081:8081',
            ],
            networks: ['hestia'],
        },
        lobechat: {
            image: 'lobehub/lobe-chat:latest',
            container_name: 'hestia-lobechat',
            restart: 'unless-stopped',
            profiles: ['lobechat'],
            environment: {
                OLLAMA_URL: config.environment?.OLLAMA_URL || 'http://localhost:11434',
                OPENAI_API_KEY: config.environment?.OPENAI_API_KEY || '',
            },
            ports: [
                '3002:3000',
            ],
            networks: ['hestia'],
        },
        openwebui: {
            image: 'ghcr.io/open-webui/open-webui:main',
            container_name: 'hestia-openwebui',
            restart: 'unless-stopped',
            profiles: ['openwebui'],
            environment: {
                OLLAMA_BASE_URL: config.environment?.OLLAMA_BASE_URL || 'http://localhost:11434',
                WEBUI_SECRET_KEY: config.environment?.WEBUI_SECRET_KEY || '',
            },
            ports: [
                '3003:8080',
            ],
            volumes: [
                './data/openwebui:/app/backend/data',
            ],
            networks: ['hestia'],
        },
        librechat: {
            image: 'ghcr.io/danny-avila/librechat:latest',
            container_name: 'hestia-librechat',
            restart: 'unless-stopped',
            profiles: ['librechat'],
            environment: {
                MONGO_URI: config.environment?.MONGO_URI || 'mongodb://localhost:27017/librechat',
                OPENAI_API_KEY: config.environment?.OPENAI_API_KEY || '',
                ENDPOINTS: 'ollama,openAI',
            },
            ports: [
                '3004:3080',
            ],
            depends_on: ['mongodb'],
            networks: ['hestia'],
        },
    };
    return services[name] || {};
}
// Build port mappings from config
function buildPortMappings(name, ports) {
    const metadata = serviceMetadata[name];
    if (!ports || !metadata)
        return [];
    const mappings = [];
    for (const port of metadata.ports) {
        const externalPort = ports[port.description?.toLowerCase().replace(' ', '_') || ''] || port.external;
        mappings.push(`${externalPort}:${port.internal}`);
    }
    return mappings;
}
// Service registry
class ServiceRegistry {
    services = new Map();
    constructor() {
        // Register all optional services
        const serviceNames = ['traefik', 'pangolin', 'whodb', 'lobechat', 'openwebui', 'librechat'];
        for (const name of serviceNames) {
            this.services.set(name, createService(name));
        }
    }
    get(name) {
        return this.services.get(name);
    }
    getAll() {
        return Array.from(this.services.values());
    }
    getByCategory(category) {
        return this.getAll().filter(s => s.category === category);
    }
    getCategories() {
        return ['network', 'database', 'ui', 'ai'];
    }
    exists(name) {
        return this.services.has(name);
    }
}
// Export singleton instance
export const serviceRegistry = new ServiceRegistry();
// Export individual service getters
export function getOptionalService(name) {
    return serviceRegistry.get(name);
}
export function getAllOptionalServices() {
    return serviceRegistry.getAll();
}
export function getServicesByCategory(category) {
    return serviceRegistry.getByCategory(category);
}
export function getServiceCategories() {
    return serviceRegistry.getCategories();
}
export function isValidService(name) {
    return serviceRegistry.exists(name);
}
// Re-export types
export { defaultServiceConfigs, serviceMetadata };
//# sourceMappingURL=optional-services.js.map