/**
 * Docker Compose Generator
 * 
 * Programmatically generates docker-compose.yml files for eve services.
 * Uses SERVICE_REGISTRY as the source of truth for service configurations.
 * 
 * @example
 * ```typescript
 * const generator = new DockerComposeGenerator();
 * generator.addBrainServices();
 * generator.addArmsServices();
 * generator.setEnvVar('JWT_SECRET', 'my-secret');
 * await generator.toFile('./docker-compose.yml');
 * ```
 */

import * as yaml from 'js-yaml';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  Service,
  ServiceConfig,
  DockerCompose,
  DockerComposeService,
  DockerComposeNetwork,
  DockerComposeVolume,
  SERVICE_REGISTRY,
  SERVICE_TO_ORGAN,
  BrainService,
  ArmsService,
  BuilderService,
  EyesService,
  LegsService,
} from './types.js';

/**
 * Generator for creating docker-compose.yml files
 */
export class DockerComposeGenerator {
  private services: Map<string, ServiceConfig> = new Map();
  private envVars: Map<string, string> = new Map();
  private volumes: Set<string> = new Set();

  /**
   * Add a single service to the docker-compose configuration
   * 
   * @param service - The service identifier from SERVICE_REGISTRY
   * @param config - Optional partial configuration to override defaults
   */
  addService(service: Service, config?: Partial<ServiceConfig>): void {
    const baseConfig = SERVICE_REGISTRY[service];
    if (!baseConfig) {
      throw new Error(`Unknown service: ${service}`);
    }

    // Merge base config with overrides
    const mergedConfig: ServiceConfig = {
      ...baseConfig,
      ...config,
      // Deep merge environment and volumes if provided
      environment: config?.environment
        ? { ...baseConfig.environment, ...config.environment }
        : baseConfig.environment,
      volumes: config?.volumes ?? baseConfig.volumes,
      dependsOn: config?.dependsOn ?? baseConfig.dependsOn,
    };

    this.services.set(service, mergedConfig);

    // Extract volume names from volume mounts
    if (mergedConfig.volumes) {
      for (const volume of mergedConfig.volumes) {
        const volumeName = volume.split(':')[0];
        // Only add named volumes (not host paths)
        if (!volumeName.startsWith('/') && !volumeName.startsWith('~')) {
          this.volumes.add(volumeName);
        }
      }
    }
  }

  /**
   * Add all brain services: synap, ollama, postgres, redis
   */
  addBrainServices(): void {
    const brainServices: BrainService[] = ['postgres', 'redis', 'ollama', 'synap'];
    
    // Add in dependency order (databases first)
    for (const service of brainServices) {
      this.addService(service);
    }
  }

  /**
   * Add arms services: openclaw
   */
  addArmsServices(): void {
    const armsServices: ArmsService[] = ['openclaw'];
    
    for (const service of armsServices) {
      this.addService(service);
    }
  }

  /**
   * Add eyes services: rsshub
   */
  addEyesServices(): void {
    const eyesServices: EyesService[] = ['rsshub'];
    
    for (const service of eyesServices) {
      this.addService(service);
    }
  }

  /**
   * Add legs services: traefik
   */
  addLegsServices(): void {
    const legsServices: LegsService[] = ['traefik'];

    for (const service of legsServices) {
      this.addService(service);
    }
  }

  /**
   * Add builder services: hermes (CLI tools like opencode/openclaude/claudecode have no containers)
   */
  addBuilderServices(): void {
    // Hermes gets a real container; other builder tools run on the host.
    // /opt/eve is the installed Eve CLI (mounted read-only from host).
    // SYNAP_API_KEY + HUB_BASE_URL come from .eve/hermes.env (written by writeHermesEnvFile).
    this.addService('hermes', {
      command: [
        'node', '/app/packages/@eve/builder/dist/index.js',
        'builder', 'hermes', 'start',
      ],
      envFile: ['.eve/hermes.env'],
    });
  }

  /**
   * Add all services across all organs (brain, arms, builder, eyes, legs)
   */
  addAllServices(): void {
    this.addBrainServices();
    this.addArmsServices();
    this.addBuilderServices();
    this.addEyesServices();
    this.addLegsServices();
  }

  /**
   * Set an environment variable for substitution
   * Variables will be substituted in the format ${VAR} or $VAR
   * 
   * @param key - Environment variable name
   * @param value - Environment variable value
   */
  setEnvVar(key: string, value: string): void {
    this.envVars.set(key, value);
  }

  /**
   * Set multiple environment variables at once
   * 
   * @param vars - Record of environment variables
   */
  setEnvVars(vars: Record<string, string>): void {
    for (const [key, value] of Object.entries(vars)) {
      this.envVars.set(key, value);
    }
  }

  /**
   * Substitute environment variables in a string
   * Replaces ${VAR} or $VAR with the value from envVars or keeps as placeholder
   * 
   * @param str - String containing variable placeholders
   * @returns String with variables substituted
   */
  private substituteEnvVars(str: string): string {
    // Replace ${VAR} syntax
    let result = str.replace(/\$\{(\w+)\}/g, (match, varName) => {
      if (this.envVars.has(varName)) {
        return this.envVars.get(varName)!;
      }
      return match; // Keep as placeholder if not set
    });

    // Replace $VAR syntax (for simple variable names)
    result = result.replace(/\$(\w+)/g, (match, varName) => {
      if (this.envVars.has(varName)) {
        return this.envVars.get(varName)!;
      }
      return match; // Keep as placeholder if not set
    });

    return result;
  }

  /**
   * Apply environment variable substitution to service configuration
   * 
   * @param config - Service configuration
   * @returns Configuration with env vars substituted
   */
  private applyEnvSubstitution(config: ServiceConfig): ServiceConfig {
    const substituted: ServiceConfig = { ...config };

    // Substitute in image name
    if (substituted.image) {
      substituted.image = this.substituteEnvVars(substituted.image);
    }

    // Substitute in container name
    if (substituted.containerName) {
      substituted.containerName = this.substituteEnvVars(substituted.containerName);
    }

    // Substitute in environment variables
    if (substituted.environment) {
      substituted.environment = Object.fromEntries(
        Object.entries(substituted.environment).map(([key, value]) => [
          key,
          this.substituteEnvVars(value),
        ])
      );
    }

    // Substitute in volumes
    if (substituted.volumes) {
      substituted.volumes = substituted.volumes.map((vol) =>
        this.substituteEnvVars(vol)
      );
    }

    // Substitute in command
    if (substituted.command) {
      substituted.command = substituted.command.map((cmd) =>
        this.substituteEnvVars(cmd)
      );
    }

    // Substitute in health check command
    if (substituted.healthCheck?.command) {
      substituted.healthCheck = {
        ...substituted.healthCheck,
        command: this.substituteEnvVars(substituted.healthCheck.command),
      };
    }

    return substituted;
  }

  /**
   * Convert ServiceConfig to DockerComposeService format
   * 
   * @param service - Service identifier
   * @param config - Service configuration
   * @returns DockerComposeService
   */
  private toDockerComposeService(
    service: string,
    config: ServiceConfig
  ): DockerComposeService {
    const composeService: DockerComposeService = {
      image: config.image,
      container_name: config.containerName,
    };

    if (config.ports && config.ports.length > 0) {
      composeService.ports = config.ports;
    }

    if (config.environment && Object.keys(config.environment).length > 0) {
      composeService.environment = config.environment;
    }

    if (config.envFile && config.envFile.length > 0) {
      composeService.env_file = config.envFile;
    }

    if (config.volumes && config.volumes.length > 0) {
      composeService.volumes = config.volumes;
    }

    if (config.network) {
      composeService.networks = [config.network];
    }

    if (config.restart) {
      composeService.restart = config.restart;
    }

    if (config.command && config.command.length > 0) {
      composeService.command = config.command;
    }



    if (config.dependsOn && config.dependsOn.length > 0) {
      composeService.depends_on = config.dependsOn;
    }

    if (config.healthCheck) {
      composeService.healthcheck = {
        test: ['CMD-SHELL', config.healthCheck.command],
        interval: config.healthCheck.interval,
        timeout: config.healthCheck.timeout,
        retries: config.healthCheck.retries,
      };
    }

    return composeService;
  }

  /**
   * Generate the complete Docker Compose object
   * 
   * @returns DockerCompose object
   */
  generate(): DockerCompose {
    const services: Record<string, DockerComposeService> = {};
    const networks: Record<string, DockerComposeNetwork> = {};
    const volumes: Record<string, DockerComposeVolume> = {};

    // Process all services
    for (const [serviceName, serviceConfig] of this.services) {
      // Apply environment variable substitution
      const substitutedConfig = this.applyEnvSubstitution(serviceConfig);

      // Convert to compose format
      services[serviceName] = this.toDockerComposeService(
        serviceName,
        substitutedConfig
      );

      // Add network if specified and not already added
      if (substitutedConfig.network && !networks[substitutedConfig.network]) {
        networks[substitutedConfig.network] = {
          driver: 'bridge',
        };
      }
    }

    // Ensure eve-network exists even if no services added yet
    if (Object.keys(networks).length === 0) {
      networks['eve-network'] = {
        driver: 'bridge',
      };
    }

    // Add volume definitions
    for (const volumeName of this.volumes) {
      volumes[volumeName] = {};
    }

    return {
      version: '3.8',
      services,
      networks,
      volumes,
    };
  }

  /**
   * Generate YAML string from the docker-compose configuration
   * 
   * @returns YAML formatted string
   */
  toYaml(): string {
    const compose = this.generate();
    
    return yaml.dump(compose, {
      indent: 2,
      lineWidth: -1, // Don't wrap lines
      noRefs: true, // Don't use YAML references
      sortKeys: false, // Keep original key order
    });
  }

  /**
   * Write docker-compose.yml to a file
   * 
   * @param filePath - Path to write the file
   */
  async toFile(filePath: string): Promise<void> {
    const yamlContent = this.toYaml();
    const dir = path.dirname(filePath);

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Write file
    await fs.writeFile(filePath, yamlContent, 'utf-8');
  }

  /**
   * Check if a service is already added
   * 
   * @param service - Service identifier
   * @returns True if service is added
   */
  hasService(service: Service): boolean {
    return this.services.has(service);
  }

  /**
   * Remove a service from the configuration
   * 
   * @param service - Service identifier
   */
  removeService(service: Service): void {
    const config = this.services.get(service);
    if (config?.volumes) {
      // Remove volumes that are no longer used
      for (const volume of config.volumes) {
        const volumeName = volume.split(':')[0];
        // Check if any other service uses this volume
        let volumeInUse = false;
        for (const [svcName, svcConfig] of this.services) {
          if (svcName !== service && svcConfig.volumes) {
            if (svcConfig.volumes.some((v) => v.startsWith(volumeName + ':'))) {
              volumeInUse = true;
              break;
            }
          }
        }
        if (!volumeInUse) {
          this.volumes.delete(volumeName);
        }
      }
    }
    this.services.delete(service);
  }

  /**
   * Get all added services
   * 
   * @returns Array of service identifiers
   */
  getServices(): Service[] {
    return Array.from(this.services.keys()) as Service[];
  }

  /**
   * Get configuration for a specific service
   * 
   * @param service - Service identifier
   * @returns Service configuration or undefined
   */
  getServiceConfig(service: Service): ServiceConfig | undefined {
    return this.services.get(service);
  }

  /**
   * Clear all services and start fresh
   */
  clear(): void {
    this.services.clear();
    this.volumes.clear();
  }
}

/**
 * Convenience function to create a new generator instance
 * 
 * @returns DockerComposeGenerator instance
 */
export function createDockerComposeGenerator(): DockerComposeGenerator {
  return new DockerComposeGenerator();
}
