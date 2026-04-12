/**
 * tunnel command - Secure Remote Access Management
 * Usage: hestia tunnel [subcommand]
 *
 * Manages secure tunnel access to Hestia nodes using Pangolin.
 * Pangolin is a self-hosted WireGuard-based tunneling solution that works
 * behind CGNAT without third-party dependencies.
 *
 * Subcommands:
 *   tunnel (default) - Show tunnel status
 *   tunnel:enable    - Interactive tunnel setup
 *   tunnel:disable   - Disable tunnel
 *   tunnel:status    - Show detailed status
 *   tunnel:url       - Show public URL
 *   tunnel:logs      - Show/follow tunnel logs
 *
 * Quick Start:
 *   1. On VPS: hestia tunnel:enable --mode server
 *   2. On Home: hestia tunnel:enable --mode client --server <vps-ip>
 *   3. Access home via https://tunnel.yourdomain.com
 *
 * Why Pangolin?
 *   - Self-hosted (no Cloudflare dependency)
 *   - WireGuard-based (fast, secure)
 *   - Works behind CGNAT
 *   - Identity-aware access
 *   - Optional component (not required)
 */
import { randomBytes } from 'crypto';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { pangolinService } from '../lib/pangolin-service.js';
import { logger, section } from '../lib/logger.js';
import { withSpinner } from '../lib/spinner.js';
import { loadConfig, updateConfig } from '../lib/config.js';
export function tunnelCommand(program) {
    // Main tunnel command - shows status
    const tunnelCmd = program
        .command('tunnel')
        .description('Manage secure remote tunnel access (Pangolin)')
        .configureHelp({
        subcommandTerm: (cmd) => `${cmd.name()}`,
        subcommandDescription: (cmd) => cmd.description(),
    })
        .option('-j, --json', 'Output as JSON')
        .action(async (options) => {
        await showTunnelStatus(options);
    });
    // =======================================================================
    // tunnel:enable - Interactive setup
    // =======================================================================
    tunnelCmd
        .command('enable')
        .description('Enable and configure remote tunnel access')
        .option('-m, --mode <mode>', 'Mode: server (VPS) or client (home)', 'client')
        .option('-s, --server <url>', 'Server URL (for client mode)')
        .option('-t, --token <token>', 'Authentication token (for client mode)')
        .option('-d, --domain <domain>', 'Domain for server mode')
        .option('-p, --port <port>', 'WireGuard port', '51820')
        .option('-f, --force', 'Force reconfiguration')
        .action(async (options) => {
        await enableTunnel(options);
    });
    // =======================================================================
    // tunnel:disable - Disable tunnel
    // =======================================================================
    tunnelCmd
        .command('disable')
        .description('Disable remote tunnel access')
        .option('-f, --force', 'Force without confirmation')
        .action(async (options) => {
        await disableTunnel(options);
    });
    // =======================================================================
    // tunnel:status - Detailed status
    // =======================================================================
    tunnelCmd
        .command('status')
        .description('Show detailed tunnel status')
        .option('-j, --json', 'Output as JSON')
        .option('-v, --verbose', 'Show verbose information')
        .action(async (options) => {
        await showDetailedStatus(options);
    });
    // =======================================================================
    // tunnel:url - Show public URL
    // =======================================================================
    tunnelCmd
        .command('url')
        .description('Show the public tunnel URL')
        .option('-j, --json', 'Output as JSON')
        .action(async (options) => {
        await showTunnelUrl(options);
    });
    // =======================================================================
    // tunnel:logs - Show tunnel logs
    // =======================================================================
    tunnelCmd
        .command('logs')
        .description('Show tunnel logs')
        .option('-n, --lines <number>', 'Number of lines to show', '100')
        .option('-f, --follow', 'Follow log output (live)')
        .action(async (options) => {
        await showTunnelLogs(options);
    });
    // =======================================================================
    // tunnel:list - List active tunnels
    // =======================================================================
    tunnelCmd
        .command('list')
        .alias('ls')
        .description('List active tunnels and endpoints')
        .option('-j, --json', 'Output as JSON')
        .action(async (options) => {
        await listTunnels(options);
    });
    // =======================================================================
    // tunnel:config - Update configuration
    // =======================================================================
    tunnelCmd
        .command('config')
        .description('Update tunnel configuration')
        .option('--add-tunnel <name:port>', 'Add a new tunnel (format: name:port)')
        .option('--remove-tunnel <name>', 'Remove a tunnel')
        .action(async (options) => {
        await updateTunnelConfig(options);
    });
    // =======================================================================
    // tunnel:restart - Restart tunnel service
    // =======================================================================
    tunnelCmd
        .command('restart')
        .description('Restart tunnel service')
        .action(async () => {
        await restartTunnel();
    });
}
// ===========================================================================
// COMMAND IMPLEMENTATIONS
// ===========================================================================
/**
 * Show basic tunnel status (default command)
 */
async function showTunnelStatus(options) {
    try {
        const status = await pangolinService.getPangolinStatus();
        const tunnelInfo = await pangolinService.getStatus();
        if (options.json) {
            console.log(JSON.stringify({
                installed: status.installed,
                running: status.running,
                mode: status.mode,
                status: tunnelInfo.status,
                publicUrl: tunnelInfo.publicUrl,
                connectedAt: tunnelInfo.connectedAt,
                activeTunnels: tunnelInfo.activeTunnels,
            }, null, 2));
            return;
        }
        if (!status.installed) {
            logger.info(chalk.yellow('Tunnel not installed'));
            logger.info('Run ' + chalk.cyan('hestia tunnel:enable') + ' to set up remote access');
            return;
        }
        logger.header('TUNNEL STATUS');
        // Status indicator
        const statusIcon = status.running
            ? (tunnelInfo.status === 'connected' ? chalk.green('🟢') : chalk.yellow('🟡'))
            : chalk.red('🔴');
        logger.info(`Status: ${statusIcon} ${formatTunnelStatus(tunnelInfo.status)}`);
        if (status.mode) {
            logger.info(`Mode: ${chalk.cyan(status.mode.toUpperCase())}`);
        }
        if (status.version && status.version !== 'unknown') {
            logger.info(`Version: ${chalk.gray(status.version)}`);
        }
        if (tunnelInfo.publicUrl) {
            logger.info(`Public URL: ${chalk.cyan.underline(tunnelInfo.publicUrl)}`);
        }
        if (tunnelInfo.activeTunnels > 0) {
            logger.info(`Active Tunnels: ${chalk.cyan(tunnelInfo.activeTunnels)}`);
        }
        if (tunnelInfo.connectedAt) {
            logger.info(`Connected: ${chalk.gray(formatDuration(Date.now() - tunnelInfo.connectedAt.getTime()))}`);
        }
        if (status.errors.length > 0) {
            logger.newline();
            logger.warn('Issues detected:');
            status.errors.forEach(e => logger.error(`  • ${e}`));
        }
        if (!status.running) {
            logger.newline();
            logger.info('To start the tunnel: ' + chalk.cyan('hestia tunnel:enable'));
        }
    }
    catch (error) {
        logger.error(`Failed to get tunnel status: ${error.message}`);
        process.exit(1);
    }
}
/**
 * Enable and configure tunnel (interactive)
 */
async function enableTunnel(options) {
    try {
        // Check if already configured
        const existingStatus = await pangolinService.getPangolinStatus();
        if (existingStatus.installed && !options.force) {
            const { overwrite } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'overwrite',
                    message: 'Tunnel is already configured. Reconfigure?',
                    default: false,
                }]);
            if (!overwrite) {
                logger.info('Cancelled');
                return;
            }
        }
        // Determine mode
        let mode = options.mode || 'client';
        if (!options.mode) {
            logger.header('TUNNEL SETUP');
            logger.info(chalk.gray('Pangolin provides secure remote access without third-party dependencies.'));
            logger.newline();
            const { selectedMode } = await inquirer.prompt([{
                    type: 'list',
                    name: 'selectedMode',
                    message: 'Select tunnel mode:',
                    choices: [
                        {
                            name: 'SERVER - I have a VPS with public IP (relay server)',
                            value: 'server',
                            short: 'Server (VPS)'
                        },
                        {
                            name: 'CLIENT - Home server behind CGNAT/firewall',
                            value: 'client',
                            short: 'Client (Home)'
                        },
                    ],
                    default: 'client',
                }]);
            mode = selectedMode;
        }
        // Install Pangolin
        await withSpinner(`Installing Pangolin ${mode}...`, async () => pangolinService.install(mode), `Pangolin installed for ${mode} mode`);
        if (mode === 'server') {
            await configureServerMode(options);
        }
        else {
            await configureClientMode(options);
        }
        // Start the service
        await withSpinner('Starting tunnel service...', async () => pangolinService.start(), 'Tunnel service started');
        // Show completion
        logger.newline();
        logger.success(chalk.bold('Tunnel configured successfully! 🔥'));
        const tunnelInfo = await pangolinService.getStatus();
        if (tunnelInfo.publicUrl) {
            logger.newline();
            logger.info(`${chalk.bold('Public URL:')} ${chalk.cyan.underline(tunnelInfo.publicUrl)}`);
        }
        if (mode === 'server') {
            logger.newline();
            section('Next Steps (on your home server)');
            logger.info(`1. Install Hestia on your home server`);
            logger.info(`2. Run: ${chalk.cyan('hestia tunnel:enable --mode client --server <this-ip>')}`);
            logger.info(`3. Access your home Hestia from anywhere!`);
        }
        else {
            logger.newline();
            logger.info('Your home server is now accessible remotely!');
            logger.info(`Run ${chalk.cyan('hestia tunnel:status')} to check connection status`);
        }
    }
    catch (error) {
        logger.error(`Failed to enable tunnel: ${error.message}`);
        process.exit(1);
    }
}
/**
 * Configure server mode (VPS)
 */
async function configureServerMode(options) {
    logger.newline();
    logger.header('SERVER CONFIGURATION');
    logger.info(chalk.gray('This will run Pangolin as a relay server on your VPS.'));
    logger.newline();
    // Get domain
    let domain = options.domain;
    if (!domain) {
        const { config } = await loadConfig();
        const defaultDomain = config.hearth.domain || 'example.com';
        const answers = await inquirer.prompt([{
                type: 'input',
                name: 'domain',
                message: 'Domain for tunnel access (e.g., tunnel.example.com):',
                default: `tunnel.${defaultDomain}`,
                validate: (input) => input.includes('.') || 'Please enter a valid domain',
            }]);
        domain = answers.domain;
    }
    // Get ports
    const serverPort = parseInt(options.port || '3000', 10);
    const wireguardPort = 51820;
    // Generate configuration
    const success = pangolinService.configureServer({
        domain,
        baseUrl: `https://${domain}`,
        serverPort,
        wireguardPort,
    });
    if (!success) {
        throw new Error('Failed to configure Pangolin server');
    }
    // Show token for client registration
    const token = generateSecureToken();
    logger.newline();
    section('Server Configuration Complete');
    logger.success(`Domain: ${chalk.cyan(domain)}`);
    logger.success(`WireGuard Port: ${chalk.cyan(wireguardPort)}`);
    logger.newline();
    logger.info(chalk.bold('Client Registration Token:'));
    logger.info(chalk.yellow(token));
    logger.newline();
    logger.info(chalk.gray('Share this token with your home server during client setup.'));
}
/**
 * Configure client mode (home server)
 */
async function configureClientMode(options) {
    logger.newline();
    logger.header('CLIENT CONFIGURATION');
    logger.info(chalk.gray('Connect to a Pangolin server to expose your home Hestia.'));
    logger.newline();
    // Check if behind CGNAT
    const networkType = await detectNetworkType();
    if (networkType === 'cgmat' || networkType === 'private') {
        logger.info(chalk.yellow('⚠️  CGNAT or private IP detected'));
        logger.info(chalk.gray('Pangolin is perfect for this setup - no port forwarding needed!'));
        logger.newline();
    }
    // Get server URL
    let serverUrl = options.server;
    if (!serverUrl) {
        const answers = await inquirer.prompt([{
                type: 'input',
                name: 'serverUrl',
                message: 'Pangolin Server URL (e.g., https://tunnel.example.com):',
                validate: (input) => input.startsWith('http') || 'Please enter a valid URL (https://...)',
            }]);
        serverUrl = answers.serverUrl;
    }
    // Get token
    let token = options.token;
    if (!token) {
        const answers = await inquirer.prompt([{
                type: 'input',
                name: 'token',
                message: 'Registration token from server:',
                validate: (input) => input.length > 10 || 'Please enter a valid token',
            }]);
        token = answers.token;
    }
    // Configure client
    const success = pangolinService.configureClient(serverUrl, token);
    if (!success) {
        throw new Error('Failed to configure Pangolin client');
    }
    logger.newline();
    section('Client Configuration Complete');
    logger.success(`Server: ${chalk.cyan(serverUrl)}`);
}
/**
 * Disable tunnel
 */
async function disableTunnel(options) {
    try {
        const status = await pangolinService.getPangolinStatus();
        if (!status.installed) {
            logger.info('Tunnel is not installed');
            return;
        }
        if (!options.force) {
            const { confirm } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'confirm',
                    message: 'Disable and remove tunnel access?',
                    default: false,
                }]);
            if (!confirm) {
                logger.info('Cancelled');
                return;
            }
        }
        await withSpinner('Stopping tunnel service...', async () => pangolinService.stop(), 'Tunnel service stopped');
        // Update config
        await updateConfig({
            tunnel: {
                enabled: false,
                provider: 'none',
            },
        });
        logger.success('Tunnel disabled');
    }
    catch (error) {
        logger.error(`Failed to disable tunnel: ${error.message}`);
        process.exit(1);
    }
}
/**
 * Show detailed status
 */
async function showDetailedStatus(options) {
    try {
        const status = await pangolinService.getPangolinStatus();
        const tunnelInfo = await pangolinService.getStatus();
        const tunnels = await pangolinService.listTunnels();
        if (options.json) {
            console.log(JSON.stringify({
                installed: status.installed,
                running: status.running,
                mode: status.mode,
                version: status.version,
                configValid: status.configValid,
                status: tunnelInfo,
                tunnels,
                errors: status.errors,
            }, null, 2));
            return;
        }
        logger.header('TUNNEL DETAILED STATUS');
        // Installation status
        section('Installation');
        logger.info(`Installed: ${status.installed ? chalk.green('Yes') : chalk.red('No')}`);
        logger.info(`Running: ${status.running ? chalk.green('Yes') : chalk.red('No')}`);
        if (status.version) {
            logger.info(`Version: ${chalk.cyan(status.version)}`);
        }
        if (status.errors.length > 0) {
            logger.newline();
            logger.warn('Configuration Issues:');
            status.errors.forEach(e => logger.error(`  • ${e}`));
        }
        // Connection status
        if (status.installed) {
            section('Connection');
            logger.info(`Status: ${formatTunnelStatus(tunnelInfo.status)}`);
            if (status.mode) {
                logger.info(`Mode: ${chalk.cyan(status.mode.toUpperCase())}`);
            }
            if (tunnelInfo.publicUrl) {
                logger.info(`Public URL: ${chalk.cyan(tunnelInfo.publicUrl)}`);
            }
            if (tunnelInfo.serverUrl) {
                logger.info(`Server: ${chalk.gray(tunnelInfo.serverUrl)}`);
            }
            if (tunnelInfo.connectedAt) {
                logger.info(`Connected: ${formatDuration(Date.now() - tunnelInfo.connectedAt.getTime())}`);
            }
            if (tunnelInfo.latency) {
                logger.info(`Latency: ${chalk.cyan(`${tunnelInfo.latency}ms`)}`);
            }
            if (options.verbose && tunnelInfo.bytesTransferred) {
                logger.info(`Data Sent: ${chalk.gray(formatBytes(tunnelInfo.bytesTransferred.sent))}`);
                logger.info(`Data Received: ${chalk.gray(formatBytes(tunnelInfo.bytesTransferred.received))}`);
            }
        }
        // Active tunnels
        if (tunnels.length > 0) {
            section('Active Tunnels');
            tunnels.forEach(t => {
                const statusIcon = t.status === 'active' ? chalk.green('●') : chalk.gray('○');
                logger.info(`${statusIcon} ${chalk.bold(t.name)}`);
                logger.info(`   Local Port: ${chalk.cyan(t.localPort)}`);
                if (t.remotePort) {
                    logger.info(`   Remote Port: ${chalk.cyan(t.remotePort)}`);
                }
                if (t.url) {
                    logger.info(`   URL: ${chalk.cyan.underline(t.url)}`);
                }
            });
        }
    }
    catch (error) {
        logger.error(`Failed to get detailed status: ${error.message}`);
        process.exit(1);
    }
}
/**
 * Show tunnel URL
 */
async function showTunnelUrl(options) {
    try {
        const url = await pangolinService.getTunnelUrl();
        if (options.json) {
            console.log(JSON.stringify({ publicUrl: url }, null, 2));
            return;
        }
        if (url) {
            console.log(url);
        }
        else {
            logger.warn('No public URL configured');
            logger.info('Run ' + chalk.cyan('hestia tunnel:enable') + ' to set up tunnel');
            process.exit(1);
        }
    }
    catch (error) {
        logger.error(`Failed to get tunnel URL: ${error.message}`);
        process.exit(1);
    }
}
/**
 * Show tunnel logs
 */
async function showTunnelLogs(options) {
    try {
        const lines = parseInt(options.lines || '100', 10);
        if (options.follow) {
            logger.info('Following logs (press Ctrl+C to exit)...');
            logger.newline();
            await pangolinService.followLogs();
        }
        else {
            const logs = await pangolinService.getLogs(lines);
            if (logs.trim()) {
                console.log(logs);
            }
            else {
                logger.info('No logs available');
            }
        }
    }
    catch (error) {
        logger.error(`Failed to get logs: ${error.message}`);
        process.exit(1);
    }
}
/**
 * List active tunnels
 */
async function listTunnels(options) {
    try {
        const tunnels = await pangolinService.listTunnels();
        if (options.json) {
            console.log(JSON.stringify(tunnels, null, 2));
            return;
        }
        if (tunnels.length === 0) {
            logger.info('No tunnels configured');
            return;
        }
        logger.header('ACTIVE TUNNELS');
        tunnels.forEach(t => {
            const statusIcon = t.status === 'active' ? chalk.green('●') : chalk.gray('○');
            const status = t.status === 'active' ? chalk.green('Active') : chalk.gray('Inactive');
            logger.info(`${statusIcon} ${chalk.bold(t.name)} (${status})`);
            logger.info(`   Local Port: ${chalk.cyan(t.localPort)}`);
            if (t.remotePort) {
                logger.info(`   Remote Port: ${chalk.cyan(t.remotePort)}`);
            }
            if (t.url) {
                logger.info(`   URL: ${chalk.cyan.underline(t.url)}`);
            }
            logger.newline();
        });
    }
    catch (error) {
        logger.error(`Failed to list tunnels: ${error.message}`);
        process.exit(1);
    }
}
/**
 * Update tunnel configuration
 */
async function updateTunnelConfig(options) {
    try {
        const { addTunnel, removeTunnel } = options;
        if (!addTunnel && !removeTunnel) {
            logger.info('Use --add-tunnel name:port or --remove-tunnel name');
            return;
        }
        if (addTunnel) {
            const [name, portStr] = addTunnel.split(':');
            if (!name || !portStr) {
                logger.error('Invalid format. Use: name:port');
                process.exit(1);
            }
            const port = parseInt(portStr, 10);
            if (isNaN(port) || port < 1 || port > 65535) {
                logger.error('Invalid port number');
                process.exit(1);
            }
            // Get current tunnels
            const currentTunnels = await pangolinService.listTunnels();
            // Add new tunnel
            const newTunnels = [
                ...currentTunnels.map(t => ({
                    name: t.name,
                    localPort: t.localPort,
                    protocol: 'tcp',
                })),
                { name, localPort: port, protocol: 'tcp' },
            ];
            const success = pangolinService.updateConfig({
                tunnels: newTunnels,
            });
            if (success) {
                logger.success(`Added tunnel: ${name} (port ${port})`);
                logger.info('Restart tunnel to apply: ' + chalk.cyan('hestia tunnel:restart'));
            }
            else {
                logger.error('Failed to add tunnel');
                process.exit(1);
            }
        }
        if (removeTunnel) {
            const currentTunnels = await pangolinService.listTunnels();
            const newTunnels = currentTunnels
                .filter(t => t.name !== removeTunnel)
                .map(t => ({
                name: t.name,
                localPort: t.localPort,
                protocol: 'tcp',
            }));
            const success = pangolinService.updateConfig({
                tunnels: newTunnels,
            });
            if (success) {
                logger.success(`Removed tunnel: ${removeTunnel}`);
                logger.info('Restart tunnel to apply: ' + chalk.cyan('hestia tunnel:restart'));
            }
            else {
                logger.error('Failed to remove tunnel');
                process.exit(1);
            }
        }
    }
    catch (error) {
        logger.error(`Failed to update config: ${error.message}`);
        process.exit(1);
    }
}
/**
 * Restart tunnel service
 */
async function restartTunnel() {
    try {
        await withSpinner('Restarting tunnel service...', async () => pangolinService.restart(), 'Tunnel service restarted');
    }
    catch (error) {
        logger.error(`Failed to restart tunnel: ${error.message}`);
        process.exit(1);
    }
}
// ===========================================================================
// HELPERS
// ===========================================================================
function formatTunnelStatus(status) {
    switch (status) {
        case 'connected':
            return chalk.green('Connected');
        case 'connecting':
            return chalk.yellow('Connecting...');
        case 'disconnected':
            return chalk.gray('Disconnected');
        case 'error':
            return chalk.red('Error');
        default:
            return chalk.gray('Unknown');
    }
}
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0)
        return `${days}d ${hours % 24}h`;
    if (hours > 0)
        return `${hours}h ${minutes % 60}m`;
    if (minutes > 0)
        return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}
function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}
async function detectNetworkType() {
    try {
        // This would use an external service to detect public IP
        // For now, return unknown
        return 'unknown';
    }
    catch {
        return 'unknown';
    }
}
function generateSecureToken() {
    try {
        return randomBytes(32).toString('hex');
    }
    catch {
        // Fallback
        return Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15);
    }
}
//# sourceMappingURL=tunnel.js.map