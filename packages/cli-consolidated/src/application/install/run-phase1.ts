/**
 * Installation Phase 1 Use Case
 * 
 * Phase 1: System preparation and dependency installation
 * - Install system dependencies (Docker, Node.js, PostgreSQL, Redis)
 * - Create system user and directories
 * - Set up basic firewall rules
 * 
 * Pure business logic - no UI dependencies.
 */

import { spawn } from 'child_process';
import { access, constants, mkdir } from 'fs/promises';
import { ProgressReporter, OperationResult } from '../types.js';

export interface Phase1Input {
  /** Target installation directory */
  targetDir: string;
  /** Safe mode - preserve existing data */
  safeMode?: boolean;
  /** Unattended installation (no prompts) */
  unattended?: boolean;
  /** Run in dry-run mode */
  dryRun?: boolean;
}

export interface Phase1Output {
  directoriesCreated: string[];
  dependenciesInstalled: string[];
}

/**
 * Run Phase 1 installation
 * 
 * @param input - Phase options
 * @param progress - Progress reporter
 * @returns Phase result
 */
export async function runPhase1(
  input: Phase1Input,
  progress: ProgressReporter
): Promise<OperationResult<Phase1Output>> {
  const { targetDir, safeMode, unattended, dryRun } = input;
  
  progress.report('Starting Phase 1: System Preparation');
  progress.onProgress(0);

  const result: Phase1Output = {
    directoriesCreated: [],
    dependenciesInstalled: [],
  };

  try {
    // Check for phase script
    const scriptPath = await findPhaseScript('phase1');
    if (!scriptPath) {
      // Fall back to built-in logic
      return await runBuiltinPhase1(input, progress);
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
        error: `Phase 1 failed with exit code ${exitCode}`,
      };
    }

    progress.onProgress(100);
    progress.report('Phase 1 complete');

    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Phase 1 failed',
    };
  }
}

/**
 * Built-in phase 1 implementation (when script not available)
 */
async function runBuiltinPhase1(
  input: Phase1Input,
  progress: ProgressReporter
): Promise<OperationResult<Phase1Output>> {
  const { targetDir, dryRun } = input;
  
  const result: Phase1Output = {
    directoriesCreated: [],
    dependenciesInstalled: [],
  };

  progress.report('Creating directories...');
  progress.onProgress(20);

  const dirs = [targetDir, `${targetDir}/logs`, `${targetDir}/data`, `${targetDir}/config`];
  
  for (const dir of dirs) {
    if (!dryRun) {
      await mkdir(dir, { recursive: true });
    }
    result.directoriesCreated.push(dir);
  }

  progress.onProgress(40);
  progress.report('Checking Docker...');

  // Check Docker availability
  const dockerAvailable = await checkCommand('docker');
  if (!dockerAvailable) {
    return {
      success: false,
      error: 'Docker is required but not installed. Please install Docker first.',
    };
  }
  result.dependenciesInstalled.push('docker');

  progress.onProgress(60);
  progress.report('Checking Node.js...');

  // Check Node.js
  const nodeAvailable = await checkCommand('node');
  if (!nodeAvailable) {
    return {
      success: false,
      error: 'Node.js is required but not installed. Please install Node.js first.',
    };
  }
  result.dependenciesInstalled.push('node');

  progress.onProgress(80);
  progress.report('Phase 1 preparations complete');
  progress.onProgress(100);

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
      // Parse progress from output if available
      const match = output.match(/Progress:\s*(\d+)%/);
      if (match) {
        const percent = parseInt(match[1], 10);
        progress.onProgress(10 + Math.round(percent * 0.8));
      }
    });

    child.stderr?.on('data', (data) => {
      // Log stderr but don't fail
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
 * Check if a command is available
 */
async function checkCommand(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('which', [cmd], { stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}
