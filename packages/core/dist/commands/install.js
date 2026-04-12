/**
 * install command - Phase-based installation
 * Usage: hestia install [phase]
 */
import { logger, section } from '../lib/logger.js';
import { spinner } from '../lib/spinner.js';
import chalk from 'chalk';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { access, constants } from 'fs/promises';
const execAsync = promisify(exec);
export function installCommand(program) {
    program
        .command('install [phase]')
        .description('Run Hestia installation (phase1, phase2, phase3, or all)')
        .argument('[phase]', 'Installation phase', 'all')
        .option('-t, --target <path>', 'Installation target directory', '/opt/hestia')
        .option('-s, --safe-mode', 'Safe mode - preserve existing data')
        .option('-u, --unattended', 'Unattended installation (no prompts)')
        .option('--skip <phases...>', 'Skip specific phases (comma-separated)')
        .option('--dry-run', 'Show what would be done without executing')
        .action(async (phase, options) => {
        try {
            logger.header('HESTIA INSTALLER');
            // Validate phase
            const validPhases = ['phase1', 'phase2', 'phase3'];
            const phasesToRun = phase === 'all'
                ? validPhases
                : [phase];
            if (!validPhases.includes(phasesToRun[0]) && phase !== 'all') {
                logger.error(`Invalid phase: ${phase}`);
                logger.info(`Valid phases: ${validPhases.join(', ')}, all`);
                process.exit(1);
            }
            // Parse skip phases
            const skipPhases = options.skip ? options.skip.flatMap((s) => s.split(',')) : [];
            const filteredPhases = phasesToRun.filter((p) => !skipPhases.includes(p));
            if (filteredPhases.length === 0) {
                logger.info('All phases skipped. Nothing to do.');
                return;
            }
            logger.info(`Phases to run: ${filteredPhases.map((p) => chalk.cyan(p)).join(', ')}`);
            logger.info(`Target directory: ${chalk.cyan(options.target || '/opt/hestia')}`);
            logger.newline();
            // Pre-flight checks
            if (!options.dryRun) {
                const canProceed = await runPreflightChecks(options);
                if (!canProceed) {
                    logger.error('Pre-flight checks failed. Aborting.');
                    process.exit(1);
                }
            }
            // Run phases
            for (const p of filteredPhases) {
                await runPhase(p, options);
            }
            logger.newline();
            logger.success('Installation complete! 🔥');
            // Show next steps
            if (phase === 'all' || phase === 'phase3') {
                logger.newline();
                section('Next Steps');
                logger.info(`1. Initialize Hestia: ${chalk.cyan('hestia init')}`);
                logger.info(`2. Add packages: ${chalk.cyan('hestia add <package>')}`);
                logger.info(`3. Ignite hearth: ${chalk.cyan('hestia ignite')}`);
            }
        }
        catch (error) {
            logger.error(`Installation failed: ${error.message}`);
            process.exit(1);
        }
    });
}
async function runPreflightChecks(options) {
    section('Pre-flight Checks');
    const checks = [
        { name: 'Root/sudo access', fn: checkSudo },
        { name: 'Target directory writable', fn: () => checkDirectory(options.target || '/opt/hestia') },
        { name: 'Internet connectivity', fn: checkInternet },
        { name: 'Docker available', fn: checkDocker },
    ];
    let allPassed = true;
    for (const check of checks) {
        spinner.start(`check-${check.name}`, `Checking: ${check.name}`);
        try {
            const passed = await check.fn();
            if (passed) {
                spinner.succeed(`check-${check.name}`, `${check.name}: OK`);
            }
            else {
                spinner.fail(`check-${check.name}`, `${check.name}: FAILED`);
                allPassed = false;
            }
        }
        catch (error) {
            spinner.fail(`check-${check.name}`, `${check.name}: ERROR - ${error.message}`);
            allPassed = false;
        }
    }
    logger.newline();
    return allPassed;
}
async function runPhase(phase, options) {
    section(`Running ${phase.toUpperCase()}`);
    if (options.dryRun) {
        logger.info(chalk.gray('[DRY RUN] Would execute:'));
        logger.info(chalk.gray(`  ${getPhaseScript(phase)}`));
        return;
    }
    const scriptPath = getPhaseScript(phase);
    // Check if script exists
    try {
        await access(scriptPath, constants.X_OK);
    }
    catch {
        // Try to find script in different locations
        const altPaths = [
            `/opt/hestia/install/${phase}.sh`,
            `./packages/install/src/phases/${phase}.sh`,
            `${process.env.HOME}/.hestia/install/${phase}.sh`,
        ];
        let found = false;
        for (const alt of altPaths) {
            try {
                await access(alt, constants.X_OK);
                logger.debug(`Found phase script at: ${alt}`);
                found = true;
                break;
            }
            catch {
                continue;
            }
        }
        if (!found) {
            throw new Error(`Phase script not found: ${scriptPath}`);
        }
    }
    // Execute phase script
    const env = {
        ...process.env,
        HESTIA_TARGET: options.target || '/opt/hestia',
        HESTIA_SAFE_MODE: options.safeMode ? '1' : '0',
        HESTIA_UNATTENDED: options.unattended ? '1' : '0',
    };
    return new Promise((resolve, reject) => {
        const child = spawn('bash', [scriptPath], {
            stdio: options.unattended ? 'pipe' : 'inherit',
            env,
        });
        let output = '';
        if (options.unattended && child.stdout) {
            child.stdout.on('data', (data) => {
                output += data.toString();
            });
        }
        child.on('close', (code) => {
            if (code === 0) {
                logger.success(`${phase} completed successfully`);
                resolve();
            }
            else {
                reject(new Error(`${phase} failed with exit code ${code}`));
            }
        });
        child.on('error', (err) => {
            reject(new Error(`Failed to execute ${phase}: ${err.message}`));
        });
    });
}
function getPhaseScript(phase) {
    if (phase === 'all') {
        return '/opt/hestia/install/phases/phase1.sh';
    }
    const scriptMap = {
        phase1: '/opt/hestia/install/phases/phase1.sh',
        phase2: '/opt/hestia/install/phases/phase2.sh',
        phase3: '/opt/hestia/install/phases/phase3.sh',
    };
    return scriptMap[phase];
}
async function checkSudo() {
    try {
        if (process.getuid && process.getuid() === 0) {
            return true;
        }
        await execAsync('sudo -n true');
        return true;
    }
    catch {
        return false;
    }
}
async function checkDirectory(path) {
    try {
        await execAsync(`mkdir -p ${path}`);
        return true;
    }
    catch {
        return false;
    }
}
async function checkInternet() {
    try {
        await execAsync('curl -s --max-time 5 https://cloudflare.com > /dev/null');
        return true;
    }
    catch {
        return false;
    }
}
async function checkDocker() {
    try {
        await execAsync('docker version > /dev/null 2>&1');
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=install.js.map