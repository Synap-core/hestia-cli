/**
 * validate command - Run production validation checks
 * Usage: hestia validate [subcommand] [options]
 */
import { productionValidator } from '../../../domains/shared/lib/validator.js';
import { logger } from '../../lib/utils/index';
import { withSpinner } from '../../lib/utils/index';
import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
/**
 * Collect system information for reports
 */
function collectSystemInfo() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const formatBytes = (bytes) => {
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0)
            return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
    };
    return {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        hestiaVersion: '0.1.0',
        cpuCount: os.cpus().length,
        totalMemory: formatBytes(totalMem),
        freeMemory: formatBytes(freeMem),
        homeDir: os.homedir(),
        configDir: path.join(os.homedir(), '.hestia'),
        shell: process.env.SHELL || process.env.ComSpec || 'unknown',
    };
}
/**
 * Category mapping from CLI names to validator categories
 */
const CATEGORY_MAP = {
    system: 'system',
    dependencies: 'dependency',
    dependency: 'dependency',
    config: 'hestia', // Config covers hestia, openclaude, openclaw
    services: 'a2a', // Services covers a2a bridge
    integration: 'integration',
    a2a: 'a2a',
    openclaude: 'openclaude',
    openclaw: 'openclaw',
    hestia: 'hestia',
    all: 'all',
};
/**
 * Checkmark and X mark symbols
 */
const SYMBOLS = {
    success: chalk.green('✓'),
    warning: chalk.yellow('⚠'),
    error: chalk.red('✗'),
    info: chalk.blue('ℹ'),
};
export function validateCommand(program) {
    // Main validate command - Run all validations
    program
        .command('validate')
        .description('Run all production validations')
        .option('-f, --fix', 'Auto-fix issues where possible')
        .option('-j, --json', 'Output results as JSON')
        .option('-c, --category <cat>', 'Validate specific category only')
        .option('-v, --verbose', 'Show detailed output')
        .option('-o, --output <path>', 'Save report to file')
        .action(async (options) => {
        try {
            await runValidation('all', options);
        }
        catch (error) {
            logger.error(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
            process.exit(1);
        }
    });
    // System validation
    program
        .command('validate:system')
        .description('Validate system requirements (Node, platform, architecture, permissions)')
        .option('-j, --json', 'Output results as JSON')
        .option('-v, --verbose', 'Show detailed output')
        .option('-o, --output <path>', 'Save report to file')
        .action(async (options) => {
        try {
            await runValidation('system', options);
        }
        catch (error) {
            logger.error(`System validation failed: ${error instanceof Error ? error.message : String(error)}`);
            process.exit(1);
        }
    });
    // Dependencies validation
    program
        .command('validate:dependencies')
        .description('Validate dependencies (Docker, git, network, ports)')
        .option('-j, --json', 'Output results as JSON')
        .option('-v, --verbose', 'Show detailed output')
        .option('-o, --output <path>', 'Save report to file')
        .action(async (options) => {
        try {
            await runValidation('dependencies', options);
        }
        catch (error) {
            logger.error(`Dependencies validation failed: ${error.message}`);
            process.exit(1);
        }
    });
    // Config validation
    program
        .command('validate:config')
        .description('Validate configuration files (Hestia, OpenClaude, OpenClaw)')
        .option('-j, --json', 'Output results as JSON')
        .option('-v, --verbose', 'Show detailed output')
        .option('-o, --output <path>', 'Save report to file')
        .action(async (options) => {
        try {
            await runConfigValidation(options);
        }
        catch (error) {
            logger.error(`Config validation failed: ${error.message}`);
            process.exit(1);
        }
    });
    // Services validation
    program
        .command('validate:services')
        .description('Validate services can start (A2A Bridge, API connectivity)')
        .option('-j, --json', 'Output results as JSON')
        .option('-v, --verbose', 'Show detailed output')
        .option('-o, --output <path>', 'Save report to file')
        .action(async (options) => {
        try {
            await runServicesValidation(options);
        }
        catch (error) {
            logger.error(`Services validation failed: ${error.message}`);
            process.exit(1);
        }
    });
    // Integration validation
    program
        .command('validate:integration')
        .description('Validate integrations (state sync, agent communication, E2E)')
        .option('-j, --json', 'Output results as JSON')
        .option('-v, --verbose', 'Show detailed output')
        .option('-o, --output <path>', 'Save report to file')
        .action(async (options) => {
        try {
            await runValidation('integration', options);
        }
        catch (error) {
            logger.error(`Integration validation failed: ${error.message}`);
            process.exit(1);
        }
    });
    // Production readiness validation
    program
        .command('validate:production')
        .description('Production readiness check - strict validation with no warnings allowed')
        .option('-j, --json', 'Output results as JSON')
        .option('-o, --output <path>', 'Save report to file')
        .option('--report', 'Generate production-readiness report')
        .action(async (options) => {
        try {
            await runProductionValidation(options);
        }
        catch (error) {
            logger.error(`Production validation failed: ${error.message}`);
            process.exit(1);
        }
    });
}
/**
 * Run validation for a specific category
 */
async function runValidation(category, options) {
    const mappedCategory = CATEGORY_MAP[category] || category;
    // Show header
    if (!options.json) {
        logger.header(`Hestia Validation: ${category.toUpperCase()}`);
        logger.newline();
    }
    let report;
    if (mappedCategory === 'all') {
        // Run all validations with progress indication
        report = await withSpinner('Running comprehensive validation suite...', () => productionValidator.validateAll(), 'Validation complete');
    }
    else {
        // Run specific category
        report = await withSpinner(`Running ${mappedCategory} validation...`, async () => {
            const result = await productionValidator.validateCategory(mappedCategory);
            // Convert single result to report format
            return {
                valid: result.valid,
                categories: { [mappedCategory]: result },
                timestamp: new Date(),
                totalDuration: result.duration || 0,
                systemInfo: collectSystemInfo(),
                summary: {
                    totalChecks: 1,
                    passed: result.valid && result.errors.length === 0 ? 1 : 0,
                    failed: !result.valid ? 1 : 0,
                    warnings: result.warnings.length,
                    autoFixable: result.fixes?.length || 0,
                },
            };
        }, 'Validation complete');
    }
    // Auto-fix if requested
    if (options.fix && !options.json) {
        logger.newline();
        const fixResult = await productionValidator.fixIssues({ autoFix: true });
        if (fixResult.fixed.length > 0) {
            logger.success(`Fixed ${fixResult.fixed.length} issues`);
        }
        if (fixResult.skipped.length > 0) {
            logger.warn(`Skipped ${fixResult.skipped.length} issues (manual intervention required)`);
        }
        if (fixResult.failed.length > 0) {
            logger.error(`Failed to fix ${fixResult.failed.length} issues`);
        }
        logger.newline();
    }
    // Output results
    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
    }
    else {
        displayResults(report, options.verbose);
    }
    // Save report if requested
    if (options.output) {
        const format = options.output.endsWith('.json') ? 'json' :
            options.output.endsWith('.html') ? 'html' : 'markdown';
        const reportContent = productionValidator.generateReport(format);
        await fs.writeFile(options.output, reportContent, 'utf-8');
        if (!options.json) {
            logger.success(`Report saved to ${options.output}`);
        }
    }
    // Exit with appropriate code
    const hasCriticalFailures = Object.values(report.categories).some((cat) => !cat.valid && cat.errors.length > 0);
    if (hasCriticalFailures) {
        process.exit(1);
    }
}
/**
 * Run configuration validation (combines hestia, openclaude, openclaw)
 */
async function runConfigValidation(options) {
    if (!options.json) {
        logger.header('Hestia Validation: CONFIGURATION');
        logger.newline();
    }
    const categories = ['hestia', 'openclaude', 'openclaw'];
    const results = {};
    let totalDuration = 0;
    let totalErrors = 0;
    let totalWarnings = 0;
    let totalFixes = 0;
    // Run each config category
    for (const category of categories) {
        if (!options.json) {
            logger.section(`${category.toUpperCase()} Configuration`);
        }
        const result = await withSpinner(`Validating ${category} config...`, () => productionValidator.validateCategory(category), `${category} config validated`);
        results[category] = result;
        totalDuration += result.duration || 0;
        totalErrors += result.errors.length;
        totalWarnings += result.warnings.length;
        totalFixes += result.fixes?.length || 0;
        if (!options.json) {
            displayCategoryResult(category, result, options.verbose);
        }
    }
    // Build report
    const report = {
        valid: totalErrors === 0,
        categories: results,
        timestamp: new Date(),
        totalDuration,
        systemInfo: collectSystemInfo(),
        summary: {
            totalChecks: categories.length,
            passed: Object.values(results).filter((r) => r.valid && r.errors.length === 0).length,
            failed: Object.values(results).filter((r) => !r.valid).length,
            warnings: totalWarnings,
            autoFixable: totalFixes,
        },
    };
    // Auto-fix if requested
    if (options.fix && !options.json) {
        logger.newline();
        for (const category of categories) {
            await productionValidator.fixIssues({ category, autoFix: true });
        }
    }
    // Output results
    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
    }
    else {
        logger.section('Configuration Summary');
        displaySummary(report.summary);
    }
    // Save report if requested
    if (options.output) {
        const format = options.output.endsWith('.json') ? 'json' :
            options.output.endsWith('.html') ? 'html' : 'markdown';
        const reportContent = productionValidator.generateReport(format);
        await fs.writeFile(options.output, reportContent, 'utf-8');
        if (!options.json) {
            logger.success(`Report saved to ${options.output}`);
        }
    }
    // Exit with appropriate code
    if (totalErrors > 0) {
        process.exit(1);
    }
}
/**
 * Run services validation (combines hestia services and a2a)
 */
async function runServicesValidation(options) {
    if (!options.json) {
        logger.header('Hestia Validation: SERVICES');
        logger.newline();
    }
    const categories = ['hestia', 'a2a'];
    const results = {};
    let totalDuration = 0;
    let totalErrors = 0;
    let totalWarnings = 0;
    // Run each service category
    for (const category of categories) {
        if (!options.json) {
            logger.section(`${category.toUpperCase()} Services`);
        }
        const result = await withSpinner(`Validating ${category} services...`, () => productionValidator.validateCategory(category), `${category} services validated`);
        results[category] = result;
        totalDuration += result.duration || 0;
        totalErrors += result.errors.length;
        totalWarnings += result.warnings.length;
        if (!options.json) {
            displayCategoryResult(category, result, options.verbose);
        }
    }
    // Build report
    const report = {
        valid: totalErrors === 0,
        categories: results,
        timestamp: new Date(),
        totalDuration,
        systemInfo: collectSystemInfo(),
        summary: {
            totalChecks: categories.length,
            passed: Object.values(results).filter((r) => r.valid && r.errors.length === 0).length,
            failed: Object.values(results).filter((r) => !r.valid).length,
            warnings: totalWarnings,
            autoFixable: Object.values(results).reduce((sum, r) => sum + (r.fixes?.length || 0), 0),
        },
    };
    // Output results
    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
    }
    else {
        logger.section('Services Summary');
        displaySummary(report.summary);
    }
    // Save report if requested
    if (options.output) {
        const format = options.output.endsWith('.json') ? 'json' :
            options.output.endsWith('.html') ? 'html' : 'markdown';
        const reportContent = productionValidator.generateReport(format);
        await fs.writeFile(options.output, reportContent, 'utf-8');
        if (!options.json) {
            logger.success(`Report saved to ${options.output}`);
        }
    }
    // Exit with appropriate code
    if (totalErrors > 0) {
        process.exit(1);
    }
}
/**
 * Run production readiness validation - strict mode
 */
async function runProductionValidation(options) {
    if (!options.json) {
        logger.header('HESTIA PRODUCTION READINESS CHECK');
        logger.newline();
        logger.info(chalk.yellow('Strict mode: No warnings allowed for production deployment'));
        logger.newline();
    }
    // Run all validations
    const report = await withSpinner('Running production readiness validation...', () => productionValidator.validateAll(), 'Validation complete');
    // Check production readiness
    const readiness = productionValidator.getProductionReadiness();
    // In strict mode, warnings are treated as failures
    const hasWarnings = Object.values(report.categories).some((cat) => cat.warnings.length > 0);
    const isProductionReady = readiness.ready && !hasWarnings;
    // Generate production readiness report
    if (options.report || options.output) {
        const productionReport = generateProductionReport(report, readiness, isProductionReady);
        const outputPath = options.output || path.join(os.homedir(), '.hestia', 'production-report.md');
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, productionReport, 'utf-8');
        if (!options.json) {
            logger.success(`Production readiness report saved to ${outputPath}`);
        }
    }
    // Output results
    if (options.json) {
        console.log(JSON.stringify({
            ready: isProductionReady,
            report,
            readiness,
        }, null, 2));
    }
    else {
        displayProductionResults(report, readiness, isProductionReady);
    }
    // Exit with appropriate code
    if (!isProductionReady) {
        process.exit(1);
    }
}
/**
 * Display validation results
 */
function displayResults(report, verbose) {
    logger.newline();
    logger.section('Validation Results');
    for (const [category, result] of Object.entries(report.categories)) {
        displayCategoryResult(category, result, verbose);
    }
    logger.section('Summary');
    displaySummary(report.summary);
    if (report.valid) {
        logger.success('All critical validations passed!');
    }
    else {
        logger.error('Some validations failed. See details above.');
    }
}
/**
 * Display category result with checkmarks/X marks
 */
function displayCategoryResult(category, result, verbose) {
    const icon = result.valid
        ? result.errors.length === 0
            ? SYMBOLS.success
            : SYMBOLS.warning
        : SYMBOLS.error;
    logger.info(`${icon} ${chalk.bold(category.toUpperCase())}`);
    // Show info messages
    if (verbose && result.info.length > 0) {
        for (const info of result.info) {
            logger.info(`  ${SYMBOLS.info} ${info}`);
        }
    }
    // Show warnings
    if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
            logger.warn(`  ${SYMBOLS.warning} ${warning}`);
        }
    }
    // Show errors
    if (result.errors.length > 0) {
        for (const error of result.errors) {
            logger.error(`  ${SYMBOLS.error} ${error}`);
        }
    }
    // Show fix suggestions
    if (result.fixes && result.fixes.length > 0) {
        logger.info(`  ${chalk.cyan('Suggested fixes:')}`);
        for (const fix of result.fixes) {
            logger.info(`    ${chalk.gray('→')} ${fix}`);
        }
    }
    if (verbose) {
        logger.info(`  ${chalk.gray(`Duration: ${result.duration}ms`)}`);
    }
    logger.newline();
}
/**
 * Display summary statistics
 */
function displaySummary(summary) {
    logger.info(`Total checks: ${summary.totalChecks}`);
    logger.success(`Passed: ${summary.passed}`);
    if (summary.failed > 0) {
        logger.error(`Failed: ${summary.failed}`);
    }
    if (summary.warnings > 0) {
        logger.warn(`Warnings: ${summary.warnings}`);
    }
    if (summary.autoFixable > 0) {
        logger.info(`Auto-fixable: ${summary.autoFixable} (run with --fix)`);
    }
    logger.newline();
}
/**
 * Display production validation results
 */
function displayProductionResults(report, readiness, isReady) {
    logger.newline();
    logger.section('Production Readiness Results');
    // Show blockers
    if (readiness.blockers.length > 0) {
        logger.error(`${SYMBOLS.error} Blockers (${readiness.blockers.length}):`);
        for (const blocker of readiness.blockers) {
            logger.error(`  ${blocker}`);
        }
        logger.newline();
    }
    // Show warnings (treated as failures in strict mode)
    if (readiness.warnings.length > 0) {
        logger.error(`${SYMBOLS.error} Warnings (not allowed in production):`);
        for (const warning of readiness.warnings) {
            logger.error(`  ${warning}`);
        }
        logger.newline();
    }
    // Show recommendations
    if (readiness.recommendations.length > 0) {
        logger.warn(`${SYMBOLS.warning} Recommendations:`);
        for (const rec of readiness.recommendations) {
            logger.warn(`  ${rec}`);
        }
        logger.newline();
    }
    // Final status
    logger.section('Production Status');
    if (isReady) {
        logger.success(`${SYMBOLS.success} System is PRODUCTION READY`);
    }
    else {
        logger.error(`${SYMBOLS.error} System is NOT production ready`);
        if (readiness.blockers.length > 0) {
            logger.error(`  Fix ${readiness.blockers.length} blocker(s) to proceed`);
        }
        if (readiness.warnings.length > 0) {
            logger.error(`  Resolve ${readiness.warnings.length} warning(s) for strict mode`);
        }
    }
    // Show summary
    displaySummary(report.summary);
}
/**
 * Generate production readiness report
 */
function generateProductionReport(report, readiness, isReady) {
    const lines = [];
    lines.push('# Hestia Production Readiness Report');
    lines.push('');
    lines.push(`**Date:** ${report.timestamp.toISOString()}`);
    lines.push(`**Status:** ${isReady ? '✅ PRODUCTION READY' : '❌ NOT READY'}`);
    lines.push(`**Duration:** ${report.totalDuration}ms`);
    lines.push('');
    // System Info
    lines.push('## System Information');
    lines.push('');
    lines.push(`- **Platform:** ${report.systemInfo.platform}`);
    lines.push(`- **Architecture:** ${report.systemInfo.arch}`);
    lines.push(`- **Node.js:** ${report.systemInfo.nodeVersion}`);
    lines.push(`- **Hestia:** ${report.systemInfo.hestiaVersion}`);
    lines.push(`- **CPUs:** ${report.systemInfo.cpuCount}`);
    lines.push(`- **Memory:** ${report.systemInfo.totalMemory}`);
    lines.push('');
    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push('| Metric | Count |');
    lines.push('|--------|-------|');
    lines.push(`| Total Checks | ${report.summary.totalChecks} |`);
    lines.push(`| Passed | ${report.summary.passed} |`);
    lines.push(`| Failed | ${report.summary.failed} |`);
    lines.push(`| Warnings | ${report.summary.warnings} |`);
    lines.push(`| Auto-fixable | ${report.summary.autoFixable} |`);
    lines.push('');
    // Blockers
    if (readiness.blockers.length > 0) {
        lines.push('## Production Blockers');
        lines.push('');
        lines.push('The following issues must be resolved before production deployment:');
        lines.push('');
        for (const blocker of readiness.blockers) {
            lines.push(`- ❌ ${blocker}`);
        }
        lines.push('');
    }
    // Warnings
    if (readiness.warnings.length > 0) {
        lines.push('## Warnings (Strict Mode)');
        lines.push('');
        lines.push('The following warnings are not allowed in strict production mode:');
        lines.push('');
        for (const warning of readiness.warnings) {
            lines.push(`- ⚠️ ${warning}`);
        }
        lines.push('');
    }
    // Recommendations
    if (readiness.recommendations.length > 0) {
        lines.push('## Recommendations');
        lines.push('');
        for (const rec of readiness.recommendations) {
            lines.push(`- ℹ️ ${rec}`);
        }
        lines.push('');
    }
    // Category Details
    lines.push('## Detailed Results');
    lines.push('');
    for (const [category, result] of Object.entries(report.categories)) {
        const status = result.valid
            ? result.errors.length === 0
                ? '✅'
                : '⚠️'
            : '❌';
        lines.push(`### ${status} ${category}`);
        lines.push('');
        if (result.info.length > 0) {
            lines.push('**Info:**');
            for (const info of result.info) {
                lines.push(`- ${info}`);
            }
            lines.push('');
        }
        if (result.warnings.length > 0) {
            lines.push('**Warnings:**');
            for (const warning of result.warnings) {
                lines.push(`- ⚠️ ${warning}`);
            }
            lines.push('');
        }
        if (result.errors.length > 0) {
            lines.push('**Errors:**');
            for (const error of result.errors) {
                lines.push(`- ❌ ${error}`);
            }
            lines.push('');
        }
        if (result.fixes && result.fixes.length > 0) {
            lines.push('**Suggested Fixes:**');
            for (const fix of result.fixes) {
                lines.push(`- \`${fix}\``);
            }
            lines.push('');
        }
    }
    // Footer
    lines.push('---');
    lines.push('');
    lines.push('*Generated by Hestia Production Validator*');
    return lines.join('\n');
}
//# sourceMappingURL=validate.js.map