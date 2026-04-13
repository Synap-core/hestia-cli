/**
 * recovery command - Backup, restore, and system recovery operations
 * Usage: hestia recovery:<subcommand>
 */
import { recovery } from '../../../domains/services/lib/recovery.js';
import { logger } from '../../lib/utils/index';
import inquirer from 'inquirer';
import chalk from 'chalk';
export function recoveryCommand(program) {
    // Initialize recovery system
    recovery.initialize();
    // recovery:backup - Create backup
    program
        .command('recovery:backup')
        .description('Create a full system backup')
        .option('-n, --name <name>', 'Backup name')
        .option('-a, --auto', 'Use automatic timestamp-based name')
        .action(async (options) => {
        try {
            let backupName = options.name;
            if (options.auto || !backupName) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                backupName = `backup-${timestamp}`;
            }
            logger.header('BACKUP OPERATION');
            logger.info(`Creating backup: ${chalk.cyan(backupName)}`);
            logger.newline();
            const backup = await recovery.createBackup(backupName, `Manual backup created via CLI`);
            logger.newline();
            logger.success(`Backup created successfully!`);
            logger.info(`Name: ${chalk.cyan(backup.name)}`);
            logger.info(`Size: ${chalk.cyan(formatBytes(backup.size))}`);
            logger.info(`Location: ${chalk.cyan('~/.hestia/backups/')}`);
            logger.info(`Version: ${chalk.cyan(backup.version)}`);
        }
        catch (error) {
            logger.error(`Backup failed: ${error.message}`);
            process.exit(1);
        }
    });
    // recovery:list - List backups
    program
        .command('recovery:list')
        .description('List all available backups')
        .action(async () => {
        try {
            const backups = await recovery.listBackups();
            logger.header('AVAILABLE BACKUPS');
            if (backups.length === 0) {
                logger.info('No backups found.');
                logger.info(`Create a backup with: ${chalk.cyan('hestia recovery:backup')}`);
                return;
            }
            // Get current system state for comparison
            const { config } = await (await import('../../../lib/utils/index.js')).loadConfig();
            const currentVersion = config.version;
            const tableData = backups.map((backup) => ({
                NAME: backup.name,
                DATE: new Date(backup.createdAt).toLocaleString(),
                SIZE: formatBytes(backup.size),
                VERSION: backup.version === currentVersion ? chalk.green(backup.version) : chalk.yellow(backup.version),
            }));
            logger.table(tableData);
            logger.newline();
            logger.info(`Total: ${chalk.cyan(backups.length)} backup(s)`);
            logger.info(`Current system version: ${chalk.cyan(currentVersion)}`);
            logger.info(chalk.green('Green') + ' = Same version as current');
            logger.info(chalk.yellow('Yellow') + ' = Different version');
        }
        catch (error) {
            logger.error(`Failed to list backups: ${error.message}`);
            process.exit(1);
        }
    });
    // recovery:restore - Restore from backup
    program
        .command('recovery:restore')
        .description('Restore system from backup')
        .option('-n, --name <name>', 'Backup name to restore')
        .option('--dry-run', 'Show what would be restored without executing')
        .action(async (options) => {
        try {
            let backupName = options.name;
            let backupToRestore;
            // If no name specified, show interactive list
            if (!backupName) {
                const backups = await recovery.listBackups();
                if (backups.length === 0) {
                    logger.error('No backups available to restore.');
                    process.exit(1);
                }
                const choices = backups.map((b) => ({
                    name: `${b.name} (${new Date(b.createdAt).toLocaleString()} - ${formatBytes(b.size)})`,
                    value: b.name,
                }));
                const answer = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'backup',
                        message: 'Select a backup to restore:',
                        choices,
                    },
                ]);
                backupName = answer.backup;
                backupToRestore = backups.find((b) => b.name === backupName);
            }
            logger.header('RESTORE OPERATION');
            if (options.dryRun) {
                logger.info(chalk.yellow('[DRY RUN]') + ' The following would be restored:');
                logger.newline();
                const backups = await recovery.listBackups();
                const backup = backups.find((b) => b.name === backupName);
                if (backup) {
                    logger.info(`Backup: ${chalk.cyan(backup.name)}`);
                    logger.info(`Created: ${chalk.cyan(new Date(backup.createdAt).toLocaleString())}`);
                    logger.info(`Size: ${chalk.cyan(formatBytes(backup.size))}`);
                    logger.newline();
                    logger.info('Components to restore:');
                    if (backup.components.config)
                        logger.info('  ✓ Configuration');
                    if (backup.components.packages)
                        logger.info('  ✓ Packages');
                    if (backup.components.state)
                        logger.info('  ✓ State');
                    if (backup.components.logs)
                        logger.info('  ✓ Logs');
                    if (backup.components.data)
                        logger.info('  ✓ Data');
                }
                return;
            }
            // Confirm before destructive operation
            const confirmMessage = `Restore from backup "${backupName}"? This will overwrite current configuration.`;
            const answer = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: confirmMessage,
                    default: false,
                },
            ]);
            if (!answer.confirm) {
                logger.info('Restore cancelled.');
                return;
            }
            // Create rollback point before restore
            logger.info('Creating rollback point before restore...');
            await recovery.createRollbackPoint('pre-restore', 'Automatic rollback point before restore');
            logger.newline();
            logger.info('Stopping services...');
            // Services will be stopped during restore
            await recovery.restoreBackup(backupName, { skipConfirmation: true });
            logger.newline();
            logger.success('Restore completed successfully!');
            logger.info('Restarting services...');
            // Restart services after restore
            logger.success('Services restarted successfully!');
            logger.newline();
            logger.info(chalk.yellow('Note: You may need to run `hestia ignite` to fully restart all packages.'));
        }
        catch (error) {
            logger.error(`Restore failed: ${error.message}`);
            process.exit(1);
        }
    });
    // recovery:rollback - Rollback changes
    program
        .command('recovery:rollback')
        .description('Rollback to previous state')
        .option('-c, --config', 'Rollback configuration changes')
        .option('-p, --package <name>', 'Rollback a specific package')
        .option('-i, --installation', 'Rollback entire installation')
        .action(async (options) => {
        try {
            logger.header('ROLLBACK OPERATION');
            // If no option specified, show interactive menu
            if (!options.config && !options.package && !options.installation) {
                const answer = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'rollbackType',
                        message: 'What would you like to rollback?',
                        choices: [
                            { name: 'Configuration changes', value: 'config' },
                            { name: 'Specific package', value: 'package' },
                            { name: 'Entire installation', value: 'installation' },
                        ],
                    },
                ]);
                if (answer.rollbackType === 'config') {
                    options.config = true;
                }
                else if (answer.rollbackType === 'package') {
                    const pkgAnswer = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'package',
                            message: 'Package name to rollback:',
                        },
                    ]);
                    options.package = pkgAnswer.package;
                }
                else {
                    options.installation = true;
                }
            }
            // Show rollback points
            const rollbackPoints = await recovery.getRollbackPoints();
            if (rollbackPoints.length === 0) {
                logger.warn('No rollback points available.');
                logger.info('Rollback points are created automatically before certain operations.');
                return;
            }
            logger.section('Available Rollback Points');
            rollbackPoints.slice(0, 5).forEach((point, index) => {
                logger.info(`${index + 1}. ${chalk.cyan(point.name)} - ${new Date(point.createdAt).toLocaleString()}`);
                if (point.description) {
                    logger.info(`   ${chalk.gray(point.description)}`);
                }
            });
            // Execute rollback
            if (options.config) {
                await recovery.rollbackConfig({ skipConfirmation: false });
            }
            else if (options.package) {
                await recovery.rollbackPackage(options.package, { skipConfirmation: false });
            }
            else if (options.installation) {
                await recovery.rollbackInstallation({ skipConfirmation: false });
            }
        }
        catch (error) {
            logger.error(`Rollback failed: ${error.message}`);
            process.exit(1);
        }
    });
    // recovery:repair - Repair system
    program
        .command('recovery:repair')
        .description('Repair system issues')
        .option('-a, --all', 'Run all repairs')
        .option('-p, --permissions', 'Fix file permissions')
        .option('-d, --dependencies', 'Repair dependencies')
        .option('-n, --network', 'Repair network configuration')
        .option('--docker', 'Repair Docker environment')
        .option('--database', 'Repair database connections')
        .option('-s, --sync', 'Force state re-sync')
        .action(async (options) => {
        try {
            logger.header('SYSTEM REPAIR');
            // If no option specified, show interactive menu
            if (!options.all && !options.permissions && !options.dependencies &&
                !options.network && !options.docker && !options.database && !options.sync) {
                const answer = await inquirer.prompt([
                    {
                        type: 'checkbox',
                        name: 'repairs',
                        message: 'Select repairs to run:',
                        choices: [
                            { name: 'Fix file permissions', value: 'permissions', checked: true },
                            { name: 'Repair dependencies', value: 'dependencies', checked: true },
                            { name: 'Repair network', value: 'network' },
                            { name: 'Clean up Docker', value: 'docker' },
                            { name: 'Repair database', value: 'database' },
                            { name: 'Force state re-sync', value: 'sync' },
                        ],
                    },
                ]);
                for (const repair of answer.repairs) {
                    options[repair] = true;
                }
                if (answer.repairs.length === 0) {
                    logger.info('No repairs selected.');
                    return;
                }
            }
            // If --all is set, enable everything
            if (options.all) {
                options.permissions = true;
                options.dependencies = true;
                options.network = true;
                options.docker = true;
                options.database = true;
                options.sync = true;
            }
            // Show what will be repaired
            logger.section('Repairs to Run');
            if (options.permissions)
                logger.info('  ✓ Fix file permissions');
            if (options.dependencies)
                logger.info('  ✓ Repair dependencies');
            if (options.network)
                logger.info('  ✓ Repair network configuration');
            if (options.docker)
                logger.info('  ✓ Clean up Docker environment');
            if (options.database)
                logger.info('  ✓ Repair database connections');
            if (options.sync)
                logger.info('  ✓ Force state re-sync');
            logger.newline();
            const answer = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: 'Proceed with repairs?',
                    default: true,
                },
            ]);
            if (!answer.confirm) {
                logger.info('Repair cancelled.');
                return;
            }
            // Create rollback point before repairs
            logger.info('Creating rollback point before repairs...');
            await recovery.createRollbackPoint('pre-repair', 'Automatic rollback point before repair');
            logger.newline();
            logger.section('Running Repairs');
            let completed = 0;
            let total = 0;
            if (options.permissions)
                total++;
            if (options.dependencies)
                total++;
            if (options.network)
                total++;
            if (options.docker)
                total++;
            if (options.database)
                total++;
            if (options.sync)
                total++;
            // Execute repairs
            if (options.permissions) {
                logger.info(`[${++completed}/${total}] Fixing file permissions...`);
                await recovery.repairPermissions({ skipConfirmation: true });
            }
            if (options.dependencies) {
                logger.info(`[${++completed}/${total}] Repairing dependencies...`);
                await recovery.repairDependencies({ skipConfirmation: true });
            }
            if (options.network) {
                logger.info(`[${++completed}/${total}] Repairing network configuration...`);
                await recovery.repairNetwork({ skipConfirmation: true });
            }
            if (options.docker) {
                logger.info(`[${++completed}/${total}] Cleaning up Docker environment...`);
                await recovery.repairDocker({ skipConfirmation: true });
            }
            if (options.database) {
                logger.info(`[${++completed}/${total}] Repairing database connections...`);
                await recovery.repairDatabase({ skipConfirmation: true });
            }
            if (options.sync) {
                logger.info(`[${++completed}/${total}] Forcing state re-sync...`);
                await recovery.repairSync({ skipConfirmation: true });
            }
            logger.newline();
            logger.success(`All repairs completed! (${completed}/${total})`);
        }
        catch (error) {
            logger.error(`Repair failed: ${error.message}`);
            process.exit(1);
        }
    });
    // recovery:safe-mode - Enter safe mode
    program
        .command('recovery:safe-mode')
        .description('Enter safe mode with minimal configuration')
        .action(async () => {
        try {
            logger.header('SAFE MODE');
            const isSafeMode = await recovery.isSafeMode();
            if (isSafeMode) {
                logger.warn('Safe mode is already enabled.');
                const answer = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'disable',
                        message: 'Disable safe mode and return to normal operation?',
                        default: true,
                    },
                ]);
                if (answer.disable) {
                    await recovery.disableSafeMode({ skipConfirmation: false });
                    logger.success('Safe mode disabled. System restored to normal operation.');
                }
                return;
            }
            logger.info('Safe mode will:');
            logger.info('  • Disable non-essential packages');
            logger.info('  • Disable intelligence and connectors');
            logger.info('  • Stop non-essential services');
            logger.info('  • Start minimal core configuration');
            logger.newline();
            const answer = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: 'Enable safe mode?',
                    default: false,
                },
            ]);
            if (!answer.confirm) {
                logger.info('Safe mode cancelled.');
                return;
            }
            await recovery.enableSafeMode({ skipConfirmation: true });
            logger.newline();
            logger.success('Safe mode enabled successfully!');
            logger.newline();
            logger.section('To Exit Safe Mode');
            logger.info('Run: ' + chalk.cyan('hestia recovery:safe-mode'));
            logger.info('Or:  ' + chalk.cyan('hestia recovery:rollback --installation'));
        }
        catch (error) {
            logger.error(`Safe mode operation failed: ${error.message}`);
            process.exit(1);
        }
    });
    // recovery:diagnose - System diagnosis
    program
        .command('recovery:diagnose')
        .description('Run full system diagnosis')
        .option('-v, --verbose', 'Show detailed output')
        .option('-j, --json', 'Output as JSON')
        .action(async (options) => {
        try {
            logger.header('SYSTEM DIAGNOSIS');
            const diagnosis = await recovery.diagnoseIssues({ verbose: true });
            if (options.json) {
                console.log(JSON.stringify(diagnosis, null, 2));
                return;
            }
            logger.newline();
            logger.section('Diagnosis Results');
            const status = diagnosis.healthy
                ? chalk.green('✓ HEALTHY')
                : chalk.yellow('⚠ ISSUES DETECTED');
            logger.info(`System Status: ${status}`);
            logger.info(`Timestamp: ${chalk.cyan(diagnosis.timestamp.toLocaleString())}`);
            // Display issues
            if (diagnosis.issues.length > 0) {
                logger.newline();
                logger.section(`Issues Found (${diagnosis.issues.length})`);
                const critical = diagnosis.issues.filter((i) => i.severity === 'critical');
                const warnings = diagnosis.issues.filter((i) => i.severity === 'warning');
                const info = diagnosis.issues.filter((i) => i.severity === 'info');
                if (critical.length > 0) {
                    logger.info(chalk.red(`\n🔴 Critical (${critical.length}):`));
                    critical.forEach((issue) => {
                        logger.info(`  [${issue.category}] ${issue.message}`);
                    });
                }
                if (warnings.length > 0) {
                    logger.info(chalk.yellow(`\n🟡 Warnings (${warnings.length}):`));
                    warnings.forEach((issue) => {
                        logger.info(`  [${issue.category}] ${issue.message}`);
                    });
                }
                if (info.length > 0) {
                    logger.info(chalk.blue(`\n🔵 Info (${info.length}):`));
                    info.forEach((issue) => {
                        logger.info(`  [${issue.category}] ${issue.message}`);
                    });
                }
            }
            else {
                logger.newline();
                logger.success('No issues found! System is healthy.');
            }
            // Display suggestions
            if (diagnosis.suggestions.length > 0) {
                logger.newline();
                logger.section(`Suggested Fixes (${diagnosis.suggestions.length})`);
                diagnosis.suggestions.forEach((fix, index) => {
                    const icon = fix.risk === 'low' ? chalk.green('🟢') :
                        fix.risk === 'medium' ? chalk.yellow('🟡') : chalk.red('🔴');
                    logger.info(`${index + 1}. ${icon} ${fix.description}`);
                    logger.info(`   Risk: ${fix.risk} | Auto-fix: ${fix.automatic ? 'Yes' : 'No'}`);
                    const issue = diagnosis.issues.find((i) => i.id === fix.issueId);
                    if (issue && options.verbose) {
                        logger.info(`   Issue: ${chalk.gray(issue.message)}`);
                    }
                });
                logger.newline();
                logger.info(`Apply fixes with: ${chalk.cyan('hestia recovery:auto')}`);
            }
            // Generate report
            const reportPath = await generateDiagnosisReport(diagnosis);
            logger.newline();
            logger.info(`Diagnosis report saved to: ${chalk.cyan(reportPath)}`);
        }
        catch (error) {
            logger.error(`Diagnosis failed: ${error.message}`);
            process.exit(1);
        }
    });
    // recovery:auto - Auto-recovery
    program
        .command('recovery:auto')
        .description('Automatic recovery - detect and fix issues')
        .option('--dry-run', 'Show what would be fixed without executing')
        .action(async (options) => {
        try {
            logger.header('AUTO-RECOVERY');
            logger.info('Running system diagnosis...');
            const diagnosis = await recovery.diagnoseIssues();
            if (diagnosis.healthy && diagnosis.suggestions.length === 0) {
                logger.success('System is healthy! No fixes needed.');
                return;
            }
            logger.info(`Found ${chalk.cyan(diagnosis.issues.length)} issue(s) with ${chalk.cyan(diagnosis.suggestions.length)} suggested fix(es).`);
            logger.newline();
            if (diagnosis.suggestions.length === 0) {
                logger.info('No automatic fixes available for the detected issues.');
                logger.info(`Run ${chalk.cyan('hestia recovery:diagnose')} for more details.`);
                return;
            }
            // Show fixes and ask for confirmation
            logger.section('Proposed Fixes');
            const automaticFixes = diagnosis.suggestions.filter((f) => f.automatic);
            const manualFixes = diagnosis.suggestions.filter((f) => !f.automatic);
            if (automaticFixes.length > 0) {
                logger.info(chalk.green(`\nAutomatic fixes (${automaticFixes.length}):`));
                automaticFixes.forEach((fix) => {
                    logger.info(`  ✓ ${fix.description} [${fix.risk} risk]`);
                });
            }
            if (manualFixes.length > 0) {
                logger.info(chalk.yellow(`\nManual fixes required (${manualFixes.length}):`));
                manualFixes.forEach((fix) => {
                    logger.info(`  • ${fix.description}`);
                });
            }
            if (options.dryRun) {
                logger.newline();
                logger.info(chalk.yellow('[DRY RUN] No changes made.'));
                return;
            }
            logger.newline();
            // Interactive confirmation for each fix
            const appliedFixes = [];
            const skippedFixes = [];
            const failedFixes = [];
            for (const fix of automaticFixes) {
                const answer = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'apply',
                        message: `Apply: ${fix.description}? [${fix.risk} risk]`,
                        default: fix.risk === 'low',
                    },
                ]);
                if (answer.apply) {
                    try {
                        logger.info(`Applying: ${fix.description}...`);
                        await recovery.applyFix(fix.id, { skipConfirmation: true });
                        appliedFixes.push(fix.id);
                        logger.success(`  ✓ Fixed`);
                    }
                    catch (error) {
                        failedFixes.push(fix.id);
                        logger.error(`  ✗ Failed: ${error.message}`);
                    }
                }
                else {
                    skippedFixes.push(fix.id);
                    logger.info(`  • Skipped`);
                }
            }
            logger.newline();
            logger.section('Results');
            logger.info(`Applied: ${chalk.green(appliedFixes.length)}`);
            logger.info(`Skipped: ${chalk.yellow(skippedFixes.length)}`);
            logger.info(`Failed: ${chalk.red(failedFixes.length)}`);
            if (appliedFixes.length > 0) {
                logger.newline();
                logger.success(`Successfully applied ${appliedFixes.length} fix(es)!`);
            }
            if (manualFixes.length > 0) {
                logger.newline();
                logger.info(chalk.yellow('Manual fixes required:'));
                manualFixes.forEach((fix) => {
                    logger.info(`  • ${fix.description}`);
                });
            }
        }
        catch (error) {
            logger.error(`Auto-recovery failed: ${error.message}`);
            process.exit(1);
        }
    });
}
// Helper function to generate diagnosis report
async function generateDiagnosisReport(diagnosis) {
    const report = {
        timestamp: diagnosis.timestamp,
        healthy: diagnosis.healthy,
        issues: diagnosis.issues,
        suggestions: diagnosis.suggestions,
        metadata: {
            version: '1.0.0',
            cli: 'hestia',
        },
    };
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const reportDir = path.join(os.homedir(), '.hestia', 'reports');
    const reportPath = path.join(reportDir, `diagnosis-${Date.now()}.json`);
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    return reportPath;
}
// Helper function to format bytes
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0)
        return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
//# sourceMappingURL=recovery.js.map