// @ts-nocheck
/**
 * package command - Package management subcommands
 * Usage: hestia package <subcommand>
 */
import { getConfig } from '../../lib/utils/index';
import { APIClient } from '../../../domains/shared/lib/api-client.js';
import { logger, table } from '../../lib/utils/index';
import { withSpinner } from '../../lib/utils/index';
import { PackageService } from '../../../domains/registry/lib/package-service.js';
import chalk from 'chalk';
export function packageCommand(program) {
    const pkgCmd = program
        .command('package')
        .alias('pkg')
        .description('Package management subcommands');
    // Subcommand: list
    pkgCmd
        .command('list')
        .description('List all installed packages')
        .option('-j, --json', 'Output as JSON')
        .option('-v, --verbose', 'Show detailed information')
        .action(async (options) => {
        try {
            const config = await getConfig();
            const api = new APIClient(config);
            const packages = await api.listPackages({});
            if (options.json) {
                console.log(JSON.stringify(packages, null, 2));
                return;
            }
            if (packages.length === 0) {
                logger.info('No packages installed.');
                return;
            }
            if (options.verbose) {
                for (const pkg of packages) {
                    logger.section(pkg.name);
                    logger.info(`  Version: ${chalk.cyan(pkg.version)}`);
                    logger.info(`  Status: ${formatStatus(pkg.status)}`);
                    logger.info(`  Type: ${chalk.cyan(pkg.packageType)}`);
                    logger.info(`  Health: ${formatHealth(pkg.health)}`);
                    if (pkg.endpoints?.length) {
                        logger.info(`  Endpoints: ${pkg.endpoints.map((e) => chalk.cyan(e)).join(', ')}`);
                    }
                    logger.newline();
                }
            }
            else {
                const tableData = packages.map((pkg) => ({
                    NAME: pkg.name,
                    VERSION: pkg.version,
                    STATUS: pkg.status,
                    TYPE: pkg.packageType,
                }));
                table(tableData);
            }
        }
        catch (error) {
            logger.error(`Failed to list packages: ${error.message}`);
            process.exit(1);
        }
    });
    // Subcommand: info
    pkgCmd
        .command('info <package-name>')
        .description('Show detailed package information')
        .option('-j, --json', 'Output as JSON')
        .action(async (packageName, options) => {
        try {
            const config = await getConfig();
            const api = new APIClient(config);
            const packages = await api.listPackages({});
            const pkg = packages.find((p) => p.name === packageName);
            if (!pkg) {
                logger.error(`Package '${packageName}' not found`);
                process.exit(1);
            }
            if (options.json) {
                console.log(JSON.stringify(pkg, null, 2));
                return;
            }
            logger.header(`PACKAGE: ${packageName}`);
            logger.info(`Version: ${chalk.cyan(pkg.version)}`);
            logger.info(`Type: ${chalk.cyan(pkg.packageType)}`);
            logger.info(`Status: ${formatStatus(pkg.status)}`);
            logger.info(`Health: ${formatHealth(pkg.health)}`);
            if (pkg.config) {
                logger.newline();
                logger.section('Configuration');
                Object.entries(pkg.config).forEach(([key, value]) => {
                    logger.info(`  ${key}: ${chalk.cyan(JSON.stringify(value))}`);
                });
            }
            if (pkg.endpoints?.length) {
                logger.newline();
                logger.section('Endpoints');
                pkg.endpoints.forEach((endpoint) => {
                    logger.info(`  ${chalk.cyan(endpoint)}`);
                });
            }
            if (pkg.dependencies?.length) {
                logger.newline();
                logger.section('Dependencies');
                pkg.dependencies.forEach((dep) => {
                    logger.info(`  ${chalk.cyan(dep)}`);
                });
            }
        }
        catch (error) {
            logger.error(`Failed to get package info: ${error.message}`);
            process.exit(1);
        }
    });
    // Subcommand: logs
    pkgCmd
        .command('logs <package-name>')
        .description('Show package logs')
        .option('-f, --follow', 'Follow log output (like tail -f)')
        .option('-n, --lines <number>', 'Number of lines to show', '50')
        .action(async (packageName, options) => {
        try {
            const config = await getConfig();
            const pkgService = new PackageService(config);
            const lines = parseInt(options.lines, 10);
            if (options.follow) {
                logger.info(`Following logs for ${chalk.cyan(packageName)}... (Ctrl+C to exit)`);
                await pkgService.followLogs(packageName, lines);
            }
            else {
                const logs = await pkgService.getLogs(packageName, lines);
                console.log(logs);
            }
        }
        catch (error) {
            logger.error(`Failed to get logs: ${error.message}`);
            process.exit(1);
        }
    });
    // Subcommand: update
    pkgCmd
        .command('update [package-name]')
        .description('Update package(s) to latest version')
        .option('-a, --all', 'Update all packages')
        .option('-f, --force', 'Force update even if already at latest version')
        .action(async (packageName, options) => {
        try {
            const config = await getConfig();
            const api = new APIClient(config);
            const pkgService = new PackageService(config);
            // Determine which packages to update
            const packages = await api.listPackages({});
            let toUpdate = [];
            if (options.all) {
                toUpdate = packages.filter((p) => p.status !== 'error');
            }
            else if (packageName) {
                const pkg = packages.find((p) => p.name === packageName);
                if (!pkg) {
                    logger.error(`Package '${packageName}' not found`);
                    process.exit(1);
                }
                toUpdate = [pkg];
            }
            else {
                logger.error('Specify a package name or use --all');
                process.exit(1);
            }
            if (toUpdate.length === 0) {
                logger.info('No packages to update');
                return;
            }
            logger.header('UPDATING PACKAGES');
            logger.info(`Packages to update: ${toUpdate.map((p) => chalk.cyan(p.name)).join(', ')}`);
            logger.newline();
            for (const pkg of toUpdate) {
                await withSpinner(`Updating ${pkg.name}...`, async () => {
                    // Check for updates
                    const updateInfo = await pkgService.checkUpdate(pkg.name);
                    if (!updateInfo.hasUpdate && !options.force) {
                        throw new Error('Already at latest version (use --force to reinstall)');
                    }
                    // Stop if running
                    if (pkg.status === 'running') {
                        await api.stopPackage(pkg.name);
                    }
                    // Update
                    await pkgService.update(pkg.name, updateInfo.latestVersion);
                    // Start if it was running
                    if (pkg.status === 'running') {
                        await api.startPackage(pkg.name);
                    }
                }, `${pkg.name} updated to ${pkg.version}`);
            }
            logger.newline();
            logger.success('All packages updated successfully! ✨');
        }
        catch (error) {
            logger.error(`Update failed: ${error.message}`);
            process.exit(1);
        }
    });
    // Subcommand: shell
    pkgCmd
        .command('shell <package-name>')
        .description('Open a shell in the package container')
        .action(async (packageName) => {
        try {
            const config = await getConfig();
            const pkgService = new PackageService(config);
            await pkgService.openShell(packageName);
        }
        catch (error) {
            logger.error(`Failed to open shell: ${error.message}`);
            process.exit(1);
        }
    });
    // Subcommand: exec
    pkgCmd
        .command('exec <package-name> <command>')
        .description('Execute a command in the package container')
        .allowUnknownOption()
        .action(async (packageName, command, _options, commandObj) => {
        try {
            const config = await getConfig();
            const pkgService = new PackageService(config);
            // Get additional args after --
            const extraArgs = commandObj.args.slice(2);
            const fullCommand = [command, ...extraArgs].join(' ');
            await pkgService.exec(packageName, fullCommand);
        }
        catch (error) {
            logger.error(`Failed to execute command: ${error.message}`);
            process.exit(1);
        }
    });
}
function formatStatus(status) {
    const colors = {
        running: (s) => chalk.green(s),
        stopped: (s) => chalk.gray(s),
        error: (s) => chalk.red(s),
        pending: (s) => chalk.yellow(s),
        installing: (s) => chalk.blue(s),
    };
    return (colors[status] || chalk.gray)(status);
}
function formatHealth(health) {
    if (!health)
        return chalk.gray('unknown');
    const colors = {
        healthy: (s) => chalk.green(s),
        degraded: (s) => chalk.yellow(s),
        unhealthy: (s) => chalk.red(s),
    };
    return (colors[health] || chalk.gray)(health);
}
//# sourceMappingURL=package.js.map