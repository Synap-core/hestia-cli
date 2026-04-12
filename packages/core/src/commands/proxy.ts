#!/usr/bin/env node
// @ts-nocheck
/**
 * proxy command - Manage reverse proxy (Nginx or Traefik)
 * Usage: hestia proxy <command>
 */

import { Command } from 'commander';
import { execa, execaCommandSync } from 'execa';
import { logger } from '../lib/logger.js';
import { spinner, withSpinner } from '../lib/spinner.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';

type ProxyType = 'nginx' | 'traefik';

interface ProxyStatus {
  type: ProxyType | null;
  running: boolean;
  containerName: string | null;
  dashboardUrl?: string;
  version?: string;
  uptime?: string;
}

interface ProxyOptions {
  json?: boolean;
  follow?: boolean;
}

// Get Hestia home directory
function getHestiaHome(): string {
  return process.env.HESTIA_HOME || '/opt/hestia';
}

// Detect current reverse proxy
function detectCurrentProxy(): ProxyType | null {
  // Check environment variable
  const envProxy = process.env.HESTIA_REVERSE_PROXY;
  if (envProxy === 'nginx' || envProxy === 'traefik') {
    return envProxy;
  }

  // Check running containers
  try {
    const { stdout } = execaCommandSync('docker ps --format "{{.Names}}"', { reject: false });
    if (stdout.includes('hestia-traefik')) return 'traefik';
    if (stdout.includes('hestia-nginx')) return 'nginx';
  } catch {
    // Ignore errors
  }

  // Check config file
  try {
    const envFile = path.join(getHestiaHome(), 'config', '.env');
    const content = fs.readFileSync(envFile, 'utf-8');
    const match = content.match(/HESTIA_REVERSE_PROXY=(\w+)/);
    if (match) {
      const proxy = match[1];
      if (proxy === 'nginx' || proxy === 'traefik') return proxy;
    }
  } catch {
    // Ignore errors
  }

  return null;
}

// Get proxy status
async function getProxyStatus(): Promise<ProxyStatus> {
  const type = detectCurrentProxy();
  
  if (!type) {
    return { type: null, running: false, containerName: null };
  }

  const containerName = type === 'traefik' ? 'hestia-traefik' : 'hestia-nginx';
  
  try {
    const { stdout } = await execa(
      'docker', 
      ['ps', '--filter', `name=${containerName}`, '--format', '{{.Status}}|{{.Image}}'],
      { reject: false }
    );
    
    if (stdout) {
      const [statusStr, image] = stdout.split('|');
      const uptime = statusStr.replace('Up ', '').trim();
      const version = image.split(':')[1] || 'latest';
      
      return {
        type,
        running: true,
        containerName,
        dashboardUrl: type === 'traefik' ? 'http://localhost:8080' : undefined,
        version,
        uptime,
      };
    }
  } catch {
    // Container not running
  }

  return { type, running: false, containerName };
}

// Show proxy status
async function showProxyStatus(options: ProxyOptions): Promise<void> {
  const status = await withSpinner(
    'Checking proxy status...',
    () => getProxyStatus(),
    'Status checked'
  );

  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  logger.header('REVERSE PROXY STATUS');
  
  if (!status.type) {
    logger.warn('No reverse proxy detected');
    logger.info('Run "hestia proxy switch <nginx|traefik>" to configure a proxy');
    return;
  }

  const typeLabel = status.type === 'traefik' 
    ? chalk.cyan('Traefik') 
    : chalk.blue('Nginx');
  
  logger.info(`Type: ${typeLabel}`);
  logger.info(`Status: ${status.running ? chalk.green('● Running') : chalk.red('● Stopped')}`);
  
  if (status.containerName) {
    logger.info(`Container: ${chalk.gray(status.containerName)}`);
  }
  
  if (status.version) {
    logger.info(`Version: ${chalk.gray(status.version)}`);
  }
  
  if (status.uptime) {
    logger.info(`Uptime: ${chalk.gray(status.uptime)}`);
  }

  if (status.dashboardUrl) {
    logger.newline();
    logger.info(`Dashboard: ${chalk.cyan(status.dashboardUrl)}`);
    logger.info(`Run "hestia proxy dashboard" to open`);
  }

  // Show services
  logger.newline();
  logger.section('Services');
  
  const services = [
    { name: 'Synap Backend', url: 'http://localhost:4000', path: '/api' },
    { name: 'OpenClaw Gateway', url: 'http://localhost:8080', path: '/gateway' },
    { name: 'PostgreSQL', url: 'localhost:5432', internal: true },
    { name: 'Redis', url: 'localhost:6379', internal: true },
    { name: 'Typesense', url: 'http://localhost:8108', internal: true },
  ];

  for (const svc of services) {
    const icon = svc.internal ? chalk.gray('•') : chalk.green('●');
    const label = svc.internal ? chalk.gray(svc.name) : chalk.white(svc.name);
    logger.info(`${icon} ${label}: ${chalk.cyan(svc.url)}`);
  }
}

// Switch between proxies
async function switchProxy(newType: ProxyType): Promise<void> {
  const currentStatus = await getProxyStatus();
  
  if (currentStatus.type === newType) {
    logger.warn(`${newType} is already the current reverse proxy`);
    return;
  }

  logger.info(`Switching from ${currentStatus.type || 'none'} to ${newType}...`);

  await withSpinner(
    `Configuring ${newType}...`,
    async () => {
      const hestiaHome = getHestiaHome();

      // Stop current proxy if running
      if (currentStatus.running && currentStatus.containerName) {
        try {
          await execa('docker', ['stop', currentStatus.containerName], { reject: false });
          await execa('docker', ['rm', currentStatus.containerName], { reject: false });
        } catch {
          // Ignore errors
        }
      }

      // Update environment file
      const envFile = path.join(hestiaHome, 'config', '.env');
      try {
        let envContent = await fs.readFile(envFile, 'utf-8').catch(() => '');
        
        // Remove old proxy setting
        envContent = envContent.replace(/^HESTIA_REVERSE_PROXY=.*$/gm, '');
        
        // Add new setting
        envContent += `\nHESTIA_REVERSE_PROXY=${newType}\n`;
        
        await fs.writeFile(envFile, envContent, 'utf-8');
      } catch (error) {
        logger.warn(`Could not update environment file: ${error}`);
      }

      // Run phase2 to configure new proxy
      const installScript = path.join(hestiaHome, 'install', 'src', 'phases', 'phase2.sh');
      if (await fileExists(installScript)) {
        await execa('sudo', ['HESTIA_REVERSE_PROXY=' + newType, installScript], {
          cwd: hestiaHome,
          reject: false,
        });
      } else {
        throw new Error(`Install script not found: ${installScript}`);
      }
    },
    `Switched to ${newType}`
  );

  logger.success(`Successfully switched to ${chalk.cyan(newType)}`);
  logger.newline();
  
  if (newType === 'traefik') {
    logger.info(`Traefik dashboard: ${chalk.cyan('http://localhost:8080')}`);
    logger.info(`Run "hestia proxy dashboard" to open it`);
  }
}

// Show proxy logs
async function showProxyLogs(options: ProxyOptions): Promise<void> {
  const status = await getProxyStatus();
  
  if (!status.type || !status.containerName) {
    logger.error('No reverse proxy is running');
    process.exit(1);
  }

  const args = ['logs', status.containerName];
  if (options.follow) {
    args.push('-f');
  } else {
    args.push('--tail', '100');
  }
  
  if (options.json) {
    const { stdout } = await execa('docker', args, { reject: false });
    console.log(stdout);
    return;
  }

  logger.header(`${status.type.toUpperCase()} LOGS`);
  
  if (options.follow) {
    logger.info('Following logs (press Ctrl+C to exit)...');
    logger.newline();
  }

  // Stream logs
  const subprocess = execa('docker', args, {
    stdio: 'inherit',
    reject: false,
  });

  await subprocess;
}

// Open Traefik dashboard
async function openDashboard(): Promise<void> {
  const status = await getProxyStatus();
  
  if (status.type !== 'traefik') {
    logger.error('Dashboard is only available for Traefik proxy');
    logger.info(`Current proxy: ${status.type || 'none'}`);
    logger.info('Run "hestia proxy switch traefik" to use Traefik');
    process.exit(1);
  }

  if (!status.running) {
    logger.error('Traefik is not running');
    process.exit(1);
  }

  const dashboardUrl = 'http://localhost:8080';
  
  logger.info(`Opening Traefik dashboard at ${chalk.cyan(dashboardUrl)}...`);
  
  try {
    // Try to open browser using platform-specific command
    const platform = process.platform;
    let command: string[];
    
    switch (platform) {
      case 'darwin':
        command = ['open', dashboardUrl];
        break;
      case 'win32':
        command = ['start', dashboardUrl];
        break;
      default:
        command = ['xdg-open', dashboardUrl];
        break;
    }
    
    await execa(command[0], command.slice(1), { reject: false });
    logger.success('Dashboard opened in browser');
  } catch (error) {
    logger.warn(`Could not open browser automatically`);
    logger.info(`Please open manually: ${chalk.cyan(dashboardUrl)}`);
  }
}

// Restart proxy
async function restartProxy(): Promise<void> {
  const status = await getProxyStatus();
  
  if (!status.type || !status.containerName) {
    logger.error('No reverse proxy configured');
    process.exit(1);
  }

  await withSpinner(
    `Restarting ${status.type}...`,
    async () => {
      await execa('docker', ['restart', status.containerName!], { reject: false });
      // Wait for container to be healthy
      await new Promise(resolve => setTimeout(resolve, 3000));
    },
    `${status.type} restarted`
  );

  const newStatus = await getProxyStatus();
  if (newStatus.running) {
    logger.success(`${chalk.cyan(status.type)} is now running`);
  } else {
    logger.error(`${status.type} failed to start`);
  }
}

// Configure proxy settings
async function configureProxy(): Promise<void> {
  logger.header('REVERSE PROXY CONFIGURATION');
  logger.info('Current configuration:');
  
  const status = await getProxyStatus();
  
  if (status.type) {
    logger.info(`  Type: ${chalk.cyan(status.type)}`);
    logger.info(`  Status: ${status.running ? chalk.green('Running') : chalk.red('Stopped')}`);
  } else {
    logger.info(`  Type: ${chalk.gray('Not configured')}`);
  }

  logger.newline();
  logger.info('Available commands:');
  logger.info(`  ${chalk.cyan('hestia proxy switch nginx')}   - Use Nginx (traditional)`);
  logger.info(`  ${chalk.cyan('hestia proxy switch traefik')}  - Use Traefik (modern, dynamic)`);
  logger.info(`  ${chalk.cyan('hestia proxy restart')}          - Restart current proxy`);
}

// Helper: Check if file exists
async function fileExists(filepath: string): Promise<boolean> {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

// Main command export
export function proxyCommand(program: Command): void {
  const proxyCmd = program
    .command('proxy')
    .description('Manage reverse proxy (Nginx or Traefik)')
    .action(() => {
      configureProxy();
    });

  // Status subcommand
  proxyCmd
    .command('status')
    .description('Show reverse proxy status')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: ProxyOptions) => {
      try {
        await showProxyStatus(options);
      } catch (error: any) {
        logger.error(`Failed to get proxy status: ${error.message}`);
        process.exit(1);
      }
    });

  // Switch subcommand
  proxyCmd
    .command('switch <type>')
    .description('Switch between nginx and traefik')
    .action(async (type: string) => {
      try {
        if (type !== 'nginx' && type !== 'traefik') {
          logger.error(`Invalid proxy type: ${type}`);
          logger.info('Valid options: nginx, traefik');
          process.exit(1);
        }
        await switchProxy(type as ProxyType);
      } catch (error: any) {
        logger.error(`Failed to switch proxy: ${error.message}`);
        process.exit(1);
      }
    });

  // Logs subcommand
  proxyCmd
    .command('logs')
    .description('Show reverse proxy logs')
    .option('-j, --json', 'Output raw logs')
    .option('-f, --follow', 'Follow log output')
    .action(async (options: ProxyOptions) => {
      try {
        await showProxyLogs(options);
      } catch (error: any) {
        logger.error(`Failed to show logs: ${error.message}`);
        process.exit(1);
      }
    });

  // Dashboard subcommand (Traefik only)
  proxyCmd
    .command('dashboard')
    .description('Open Traefik dashboard (Traefik only)')
    .action(async () => {
      try {
        await openDashboard();
      } catch (error: any) {
        logger.error(`Failed to open dashboard: ${error.message}`);
        process.exit(1);
      }
    });

  // Restart subcommand
  proxyCmd
    .command('restart')
    .description('Restart the reverse proxy')
    .action(async () => {
      try {
        await restartProxy();
      } catch (error: any) {
        logger.error(`Failed to restart proxy: ${error.message}`);
        process.exit(1);
      }
    });
}
