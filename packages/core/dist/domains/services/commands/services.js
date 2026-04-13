// @ts-nocheck
/**
 * services command - Manage optional Hestia services
 *
 * Commands:
 *   hestia services              - List all services (core + optional)
 *   hestia services:list           - List with status
 *   hestia services:available      - Show available optional services
 *   hestia services:install <n>    - Install optional service
 *   hestia services:remove <n>     - Remove service
 *   hestia services:start <n>      - Start service
 *   hestia services:stop <n>       - Stop service
 *   hestia services:status <n>     - Detailed status
 *   hestia services:enable <n>      - Enable service
 *   hestia services:disable <n>     - Disable service
 *   hestia services:configure <n>  - Configure service
 *   hestia services:logs <n>        - Show logs
 */
import chalk from 'chalk';
import { logger, table } from '../../lib/utils/index';
import { serviceManager } from '../../../domains/services/lib/service-manager.js';
// Category display names and icons
const categoryDisplay = {
    network: { name: 'Network', icon: '🌐', color: '#3b82f6' },
    database: { name: 'Database', icon: '🗄️', color: '#10b981' },
    ui: { name: 'UI', icon: '🎨', color: '#f59e0b' },
    ai: { name: 'AI', icon: '🤖', color: '#8b5cf6' },
};
// Status display formatting
function formatStatus(status) {
    const statusConfig = {
        'not-installed': { icon: '○', color: '#9ca3af' },
        'installed': { icon: '◐', color: '#6b7280' },
        'enabled': { icon: '◉', color: '#3b82f6' },
        'running': { icon: '●', color: '#10b981' },
        'stopped': { icon: '◌', color: '#f59e0b' },
        'error': { icon: '✗', color: '#ef4444' },
    };
    const config = statusConfig[status];
    return chalk.hex(config.color)(`${config.icon} ${status}`);
}
// Category formatter
function formatCategory(category) {
    const display = categoryDisplay[category];
    return chalk.hex(display.color)(`${display.icon} ${display.name}`);
}
export function servicesCommand(program) {
    const services = program
        .command('services')
        .description('Manage optional Hestia services')
        .option('-j, --json', 'Output as JSON')
        .action(async (options) => {
        await listServices(options);
    });
    // services:list - List all services with status
    services
        .command('list')
        .description('List all services with their status')
        .option('-c, --category <cat>', 'Filter by category (network|database|ui|ai)')
        .option('-j, --json', 'Output as JSON')
        .option('-v, --verbose', 'Show detailed information')
        .action(async (options) => {
        await listServices(options);
    });
    // services:available - Show available optional services
    services
        .command('available')
        .alias('ls-available')
        .description('Show available optional services')
        .option('-c, --category <cat>', 'Filter by category')
        .option('-j, --json', 'Output as JSON')
        .action(async (options) => {
        await listAvailableServices(options);
    });
    // services:install - Install optional service
    services
        .command('install <name>')
        .description('Install an optional service')
        .option('-p, --port <port>', 'Specify preferred port')
        .option('-y, --yes', 'Skip confirmation prompts')
        .action(async (name, options) => {
        await installService(name, options);
    });
    // services:remove - Remove service
    services
        .command('remove <name>')
        .alias('uninstall')
        .description('Remove an installed service')
        .option('-f, --force', 'Force removal without confirmation')
        .action(async (name, options) => {
        await removeService(name, options);
    });
    // services:start - Start service
    services
        .command('start <name>')
        .description('Start a service')
        .action(async (name) => {
        await startService(name);
    });
    // services:stop - Stop service
    services
        .command('stop <name>')
        .description('Stop a service')
        .action(async (name) => {
        await stopService(name);
    });
    // services:status - Detailed status
    services
        .command('status [name]')
        .description('Show detailed status of a service or all services')
        .option('-j, --json', 'Output as JSON')
        .option('-w, --watch', 'Watch mode - continuously update')
        .action(async (name, options) => {
        if (options.watch) {
            await watchStatus(name, options);
        }
        else {
            await showStatus(name, options);
        }
    });
    // services:enable - Enable service
    services
        .command('enable <name>')
        .description('Enable a service to auto-start')
        .action(async (name) => {
        await enableService(name);
    });
    // services:disable - Disable service
    services
        .command('disable <name>')
        .description('Disable a service from auto-starting')
        .action(async (name) => {
        await disableService(name);
    });
    // services:configure - Configure service
    services
        .command('configure <name>')
        .description('Configure a service')
        .option('-p, --port <ports...>', 'Port mappings (e.g., http:8080 https:8443)')
        .option('-e, --env <vars...>', 'Environment variables (e.g., KEY=value)')
        .option('-f, --file <path>', 'Load configuration from file')
        .action(async (name, options) => {
        await configureService(name, options);
    });
    // services:logs - Show logs
    services
        .command('logs <name>')
        .description('Show service logs')
        .option('-n, --lines <num>', 'Number of lines to show', '100')
        .option('-f, --follow', 'Follow log output')
        .action(async (name, options) => {
        await showLogs(name, options);
    });
}
// List all services
async function listServices(options) {
    try {
        const allServices = getAllOptionalServices();
        const statuses = await serviceManager.getAllStatuses();
        if (options.json) {
            const data = allServices.map(service => {
                const statusInfo = statuses.find(s => s.service.name === service.name);
                return {
                    name: service.name,
                    displayName: service.displayName,
                    category: service.category,
                    description: service.description,
                    status: statusInfo?.status.status || 'not-installed',
                    installed: statusInfo?.status.status !== 'not-installed',
                    enabled: statusInfo?.status.status === 'running' || statusInfo?.status.status === 'enabled',
                    running: statusInfo?.status.status === 'running',
                    ports: service.ports,
                };
            });
            console.log(JSON.stringify(data, null, 2));
            return;
        }
        // Group by category
        const categories = options.category
            ? [options.category]
            : getServiceCategories();
        logger.header('HESTIA SERVICES');
        logger.newline();
        for (const category of categories) {
            const catDisplay = categoryDisplay[category];
            const services = getServicesByCategory(category);
            if (services.length === 0)
                continue;
            console.log(chalk.hex(catDisplay.color)(`${catDisplay.icon} ${catDisplay.name}`));
            console.log(chalk.hex(catDisplay.color)('─'.repeat(40)));
            const tableData = services.map(service => {
                const statusInfo = statuses.find(s => s.service.name === service.name);
                const status = statusInfo?.status.status || 'not-installed';
                return {
                    Name: chalk.white(service.displayName),
                    Status: formatStatus(status),
                    Port: service.defaultPort.toString(),
                    Description: chalk.gray(service.description.slice(0, 40) + (service.description.length > 40 ? '...' : '')),
                };
            });
            table(tableData);
            logger.newline();
        }
        // Show summary
        const summary = await serviceManager.getServicesSummary();
        logger.info(`Total: ${allServices.length} services | Installed: ${summary.installed} | Enabled: ${summary.enabled} | Running: ${summary.running}`);
    }
    catch (error) {
        logger.error(`Failed to list services: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
// List available optional services
async function listAvailableServices(options) {
    try {
        let services = getAllOptionalServices();
        if (options.category) {
            services = services.filter(s => s.category === options.category);
        }
        // Filter to only show not-installed
        const availableServices = [];
        for (const service of services) {
            const installed = await service.isInstalled();
            if (!installed) {
                availableServices.push(service);
            }
        }
        if (options.json) {
            console.log(JSON.stringify(availableServices.map(s => ({
                name: s.name,
                displayName: s.displayName,
                category: s.category,
                description: s.description,
                ports: s.ports,
                dependencies: s.dependencies,
            })), null, 2));
            return;
        }
        if (availableServices.length === 0) {
            logger.success('All optional services are already installed!');
            return;
        }
        logger.header('AVAILABLE OPTIONAL SERVICES');
        logger.newline();
        for (const service of availableServices) {
            console.log(`${formatCategory(service.category)} ${chalk.bold.white(service.displayName)}`);
            console.log(chalk.gray(service.description));
            if (service.ports.length > 0) {
                const ports = service.ports.map(p => `${p.external} (${p.description})`).join(', ');
                console.log(chalk.blue(`  Ports: ${ports}`));
            }
            if (service.dependencies.length > 0) {
                const deps = service.dependencies.map(d => `${d.name}${d.optional ? ' (optional)' : ''}`).join(', ');
                console.log(chalk.yellow(`  Dependencies: ${deps}`));
            }
            logger.newline();
        }
        logger.info(`Use 'hestia services:install <name>' to install a service`);
    }
    catch (error) {
        logger.error(`Failed to list available services: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
// Install a service
async function installService(name, options) {
    try {
        if (!isValidService(name)) {
            logger.error(`Unknown service: ${name}`);
            logger.info(`Run 'hestia services:available' to see available services`);
            process.exit(1);
        }
        const service = getOptionalService(name);
        const installed = await service.isInstalled();
        if (installed) {
            logger.warn(`${service.displayName} is already installed`);
            return;
        }
        if (!options.yes) {
            const inquirer = (await import('inquirer')).default;
            const { confirm } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'confirm',
                    message: `Install ${service.displayName}?`,
                    default: true,
                }]);
            if (!confirm) {
                logger.info('Installation cancelled');
                return;
            }
        }
        await serviceManager.install(name);
    }
    catch (error) {
        logger.error(`Failed to install ${name}: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
// Remove a service
async function removeService(name, options) {
    try {
        if (!isValidService(name)) {
            logger.error(`Unknown service: ${name}`);
            process.exit(1);
        }
        const service = getOptionalService(name);
        const installed = await service.isInstalled();
        if (!installed) {
            logger.warn(`${service.displayName} is not installed`);
            return;
        }
        if (!options.force) {
            const inquirer = (await import('inquirer')).default;
            const { confirm } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'confirm',
                    message: `Remove ${service.displayName}? This will delete all data associated with this service.`,
                    default: false,
                }]);
            if (!confirm) {
                logger.info('Removal cancelled');
                return;
            }
        }
        await serviceManager.remove(name);
    }
    catch (error) {
        logger.error(`Failed to remove ${name}: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
// Start a service
async function startService(name) {
    try {
        if (!isValidService(name)) {
            logger.error(`Unknown service: ${name}`);
            process.exit(1);
        }
        await serviceManager.start(name);
    }
    catch (error) {
        logger.error(`Failed to start ${name}: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
// Stop a service
async function stopService(name) {
    try {
        if (!isValidService(name)) {
            logger.error(`Unknown service: ${name}`);
            process.exit(1);
        }
        await serviceManager.stop(name);
    }
    catch (error) {
        logger.error(`Failed to stop ${name}: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
// Show status
async function showStatus(name, options) {
    try {
        if (name) {
            if (!isValidService(name)) {
                logger.error(`Unknown service: ${name}`);
                process.exit(1);
            }
            const service = getOptionalService(name);
            const status = await serviceManager.getStatus(name);
            if (options.json) {
                console.log(JSON.stringify({
                    name: service.name,
                    displayName: service.displayName,
                    category: service.category,
                    ...status,
                }, null, 2));
                return;
            }
            logger.header(`${service.displayName.toUpperCase()} STATUS`);
            logger.newline();
            console.log(`Status: ${formatStatus(status.status)}`);
            if (status.version)
                console.log(`Version: ${chalk.cyan(status.version)}`);
            if (status.url)
                console.log(`URL: ${chalk.cyan(status.url)}`);
            if (status.uptime)
                console.log(`Uptime: ${chalk.cyan(formatUptime(status.uptime))}`);
            if (status.message)
                console.log(`Message: ${chalk.gray(status.message)}`);
            if (status.lastError)
                console.log(`Last Error: ${chalk.red(status.lastError)}`);
            if (status.ports && status.ports.length > 0) {
                logger.newline();
                console.log(chalk.bold('Ports:'));
                for (const port of status.ports) {
                    console.log(`  ${port.external}:${port.internal} (${port.description || 'unknown'})`);
                }
            }
        }
        else {
            // Show all services status
            const statuses = await serviceManager.getAllStatuses();
            if (options.json) {
                console.log(JSON.stringify(statuses.map(({ service, status }) => ({
                    name: service.name,
                    displayName: service.displayName,
                    category: service.category,
                    ...status,
                })), null, 2));
                return;
            }
            logger.header('SERVICES STATUS');
            logger.newline();
            const tableData = statuses.map(({ service, status }) => ({
                Service: service.displayName,
                Category: formatCategory(service.category),
                Status: formatStatus(status.status),
                URL: status.url ? chalk.cyan(status.url) : chalk.gray('-'),
            }));
            table(tableData);
        }
    }
    catch (error) {
        logger.error(`Failed to get status: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
// Watch status continuously
async function watchStatus(name, options) {
    const interval = 2000;
    logger.info(`Watching status (press Ctrl+C to exit)...\n`);
    const run = async () => {
        process.stdout.write('\x1Bc');
        await showStatus(name, { json: false });
        logger.newline();
        logger.info(chalk.gray(`Last updated: ${new Date().toLocaleTimeString()}`));
        logger.info(chalk.gray('Press Ctrl+C to exit'));
    };
    await run();
    const timer = setInterval(run, interval);
    process.on('SIGINT', () => {
        clearInterval(timer);
        logger.newline();
        logger.info('Stopped watching');
        process.exit(0);
    });
}
// Enable a service
async function enableService(name) {
    try {
        if (!isValidService(name)) {
            logger.error(`Unknown service: ${name}`);
            process.exit(1);
        }
        await serviceManager.enable(name);
    }
    catch (error) {
        logger.error(`Failed to enable ${name}: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
// Disable a service
async function disableService(name) {
    try {
        if (!isValidService(name)) {
            logger.error(`Unknown service: ${name}`);
            process.exit(1);
        }
        await serviceManager.disable(name);
    }
    catch (error) {
        logger.error(`Failed to disable ${name}: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
// Configure a service
async function configureService(name, options) {
    try {
        if (!isValidService(name)) {
            logger.error(`Unknown service: ${name}`);
            process.exit(1);
        }
        const service = getOptionalService(name);
        const config = {};
        // Parse port mappings
        if (options.port) {
            const ports = {};
            for (const mapping of options.port) {
                const [key, value] = mapping.split(':');
                if (key && value) {
                    ports[key] = parseInt(value, 10);
                }
            }
            config.ports = ports;
        }
        // Parse environment variables
        if (options.env) {
            const env = {};
            for (const variable of options.env) {
                const [key, value] = variable.split('=');
                if (key && value) {
                    env[key] = value;
                }
            }
            config.environment = env;
        }
        // Load from file if specified
        if (options.file) {
            const fs = await import('fs/promises');
            const content = await fs.readFile(options.file, 'utf-8');
            const fileConfig = JSON.parse(content);
            Object.assign(config, fileConfig);
        }
        await serviceManager.configure(name, config);
    }
    catch (error) {
        logger.error(`Failed to configure ${name}: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
// Show logs
async function showLogs(name, options) {
    try {
        if (!isValidService(name)) {
            logger.error(`Unknown service: ${name}`);
            process.exit(1);
        }
        const lines = parseInt(options.lines || '100', 10);
        if (options.follow) {
            logger.info(`Following logs for ${name} (press Ctrl+C to exit)...\n`);
            const { spawn } = await import('child_process');
            const target = process.env.HESTIA_TARGET || '/opt/hestia';
            const proc = spawn('docker', [
                'compose',
                '-f', `${target}/docker-compose.yml`,
                'logs',
                '-f',
                '--tail', String(lines),
                name,
            ], { cwd: target, stdio: 'inherit' });
            process.on('SIGINT', () => {
                proc.kill();
                logger.newline();
                logger.info('Stopped following logs');
                process.exit(0);
            });
            return;
        }
        const logs = await serviceManager.getLogs(name, lines);
        console.log(logs);
    }
    catch (error) {
        logger.error(`Failed to get logs for ${name}: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
// Format uptime in human-readable format
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0)
        return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0)
        return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}
//# sourceMappingURL=services.js.map