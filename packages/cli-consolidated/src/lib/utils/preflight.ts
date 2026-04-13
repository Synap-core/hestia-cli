/**
 * Pre-flight Check System
 * Validates all prerequisites before command execution
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { access, constants } from 'fs/promises';
import { logger } from './logger.js';
import { getConfigValue, loadConfig, configExists } from './config.js';
import { getCredential } from './credentials.js';

const execAsync = promisify(exec);

export interface PreFlightRequirements {
  /** Check if Docker is installed and running */
  docker?: boolean;
  /** List of required credential keys */
  credentials?: string[];
  /** Check if valid config exists */
  config?: boolean;
  /** List of required ports */
  ports?: number[];
  /** Check if connected to internet */
  internet?: boolean;
  /** List of required commands */
  commands?: string[];
  /** Check write permissions to config directory */
  writeAccess?: boolean;
}

export interface PreFlightResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checks: {
    docker?: { ok: boolean; message: string };
    credentials?: Record<string, { ok: boolean; message: string }>;
    config?: { ok: boolean; message: string };
    ports?: Record<number, { ok: boolean; message: string }>;
    internet?: { ok: boolean; message: string };
    commands?: Record<string, { ok: boolean; message: string }>;
    writeAccess?: { ok: boolean; message: string };
  };
}

/**
 * Run comprehensive pre-flight checks before command execution
 */
export async function preFlightCheck(requirements: PreFlightRequirements): Promise<PreFlightResult> {
  const result: PreFlightResult = {
    ok: true,
    errors: [],
    warnings: [],
    checks: {}
  };

  logger.debug('Running pre-flight checks...', requirements);

  // Check Docker
  if (requirements.docker) {
    const dockerCheck = await checkDocker();
    result.checks.docker = dockerCheck;
    if (!dockerCheck.ok) {
      result.ok = false;
      result.errors.push(dockerCheck.message);
    }
  }

  // Check credentials
  if (requirements.credentials && requirements.credentials.length > 0) {
    result.checks.credentials = {};
    for (const key of requirements.credentials) {
      const credCheck = await checkCredential(key);
      result.checks.credentials[key] = credCheck;
      if (!credCheck.ok) {
        result.ok = false;
        result.errors.push(credCheck.message);
      }
    }
  }

  // Check config
  if (requirements.config) {
    const configCheck = await checkConfig();
    result.checks.config = configCheck;
    if (!configCheck.ok) {
      result.ok = false;
      result.errors.push(configCheck.message);
    }
  }

  // Check ports
  if (requirements.ports && requirements.ports.length > 0) {
    result.checks.ports = {};
    for (const port of requirements.ports) {
      const portCheck = await checkPort(port);
      result.checks.ports[port] = portCheck;
      if (!portCheck.ok) {
        result.warnings.push(portCheck.message);
        // Don't fail for port warnings, just warn
      }
    }
  }

  // Check internet
  if (requirements.internet) {
    const internetCheck = await checkInternet();
    result.checks.internet = internetCheck;
    if (!internetCheck.ok) {
      result.warnings.push(internetCheck.message);
    }
  }

  // Check commands
  if (requirements.commands && requirements.commands.length > 0) {
    result.checks.commands = {};
    for (const cmd of requirements.commands) {
      const cmdCheck = await checkCommand(cmd);
      result.checks.commands[cmd] = cmdCheck;
      if (!cmdCheck.ok) {
        result.ok = false;
        result.errors.push(cmdCheck.message);
      }
    }
  }

  // Check write access
  if (requirements.writeAccess) {
    const writeCheck = await checkWriteAccess();
    result.checks.writeAccess = writeCheck;
    if (!writeCheck.ok) {
      result.ok = false;
      result.errors.push(writeCheck.message);
    }
  }

  logger.debug('Pre-flight checks complete', { ok: result.ok, errors: result.errors.length });
  return result;
}

async function checkDocker(): Promise<{ ok: boolean; message: string }> {
  try {
    // Check if docker command exists
    await execAsync('docker --version');
    
    // Check if docker daemon is running
    await execAsync('docker info');
    
    return { ok: true, message: 'Docker is installed and running' };
  } catch (error: any) {
    if (error.message?.includes('Cannot connect to the Docker daemon')) {
      return { 
        ok: false, 
        message: 'Docker daemon is not running. Start it with: sudo systemctl start docker' 
      };
    }
    return { 
      ok: false, 
      message: 'Docker is not installed. Install from https://docs.docker.com/get-docker/' 
    };
  }
}

async function checkCredential(key: string): Promise<{ ok: boolean; message: string }> {
  try {
    const value = await getCredential(key);
    if (!value || value.trim() === '') {
      return { 
        ok: false, 
        message: `Missing credential: ${key}. Set it with: hestia config set credentials.${key} <value>` 
      };
    }
    return { ok: true, message: `Credential ${key} is set` };
  } catch (error: any) {
    return { ok: false, message: `Error checking credential ${key}: ${error.message}` };
  }
}

async function checkConfig(): Promise<{ ok: boolean; message: string }> {
  try {
    const exists = await configExists();
    if (!exists) {
      return { 
        ok: false, 
        message: 'Hestia is not initialized. Run: hestia init' 
      };
    }
    
    const config = await loadConfig();
    if (!config.hearth?.id) {
      return { 
        ok: false, 
        message: 'Invalid configuration: missing hearth ID. Re-run: hestia init' 
      };
    }
    
    return { ok: true, message: 'Configuration is valid' };
  } catch (error: any) {
    return { ok: false, message: `Error checking config: ${error.message}` };
  }
}

async function checkPort(port: number): Promise<{ ok: boolean; message: string }> {
  try {
    // Try to check if port is in use
    const { stdout } = await execAsync(`lsof -i :${port} 2>/dev/null || netstat -tuln 2>/dev/null | grep :${port} || ss -tuln 2>/dev/null | grep :${port}`);
    
    if (stdout && stdout.includes(port.toString())) {
      return { 
        ok: false, 
        message: `Port ${port} is already in use` 
      };
    }
    
    return { ok: true, message: `Port ${port} is available` };
  } catch {
    // If command fails, assume port is available
    return { ok: true, message: `Port ${port} appears available` };
  }
}

async function checkInternet(): Promise<{ ok: boolean; message: string }> {
  try {
    // Try multiple methods
    try {
      await execAsync('ping -c 1 8.8.8.8');
      return { ok: true, message: 'Internet connection available' };
    } catch {
      try {
        await execAsync('curl -s https://cloudflare.com > /dev/null');
        return { ok: true, message: 'Internet connection available' };
      } catch {
        return { 
          ok: false, 
          message: 'No internet connection detected. Some features may not work.' 
        };
      }
    }
  } catch (error: any) {
    return { ok: false, message: `Error checking internet: ${error.message}` };
  }
}

async function checkCommand(command: string): Promise<{ ok: boolean; message: string }> {
  try {
    await execAsync(`which ${command}`);
    return { ok: true, message: `Command ${command} is available` };
  } catch {
    return { 
      ok: false, 
      message: `Required command not found: ${command}. Please install it.` 
    };
  }
}

async function checkWriteAccess(): Promise<{ ok: boolean; message: string }> {
  try {
    const config = await getConfigValue();
    const configDir = config._configDir || `${process.env.HOME}/.hestia`;
    
    // Try to write a test file
    const testFile = `${configDir}/.write_test_${Date.now()}`;
    await execAsync(`touch ${testFile} && rm ${testFile}`);
    
    return { ok: true, message: 'Write access to config directory confirmed' };
  } catch (error: any) {
    return { 
      ok: false, 
      message: `No write access to config directory. Check permissions: ${error.message}` 
    };
  }
}

/**
 * Quick check for common requirements
 */
export async function quickCheck(): Promise<PreFlightResult> {
  return preFlightCheck({
    docker: true,
    config: true,
    writeAccess: true
  });
}

/**
 * Check for API operations
 */
export async function apiCheck(): Promise<PreFlightResult> {
  return preFlightCheck({
    config: true,
    credentials: ['apiKey'],
    internet: true,
    writeAccess: true
  });
}
