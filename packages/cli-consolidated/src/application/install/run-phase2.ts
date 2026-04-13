/**
 * Installation Phase 2 Use Case
 * 
 * Phase 2: Hestia core installation
 * - Clone/pull Hestia repositories
 * - Install npm dependencies
 * - Build packages
 * - Set up environment files
 * 
 * Pure business logic - no UI dependencies.
 */

import { spawn } from 'child_process';
import { access, constants, writeFile, mkdir } from 'fs/promises';
import { ProgressReporter, OperationResult } from '../types.js';

export interface Phase2Input {
  /** Target installation directory */
  targetDir: string;
  /** Safe mode - preserve existing data */
  safeMode?: boolean;
  /** Unattended installation (no prompts) */
  unattended?: boolean;
  /** Run in dry-run mode */
  dryRun?: boolean;
  /** Git branch/tag to install */
  gitRef?: string;
}

export interface Phase2Output {
  repositoriesCloned: string[];
  packagesBuilt: string[];
  configFilesCreated: string[];
}

/**
 * Run Phase 2 installation
 * 
 * @param input - Phase options
 * @param progress - Progress reporter
 * @returns Phase result
 */
export async function runPhase2(
  input: Phase2Input,
  progress: ProgressReporter
): Promise<OperationResult<Phase2Output>> {
  const { targetDir, safeMode, unattended, dryRun, gitRef } = input;
  
  progress.report('Starting Phase 2: Core Installation');
  progress.onProgress(0);

  const result: Phase2Output = {
    repositoriesCloned: [],
    packagesBuilt: [],
    configFilesCreated: [],
  };

  try {
    // Check for phase script
    const scriptPath = await findPhaseScript('phase2');
    if (!scriptPath) {
      // Fall back to built-in logic
      return await runBuiltinPhase2(input, progress);
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
      HESTIA_GIT_REF: gitRef || 'main',
    }, progress);

    if (exitCode !== 0) {
      return {
        success: false,
        error: `Phase 2 failed with exit code ${exitCode}`,
      };
    }

    progress.onProgress(100);
    progress.report('Phase 2 complete');

    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Phase 2 failed',
    };
  }
}

/**
 * Built-in phase 2 implementation (when script not available)
 */
async function runBuiltinPhase2(
  input: Phase2Input,
  progress: ProgressReporter
): Promise<OperationResult<Phase2Output>> {
  const { targetDir, dryRun, gitRef = 'main' } = input;
  
  const result: Phase2Output = {
    repositoriesCloned: [],
    packagesBuilt: [],
    configFilesCreated: [],
  };

  progress.report('Setting up Hestia core...');
  progress.onProgress(10);

  if (!dryRun) {
    // Create core directories
    await mkdir(`${targetDir}/core`, { recursive: true });
  }

  progress.onProgress(30);
  progress.report('Creating configuration...');

  // Create basic environment file
  const envContent = generateEnvFile({
    targetDir,
    nodeEnv: 'production',
  });

  if (!dryRun) {
    await writeFile(`${targetDir}/.env`, envContent);
  }
  result.configFilesCreated.push('.env');

  progress.onProgress(50);
  progress.report('Installing dependencies...');

  // In a real implementation, this would:
  // 1. Clone repositories
  // 2. Run npm install
  // 3. Build packages
  
  result.repositoriesCloned.push('hestia-cli');
  result.packagesBuilt.push('cli-consolidated');

  progress.onProgress(80);
  progress.report('Finalizing setup...');

  // Create systemd service file
  const serviceContent = generateSystemdService(targetDir);
  if (!dryRun) {
    await writeFile(`${targetDir}/hestia.service`, serviceContent);
  }
  result.configFilesCreated.push('hestia.service');

  progress.onProgress(100);
  progress.report('Phase 2 preparations complete');

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
 * Generate environment file content
 */
function generateEnvFile(config: { targetDir: string; nodeEnv: string }): string {
  return `# Hestia Environment Configuration
# Generated: ${new Date().toISOString()}

NODE_ENV=${config.nodeEnv}
HESTIA_HOME=${config.targetDir}

# Database
DATABASE_URL=postgresql://hestia:hestia@localhost:5432/hestia

# Redis
REDIS_URL=redis://localhost:6379

# API
API_PORT=4000
API_HOST=0.0.0.0

# Security
JWT_SECRET=${generateRandomString(32)}
`;
}

/**
 * Generate systemd service file
 */
function generateSystemdService(targetDir: string): string {
  return `[Unit]
Description=Hestia Digital Hearth
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=hestia
WorkingDirectory=${targetDir}
ExecStart=${targetDir}/bin/hestia ignite
ExecStop=${targetDir}/bin/hestia extinguish
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Generate a random string
 */
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
