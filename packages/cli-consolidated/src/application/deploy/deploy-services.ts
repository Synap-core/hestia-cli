/**
 * Deploy Services Use Case
 * 
 * Deploys Docker services and waits for health checks.
 * 
 * Pure business logic - no UI dependencies.
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ProgressReporter, OperationResult } from '../types.js';

export interface DeployServicesInput {
  /** Deployment directory containing docker-compose.yml */
  deployDir: string;
  /** Domain name */
  domain: string;
  /** Timeout for health checks in milliseconds */
  healthCheckTimeout?: number;
  /** Skip health checks */
  skipHealthCheck?: boolean;
}

export interface DeployServicesOutput {
  servicesStarted: string[];
  servicesHealthy: string[];
  servicesFailed: string[];
}

/**
 * Deploy services using Docker Compose
 * 
 * @param input - Deployment options
 * @param progress - Progress reporter
 * @returns Deployment result
 */
export async function deployServices(
  input: DeployServicesInput,
  progress: ProgressReporter
): Promise<OperationResult<DeployServicesOutput>> {
  const { deployDir, domain, healthCheckTimeout = 300000, skipHealthCheck } = input;
  
  progress.report('Starting service deployment...');
  progress.onProgress(0);

  const result: DeployServicesOutput = {
    servicesStarted: [],
    servicesHealthy: [],
    servicesFailed: [],
  };

  try {
    // Verify docker-compose.yml exists
    const composePath = path.join(deployDir, 'docker-compose.yml');
    try {
      await fs.access(composePath);
    } catch {
      return {
        success: false,
        error: `Docker Compose file not found: ${composePath}`,
      };
    }

    progress.onProgress(10);

    // Pull latest images
    progress.report('Pulling latest Docker images...');
    const pullResult = await runDockerCompose(deployDir, ['pull']);
    if (pullResult.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to pull images: ${pullResult.stderr}`,
      };
    }
    progress.onProgress(40);

    // Start services
    progress.report('Starting core services...');
    const upResult = await runDockerCompose(deployDir, ['up', '-d', '--remove-orphans']);
    if (upResult.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to start services: ${upResult.stderr}`,
      };
    }
    progress.onProgress(60);

    // Get list of started services
    const servicesResult = await runDockerCompose(deployDir, ['ps', '--format', 'json']);
    if (servicesResult.exitCode === 0) {
      try {
        const services = JSON.parse(servicesResult.stdout);
        result.servicesStarted = services.map((s: any) => s.Service || s.Name);
      } catch {
        // Fallback: parse line by line
        result.servicesStarted = servicesResult.stdout
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => line.split(/\s+/)[0]);
      }
    }

    // Wait for health checks
    if (!skipHealthCheck) {
      progress.report('Waiting for services to be healthy...');
      progress.onProgress(70);

      const healthResult = await waitForServicesHealth(deployDir, healthCheckTimeout, progress);
      result.servicesHealthy = healthResult.healthy;
      result.servicesFailed = healthResult.failed;

      if (healthResult.failed.length > 0) {
        return {
          success: false,
          error: `Some services failed health checks: ${healthResult.failed.join(', ')}`,
        };
      }
    }

    progress.onProgress(100);
    progress.report('Service deployment complete');

    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Service deployment failed',
    };
  }
}

/**
 * Run docker compose command
 */
function runDockerCompose(
  cwd: string,
  args: string[],
  timeout = 300000
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Docker Compose command timed out'));
    }, timeout);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * Wait for services to be healthy
 */
async function waitForServicesHealth(
  deployDir: string,
  timeout: number,
  progress: ProgressReporter
): Promise<{ healthy: string[]; failed: string[] }> {
  const start = Date.now();
  const healthy: string[] = [];
  const failed: string[] = [];

  while (Date.now() - start < timeout) {
    try {
      const result = await runDockerCompose(deployDir, ['ps', '--format', 'json']);
      if (result.exitCode !== 0) {
        await sleep(2000);
        continue;
      }

      let services: any[] = [];
      try {
        const parsed = JSON.parse(result.stdout);
        services = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        // Non-JSON output, skip parsing
      }

      for (const service of services) {
        const name = service.Service || service.Name;
        const state = service.State || service.Status || '';
        const health = service.Health || service.HealthCheck || '';

        if (state === 'running' && (health === 'healthy' || health === '')) {
          if (!healthy.includes(name)) {
            healthy.push(name);
          }
        } else if (state === 'exited' || state === 'dead') {
          if (!failed.includes(name)) {
            failed.push(name);
          }
        }
      }

      // Report progress
      const totalServices = services.length;
      if (totalServices > 0) {
        const progressPercent = Math.round((healthy.length / totalServices) * 100);
        progress.onProgress(70 + Math.round(progressPercent * 0.3));
      }

      // Check if all services are accounted for
      if (healthy.length + failed.length >= services.length && services.length > 0) {
        break;
      }
    } catch {
      // Ignore errors and retry
    }

    await sleep(2000);
  }

  return { healthy, failed };
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for an HTTP endpoint to be ready
 */
export async function waitForHttpEndpoint(
  url: string,
  timeout: number,
  progress?: ProgressReporter
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // Retry
    }
    
    if (progress) {
      const elapsed = Date.now() - start;
      const percent = Math.min(100, Math.round((elapsed / timeout) * 100));
      progress.onProgress(percent);
    }
    
    await sleep(2000);
  }

  return false;
}
