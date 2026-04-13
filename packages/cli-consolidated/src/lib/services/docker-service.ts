/**
 * Docker Service - Real container management
 * Handles Docker container lifecycle for Hestia packages
 * Implements IDockerService for contract clarity and testability
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { logger } from '../utils/logger.js';
import { getConfigValue } from '../utils/config.js';
import type { IDockerService, ComposeConfig, ServiceStatus } from './interfaces.js';

const execAsync = promisify(exec);

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'paused' | 'restarting' | 'exited';
  ports: string[];
  health?: 'healthy' | 'unhealthy' | 'starting' | 'none';
  created: string;
}

export interface ComposeProject {
  name: string;
  status: 'running' | 'stopped' | 'partial';
  containers: ContainerInfo[];
  configFile: string;
}

/**
 * Check if Docker is available and running
 */
export async function isDockerRunning(): Promise<boolean> {
  try {
    await execAsync('docker info');
    return true;
  } catch {
    return false;
  }
}

/**
 * Start a package using docker-compose
 */
export async function startPackage(packageName: string): Promise<{ success: boolean; message: string }> {
  try {
    const config = await getConfigValue();
    if (!config._packagesDir) {
      throw new Error('Packages directory not configured');
    }
    const composeFile = path.join(config._packagesDir, packageName, 'docker-compose.yml');
    
    // Check if compose file exists
    try {
      await fs.access(composeFile);
    } catch {
      return { 
        success: false, 
        message: `No docker-compose.yml found for package ${packageName}` 
      };
    }
    
    logger.info(`Starting ${packageName}...`);
    
    // Pull latest images
    try {
      await execAsync(`docker compose -f "${composeFile}" pull`, {
        timeout: 120000
      });
    } catch (error) {
      logger.warn(`Warning: Could not pull latest images, using local: ${error}`);
    }
    
    // Start containers
    const { stdout, stderr } = await execAsync(
      `docker compose -f "${composeFile}" up -d`,
      { timeout: 120000 }
    );
    
    if (stderr && !stderr.includes('Pulling') && !stderr.includes('Pulled')) {
      logger.debug('Docker output:', stderr);
    }
    
    // Wait for containers to be healthy
    await waitForHealthy(packageName, composeFile);
    
    return { success: true, message: `Package ${packageName} started successfully` };
  } catch (error: any) {
    return { 
      success: false, 
      message: `Failed to start ${packageName}: ${error.message}` 
    };
  }
}

/**
 * Stop a package using docker-compose
 */
export async function stopPackage(packageName: string): Promise<{ success: boolean; message: string }> {
  try {
    const config = await getConfigValue();
    if (!config._packagesDir) {
      throw new Error('Packages directory not configured');
    }
    const composeFile = path.join(config._packagesDir, packageName, 'docker-compose.yml');
    
    // Check if compose file exists
    try {
      await fs.access(composeFile);
    } catch {
      return { 
        success: false, 
        message: `No docker-compose.yml found for package ${packageName}` 
      };
    }
    
    logger.info(`Stopping ${packageName}...`);
    
    const { stdout, stderr } = await execAsync(
      `docker compose -f "${composeFile}" down`,
      { timeout: 60000 }
    );
    
    return { success: true, message: `Package ${packageName} stopped successfully` };
  } catch (error: any) {
    return { 
      success: false, 
      message: `Failed to stop ${packageName}: ${error.message}` 
    };
  }
}

/**
 * Restart a package
 */
export async function restartPackage(packageName: string): Promise<{ success: boolean; message: string }> {
  try {
    const config = await getConfigValue();
    if (!config._packagesDir) {
      throw new Error('Packages directory not configured');
    }
    const composeFile = path.join(config._packagesDir, packageName, 'docker-compose.yml');
    
    try {
      await fs.access(composeFile);
    } catch {
      return { 
        success: false, 
        message: `No docker-compose.yml found for package ${packageName}` 
      };
    }
    
    logger.info(`Restarting ${packageName}...`);
    
    await execAsync(
      `docker compose -f "${composeFile}" restart`,
      { timeout: 60000 }
    );
    
    await waitForHealthy(packageName, composeFile);
    
    return { success: true, message: `Package ${packageName} restarted successfully` };
  } catch (error: any) {
    return { 
      success: false, 
      message: `Failed to restart ${packageName}: ${error.message}` 
    };
  }
}

/**
 * Get status of a package's containers
 */
export async function getPackageStatus(packageName: string): Promise<{
  running: boolean;
  containers: ContainerInfo[];
  message?: string;
}> {
  try {
    const config = await getConfigValue();
    if (!config._packagesDir) {
      throw new Error('Packages directory not configured');
    }
    const composeFile = path.join(config._packagesDir, packageName, 'docker-compose.yml');
    
    try {
      await fs.access(composeFile);
    } catch {
      return { running: false, containers: [], message: 'Package not installed' };
    }
    
    const { stdout } = await execAsync(
      `docker compose -f "${composeFile}" ps --format json`,
      { timeout: 10000 }
    );
    
    if (!stdout.trim()) {
      return { running: false, containers: [] };
    }
    
    // Parse container info
    const lines = stdout.trim().split('\n').filter(l => l.trim());
    const containers: ContainerInfo[] = [];
    
    for (const line of lines) {
      try {
        const info = JSON.parse(line);
        containers.push({
          id: info.ID || info.id || '',
          name: info.Name || info.name || '',
          image: info.Image || info.image || '',
          status: mapStatus(info.State || info.state || ''),
          ports: parsePorts(info.Publishers || info.ports || []),
          health: info.Health || info.health || 'none',
          created: info.CreatedAt || info.created || ''
        });
      } catch {
        // Skip invalid lines
      }
    }
    
    const running = containers.some(c => c.status === 'running');
    
    return { running, containers };
  } catch (error: any) {
    return { 
      running: false, 
      containers: [],
      message: error.message 
    };
  }
}

/**
 * List all Hestia containers
 */
export async function listContainers(): Promise<ContainerInfo[]> {
  try {
    const { stdout } = await execAsync(
      `docker ps -a --filter "label=hestia" --format "{{json .}}"`,
      { timeout: 10000 }
    );
    
    if (!stdout.trim()) {
      return [];
    }
    
    const containers: ContainerInfo[] = [];
    const lines = stdout.trim().split('\n');
    
    for (const line of lines) {
      try {
        const info = JSON.parse(line);
        containers.push({
          id: info.ID,
          name: info.Names,
          image: info.Image,
          status: mapStatus(info.State),
          ports: parsePortsString(info.Ports),
          created: info.CreatedAt
        });
      } catch {
        // Skip invalid
      }
    }
    
    return containers;
  } catch {
    return [];
  }
}

/**
 * Get container logs
 */
export async function getLogs(
  packageName: string, 
  options: { follow?: boolean; tail?: number } = {}
): Promise<{ success: boolean; logs?: string; error?: string }> {
  try {
    const config = await getConfigValue();
    if (!config._packagesDir) {
      throw new Error('Packages directory not configured');
    }
    const composeFile = path.join(config._packagesDir, packageName, 'docker-compose.yml');

    await fs.access(composeFile);
    
    const follow = options.follow ? '-f' : '';
    const tail = options.tail ? `--tail ${options.tail}` : '';
    
    const { stdout } = await execAsync(
      `docker compose -f "${composeFile}" logs ${follow} ${tail}`,
      { timeout: options.follow ? 30000 : 10000 }
    );
    
    return { success: true, logs: stdout };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Execute command in container
 */
export async function execInContainer(
  containerName: string,
  command: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  try {
    const { stdout, stderr } = await execAsync(
      `docker exec ${containerName} ${command}`,
      { timeout: 30000 }
    );
    
    return { success: true, output: stdout || stderr };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Helper functions

function mapStatus(dockerStatus: string): ContainerInfo['status'] {
  const status = dockerStatus.toLowerCase();
  if (status.includes('running')) return 'running';
  if (status.includes('paused')) return 'paused';
  if (status.includes('restarting')) return 'restarting';
  if (status.includes('exited')) return 'exited';
  return 'stopped';
}

function parsePorts(publishers: any[]): string[] {
  if (!Array.isArray(publishers)) return [];
  return publishers.map(p => `${p.PrivatePort}:${p.PublicPort}/${p.Type}`);
}

function parsePortsString(portsStr: string): string[] {
  if (!portsStr) return [];
  return portsStr.split(', ').filter(p => p.trim());
}

async function waitForHealthy(packageName: string, composeFile: string, timeout = 120000): Promise<void> {
  const startTime = Date.now();
  const checkInterval = 2000;
  
  while (Date.now() - startTime < timeout) {
    try {
      const { stdout } = await execAsync(
        `docker compose -f "${composeFile}" ps --format json`,
        { timeout: 5000 }
      );
      
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      const containers = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
      
      // Check if all containers are running
      const allRunning = containers.every((c: any) => 
        c.State === 'running' || c.state === 'running'
      );
      
      if (allRunning && containers.length > 0) {
        return;
      }
    } catch {
      // Ignore errors during wait
    }
    
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  throw new Error(`Timeout waiting for ${packageName} containers to be healthy`);
}

/**
 * Clean up Docker resources
 */
export async function cleanup(): Promise<{ success: boolean; message: string }> {
  try {
    logger.info('Cleaning up Docker resources...');
    
    // Remove stopped containers
    await execAsync('docker container prune -f', { timeout: 30000 });
    
    // Remove unused networks
    await execAsync('docker network prune -f', { timeout: 30000 });
    
    // Remove dangling images
    await execAsync('docker image prune -f', { timeout: 30000 });
    
    return { success: true, message: 'Docker cleanup completed' };
  } catch (error: any) {
    return { success: false, message: `Cleanup failed: ${error.message}` };
  }
}

/**
 * Get Docker system info
 */
export async function getDockerInfo(): Promise<{
  version: string;
  running: boolean;
  containers: { total: number; running: number; paused: number; stopped: number };
  images: number;
}> {
  try {
    const { stdout: version } = await execAsync('docker version --format "{{.Server.Version}}"');
    const { stdout: info } = await execAsync('docker info --format "{{json .}}"');
    const data = JSON.parse(info);
    
    return {
      version: version.trim(),
      running: true,
      containers: {
        total: data.Containers || 0,
        running: data.ContainersRunning || 0,
        paused: data.ContainersPaused || 0,
        stopped: data.ContainersStopped || 0
      },
      images: data.Images || 0
    };
  } catch {
    return {
      version: 'unknown',
      running: false,
      containers: { total: 0, running: 0, paused: 0, stopped: 0 },
      images: 0
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DockerService Class - Implements IDockerService
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Docker Service Class
 * Provides a class-based interface for Docker operations
 * Implements IDockerService for contract clarity and testability
 */
export class DockerService implements IDockerService {
  private packagesDir: string | undefined;

  constructor(packagesDir?: string) {
    this.packagesDir = packagesDir;
  }

  /**
   * Start a Docker service
   * Implements IDockerService.startService()
   */
  async startService(name: string): Promise<void> {
    const result = await startPackage(name);
    if (!result.success) {
      throw new Error(result.message);
    }
  }

  /**
   * Stop a Docker service
   * Implements IDockerService.stopService()
   */
  async stopService(name: string): Promise<void> {
    const result = await stopPackage(name);
    if (!result.success) {
      throw new Error(result.message);
    }
  }

  /**
   * Get status of a Docker service
   * Implements IDockerService.getStatus()
   */
  async getStatus(name: string): Promise<ServiceStatus> {
    const status = await getPackageStatus(name);
    return {
      isRunning: status.running,
      errors: status.message ? [status.message] : []
    };
  }

  /**
   * Generate docker-compose.yml content
   * Implements IDockerService.generateCompose()
   */
  async generateCompose(config: ComposeConfig): Promise<string> {
    const yaml = await import('js-yaml');
    return yaml.dump(config, {
      indent: 2,
      lineWidth: 120,
    });
  }
}

// Singleton instance for convenience
export const dockerService = new DockerService();
