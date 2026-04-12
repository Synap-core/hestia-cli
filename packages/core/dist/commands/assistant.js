/**
 * assistant command - OpenClaw AI Assistant integration for Hestia
 * Usage: hestia assistant [subcommand]
 *
 * Manages the OpenClaw personal AI assistant including:
 * - Starting/stopping the assistant
 * - Managing skills
 * - Configuring communication platforms
 * - Sending messages and viewing activity
 */
import { openclawService } from '../lib/openclaw-service.js';
import { logger } from '../lib/logger.js';
import { stateManager } from '../lib/state-manager.js';
import inquirer from 'inquirer';
import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
export function assistantCommand(program) {
    const assistant = program
        .command('assistant')
        .description('Manage OpenClaw AI assistant')
        .option('-v, --verbose', 'Show detailed output')
        .option('--debug', 'Enable debug logging')
        .option('-f, --foreground', 'Run in foreground mode');
    // Default command - start assistant
    assistant
        .command('start', { isDefault: true })
        .description('Start the OpenClaw assistant')
        .option('-p, --port <port>', 'Port to run on', '3001')
        .option('-a, --api-port <port>', 'API port', '3002')
        .action(async (options) => {
        try {
            await startAssistant(options);
        }
        catch (error) {
            logger.error(`Failed to start assistant: ${error.message}`);
            process.exit(1);
        }
    });
    // Status command
    assistant
        .command('status')
        .alias('s')
        .description('Show assistant status')
        .action(async () => {
        try {
            await showStatus();
        }
        catch (error) {
            logger.error(`Failed to get status: ${error.message}`);
            process.exit(1);
        }
    });
    // Setup command
    assistant
        .command('setup')
        .description('First-time setup for OpenClaw')
        .action(async () => {
        try {
            await setupAssistant();
        }
        catch (error) {
            logger.error(`Setup failed: ${error.message}`);
            process.exit(1);
        }
    });
    // Stop command
    assistant
        .command('stop')
        .description('Stop the assistant')
        .action(async () => {
        try {
            await stopAssistant();
        }
        catch (error) {
            logger.error(`Failed to stop assistant: ${error.message}`);
            process.exit(1);
        }
    });
    // Skill management command
    assistant
        .command('skill <action>')
        .description('Manage assistant skills (list, add, remove, enable, disable)')
        .action(async (action) => {
        try {
            await manageSkills(action);
        }
        catch (error) {
            logger.error(`Skill command failed: ${error.message}`);
            process.exit(1);
        }
    });
    // Comms configuration command
    assistant
        .command('comm <platform>')
        .description('Configure communication platform (telegram, whatsapp, discord, imessage)')
        .action(async (platform) => {
        try {
            await configureComms(platform.toLowerCase());
        }
        catch (error) {
            logger.error(`Comm configuration failed: ${error.message}`);
            process.exit(1);
        }
    });
    // Send message command
    assistant
        .command('send <message>')
        .description('Send a message to the assistant')
        .option('-p, --platform <platform>', 'Platform to simulate (telegram, whatsapp, etc)')
        .action(async (message, options) => {
        try {
            await sendMessage(message, options.platform);
        }
        catch (error) {
            logger.error(`Failed to send message: ${error.message}`);
            process.exit(1);
        }
    });
    // Activity command
    assistant
        .command('activity')
        .description('Show recent assistant activity')
        .option('-l, --limit <n>', 'Number of entries to show', '20')
        .option('-s, --since <time>', 'Show since (e.g., 1h, 1d, 7d)')
        .option('-t, --type <type>', 'Filter by type (message, skill_call, tool_use, error, system)')
        .action(async (options) => {
        try {
            await showActivity(options);
        }
        catch (error) {
            logger.error(`Failed to get activity: ${error.message}`);
            process.exit(1);
        }
    });
    // Register aliases for subcommands
    program
        .command('assistant:status')
        .description('Alias for: assistant status')
        .action(async () => {
        try {
            await showStatus();
        }
        catch (error) {
            logger.error(`Failed to get status: ${error.message}`);
            process.exit(1);
        }
    });
    program
        .command('assistant:setup')
        .description('Alias for: assistant setup')
        .action(async () => {
        try {
            await setupAssistant();
        }
        catch (error) {
            logger.error(`Setup failed: ${error.message}`);
            process.exit(1);
        }
    });
    program
        .command('assistant:stop')
        .description('Alias for: assistant stop')
        .action(async () => {
        try {
            await stopAssistant();
        }
        catch (error) {
            logger.error(`Failed to stop assistant: ${error.message}`);
            process.exit(1);
        }
    });
    program
        .command('assistant:skill <action>')
        .description('Alias for: assistant skill <action>')
        .action(async (action) => {
        try {
            await manageSkills(action);
        }
        catch (error) {
            logger.error(`Skill command failed: ${error.message}`);
            process.exit(1);
        }
    });
    program
        .command('assistant:comm <platform>')
        .description('Alias for: assistant comm <platform>')
        .action(async (platform) => {
        try {
            await configureComms(platform.toLowerCase());
        }
        catch (error) {
            logger.error(`Comm configuration failed: ${error.message}`);
            process.exit(1);
        }
    });
    program
        .command('assistant:send <message>')
        .description('Alias for: assistant send <message>')
        .option('-p, --platform <platform>', 'Platform to simulate')
        .action(async (message, options) => {
        try {
            await sendMessage(message, options.platform);
        }
        catch (error) {
            logger.error(`Failed to send message: ${error.message}`);
            process.exit(1);
        }
    });
    program
        .command('assistant:activity')
        .description('Alias for: assistant activity')
        .option('-l, --limit <n>', 'Number of entries', '20')
        .option('-s, --since <time>', 'Show since (e.g., 1h, 1d)')
        .option('-t, --type <type>', 'Filter by type')
        .action(async (options) => {
        try {
            await showActivity(options);
        }
        catch (error) {
            logger.error(`Failed to get activity: ${error.message}`);
            process.exit(1);
        }
    });
}
// ============================================================================
// SUBCOMMAND IMPLEMENTATIONS
// ============================================================================
/**
 * Start the OpenClaw assistant
 */
async function startAssistant(options) {
    logger.header('STARTING OPENCLAW ASSISTANT');
    // Check if installed
    const isInstalled = await openclawService.isInstalled();
    if (!isInstalled) {
        logger.warn('OpenClaw is not installed. Run setup first.');
        logger.info('Run: hestia assistant:setup');
        process.exit(1);
    }
    // Check if already running
    const isRunning = await openclawService.isRunning();
    if (isRunning) {
        logger.success('OpenClaw is already running');
        return;
    }
    // Sync Hestia config
    logger.info('Synchronizing Hestia configuration...');
    try {
        await openclawService.syncWithHestia();
        logger.success('Configuration synchronized');
    }
    catch (error) {
        logger.warn('Failed to sync configuration, continuing with local config');
    }
    // Start OpenClaw
    logger.info('Starting OpenClaw process...');
    await openclawService.start({
        port: parseInt(options.port),
        apiPort: parseInt(options.apiPort),
        foreground: options.foreground,
        debug: options.debug,
    });
    // Get config for assistant name
    const config = await openclawService.getConfig();
    // Show startup message
    logger.newline();
    logger.header('ASSISTANT STARTED');
    logger.success(`OpenClaw is now running on port ${options.port}`);
    logger.info(`API endpoint: http://localhost:${options.apiPort}`);
    logger.info(`Skills directory: ${config.installPath}/skills`);
    logger.newline();
    logger.info(`Your assistant is ready to help! 💬`);
    logger.info(`Configure communication platforms with: hestia assistant:comm <platform>`);
    if (!options.foreground) {
        logger.info(`Run in foreground with: hestia assistant:start --foreground`);
    }
}
/**
 * Show assistant status
 */
async function showStatus() {
    logger.header('OPENCLAW ASSISTANT STATUS');
    const isInstalled = await openclawService.isInstalled();
    if (!isInstalled) {
        logger.warn('OpenClaw is not installed');
        logger.info('Run: hestia assistant:setup');
        return;
    }
    const status = await openclawService.getStatus();
    const config = await openclawService.getConfig();
    // Show running status
    const statusIcon = status.status === 'running' ? chalk.green('●') : chalk.red('●');
    logger.info(`Status: ${statusIcon} ${status.status.toUpperCase()}`);
    if (status.uptime) {
        logger.info(`Uptime: ${formatUptime(status.uptime)}`);
    }
    if (status.pid) {
        logger.info(`Process ID: ${status.pid}`);
    }
    logger.info(`Version: ${status.version || 'unknown'}`);
    logger.info(`Ports: ${status.port} (main) / ${status.apiPort} (API)`);
    // Show comms platforms
    logger.newline();
    logger.section('COMMUNICATION PLATFORMS');
    const platforms = ['telegram', 'whatsapp', 'discord', 'imessage'];
    const commsStatus = await openclawService.getCommsStatus();
    const commsTable = platforms.map((platform) => {
        const platformConfig = config.comms[platform];
        const status = commsStatus[platform];
        const icon = status?.enabled ? (status?.connected ? chalk.green('✓') : chalk.yellow('○')) : chalk.gray('✗');
        return {
            PLATFORM: platform.charAt(0).toUpperCase() + platform.slice(1),
            ENABLED: status?.enabled ? chalk.green('Yes') : chalk.gray('No'),
            CONNECTED: status?.connected ? chalk.green('Yes') : chalk.gray('No'),
            STATUS: `${icon} ${platformConfig?.enabled ? (status?.connected ? 'Active' : 'Disconnected') : 'Disabled'}`,
        };
    });
    logger.table(commsTable);
    // Show skills
    logger.newline();
    logger.section('INSTALLED SKILLS');
    const skills = await openclawService.listSkills();
    if (skills.length === 0) {
        logger.info('No skills installed');
        logger.info('Add skills with: hestia assistant:skill add');
    }
    else {
        const skillsTable = skills.map((skill) => ({
            NAME: skill.name,
            VERSION: skill.version,
            LANGUAGE: skill.language,
            STATUS: skill.enabled ? chalk.green('Enabled') : chalk.gray('Disabled'),
            TAGS: skill.tags.slice(0, 3).join(', ') || '-',
        }));
        logger.table(skillsTable);
        logger.info(`Total: ${skills.length} skills (${skills.filter((s) => s.enabled).length} enabled)`);
    }
    // Show recent activity
    logger.newline();
    logger.section('RECENT ACTIVITY');
    const activities = await openclawService.getActivity({ limit: 5 });
    if (activities.length === 0) {
        logger.info('No recent activity');
    }
    else {
        activities.forEach((activity) => {
            const icon = getActivityIcon(activity.type);
            const time = formatTimeAgo(activity.timestamp);
            logger.info(`${icon} [${time}] ${activity.content.substring(0, 60)}${activity.content.length > 60 ? '...' : ''}`);
        });
        logger.info(`\nView full activity: hestia assistant:activity`);
    }
    // Show stats
    logger.newline();
    logger.section('STATISTICS');
    logger.info(`Messages received: ${status.stats.messagesReceived}`);
    logger.info(`Messages sent: ${status.stats.messagesSent}`);
    logger.info(`Skills called: ${status.stats.skillsCalled}`);
    logger.info(`Errors: ${status.stats.errors > 0 ? chalk.red(String(status.stats.errors)) : status.stats.errors}`);
}
/**
 * First-time setup for OpenClaw
 */
async function setupAssistant() {
    logger.header('OPENCLAW SETUP');
    // Check if already installed
    const isInstalled = await openclawService.isInstalled();
    if (isInstalled) {
        const { reinstall } = await inquirer.prompt([{
                type: 'confirm',
                name: 'reinstall',
                message: 'OpenClaw is already installed. Reinstall?',
                default: false,
            }]);
        if (!reinstall) {
            logger.info('Setup cancelled');
            return;
        }
    }
    // Configure assistant name
    logger.newline();
    logger.section('ASSISTANT CONFIGURATION');
    const { assistantName } = await inquirer.prompt([{
            type: 'input',
            name: 'assistantName',
            message: 'What would you like to name your assistant?',
            default: 'Claw',
        }]);
    // Install OpenClaw
    logger.newline();
    logger.info('Installing OpenClaw...');
    const method = await openclawService.install({ method: 'git' });
    logger.success(`OpenClaw installed via ${method}`);
    // Store name in runtime state
    stateManager.setRuntimeValue('assistantName', assistantName);
    // Setup communication platforms
    logger.newline();
    logger.section('COMMUNICATION PLATFORMS');
    logger.info('Configure how your assistant can communicate with you');
    const platforms = ['telegram', 'whatsapp', 'discord', 'imessage'];
    for (const platform of platforms) {
        const { enable } = await inquirer.prompt([{
                type: 'confirm',
                name: 'enable',
                message: `Enable ${platform.charAt(0).toUpperCase() + platform.slice(1)}?`,
                default: platform === 'telegram',
            }]);
        if (enable) {
            await configureCommsPlatformInteractive(platform);
        }
    }
    // Create default skills
    logger.newline();
    logger.section('DEFAULT SKILLS');
    await createDefaultSkills();
    // Show completion message
    logger.newline();
    logger.header('SETUP COMPLETE');
    logger.success(`Your assistant "${assistantName}" is ready!`);
    logger.info('Start the assistant with: hestia assistant:start');
    logger.info('View status with: hestia assistant:status');
}
/**
 * Stop the assistant
 */
async function stopAssistant() {
    logger.header('STOPPING OPENCLAW');
    const isRunning = await openclawService.isRunning();
    if (!isRunning) {
        logger.warn('OpenClaw is not running');
        return;
    }
    await openclawService.stop();
    logger.success('OpenClaw stopped successfully');
}
/**
 * Manage skills
 */
async function manageSkills(action) {
    const validActions = ['list', 'add', 'remove', 'enable', 'disable'];
    if (!validActions.includes(action)) {
        logger.error(`Invalid action: ${action}`);
        logger.info(`Valid actions: ${validActions.join(', ')}`);
        process.exit(1);
    }
    switch (action) {
        case 'list':
            await listSkills();
            break;
        case 'add':
            await addSkill();
            break;
        case 'remove':
            await removeSkill();
            break;
        case 'enable':
            await toggleSkill(true);
            break;
        case 'disable':
            await toggleSkill(false);
            break;
    }
}
async function listSkills() {
    logger.header('INSTALLED SKILLS');
    const skills = await openclawService.listSkills();
    if (skills.length === 0) {
        logger.info('No skills installed');
        return;
    }
    const tableData = skills.map((skill) => ({
        NAME: skill.name,
        VERSION: skill.version,
        LANGUAGE: skill.language,
        ENABLED: skill.enabled ? chalk.green('●') : chalk.gray('○'),
        DESCRIPTION: skill.description.substring(0, 40) + (skill.description.length > 40 ? '...' : ''),
    }));
    logger.table(tableData);
    logger.info(`\nTotal: ${skills.length} skills (${skills.filter((s) => s.enabled).length} enabled)`);
}
async function addSkill() {
    logger.header('ADD SKILL');
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'name',
            message: 'Skill name:',
            validate: (input) => input.length > 0 || 'Name is required',
        },
        {
            type: 'input',
            name: 'description',
            message: 'Description:',
            default: 'A custom skill',
        },
        {
            type: 'list',
            name: 'source',
            message: 'How would you like to provide the skill code?',
            choices: [
                { name: 'Write code interactively', value: 'interactive' },
                { name: 'Read from file', value: 'file' },
                { name: 'Use template', value: 'template' },
            ],
        },
        {
            type: 'list',
            name: 'language',
            message: 'Programming language:',
            choices: ['typescript', 'javascript', 'python'],
            when: (answers) => answers.source !== 'file',
        },
    ]);
    let code;
    if (answers.source === 'file') {
        const { filePath } = await inquirer.prompt([{
                type: 'input',
                name: 'filePath',
                message: 'Path to skill file:',
                validate: async (input) => {
                    try {
                        await fs.access(input);
                        return true;
                    }
                    catch {
                        return 'File not found';
                    }
                },
            }]);
        code = await fs.readFile(filePath, 'utf-8');
        // Detect language from extension
        const ext = path.extname(filePath);
        answers.language = ext === '.ts' ? 'typescript' : ext === '.py' ? 'python' : 'javascript';
    }
    else if (answers.source === 'template') {
        code = getSkillTemplate(answers.language);
    }
    else {
        logger.info('Enter your skill code (press Ctrl+D when done):');
        // For interactive input, we'd need a more complex input handler
        // For now, use a simple template
        code = getSkillTemplate(answers.language);
    }
    const skillCode = {
        metadata: {
            name: answers.name,
            version: '1.0.0',
            description: answers.description,
            language: answers.language,
            tags: ['custom'],
            entryPoint: `index.${answers.language === 'typescript' ? 'ts' : answers.language === 'python' ? 'py' : 'js'}`,
            enabled: true,
            installedAt: new Date(),
            lastUpdated: new Date(),
        },
        code,
    };
    await openclawService.addSkill(answers.name, skillCode);
    logger.success(`Skill '${answers.name}' added successfully`);
}
async function removeSkill() {
    const skills = await openclawService.listSkills();
    if (skills.length === 0) {
        logger.warn('No skills to remove');
        return;
    }
    const { skillName } = await inquirer.prompt([{
            type: 'list',
            name: 'skillName',
            message: 'Select skill to remove:',
            choices: skills.map((s) => ({ name: `${s.name} (${s.description})`, value: s.name })),
        }]);
    const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: `Are you sure you want to remove '${skillName}'?`,
            default: false,
        }]);
    if (!confirm) {
        logger.info('Removal cancelled');
        return;
    }
    await openclawService.removeSkill(skillName);
    logger.success(`Skill '${skillName}' removed`);
}
async function toggleSkill(enable) {
    const skills = await openclawService.listSkills();
    if (skills.length === 0) {
        logger.warn('No skills available');
        return;
    }
    const action = enable ? 'enable' : 'disable';
    const filtered = skills.filter((s) => (enable ? !s.enabled : s.enabled));
    if (filtered.length === 0) {
        logger.info(`No skills to ${action}`);
        return;
    }
    const { skillName } = await inquirer.prompt([{
            type: 'list',
            name: 'skillName',
            message: `Select skill to ${action}:`,
            choices: filtered.map((s) => ({ name: s.name, value: s.name })),
        }]);
    await openclawService.toggleSkill(skillName, enable);
}
/**
 * Configure communication platform
 */
async function configureComms(platform) {
    logger.header(`CONFIGURE ${platform.toUpperCase()}`);
    const validPlatforms = ['telegram', 'whatsapp', 'discord', 'imessage'];
    if (!validPlatforms.includes(platform)) {
        logger.error(`Invalid platform: ${platform}`);
        logger.info(`Valid platforms: ${validPlatforms.join(', ')}`);
        process.exit(1);
    }
    await configureCommsPlatformInteractive(platform);
}
async function configureCommsPlatformInteractive(platform) {
    const config = {
        enabled: true,
        autoReply: true,
    };
    switch (platform) {
        case 'telegram':
            logger.info('To create a Telegram bot:');
            logger.info('1. Message @BotFather on Telegram');
            logger.info('2. Use /newbot command');
            logger.info('3. Copy the bot token here');
            logger.newline();
            const telegramAnswer = await inquirer.prompt([{
                    type: 'password',
                    name: 'token',
                    message: 'Bot token:',
                    mask: '*',
                    validate: (input) => input.length > 0 || 'Token is required',
                }]);
            config.botToken = telegramAnswer.token;
            break;
        case 'whatsapp':
            logger.info(chalk.yellow('WhatsApp Setup:'));
            logger.info('You will need to scan a QR code with your WhatsApp app');
            logger.info('After configuration, the QR code will be displayed');
            logger.newline();
            const whatsappAnswer = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'ready',
                    message: 'Ready to proceed?',
                    default: true,
                }]);
            if (!whatsappAnswer.ready) {
                logger.info('Configuration cancelled');
                return;
            }
            // WhatsApp uses different auth method (QR code)
            config.apiKey = 'qr-auth';
            break;
        case 'discord':
            logger.info('To create a Discord bot:');
            logger.info('1. Go to https://discord.com/developers/applications');
            logger.info('2. Create a new application');
            logger.info('3. Go to Bot section and copy the token');
            logger.newline();
            const discordAnswer = await inquirer.prompt([{
                    type: 'password',
                    name: 'token',
                    message: 'Bot token:',
                    mask: '*',
                    validate: (input) => input.length > 0 || 'Token is required',
                }]);
            config.botToken = discordAnswer.token;
            break;
        case 'imessage':
            if (process.platform !== 'darwin') {
                logger.error('iMessage integration is only available on macOS');
                return;
            }
            logger.warn(chalk.yellow('Warning: iMessage integration requires macOS and may have limitations'));
            logger.info('Your Mac must be running and unlocked for iMessage to work');
            const imessageAnswer = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'accept',
                    message: 'Do you want to continue?',
                    default: false,
                }]);
            if (!imessageAnswer.accept) {
                logger.info('Configuration cancelled');
                return;
            }
            break;
    }
    // Auto-reply setting
    const autoReplyAnswer = await inquirer.prompt([{
            type: 'confirm',
            name: 'autoReply',
            message: 'Enable auto-reply? (assistant responds to all messages)',
            default: true,
        }]);
    config.autoReply = autoReplyAnswer.autoReply;
    // Save configuration
    await openclawService.configureComms(platform, config);
    logger.success(`${platform.charAt(0).toUpperCase() + platform.slice(1)} configured`);
    // Test connection if possible
    if (platform !== 'whatsapp') {
        logger.info('Testing connection...');
        try {
            const testResult = await openclawService.testCommsConnection(platform);
            if (testResult.success) {
                logger.success('Connection test passed');
            }
            else {
                logger.warn(`Connection test failed: ${testResult.message}`);
            }
        }
        catch (error) {
            logger.warn(`Could not test connection: ${error.message}`);
        }
    }
    else {
        logger.info('Start the assistant and scan the QR code that will be displayed');
    }
}
/**
 * Send message to assistant
 */
async function sendMessage(message, platform) {
    logger.header('SEND MESSAGE');
    const isRunning = await openclawService.isRunning();
    if (!isRunning) {
        logger.error('OpenClaw is not running. Start it first with: hestia assistant:start');
        process.exit(1);
    }
    logger.info(`You: ${message}`);
    try {
        const response = await openclawService.sendMessage(message, {
            platform: platform,
        });
        logger.newline();
        logger.info(`${chalk.cyan('Assistant:')} ${response.response}`);
        if (response.metadata) {
            logger.debug('Metadata:', response.metadata);
        }
    }
    catch (error) {
        logger.error(`Failed to send message: ${error.message}`);
        throw error;
    }
}
/**
 * Show recent activity
 */
async function showActivity(options) {
    logger.header('ASSISTANT ACTIVITY');
    const limit = parseInt(String(options.limit || '20'));
    let since;
    if (options.since) {
        const now = new Date();
        const match = options.since.match(/^(\d+)([hdm])$/);
        if (match) {
            const [, num, unit] = match;
            const multiplier = unit === 'h' ? 3600000 : unit === 'd' ? 86400000 : 60000;
            since = new Date(now.getTime() - parseInt(num) * multiplier);
        }
    }
    const activities = await openclawService.getActivity({
        limit,
        since,
        type: options.type,
    });
    if (activities.length === 0) {
        logger.info('No activity found');
        return;
    }
    // Group by date
    let currentDate = '';
    activities.forEach((activity) => {
        const date = activity.timestamp.toDateString();
        if (date !== currentDate) {
            currentDate = date;
            logger.newline();
            logger.section(date);
        }
        const icon = getActivityIcon(activity.type);
        const time = activity.timestamp.toLocaleTimeString();
        const platform = activity.platform ? `[${activity.platform}] ` : '';
        logger.info(`${icon} [${time}] ${chalk.gray(platform)}${activity.content}`);
    });
    logger.newline();
    logger.info(`Showing ${activities.length} entries`);
    // Show statistics
    const stats = activities.reduce((acc, a) => {
        acc[a.type] = (acc[a.type] || 0) + 1;
        return acc;
    }, {});
    logger.newline();
    logger.section('STATISTICS');
    Object.entries(stats).forEach(([type, count]) => {
        logger.info(`${type}: ${count}`);
    });
}
// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
/**
 * Create default skills during setup
 */
async function createDefaultSkills() {
    const defaults = [
        {
            name: 'help',
            description: 'Provides help and usage information',
            language: 'typescript',
            code: getSkillTemplate('typescript').replace('// Your skill logic here', `
// Help skill - provides usage information
export async function handle(message: string, context: any) {
  return \`
Available commands:
- help: Show this message
- status: Check assistant status
- whoami: Get information about me
\`;
}`),
        },
        {
            name: 'whoami',
            description: 'Responds with information about the assistant',
            language: 'typescript',
            code: getSkillTemplate('typescript').replace('// Your skill logic here', `
// Whoami skill - assistant identity
export async function handle(message: string, context: any) {
  return \`I am \${context.assistantName || 'Claw'}, your AI assistant powered by OpenClaw and Hestia.
I'm here to help you with tasks, answer questions, and integrate with your systems.\`;
}`),
        },
    ];
    for (const skill of defaults) {
        try {
            const existing = await openclawService.listSkills();
            if (!existing.find((s) => s.name === skill.name)) {
                await openclawService.addSkill(skill.name, {
                    metadata: {
                        name: skill.name,
                        version: '1.0.0',
                        description: skill.description,
                        language: skill.language,
                        tags: ['default', 'system'],
                        entryPoint: 'index.ts',
                        enabled: true,
                        installedAt: new Date(),
                        lastUpdated: new Date(),
                    },
                    code: skill.code,
                });
                logger.success(`Created default skill: ${skill.name}`);
            }
        }
        catch (error) {
            logger.warn(`Failed to create skill ${skill.name}: ${error}`);
        }
    }
}
/**
 * Get skill template based on language
 */
function getSkillTemplate(language) {
    const templates = {
        typescript: `/**
 * Skill: {{name}}
 * Description: {{description}}
 */

export interface SkillContext {
  userId: string;
  assistantName: string;
  config: Record<string, any>;
}

export interface SkillResult {
  response: string;
  metadata?: Record<string, any>;
}

export async function handle(
  message: string,
  context: SkillContext
): Promise<SkillResult> {
  // Your skill logic here
  
  return {
    response: "Hello from your skill!",
    metadata: { executed: true }
  };
}

export default handle;
`,
        javascript: `/**
 * Skill: {{name}}
 * Description: {{description}}
 */

async function handle(message, context) {
  // Your skill logic here
  
  return {
    response: "Hello from your skill!",
    metadata: { executed: true }
  };
}

module.exports = handle;
`,
        python: `"""
Skill: {{name}}
Description: {{description}}
"""

async def handle(message: str, context: dict) -> dict:
    # Your skill logic here
    
    return {
        "response": "Hello from your skill!",
        "metadata": {"executed": True}
    }
`,
    };
    return templates[language] || templates.javascript;
}
/**
 * Format uptime in human-readable format
 */
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
/**
 * Get icon for activity type
 */
function getActivityIcon(type) {
    const icons = {
        message: chalk.blue('💬'),
        skill_call: chalk.green('🔧'),
        tool_use: chalk.yellow('🛠️'),
        error: chalk.red('❌'),
        system: chalk.gray('⚙️'),
    };
    return icons[type] || chalk.gray('•');
}
/**
 * Format timestamp as relative time
 */
function formatTimeAgo(date) {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000)
        return 'just now';
    if (diff < 3600000)
        return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000)
        return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
}
//# sourceMappingURL=assistant.js.map