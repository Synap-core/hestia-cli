/**
 * Installation Phase 3 Use Case
 * 
 * Phase 3: Service startup and finalization
 * - Start Docker services
 * - Initialize database
 * - Run migrations
 * - Start Hestia services
 * - Health checks
 * 
 * Pure business logic - no UI dependencies.
 */

import { spawn } from 'child_process';
import { access, constants } from 'fs/promises';
import { ProgressReporter, OperationResult } from '../types.js';

export interface Phase3Input {
  /** Target installation directory */
  targetDir: string;
  /** Safe mode - preserve existing data */
  safeMode?: boolean;
  /** Unattended installation (no prompts) */
  unattended?: boolean;
  /** Run in dry-run mode */
  dryRun?: boolean;
  /** Skip health checks */
  skipHealthCheck?: boolean;
}

export interface Phase3Output {
  servicesStarted: string[];
  migrationsRun: boolean;
  healthCheckPassed: boolean;
}

/**
 * Run Phase 3 installation
 * 
 * @param input - Phase options
 * @param progress - Progress reporter
 * @returns Phase result
 */
export async function runPhase3(
  input: Phase3Input,
  progress: ProgressReporter
): Promise<OperationResult<Phase3Output>> {
  const { targetDir, safeMode, unattended, dryRun, skipHealthCheck } = input;
  
  progress.report('Starting Phase 3: Service Startup');
  progress.onProgress(0);

  const result: Phase3Output = {
    servicesStarted: [],
    migrationsRun: false,
    healthCheckPassed: false,
  };

  try {
    // Check for phase script
    const scriptPath = await findPhaseScript('phase3');
    if (!scriptPath) {
      // Fall back to built-in logic
      return await runBuiltinPhase3(input, progress);
    }

    progress.onProgress(10);
    progress.report(`Executing phase script: ${scriptPath}`);

    if (dryRun) {
      progress.report('[DRY RUN] Would execute phase script');
      progress.onProgress(100);
      return {
        success: true,
        data: result,
      };
    }

    // Execute phase script
    const exitCode = await executePhaseScript(scriptPath, {
      HESTIA_TARGET: targetDir,
      HESTIA_SAFE_MODE: safeMode ? '1' : '0',
      HESTIA_UNATTENDED: unattended ? '1' : '0',
    }, progress);

    if (exitCode !== 0) {
      return {
        success: false,
        error: `Phase 3 failed with exit code ${exitCode}`,
      };
    }

    // Run health check if not skipped
    if (!skipHealthCheck && !dryRun) {
      progress.report('Running health checks...');
      progress.onProgress(90);
      
      const healthResult = await runHealthCheck(targetDir, progress);
      result.healthCheckPassed = healthResult;
      
      if (!healthResult) {
        return {
          success: false,
          error: 'Health check failed. Services may not have started correctly.',
        };
      }
    }

    progress.onProgress(100);
    progress.report('Phase 3 complete');

    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Phase 3 failed',
    };
  }
}

/**
 * Built-in phase 3 implementation (when script not available)
 */
async function runBuiltinPhase3(
  input: Phase3Input,
  progress: ProgressReporter
): Promise<OperationResult<Phase3Output>> {
  const { targetDir, dryRun, skipHealthCheck } = input;
  
  const result: Phase3Output = {
    servicesStarted: [],
    migrationsRun: false,
    healthCheckPassed: false,
  };

  progress.report('Starting Docker services...');
  progress.onProgress(20);

  if (!dryRun) {
    // Start core services
    const composeFile = `${targetDir}/docker-compose.yml`;
    try {
      await access(composeFile, constants.R_OK);
      
      await runCommand('docker', ['compose', '-f', composeFile, 'up', '-d'], {
        cwd: targetDir,
      });
      
      result.servicesStarted.push('postgres', 'redis');
    } catch {
      // Compose file doesn't exist, skip
      progress.report('No Docker compose file found, skipping container startup');
    }
  }

  progress.onProgress(50);
  progress.report('Running database migrations...');

  if (!dryRun) {
    // Wait for database to be ready
    await waitForService('localhost', 5432, 30000);
    
    // Run migrations (if migration script exists)
    try {
      await runCommand('npm', ['run', 'db:migrate'], { cwd: targetDir });
      result.migrationsRun = true;
    } catch {
      progress.report('No migrations to run or migration script not found');
    }
  }

  progress.onProgress(75);
  progress.report('Starting Hestia services...');

  if (!dryRun) {
    // Start Hestia service
    try {
      await runCommand('systemctl', ['start', 'hestia']);
      result.servicesStarted.push('hestia');
    } catch {
      // Try direct start
      await runCommand(`${targetDir}/bin/hestia`, ['ignite'], { 
        cwd: targetDir,
        detached: true,
      });
      result.servicesStarted.push('hestia');
    }
  }

  // Run health check if not skipped
  if (!skipHealthCheck && !dryRun) {
    progress.report('Running health checks...');
    progress.onProgress(90);
    
    // Wait for API to be ready
    await waitForHttp('http://localhost:4000/health', 60000);
    
    const healthResult = await checkHealth('http://localhost:4000/health');
    result.healthCheckPassed = healthResult;
  }

  progress.onProgress(100);
  progress.report('Phase 3 preparations complete');

  return {
    success: true,
    data: result,
  };
}

/**
 * Find phase script in various locations
 */
async function findPhaseScript(phase: string): Promise<string | null> {
  const paths = [
    `/opt/hestia/install/phases/${phase}.sh`,
    `./packages/install/src/phases/${phase}.sh`,
    `${process.env.HOME}/.hestia/install/${phase}.sh`,
    `./install/${phase}.sh`,
  ];

  for (const p of paths) {
    try {
      await access(p, constants.X_OK);
      return p;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Execute a phase script with proper environment
 */
function executePhaseScript(
  scriptPath: string,
  env: Record<string, string>,
  progress: ProgressReporter
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });

    let output = '';
    
    child.stdout?.on('data', (data) => {
      output += data.toString();
      const match = output.match(/Progress:\s*(\d+)%/);
      if (match) {
        const percent = parseInt(match[1], 10);
        progress.onProgress(10 + Math.round(percent * 0.8));
      }
    });

    child.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) progress.report(msg);
    });

    child.on('close', (code) => {
      resolve(code ?? 1);
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Run a shell command
 */
function runCommand(
  cmd: string,
  args: string[],
  options: { cwd?: string; detached?: boolean } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'ignore',
      cwd: options.cwd,
      detached: options.detached,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Wait for a TCP service to be available
 */
function waitForService(host: string, port: number, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const socket = new (require('net').Socket)();
      socket.setTimeout(1000);
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start > timeout) {
          resolve(); // Don't fail, just continue
        } else {
          setTimeout(check, 1000);
        }
      });
      socket.connect(port, host);
    };
    check();
  });
}

/**
 * Wait for an HTTP endpoint to be available
 */
function waitForHttp(url: string, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) {
          resolve();
          return;
        }
      } catch {
        // Retry
      }
      
      if (Date.now() - start > timeout) {
        resolve();
      } else {
        setTimeout(check, 2000);
      }
    };
    check();
  });
}

/**
 * Check health endpoint
 */
async function checkHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Run health check against target directory
 */
async function runHealthCheck(
  targetDir: string,
  progress: ProgressReporter
): Promise<boolean> {
  try {
    // Check if API is responding
    const apiHealthy = await checkHealth('http://localhost:4000/health');
    if (apiHealthy) {
      progress.report('API health check passed');
    } else {
      progress.report('API health check failed');
    }
    return apiHealthy;
  } catch {
    return false;
  }
}
