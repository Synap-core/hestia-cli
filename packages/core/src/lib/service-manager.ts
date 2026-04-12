/**
 * Service Manager
 * 
 * Central service management for Hestia.
 * Handles service lifecycle, state tracking, dependency management,
 * port allocation, and Docker Compose profile management.
 */

import { execa } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as net from 'net';
import YAML from 'yaml';
import { logger } from './logger.js';
import { spinner, withSpinner } from './spinner.js';
import {
  serviceRegistry,
  getOptionalService,
  getAllOptionalServices,
  type OptionalService,
  type ServiceStatus,
  type ServiceCategory,
  type ServiceStatusInfo,
  type ServiceConfig,
  defaultServiceConfigs,
} from './optional-services.js';

// Service state tracking
interface ServiceState {
  name: string;
  installed: boolean;
  enabled: boolean;
  status: ServiceStatus;
  lastStartTime?: Date;
  lastError?: string;
  pid?: number;
  ports?: number[];
}

// Service manager configuration
interface ServiceManagerConfig {
  autoStartEnabled: boolean;
  portRange: { min: number; max: number };
  reservedPorts: number[];
  stateFilePath: string;
}

// Port allocation tracker
interface PortAllocation {
  port: number;
  service: string;
  assignedAt: Date;
}

class ServiceManager {
  private config: ServiceManagerConfig;
  private states: Map<string, ServiceState> = new Map();
  private portAllocations: Map<number, PortAllocation> = new Map();
  private initialized = false;

  constructor() {
    this.config = {
      autoStartEnabled: true,
      portRange: { min: 3000, max: 3100 },
      reservedPorts: [80, 443, 8080, 5432, 27017, 11434],
      stateFilePath: '',
    };
  }

  // Initialize the service manager
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const target = process.env.HESTIA_TARGET || '/opt/hestia';
    this.config.stateFilePath = path.join(target, 'data', 'service-states.json');

    // Ensure directories exist
    await fs.mkdir(path.dirname(this.config.stateFilePath), { recursive: true });

    // Load saved states
    await this.loadStates();

    // Initialize port allocations
    await this.initializePortAllocations();

    this.initialized = true;
    logger.debug('Service manager initialized');
  }

  // Load service states from disk
  private async loadStates(): Promise<void> {
    try {
      const content = await fs.readFile(this.config.stateFilePath, 'utf-8');
      const data = JSON.parse(content);
      
      if (data.states) {
        for (const [name, state] of Object.entries(data.states)) {
          this.states.set(name, state as ServiceState);
        }
      }
      
      if (data.portAllocations) {
        for (const [port, allocation] of Object.entries(data.portAllocations)) {
          this.portAllocations.set(Number(port), allocation as PortAllocation);
        }
      }
    } catch {
      // No state file yet, start fresh
      logger.debug('No previous service states found');
    }
  }

  // Save service states to disk
  private async saveStates(): Promise<void> {
    const data = {
      states: Object.fromEntries(this.states),
      portAllocations: Object.fromEntries(this.portAllocations),
      savedAt: new Date().toISOString(),
    };

    await fs.writeFile(
      this.config.stateFilePath,
      JSON.stringify(data, null, 2),
      'utf-8'
    );
  }

  // Initialize port allocations from existing configs
  private async initializePortAllocations(): Promise<void> {
    const services = getAllOptionalServices();
    
    for (const service of services) {
      const config = await this.loadServiceConfig(service.name);
      
      if (config.ports) {
        for (const [key, port] of Object.entries(config.ports)) {
          this.portAllocations.set(port, {
            port,
            service: service.name,
            assignedAt: new Date(),
          });
        }
      }
    }
  }

  // Get service configuration
  private async loadServiceConfig(serviceName: string): Promise<ServiceConfig> {
    try {
      const target = process.env.HESTIA_TARGET || '/opt/hestia';
      const configPath = path.join(target, 'config', 'services', `${serviceName}.yaml`);
      const content = await fs.readFile(configPath, 'utf-8');
      return { ...defaultServiceConfigs[serviceName], ...YAML.parse(content) };
    } catch {
      return defaultServiceConfigs[serviceName] || { enabled: false, autoStart: false };
    }
  }

  // Save service configuration
  private async saveServiceConfig(serviceName: string, config: ServiceConfig): Promise<void> {
    const target = process.env.HESTIA_TARGET || '/opt/hestia';
    const configPath = path.join(target, 'config', 'services', `${serviceName}.yaml`);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    
    const yaml = YAML.stringify(config, { indent: 2 });
    await fs.writeFile(configPath, yaml, 'utf-8');
  }

  // Find an available port
  async findAvailablePort(serviceName: string, preferredPort?: number): Promise<number> {
    // Check if preferred port is available
    if (preferredPort && await this.isPortAvailable(preferredPort, serviceName)) {
      return preferredPort;
    }

    // Search in configured range
    for (let port = this.config.portRange.min; port <= this.config.portRange.max; port++) {
      if (this.config.reservedPorts.includes(port)) continue;
      
      if (await this.isPortAvailable(port, serviceName)) {
        return port;
      }
    }

    throw new Error(`No available ports in range ${this.config.portRange.min}-${this.config.portRange.max}`);
  }

  // Check if a port is available
  private async isPortAvailable(port: number, serviceName: string): Promise<boolean> {
    // Check if port is already allocated to another service
    const allocation = this.portAllocations.get(port);
    if (allocation && allocation.service !== serviceName) {
      return false;
    }

    // Check if port is in use by system
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.once('error', () => {
        resolve(false);
      });
      
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      
      server.listen(port, '0.0.0.0');
    });
  }

  // Allocate a port for a service
  async allocatePort(serviceName: string, port: number): Promise<void> {
    this.portAllocations.set(port, {
      port,
      service: serviceName,
      assignedAt: new Date(),
    });
    await this.saveStates();
  }

  // Release a port allocation
  async releasePort(port: number): Promise<void> {
    this.portAllocations.delete(port);
    await this.saveStates();
  }

  // Install a service
  async install(serviceName: string): Promise<void> {
    await this.initialize();

    const service = getOptionalService(serviceName);
    if (!service) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    const state = this.states.get(serviceName);
    if (state?.installed) {
      logger.warn(`${service.displayName} is already installed`);
      return;
    }

    await withSpinner(
      `Installing ${service.displayName}...`,
      async () => {
        // Check dependencies
        await this.checkDependencies(service);
        
        // Allocate ports
        const ports: Record<string, number> = {};
        for (const port of service.ports) {
          const portKey = port.description?.toLowerCase().replace(' ', '_') || `port_${port.internal}`;
          ports[portKey] = await this.findAvailablePort(serviceName, port.external);
          await this.allocatePort(serviceName, ports[portKey]);
        }

        // Save port configuration
        const config = await this.loadServiceConfig(serviceName);
        config.ports = ports;
        await this.saveServiceConfig(serviceName, config);

        // Run service-specific installation
        await service.install();

        // Update state
        this.states.set(serviceName, {
          name: serviceName,
          installed: true,
          enabled: false,
          status: 'installed',
        });
        await this.saveStates();
      },
      `${service.displayName} installed successfully`
    );
  }

  // Remove a service
  async remove(serviceName: string): Promise<void> {
    await this.initialize();

    const service = getOptionalService(serviceName);
    if (!service) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    const state = this.states.get(serviceName);
    if (!state?.installed) {
      logger.warn(`${service.displayName} is not installed`);
      return;
    }

    // Stop if running
    if (state.status === 'running') {
      await this.stop(serviceName);
    }

    await withSpinner(
      `Removing ${service.displayName}...`,
      async () => {
        // Release ports
        const config = await this.loadServiceConfig(serviceName);
        if (config.ports) {
          for (const port of Object.values(config.ports)) {
            await this.releasePort(port);
          }
        }

        // Remove config files
        const target = process.env.HESTIA_TARGET || '/opt/hestia';
        const configPath = path.join(target, 'config', 'services', `${serviceName}.yaml`);
        try {
          await fs.unlink(configPath);
        } catch {
          // File may not exist
        }

        // Update state
        this.states.delete(serviceName);
        await this.saveStates();
      },
      `${service.displayName} removed successfully`
    );
  }

  // Check service dependencies
  private async checkDependencies(service: OptionalService): Promise<void> {
    for (const dep of service.dependencies) {
      if (dep.type === 'service') {
        const depService = getOptionalService(dep.name);
        if (!depService && !dep.optional) {
          throw new Error(
            `Required dependency '${dep.name}' for ${service.displayName} is not available`
          );
        }

        if (depService) {
          const depState = this.states.get(dep.name);
          if (!depState?.installed && !dep.optional) {
            throw new Error(
              `Required dependency '${depService.displayName}' for ${service.displayName} is not installed`
            );
          }
        }
      } else if (dep.type === 'port') {
        const port = parseInt(dep.name, 10);
        if (!(await this.isPortAvailable(port, service.name))) {
          throw new Error(`Required port ${port} for ${service.displayName} is not available`);
        }
      }
    }
  }

  // Enable a service
  async enable(serviceName: string): Promise<void> {
    await this.initialize();

    const service = getOptionalService(serviceName);
    if (!service) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    const state = this.states.get(serviceName);
    if (!state?.installed) {
      throw new Error(`${service.displayName} is not installed. Run 'hestia services:install ${serviceName}' first.`);
    }

    if (state.enabled) {
      logger.warn(`${service.displayName} is already enabled`);
      return;
    }

    const config = await this.loadServiceConfig(serviceName);
    config.enabled = true;
    await this.saveServiceConfig(serviceName, config);

    state.enabled = true;
    await this.saveStates();

    logger.success(`${service.displayName} enabled`);

    // Auto-start if configured
    if (config.autoStart && this.config.autoStartEnabled) {
      await this.start(serviceName);
    }
  }

  // Disable a service
  async disable(serviceName: string): Promise<void> {
    await this.initialize();

    const service = getOptionalService(serviceName);
    if (!service) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    const state = this.states.get(serviceName);
    if (!state?.installed) {
      throw new Error(`${service.displayName} is not installed`);
    }

    if (!state.enabled) {
      logger.warn(`${service.displayName} is already disabled`);
      return;
    }

    // Stop if running
    if (state.status === 'running') {
      await this.stop(serviceName);
    }

    const config = await this.loadServiceConfig(serviceName);
    config.enabled = false;
    await this.saveServiceConfig(serviceName, config);

    state.enabled = false;
    state.status = 'installed';
    await this.saveStates();

    logger.success(`${service.displayName} disabled`);
  }

  // Start a service
  async start(serviceName: string): Promise<void> {
    await this.initialize();

    const service = getOptionalService(serviceName);
    if (!service) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    const state = this.states.get(serviceName);
    if (!state?.installed) {
      throw new Error(`${service.displayName} is not installed`);
    }

    if (!state.enabled) {
      throw new Error(`${service.displayName} is not enabled. Run 'hestia services:enable ${serviceName}' first.`);
    }

    if (state.status === 'running') {
      logger.warn(`${service.displayName} is already running`);
      return;
    }

    await withSpinner(
      `Starting ${service.displayName}...`,
      async () => {
        await service.start();
        
        state.status = 'running';
        state.lastStartTime = new Date();
        await this.saveStates();

        // Wait a moment and verify it's actually running
        await new Promise(resolve => setTimeout(resolve, 2000));
        const status = await service.status();
        
        if (status.status !== 'running') {
          state.status = 'error';
          state.lastError = status.message || 'Failed to start';
          await this.saveStates();
          throw new Error(`Failed to start ${service.displayName}: ${status.message}`);
        }
      },
      `${service.displayName} started successfully`
    );
  }

  // Stop a service
  async stop(serviceName: string): Promise<void> {
    await this.initialize();

    const service = getOptionalService(serviceName);
    if (!service) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    const state = this.states.get(serviceName);
    if (!state?.installed) {
      throw new Error(`${service.displayName} is not installed`);
    }

    if (state.status !== 'running') {
      logger.warn(`${service.displayName} is not running`);
      return;
    }

    await withSpinner(
      `Stopping ${service.displayName}...`,
      async () => {
        await service.stop();
        
        state.status = 'installed';
        await this.saveStates();
      },
      `${service.displayName} stopped`
    );
  }

  // Get service status
  async getStatus(serviceName: string): Promise<ServiceStatusInfo> {
    await this.initialize();

    const service = getOptionalService(serviceName);
    if (!service) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    const state = this.states.get(serviceName);
    const status = await service.status();

    // Enrich status with state information
    if (state) {
      return {
        ...status,
        uptime: state.lastStartTime 
          ? Math.floor((Date.now() - state.lastStartTime.getTime()) / 1000)
          : undefined,
      };
    }

    return status;
  }

  // Get all service statuses
  async getAllStatuses(): Promise<Array<{ service: OptionalService; status: ServiceStatusInfo }>> {
    await this.initialize();

    const services = getAllOptionalServices();
    const results: Array<{ service: OptionalService; status: ServiceStatusInfo }> = [];

    for (const service of services) {
      const status = await this.getStatus(service.name);
      results.push({ service, status });
    }

    return results;
  }

  // Configure a service
  async configure(serviceName: string, config: Record<string, unknown>): Promise<void> {
    await this.initialize();

    const service = getOptionalService(serviceName);
    if (!service) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    const state = this.states.get(serviceName);
    if (!state?.installed) {
      throw new Error(`${service.displayName} is not installed`);
    }

    await withSpinner(
      `Configuring ${service.displayName}...`,
      async () => {
        await service.configure(config);
        
        // Update saved config
        const currentConfig = await this.loadServiceConfig(serviceName);
        await this.saveServiceConfig(serviceName, {
          ...currentConfig,
          ...config as ServiceConfig,
        });
      },
      `${service.displayName} configured`
    );

    // Restart if running to apply changes
    if (state.status === 'running') {
      logger.info(`Restarting ${service.displayName} to apply changes...`);
      await this.stop(serviceName);
      await this.start(serviceName);
    }
  }

  // Get service logs
  async getLogs(serviceName: string, lines: number = 100): Promise<string> {
    await this.initialize();

    const service = getOptionalService(serviceName);
    if (!service) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    if (service.getLogs) {
      return await service.getLogs(lines);
    }

    // Fallback: try to get Docker logs
    try {
      const target = process.env.HESTIA_TARGET || '/opt/hestia';
      const composePath = path.join(target, 'docker-compose.yml');
      
      const { stdout } = await execa('docker', [
        'compose',
        '-f', composePath,
        'logs',
        '--tail', String(lines),
        serviceName,
      ], { cwd: target });
      
      return stdout;
    } catch (error) {
      return `Unable to retrieve logs: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // Get Docker Compose profiles for enabled services
  async getEnabledProfiles(): Promise<string[]> {
    await this.initialize();

    const profiles: string[] = [];
    const services = getAllOptionalServices();

    for (const service of services) {
      const state = this.states.get(service.name);
      if (state?.enabled && service.dockerComposeProfile) {
        profiles.push(service.dockerComposeProfile);
      }
    }

    return [...new Set(profiles)];
  }

  // Start all enabled services
  async startAllEnabled(): Promise<void> {
    await this.initialize();

    const services = getAllOptionalServices();
    const enabledServices = services.filter(s => {
      const state = this.states.get(s.name);
      return state?.enabled && state?.status !== 'running';
    });

    if (enabledServices.length === 0) {
      logger.info('No enabled services to start');
      return;
    }

    logger.info(`Starting ${enabledServices.length} enabled service(s)...`);
    
    for (const service of enabledServices) {
      try {
        await this.start(service.name);
      } catch (error) {
        logger.error(`Failed to start ${service.displayName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Stop all running services
  async stopAll(): Promise<void> {
    await this.initialize();

    const runningServices = Array.from(this.states.entries())
      .filter(([, state]) => state.status === 'running')
      .map(([name]) => name);

    if (runningServices.length === 0) {
      logger.info('No running services to stop');
      return;
    }

    logger.info(`Stopping ${runningServices.length} service(s)...`);
    
    for (const serviceName of runningServices) {
      try {
        await this.stop(serviceName);
      } catch (error) {
        logger.error(`Failed to stop ${serviceName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Get services summary for display
  async getServicesSummary(): Promise<{
    installed: number;
    enabled: number;
    running: number;
    byCategory: Record<ServiceCategory, number>;
  }> {
    await this.initialize();

    const allServices = getAllOptionalServices();
    const statuses = await this.getAllStatuses();

    const summary = {
      installed: 0,
      enabled: 0,
      running: 0,
      byCategory: {
        network: 0,
        database: 0,
        ui: 0,
        ai: 0,
      },
    };

    for (const { service, status } of statuses) {
      if (status.status !== 'not-installed') {
        summary.installed++;
      }
      if (status.status === 'running' || status.status === 'enabled') {
        summary.enabled++;
      }
      if (status.status === 'running') {
        summary.running++;
      }
      summary.byCategory[service.category]++;
    }

    return summary;
  }

  // Validate service configuration
  async validateConfig(serviceName: string): Promise<{ valid: boolean; errors: string[] }> {
    await this.initialize();

    const service = getOptionalService(serviceName);
    if (!service) {
      return { valid: false, errors: [`Unknown service: ${serviceName}`] };
    }

    const errors: string[] = [];

    // Check dependencies
    try {
      await this.checkDependencies(service);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    // Check port availability
    const config = await this.loadServiceConfig(serviceName);
    if (config.ports) {
      for (const [key, port] of Object.entries(config.ports)) {
        if (!(await this.isPortAvailable(port, serviceName))) {
          const allocation = this.portAllocations.get(port);
          if (allocation && allocation.service !== serviceName) {
            errors.push(`Port ${port} (${key}) is already allocated to ${allocation.service}`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

// Export singleton instance
export const serviceManager = new ServiceManager();

// Re-export types
export type {
  ServiceState,
  ServiceManagerConfig,
  PortAllocation,
  ServiceCategory,
  ServiceStatus,
  ServiceStatusInfo,
  ServiceConfig,
};

// Helper functions
export async function isServiceInstalled(serviceName: string): Promise<boolean> {
  const service = getOptionalService(serviceName);
  if (!service) return false;
  return await service.isInstalled();
}

export async function isServiceRunning(serviceName: string): Promise<boolean> {
  const service = getOptionalService(serviceName);
  if (!service) return false;
  const status = await service.status();
  return status.status === 'running';
}

export function getServiceInfo(serviceName: string): OptionalService | undefined {
  return getOptionalService(serviceName);
}
