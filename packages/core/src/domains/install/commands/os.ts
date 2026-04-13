#!/usr/bin/env node
// @ts-nocheck
/**
 * os command - Operating System Management
 * Usage: hestia os [subcommand]
 *
 * Manages the operating system for Hestia nodes including:
 * - System information and status
 * - Package management
 * - Service management
 * - User management
 * - Network configuration
 * - Firewall management
 * - Disk management
 * - Kernel parameters (sysctl)
 * - System backup and restore
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import { osManager, OSManager } from '../../../domains/install/lib/os-manager.js';
import { logger, table } from '../../lib/utils/index';
import { withSpinner } from '../../lib/utils/index';
import chalk from 'chalk';
import { writeFileSync, existsSync, mkdirSync } from 'fs';

// Helper type for command options
interface OSOptions {
  json?: boolean;
  verbose?: boolean;
  force?: boolean;
  interactive?: boolean;
}

interface PackageOptions extends OSOptions {
  global?: boolean;
}

interface ServiceOptions extends OSOptions {
  now?: boolean;
}

interface DiskOptions extends OSOptions {
  filesystem?: string;
}

interface FirewallOptions extends OSOptions {
  from?: string;
}

interface BackupOptions extends OSOptions {
  path?: string;
}

interface RestoreOptions extends OSOptions {
  backup?: string;
}

export function osCommand(program: Command): void {
  const osCmd = program
    .command('os')
    .description('Manage the operating system')
    .configureHelp({
      subcommandTerm: (cmd) => `${cmd.name()}`,
      subcommandDescription: (cmd) => cmd.description(),
    });

  // ========================================================================
  // os (default) - Show OS info
  // ========================================================================
  osCmd
    .command('status')
    .alias('info')
    .description('Show operating system information (default)')
    .option('-j, --json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed information')
    .action(async (options: OSOptions) => {
      try {
        const osInfo = osManager.getOSInfo();
        const services = osManager.listServices();
        const disks = osManager.listDisks();

        // Calculate service statistics
        const runningServices = services.filter(s => s.status === 'running').length;
        const enabledServices = services.filter(s => s.enabled).length;

        // Calculate disk usage
        let totalUsed = 0;
        let totalSize = 0;
        for (const disk of disks) {
          if (disk.usage) {
            totalUsed += disk.usage.used;
            totalSize += disk.usage.total;
          }
        }
        const diskPercent = totalSize > 0 ? Math.round((totalUsed / totalSize) * 100) : 0;

        if (options.json) {
          console.log(JSON.stringify({
            os: osInfo,
            services: {
              total: services.length,
              running: runningServices,
              enabled: enabledServices,
            },
            disk: {
              used: totalUsed,
              total: totalSize,
              percent: diskPercent,
            },
          }, null, 2));
          return;
        }

        // Display OS Info
        logger.header('OPERATING SYSTEM');
        logger.info(`Distribution: ${chalk.cyan(osInfo.distribution)}`);
        logger.info(`Version: ${chalk.cyan(osInfo.version)}`);
        logger.info(`Kernel: ${chalk.cyan(osInfo.kernelVersion)}`);
        logger.info(`Architecture: ${chalk.cyan(osInfo.architecture)}`);
        logger.info(`Hostname: ${chalk.cyan(osInfo.hostname)}`);
        logger.info(`Uptime: ${chalk.cyan(formatUptime(osInfo.uptime))}`);

        if (options.verbose) {
          logger.newline();
          logger.info(`Platform: ${chalk.cyan(osInfo.platform)}`);
          logger.info(`Codename: ${chalk.cyan(osInfo.codename)}`);
          logger.info(`Supported: ${osInfo.supported ? chalk.green('Yes') : chalk.red('No')}`);
        }

        // Display Services Summary
        logger.newline();
        logger.header('SERVICES');
        logger.info(`Total: ${services.length}`);
        logger.success(`Running: ${runningServices}`);
        logger.info(`Enabled: ${enabledServices}`);

        if (options.verbose && services.length > 0) {
          logger.newline();
          const tableData = services.slice(0, 10).map(s => ({
            NAME: s.name,
            STATUS: formatServiceStatus(s.status),
            ENABLED: s.enabled ? chalk.green('Yes') : chalk.gray('No'),
          }));
          table(tableData);
          if (services.length > 10) {
            logger.info(chalk.gray(`... and ${services.length - 10} more`));
          }
        }

        // Display Disk Usage
        logger.newline();
        logger.header('DISK USAGE');
        logger.info(`Total Used: ${chalk.cyan(formatBytes(totalUsed))}`);
        logger.info(`Total Size: ${chalk.cyan(formatBytes(totalSize))}`);
        logger.info(`Usage: ${formatDiskPercent(diskPercent)}`);

        if (options.verbose && disks.length > 0) {
          logger.newline();
          const tableData = disks.map(d => ({
            DEVICE: d.device,
            SIZE: d.size,
            MOUNT: d.mountPoint || '-',
            USAGE: d.usage ? formatDiskPercent(d.usage.percentUsed) : '-',
            TYPE: d.type,
          }));
          table(tableData);
        }
      } catch (error: any) {
        logger.error(`Failed to get OS info: ${error.message}`);
        process.exit(1);
      }
    });

  // ========================================================================
  // os:info - Detailed OS information
  // ========================================================================
  osCmd
    .command('details')
    .alias('detail')
    .description('Show detailed OS information')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: OSOptions) => {
      try {
        const osInfo = osManager.getOSInfo();
        const kernelInfo = osManager.getKernelInfo();
        const bootInfo = osManager.getBootInfo();
        const timezone = osManager.getTimezone();
        const locale = osManager.getLocale();

        if (options.json) {
          console.log(JSON.stringify({
            os: osInfo,
            kernel: kernelInfo,
            boot: bootInfo,
            timezone,
            locale,
          }, null, 2));
          return;
        }

        // OS Information
        logger.header('OS INFORMATION');
        logger.info(`Platform: ${chalk.cyan(osInfo.platform)}`);
        logger.info(`Distribution: ${chalk.cyan(osInfo.distribution)}`);
        logger.info(`Version: ${chalk.cyan(osInfo.version)}`);
        logger.info(`Codename: ${chalk.cyan(osInfo.codename)}`);
        logger.info(`Architecture: ${chalk.cyan(osInfo.architecture)}`);
        logger.info(`Hostname: ${chalk.cyan(osInfo.hostname)}`);

        // Kernel Information
        logger.newline();
        logger.header('KERNEL INFORMATION');
        logger.info(`Version: ${chalk.cyan(kernelInfo.version)}`);
        logger.info(`Build Date: ${chalk.cyan(kernelInfo.buildDate)}`);
        logger.info(`Architecture: ${chalk.cyan(kernelInfo.architecture)}`);
        logger.info(`Loaded Modules: ${chalk.cyan(kernelInfo.modules.length)}`);

        // Boot Information
        logger.newline();
        logger.header('BOOT INFORMATION');
        logger.info(`Boot Time: ${chalk.cyan(bootInfo.bootTime.toISOString())}`);
        logger.info(`Boot Loader: ${chalk.cyan(bootInfo.bootLoader)}`);
        logger.info(`Init System: ${chalk.cyan(bootInfo.initSystem)}`);

        if (bootInfo.bootArgs.length > 0) {
          logger.newline();
          logger.section('Boot Arguments');
          bootInfo.bootArgs.forEach(arg => logger.info(`  ${arg}`));
        }

        if (Object.keys(bootInfo.kernelParams).length > 0) {
          logger.newline();
          logger.section('Kernel Parameters');
          const tableData = Object.entries(bootInfo.kernelParams).map(([key, value]) => ({
            PARAMETER: key,
            VALUE: value,
          }));
          table(tableData);
        }

        // Timezone and Locale
        logger.newline();
        logger.header('LOCALIZATION');
        logger.info(`Timezone: ${chalk.cyan(timezone)}`);
        logger.info(`Locale: ${chalk.cyan(locale)}`);
      } catch (error: any) {
        logger.error(`Failed to get OS details: ${error.message}`);
        process.exit(1);
      }
    });

  // ========================================================================
  // os:packages - Package management
  // ========================================================================
  const packagesCmd = osCmd
    .command('packages')
    .alias('pkg')
    .description('Package management');

  // packages list
  packagesCmd
    .command('list')
    .alias('ls')
    .description('List installed packages')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: OSOptions) => {
      try {
        const packages = await withSpinner(
          'Fetching installed packages...',
          () => osManager.listInstalled(),
          `Found ${osManager.listInstalled().length} packages`
        );

        if (options.json) {
          console.log(JSON.stringify(packages, null, 2));
          return;
        }

        if (packages.length === 0) {
          logger.info('No packages found.');
          return;
        }

        logger.header('INSTALLED PACKAGES');
        const tableData = packages.slice(0, 50).map(p => ({
          NAME: p.name,
          VERSION: p.version,
          DESCRIPTION: p.description?.substring(0, 40) || '-',
        }));
        table(tableData);

        if (packages.length > 50) {
          logger.info(chalk.gray(`... and ${packages.length - 50} more`));
        }

        logger.newline();
        logger.info(`Total: ${packages.length} package${packages.length !== 1 ? 's' : ''}`);
      } catch (error: any) {
        logger.error(`Failed to list packages: ${error.message}`);
        process.exit(1);
      }
    });

  // packages update
  packagesCmd
    .command('update')
    .description('Update package lists')
    .option('-f, --force', 'Force update')
    .action(async (options: OSOptions) => {
      try {
        if (!options.force) {
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: 'Update package lists?',
            default: true,
          }]);
          if (!confirm) {
            logger.info('Cancelled');
            return;
          }
        }

        const success = await withSpinner(
          'Updating package lists...',
          () => osManager.updatePackages(),
          'Package lists updated'
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to update packages: ${error.message}`);
        process.exit(1);
      }
    });

  // packages upgrade
  packagesCmd
    .command('upgrade')
    .description('Upgrade installed packages')
    .option('-f, --force', 'Force upgrade without confirmation')
    .action(async (options: OSOptions) => {
      try {
        if (!options.force) {
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: 'Upgrade all packages? This may take a while.',
            default: false,
          }]);
          if (!confirm) {
            logger.info('Cancelled');
            return;
          }
        }

        const success = await withSpinner(
          'Upgrading packages...',
          () => osManager.upgradePackages(),
          'Packages upgraded'
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to upgrade packages: ${error.message}`);
        process.exit(1);
      }
    });

  // packages install <pkg>
  packagesCmd
    .command('install <package>')
    .alias('add')
    .description('Install a package')
    .option('-g, --global', 'Install globally (system-wide)')
    .action(async (packageName: string, options: PackageOptions) => {
      try {
        const success = await withSpinner(
          `Installing ${packageName}...`,
          () => osManager.installPackage(packageName),
          `Package ${packageName} installed`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to install package: ${error.message}`);
        process.exit(1);
      }
    });

  // packages remove <pkg>
  packagesCmd
    .command('remove <package>')
    .alias('rm')
    .description('Remove a package')
    .option('-f, --force', 'Force removal without confirmation')
    .action(async (packageName: string, options: OSOptions) => {
      try {
        if (!options.force) {
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Remove package ${packageName}?`,
            default: false,
          }]);
          if (!confirm) {
            logger.info('Cancelled');
            return;
          }
        }

        const success = await withSpinner(
          `Removing ${packageName}...`,
          () => osManager.removePackage(packageName),
          `Package ${packageName} removed`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to remove package: ${error.message}`);
        process.exit(1);
      }
    });

  // packages search <pkg>
  packagesCmd
    .command('search <query>')
    .alias('find')
    .description('Search for packages')
    .option('-j, --json', 'Output as JSON')
    .action(async (query: string, options: OSOptions) => {
      try {
        const packages = await withSpinner(
          `Searching for "${query}"...`,
          () => osManager.searchPackage(query),
          `Found packages matching "${query}"`
        );

        if (options.json) {
          console.log(JSON.stringify(packages, null, 2));
          return;
        }

        if (packages.length === 0) {
          logger.info(`No packages found matching "${query}"`);
          return;
        }

        logger.header(`SEARCH RESULTS: ${query}`);
        const tableData = packages.slice(0, 30).map(p => ({
          NAME: p.name,
          DESCRIPTION: p.description?.substring(0, 50) || '-',
        }));
        table(tableData);

        if (packages.length > 30) {
          logger.info(chalk.gray(`... and ${packages.length - 30} more`));
        }
      } catch (error: any) {
        logger.error(`Failed to search packages: ${error.message}`);
        process.exit(1);
      }
    });

  // ========================================================================
  // os:services - Service management
  // ========================================================================
  const servicesCmd = osCmd
    .command('services')
    .alias('svc')
    .description('Service management');

  // services list
  servicesCmd
    .command('list')
    .alias('ls')
    .description('List all services')
    .option('-j, --json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed information')
    .action(async (options: OSOptions) => {
      try {
        const services = osManager.listServices();

        if (options.json) {
          console.log(JSON.stringify(services, null, 2));
          return;
        }

        if (services.length === 0) {
          logger.info('No services found.');
          return;
        }

        logger.header('SYSTEM SERVICES');
        const tableData = services.map(s => ({
          NAME: s.name,
          STATUS: formatServiceStatus(s.status),
          ENABLED: s.enabled ? chalk.green('Yes') : chalk.gray('No'),
          DESCRIPTION: s.description?.substring(0, 30) || '-',
        }));
        table(tableData);

        logger.newline();
        logger.info(`Total: ${services.length} service${services.length !== 1 ? 's' : ''}`);
      } catch (error: any) {
        logger.error(`Failed to list services: ${error.message}`);
        process.exit(1);
      }
    });

  // services start <svc>
  servicesCmd
    .command('start <service>')
    .description('Start a service')
    .action(async (serviceName: string) => {
      try {
        const success = await withSpinner(
          `Starting ${serviceName}...`,
          () => osManager.startService(serviceName),
          `Service ${serviceName} started`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to start service: ${error.message}`);
        process.exit(1);
      }
    });

  // services stop <svc>
  servicesCmd
    .command('stop <service>')
    .description('Stop a service')
    .action(async (serviceName: string) => {
      try {
        const success = await withSpinner(
          `Stopping ${serviceName}...`,
          () => osManager.stopService(serviceName),
          `Service ${serviceName} stopped`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to stop service: ${error.message}`);
        process.exit(1);
      }
    });

  // services restart <svc>
  servicesCmd
    .command('restart <service>')
    .description('Restart a service')
    .action(async (serviceName: string) => {
      try {
        const success = await withSpinner(
          `Restarting ${serviceName}...`,
          () => osManager.restartService(serviceName),
          `Service ${serviceName} restarted`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to restart service: ${error.message}`);
        process.exit(1);
      }
    });

  // services enable <svc>
  servicesCmd
    .command('enable <service>')
    .description('Enable a service (start on boot)')
    .action(async (serviceName: string) => {
      try {
        const success = await withSpinner(
          `Enabling ${serviceName}...`,
          () => osManager.enableService(serviceName),
          `Service ${serviceName} enabled`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to enable service: ${error.message}`);
        process.exit(1);
      }
    });

  // services disable <svc>
  servicesCmd
    .command('disable <service>')
    .description('Disable a service (don\'t start on boot)')
    .action(async (serviceName: string) => {
      try {
        const success = await withSpinner(
          `Disabling ${serviceName}...`,
          () => osManager.disableService(serviceName),
          `Service ${serviceName} disabled`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to disable service: ${error.message}`);
        process.exit(1);
      }
    });

  // services status <svc>
  servicesCmd
    .command('status <service>')
    .description('Show detailed service status')
    .option('-j, --json', 'Output as JSON')
    .action(async (serviceName: string, options: OSOptions) => {
      try {
        const status = osManager.getServiceStatus(serviceName);

        if (!status) {
          logger.error(`Service not found: ${serviceName}`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }

        logger.header(`SERVICE: ${serviceName}`);
        logger.info(`Status: ${formatServiceStatus(status.status)}`);
        logger.info(`Enabled: ${status.enabled ? chalk.green('Yes') : chalk.gray('No')}`);
        logger.info(`Loaded: ${status.loaded ? chalk.green('Yes') : chalk.gray('No')}`);

        if (status.pid) {
          logger.info(`PID: ${chalk.cyan(status.pid)}`);
        }
        if (status.uptime) {
          logger.info(`Uptime: ${chalk.cyan(status.uptime)}`);
        }
        if (status.memoryUsage) {
          logger.info(`Memory: ${chalk.cyan(status.memoryUsage)}`);
        }
        if (status.cpuUsage) {
          logger.info(`CPU: ${chalk.cyan(status.cpuUsage)}`);
        }
        if (status.description) {
          logger.info(`Description: ${chalk.cyan(status.description)}`);
        }
      } catch (error: any) {
        logger.error(`Failed to get service status: ${error.message}`);
        process.exit(1);
      }
    });

  // ========================================================================
  // os:users - User management
  // ========================================================================
  const usersCmd = osCmd
    .command('users')
    .alias('user')
    .description('User management');

  // users list
  usersCmd
    .command('list')
    .alias('ls')
    .description('List system users')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: OSOptions) => {
      try {
        const users = osManager.listUsers();

        if (options.json) {
          console.log(JSON.stringify(users, null, 2));
          return;
        }

        logger.header('SYSTEM USERS');
        const tableData = users.map(u => ({
          USERNAME: u.username,
          UID: u.uid,
          GID: u.gid,
          HOME: u.home,
          SHELL: u.shell,
          SYSTEM: u.isSystemUser ? chalk.gray('Yes') : '-',
        }));
        table(tableData);

        logger.newline();
        logger.info(`Total: ${users.length} user${users.length !== 1 ? 's' : ''}`);
      } catch (error: any) {
        logger.error(`Failed to list users: ${error.message}`);
        process.exit(1);
      }
    });

  // users create <user>
  usersCmd
    .command('create <username>')
    .alias('add')
    .description('Create a new user')
    .option('--home <path>', 'Home directory')
    .option('--shell <shell>', 'Login shell')
    .option('--groups <groups>', 'Comma-separated list of groups')
    .option('--system', 'Create system user')
    .option('--password <password>', 'Set password')
    .action(async (username: string, options: {
      home?: string;
      shell?: string;
      groups?: string;
      system?: boolean;
      password?: string;
    }) => {
      try {
        const userOptions: Parameters<OSManager['createUser']>[1] = {
          home: options.home,
          shell: options.shell,
          system: options.system,
          password: options.password,
          createHome: true,
          groups: options.groups?.split(',').map(g => g.trim()).filter(Boolean),
        };

        const success = await withSpinner(
          `Creating user ${username}...`,
          () => osManager.createUser(username, userOptions),
          `User ${username} created`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to create user: ${error.message}`);
        process.exit(1);
      }
    });

  // users delete <user>
  usersCmd
    .command('delete <username>')
    .alias('rm')
    .description('Delete a user')
    .option('-r, --remove-home', 'Remove home directory')
    .option('-f, --force', 'Force deletion without confirmation')
    .action(async (username: string, options: { removeHome?: boolean; force?: boolean }) => {
      try {
        if (!options.force) {
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Delete user ${username}?`,
            default: false,
          }]);
          if (!confirm) {
            logger.info('Cancelled');
            return;
          }
        }

        const success = await withSpinner(
          `Deleting user ${username}...`,
          () => osManager.deleteUser(username, options.removeHome),
          `User ${username} deleted`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to delete user: ${error.message}`);
        process.exit(1);
      }
    });

  // users addgroup <user> <group>
  usersCmd
    .command('addgroup <username> <group>')
    .alias('addg')
    .description('Add user to group')
    .action(async (username: string, group: string) => {
      try {
        const success = await withSpinner(
          `Adding ${username} to group ${group}...`,
          () => osManager.addToGroup(username, group),
          `User ${username} added to group ${group}`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to add user to group: ${error.message}`);
        process.exit(1);
      }
    });

  // users passwd <user>
  usersCmd
    .command('passwd <username>')
    .description('Set user password')
    .action(async (username: string) => {
      try {
        const { password, confirmPassword } = await inquirer.prompt([
          {
            type: 'password',
            name: 'password',
            message: 'New password:',
            mask: '*',
          },
          {
            type: 'password',
            name: 'confirmPassword',
            message: 'Confirm password:',
            mask: '*',
          },
        ]);

        if (password !== confirmPassword) {
          logger.error('Passwords do not match');
          process.exit(1);
        }

        const success = await withSpinner(
          `Setting password for ${username}...`,
          () => osManager.setPassword(username, password),
          `Password set for user ${username}`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to set password: ${error.message}`);
        process.exit(1);
      }
    });

  // ========================================================================
  // os:network - Network configuration
  // ========================================================================
  const networkCmd = osCmd
    .command('network')
    .alias('net')
    .description('Network configuration');

  // network config
  networkCmd
    .command('config')
    .description('Show network configuration')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: OSOptions) => {
      try {
        const config = osManager.getNetworkConfig();

        if (options.json) {
          console.log(JSON.stringify(config, null, 2));
          return;
        }

        logger.header('NETWORK CONFIGURATION');
        logger.info(`Hostname: ${chalk.cyan(config.hostname)}`);

        logger.newline();
        logger.section('Interfaces');
        if (config.interfaces.length > 0) {
          const tableData = config.interfaces.map(i => ({
            NAME: i.name,
            TYPE: i.type,
            STATE: i.state,
            MAC: i.macAddress,
            MTU: i.mtu,
          }));
          table(tableData);
        } else {
          logger.info('No interfaces found');
        }

        logger.newline();
        logger.section('DNS Servers');
        if (config.dns.length > 0) {
          config.dns.forEach(d => logger.info(`  ${d.address} (priority: ${d.priority})`));
        } else {
          logger.info('No DNS servers configured');
        }

        logger.newline();
        logger.section('Routes');
        if (config.routes.length > 0) {
          const tableData = config.routes.map(r => ({
            DESTINATION: r.destination,
            GATEWAY: r.gateway,
            INTERFACE: r.interface,
            METRIC: r.metric,
          }));
          table(tableData);
        } else {
          logger.info('No routes configured');
        }

        logger.newline();
        logger.section('Hosts Entries');
        if (config.hosts.length > 0) {
          const tableData = config.hosts.map(h => ({
            IP: h.ip,
            HOSTNAMES: h.hostnames.join(', '),
          }));
          table(tableData);
        } else {
          logger.info('No hosts entries');
        }
      } catch (error: any) {
        logger.error(`Failed to get network config: ${error.message}`);
        process.exit(1);
      }
    });

  // network hostname <name>
  networkCmd
    .command('hostname <name>')
    .description('Set system hostname')
    .action(async (name: string) => {
      try {
        const success = await withSpinner(
          `Setting hostname to ${name}...`,
          () => osManager.setHostname(name),
          `Hostname set to ${name}`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to set hostname: ${error.message}`);
        process.exit(1);
      }
    });

  // network dns <servers>
  networkCmd
    .command('dns <servers...>')
    .description('Configure DNS servers')
    .action(async (servers: string[]) => {
      try {
        const success = await withSpinner(
          `Configuring DNS servers...`,
          () => osManager.configureDNS(servers),
          `DNS servers configured: ${servers.join(', ')}`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to configure DNS: ${error.message}`);
        process.exit(1);
      }
    });

  // network hosts
  networkCmd
    .command('hosts')
    .description('Manage /etc/hosts entries')
    .option('-a, --add <ip>', 'Add entry with IP')
    .option('-n, --names <names>', 'Comma-separated hostnames')
    .option('-l, --list', 'List current hosts')
    .action(async (options: { add?: string; names?: string; list?: boolean }) => {
      try {
        if (options.list || (!options.add && !options.names)) {
          const config = osManager.getNetworkConfig();
          logger.header('/ETC/HOSTS');
          if (config.hosts.length > 0) {
            const tableData = config.hosts.map(h => ({
              IP: h.ip,
              HOSTNAMES: h.hostnames.join(', '),
              COMMENT: h.comment || '-',
            }));
            table(tableData);
          } else {
            logger.info('No hosts entries');
          }
          return;
        }

        if (options.add && options.names) {
          const hostnames = options.names.split(',').map(n => n.trim()).filter(Boolean);
          const entries = [{ ip: options.add, hostnames }];
          const success = osManager.configureHosts(entries);

          if (success) {
            logger.success(`Added ${options.add} -> ${hostnames.join(', ')}`);
          } else {
            process.exit(1);
          }
        } else {
          logger.error('Both --add and --names are required');
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to manage hosts: ${error.message}`);
        process.exit(1);
      }
    });

  // ========================================================================
  // os:firewall - Firewall management
  // ========================================================================
  const firewallCmd = osCmd
    .command('firewall')
    .alias('fw')
    .description('Firewall management');

  // firewall status
  firewallCmd
    .command('status')
    .description('Show firewall status')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: OSOptions) => {
      try {
        const status = osManager.getFirewallStatus();

        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }

        logger.header('FIREWALL STATUS');
        logger.info(`Enabled: ${status.enabled ? chalk.green('Yes') : chalk.red('No')}`);
        logger.info(`Active: ${status.active ? chalk.green('Yes') : chalk.red('No')}`);
        logger.info(`Default Incoming: ${status.defaultIncoming}`);
        logger.info(`Default Outgoing: ${status.defaultOutgoing}`);

        if (status.rules.length > 0) {
          logger.newline();
          logger.section('Rules');
          const tableData = status.rules.map(r => ({
            PORT: r.port || 'any',
            PROTOCOL: r.protocol,
            ACTION: r.action.toUpperCase(),
            FROM: r.from || 'any',
            DIRECTION: r.direction,
          }));
          table(tableData);
        }
      } catch (error: any) {
        logger.error(`Failed to get firewall status: ${error.message}`);
        process.exit(1);
      }
    });

  // firewall enable
  firewallCmd
    .command('enable')
    .description('Enable firewall')
    .action(async () => {
      try {
        const success = await withSpinner(
          'Enabling firewall...',
          () => osManager.enableFirewall(),
          'Firewall enabled'
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to enable firewall: ${error.message}`);
        process.exit(1);
      }
    });

  // firewall disable
  firewallCmd
    .command('disable')
    .description('Disable firewall')
    .option('-f, --force', 'Force without confirmation')
    .action(async (options: OSOptions) => {
      try {
        if (!options.force) {
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: 'Disable firewall? This may expose your system.',
            default: false,
          }]);
          if (!confirm) {
            logger.info('Cancelled');
            return;
          }
        }

        const success = await withSpinner(
          'Disabling firewall...',
          () => osManager.disableFirewall(),
          'Firewall disabled'
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to disable firewall: ${error.message}`);
        process.exit(1);
      }
    });

  // firewall allow <port> [proto]
  firewallCmd
    .command('allow <port>')
    .description('Allow port through firewall')
    .option('-p, --protocol <proto>', 'Protocol (tcp, udp, tcpudp)', 'tcp')
    .option('--from <ip>', 'Allow from specific IP')
    .action(async (port: string, options: FirewallOptions & { protocol: string }) => {
      try {
        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
          logger.error('Invalid port number');
          process.exit(1);
        }

        const success = osManager.allowPort(
          portNum,
          options.protocol as 'tcp' | 'udp' | 'tcpudp',
          options.from
        );

        if (success) {
          logger.success(`Port ${port}/${options.protocol} allowed${options.from ? ` from ${options.from}` : ''}`);
        } else {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to allow port: ${error.message}`);
        process.exit(1);
      }
    });

  // firewall deny <port> [proto]
  firewallCmd
    .command('deny <port>')
    .description('Deny port through firewall')
    .option('-p, --protocol <proto>', 'Protocol (tcp, udp, tcpudp)', 'tcp')
    .action(async (port: string, options: { protocol: string }) => {
      try {
        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
          logger.error('Invalid port number');
          process.exit(1);
        }

        const success = osManager.denyPort(portNum, options.protocol as 'tcp' | 'udp' | 'tcpudp');

        if (success) {
          logger.success(`Port ${port}/${options.protocol} denied`);
        } else {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to deny port: ${error.message}`);
        process.exit(1);
      }
    });

  // firewall list
  firewallCmd
    .command('list')
    .description('List firewall rules')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: OSOptions) => {
      try {
        const rules = osManager.listRules();

        if (options.json) {
          console.log(JSON.stringify(rules, null, 2));
          return;
        }

        if (rules.length === 0) {
          logger.info('No firewall rules defined.');
          return;
        }

        logger.header('FIREWALL RULES');
        const tableData = rules.map((r, i) => ({
          '#': i + 1,
          PORT: r.port || 'any',
          PROTOCOL: r.protocol,
          ACTION: r.action.toUpperCase(),
          FROM: r.from || 'any',
          TO: r.to || 'any',
        }));
        table(tableData);
      } catch (error: any) {
        logger.error(`Failed to list rules: ${error.message}`);
        process.exit(1);
      }
    });

  // ========================================================================
  // os:disk - Disk management
  // ========================================================================
  const diskCmd = osCmd
    .command('disk')
    .description('Disk management');

  // disk list
  diskCmd
    .command('list')
    .alias('ls')
    .description('List all disks')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: OSOptions) => {
      try {
        const disks = osManager.listDisks();

        if (options.json) {
          console.log(JSON.stringify(disks, null, 2));
          return;
        }

        logger.header('DISKS');
        const tableData = disks.map(d => ({
          DEVICE: d.device,
          MODEL: d.model?.substring(0, 25) || 'Unknown',
          SIZE: d.size,
          TYPE: d.type,
          MOUNTED: d.mounted ? chalk.green('Yes') : chalk.gray('No'),
        }));
        table(tableData);
      } catch (error: any) {
        logger.error(`Failed to list disks: ${error.message}`);
        process.exit(1);
      }
    });

  // disk info <device>
  diskCmd
    .command('info <device>')
    .description('Show detailed disk information')
    .option('-j, --json', 'Output as JSON')
    .action(async (device: string, options: OSOptions) => {
      try {
        const info = osManager.getDiskInfo(device);

        if (!info) {
          logger.error(`Device not found: ${device}`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(info, null, 2));
          return;
        }

        logger.header(`DISK: ${device}`);
        logger.info(`Model: ${chalk.cyan(info.model)}`);
        logger.info(`Size: ${chalk.cyan(info.size)}`);
        logger.info(`Type: ${chalk.cyan(info.type)}`);
        if (info.serial) {
          logger.info(`Serial: ${chalk.cyan(info.serial)}`);
        }
        logger.info(`Mounted: ${info.mounted ? chalk.green('Yes') : chalk.gray('No')}`);

        if (info.mountPoint) {
          logger.info(`Mount Point: ${chalk.cyan(info.mountPoint)}`);
        }
        if (info.filesystem) {
          logger.info(`Filesystem: ${chalk.cyan(info.filesystem)}`);
        }

        if (info.usage) {
          logger.newline();
          logger.section('Usage');
          logger.info(`Total: ${formatBytes(info.usage.total)}`);
          logger.info(`Used: ${formatBytes(info.usage.used)}`);
          logger.info(`Free: ${formatBytes(info.usage.free)}`);
          logger.info(`Used %: ${formatDiskPercent(info.usage.percentUsed)}`);
        }

        if (info.partitions.length > 0) {
          logger.newline();
          logger.section('Partitions');
          const tableData = info.partitions.map(p => ({
            DEVICE: p.device,
            SIZE: p.size,
            TYPE: p.type,
            FILESYSTEM: p.filesystem || '-',
            MOUNT: p.mountPoint || '-',
          }));
          table(tableData);
        }
      } catch (error: any) {
        logger.error(`Failed to get disk info: ${error.message}`);
        process.exit(1);
      }
    });

  // disk format <device> [fs]
  diskCmd
    .command('format <device>')
    .description('Format a disk')
    .option('-f, --filesystem <fs>', 'Filesystem type (ext4, xfs, btrfs)', 'ext4')
    .option('--force', 'Force format without confirmation')
    .action(async (device: string, options: DiskOptions & { force?: boolean; filesystem: string }) => {
      try {
        if (!options.force) {
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: chalk.red(`WARNING: This will ERASE ALL DATA on ${device}. Continue?`),
            default: false,
          }]);
          if (!confirm) {
            logger.info('Cancelled');
            return;
          }
        }

        const success = await withSpinner(
          `Formatting ${device} with ${options.filesystem}...`,
          () => osManager.formatDisk(device, options.filesystem as 'ext4' | 'xfs' | 'btrfs'),
          `Disk ${device} formatted`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to format disk: ${error.message}`);
        process.exit(1);
      }
    });

  // disk mount <device> <path>
  diskCmd
    .command('mount <device> <path>')
    .description('Mount a disk')
    .option('-o, --options <opts>', 'Mount options (comma-separated)')
    .action(async (device: string, path: string, options: { options?: string }) => {
      try {
        const mountOpts = options.options?.split(',').map(o => o.trim()).filter(Boolean) || [];

        const success = await withSpinner(
          `Mounting ${device} to ${path}...`,
          () => osManager.mount(device, path, mountOpts),
          `Mounted ${device} to ${path}`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to mount disk: ${error.message}`);
        process.exit(1);
      }
    });

  // disk unmount <path>
  diskCmd
    .command('unmount <path>')
    .alias('umount')
    .description('Unmount a disk')
    .action(async (path: string) => {
      try {
        const success = await withSpinner(
          `Unmounting ${path}...`,
          () => osManager.unmount(path),
          `Unmounted ${path}`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to unmount disk: ${error.message}`);
        process.exit(1);
      }
    });

  // ========================================================================
  // os:sysctl - Kernel parameters
  // ========================================================================
  const sysctlCmd = osCmd
    .command('sysctl')
    .alias('kernel')
    .description('Kernel parameters management');

  // sysctl list
  sysctlCmd
    .command('list')
    .alias('ls')
    .description('List sysctl parameters')
    .option('-p, --pattern <pattern>', 'Filter by pattern')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: { pattern?: string; json?: boolean }) => {
      try {
        // Get common sysctl parameters
        const commonParams = [
          'kernel.hostname',
          'kernel.osrelease',
          'kernel.ostype',
          'kernel.pid_max',
          'vm.swappiness',
          'vm.dirty_ratio',
          'fs.file-max',
          'net.ipv4.ip_forward',
          'net.ipv4.tcp_syncookies',
        ];

        const params: Record<string, string | null> = {};
        for (const key of commonParams) {
          params[key] = osManager.getSysctl(key);
        }

        if (options.json) {
          console.log(JSON.stringify(params, null, 2));
          return;
        }

        logger.header('KERNEL PARAMETERS');
        const tableData = Object.entries(params).map(([key, value]) => ({
          PARAMETER: key,
          VALUE: value || '-',
        }));
        table(tableData);
      } catch (error: any) {
        logger.error(`Failed to list sysctl parameters: ${error.message}`);
        process.exit(1);
      }
    });

  // sysctl get <key>
  sysctlCmd
    .command('get <key>')
    .description('Get a sysctl parameter value')
    .action(async (key: string) => {
      try {
        const value = osManager.getSysctl(key);

        if (value === null) {
          logger.error(`Parameter not found: ${key}`);
          process.exit(1);
        }

        logger.info(`${chalk.cyan(key)} = ${chalk.green(value)}`);
      } catch (error: any) {
        logger.error(`Failed to get sysctl parameter: ${error.message}`);
        process.exit(1);
      }
    });

  // sysctl set <key> <value>
  sysctlCmd
    .command('set <key> <value>')
    .description('Set a sysctl parameter')
    .option('--no-persistent', 'Don\'t persist across reboots')
    .action(async (key: string, value: string, options: { persistent?: boolean }) => {
      try {
        const success = await withSpinner(
          `Setting ${key} = ${value}...`,
          () => osManager.setSysctl(key, value, options.persistent !== false),
          `Parameter ${key} set to ${value}`
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to set sysctl parameter: ${error.message}`);
        process.exit(1);
      }
    });

  // ========================================================================
  // os:report - Generate OS report
  // ========================================================================
  osCmd
    .command('report')
    .description('Generate comprehensive OS report')
    .option('-o, --output <file>', 'Save report to file')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: { output?: string; json?: boolean }) => {
      try {
        const report = await withSpinner(
          'Generating OS report...',
          () => osManager.generateReport(),
          'Report generated'
        );

        if (options.json || options.output) {
          const json = JSON.stringify(report, null, 2);
          if (options.output) {
            writeFileSync(options.output, json);
            logger.success(`Report saved to ${options.output}`);
          }
          if (options.json) {
            console.log(json);
          }
          return;
        }

        // Display report
        logger.header('OS REPORT');
        logger.info(`Generated: ${chalk.cyan(report.timestamp.toISOString())}`);

        logger.newline();
        logger.section('System');
        logger.info(`OS: ${chalk.cyan(report.os.distribution)} ${report.os.version}`);
        logger.info(`Kernel: ${chalk.cyan(report.kernel.version)}`);
        logger.info(`Architecture: ${chalk.cyan(report.os.architecture)}`);
        logger.info(`Hostname: ${chalk.cyan(report.os.hostname)}`);

        logger.newline();
        logger.section('Services');
        logger.info(`Total: ${report.services.length}`);
        const runningServices = report.services.filter(s => s.status === 'running').length;
        logger.success(`Running: ${runningServices}`);
        logger.info(`Enabled: ${report.services.filter(s => s.enabled).length}`);

        logger.newline();
        logger.section('Disk Usage');
        report.diskUsage.forEach(d => {
          if (d.usage) {
            logger.info(`${d.device}: ${formatDiskPercent(d.usage.percentUsed)}`);
          }
        });

        if (report.recommendations.length > 0) {
          logger.newline();
          logger.section('Recommendations');
          report.recommendations.forEach(r => {
            const icon = r.severity === 'critical' ? '🔴' : r.severity === 'warning' ? '🟡' : '🔵';
            logger.info(`${icon} ${r.title}: ${r.description}`);
          });
        }
      } catch (error: any) {
        logger.error(`Failed to generate report: ${error.message}`);
        process.exit(1);
      }
    });

  // ========================================================================
  // os:backup - Backup OS config
  // ========================================================================
  osCmd
    .command('backup')
    .description('Backup OS configuration')
    .option('-p, --path <path>', 'Backup destination path', '/var/backups/hestia')
    .action(async (options: { path: string }) => {
      try {
        // Ensure backup directory exists
        if (!existsSync(options.path)) {
          mkdirSync(options.path, { recursive: true });
        }

        const success = await withSpinner(
          'Creating OS configuration backup...',
          () => osManager.backupConfig(options.path),
          'Backup complete'
        );

        if (!success) {
          process.exit(1);
        }
      } catch (error: any) {
        logger.error(`Failed to backup: ${error.message}`);
        process.exit(1);
      }
    });

  // ========================================================================
  // os:restore - Restore OS config
  // ========================================================================
  osCmd
    .command('restore')
    .description('Restore OS configuration from backup')
    .option('-b, --backup <path>', 'Backup file path')
    .option('-i, --interactive', 'Interactive mode - select from available backups')
    .action(async (options: { backup?: string; interactive?: boolean }) => {
      try {
        let backupPath = options.backup;

        if (options.interactive || !backupPath) {
          // List available backups
          const { execSync } = await import('child_process');
          const backupDir = '/var/backups/hestia';

          if (!existsSync(backupDir)) {
            logger.error('No backup directory found');
            process.exit(1);
          }

          const backups = execSync(`ls -1 ${backupDir}/os-backup-*.tar.gz 2>/dev/null || echo ''`, { encoding: 'utf8' })
            .trim()
            .split('\n')
            .filter(Boolean);

          if (backups.length === 0) {
            logger.error('No backups found');
            process.exit(1);
          }

          const { selected } = await inquirer.prompt([{
            type: 'list',
            name: 'selected',
            message: 'Select backup to restore:',
            choices: backups.map(b => ({
              name: b.split('/').pop(),
              value: b,
            })),
          }]);

          backupPath = selected;
        }

        if (!backupPath) {
          logger.error('No backup specified');
          process.exit(1);
        }

        if (!existsSync(backupPath)) {
          logger.error(`Backup not found: ${backupPath}`);
          process.exit(1);
        }

        // Confirm restore
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: chalk.red('WARNING: This will overwrite current system configuration. Continue?'),
          default: false,
        }]);

        if (!confirm) {
          logger.info('Cancelled');
          return;
        }

        const success = await withSpinner(
          'Restoring configuration...',
          () => osManager.restoreConfig(backupPath),
          'Restore complete'
        );

        if (!success) {
          process.exit(1);
        }

        logger.warn('You may need to reboot for some changes to take effect');
      } catch (error: any) {
        logger.error(`Failed to restore: ${error.message}`);
        process.exit(1);
      }
    });
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(' ');
}

function formatBytes(bytes: number): string {
  const units = ['B', 'K', 'M', 'G', 'T', 'P'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)}${units[unitIndex]}`;
}

function formatDiskPercent(percent: number): string {
  if (percent < 70) return chalk.green(`${percent}%`);
  if (percent < 90) return chalk.yellow(`${percent}%`);
  return chalk.red(`${percent}%`);
}

function formatServiceStatus(status: string): string {
  switch (status) {
    case 'running':
      return chalk.green('● running');
    case 'stopped':
      return chalk.gray('○ stopped');
    case 'failed':
      return chalk.red('✗ failed');
    case 'activating':
      return chalk.yellow('◐ starting');
    case 'deactivating':
      return chalk.yellow('◑ stopping');
    default:
      return chalk.gray('? unknown');
  }
}
