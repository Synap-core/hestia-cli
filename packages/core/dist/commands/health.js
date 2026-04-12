/**
 * health command - System health monitoring and diagnostics
 * Usage: hestia health [subcommand] [options]
 */
import { healthCheck } from '../lib/health-check.js';
import { logger } from '../lib/logger.js';
import chalk from 'chalk';
import * as fs from 'fs/promises';
export function healthCommand(program) {
    // Main health command
    program
        .command('health')
        .description('Check system health status')
        .option('-w, --watch', 'Continuous monitoring mode')
        .option('-j, --json', 'Output as JSON')
        .option('-c, --category <category>', 'Filter by category (service|resource|network|integration)')
        .action(async (options) => {
        try {
            if (options.watch) {
                await watchHealth(options);
            }
            else {
                await runHealthCheck(options);
            }
        }
        catch (error) {
            logger.error(`Health check failed: ${error.message}`);
            process.exit(1);
        }
    });
    // health:watch - Continuous monitoring
    program
        .command('health:watch')
        .description('Continuous health monitoring with alerts')
        .option('-i, --interval <seconds>', 'Check interval in seconds', '30')
        .option('-a, --auto-restart', 'Auto-restart failed services')
        .action(async (options) => {
        try {
            const interval = parseInt(options.interval || '30', 10) * 1000;
            await watchHealth({ ...options, interval });
        }
        catch (error) {
            logger.error(`Health watch failed: ${error.message}`);
            process.exit(1);
        }
    });
    // health:services - Service health only
    program
        .command('health:services')
        .description('Check service health only')
        .option('-j, --json', 'Output as JSON')
        .action(async (options) => {
        try {
            await runCategoryCheck('service', options);
        }
        catch (error) {
            logger.error(`Service health check failed: ${error.message}`);
            process.exit(1);
        }
    });
    // health:resources - Resource health
    program
        .command('health:resources')
        .description('Check resource health (disk, memory, CPU, Docker)')
        .option('-j, --json', 'Output as JSON')
        .action(async (options) => {
        try {
            await runCategoryCheck('resource', options);
        }
        catch (error) {
            logger.error(`Resource health check failed: ${error.message}`);
            process.exit(1);
        }
    });
    // health:network - Network health
    program
        .command('health:network')
        .description('Check network health (internet, DNS, firewall, ports)')
        .option('-j, --json', 'Output as JSON')
        .action(async (options) => {
        try {
            await runCategoryCheck('network', options);
        }
        catch (error) {
            logger.error(`Network health check failed: ${error.message}`);
            process.exit(1);
        }
    });
    // health:report - Generate health report
    program
        .command('health:report')
        .description('Generate detailed health report')
        .option('-f, --format <format>', 'Report format (md|json|html)', 'md')
        .option('-o, --output <file>', 'Output file path')
        .action(async (options) => {
        try {
            await generateReport(options);
        }
        catch (error) {
            logger.error(`Report generation failed: ${error.message}`);
            process.exit(1);
        }
    });
}
async function runHealthCheck(options) {
    logger.header('SYSTEM HEALTH CHECK');
    logger.newline();
    let report;
    if (options.category) {
        const category = options.category;
        const results = await healthCheck.runCheck(category);
        // Convert to full report format
        report = {
            timestamp: new Date(),
            overallStatus: getWorstStatus(Object.values(results)),
            healthScore: calculateScore(Object.values(results)),
            categories: {
                service: { status: category === 'service' ? getWorstStatus(Object.values(results)) : 'healthy', checks: category === 'service' ? results : {} },
                resource: { status: category === 'resource' ? getWorstStatus(Object.values(results)) : 'healthy', checks: category === 'resource' ? results : {} },
                network: { status: category === 'network' ? getWorstStatus(Object.values(results)) : 'healthy', checks: category === 'network' ? results : {} },
                integration: { status: category === 'integration' ? getWorstStatus(Object.values(results)) : 'healthy', checks: category === 'integration' ? results : {} },
            },
            degradedServices: [],
            failedServices: [],
            summary: {
                totalChecks: Object.keys(results).length,
                healthy: Object.values(results).filter(r => r.status === 'healthy').length,
                degraded: Object.values(results).filter(r => r.status === 'degraded').length,
                unhealthy: Object.values(results).filter(r => r.status === 'unhealthy').length,
            },
        };
        for (const [name, result] of Object.entries(results)) {
            if (result.status === 'degraded') {
                report.degradedServices.push(`${category}.${name}`);
            }
            else if (result.status === 'unhealthy') {
                report.failedServices.push(`${category}.${name}`);
            }
        }
    }
    else {
        report = await healthCheck.runAllChecks();
    }
    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        process.exit(report.overallStatus === 'healthy' ? 0 : report.overallStatus === 'degraded' ? 1 : 2);
        return;
    }
    displayHealthReport(report);
    // Exit with appropriate code
    const exitCode = report.overallStatus === 'healthy' ? 0 : report.overallStatus === 'degraded' ? 1 : 2;
    process.exit(exitCode);
}
async function watchHealth(options) {
    const interval = typeof options.interval === 'number' ? options.interval : 30000;
    const autoRestart = options.autoRestart || false;
    if (autoRestart) {
        healthCheck.updateConfig({ autoRestart: true });
    }
    logger.info(`Starting continuous health monitoring (interval: ${Math.floor(interval / 1000)}s)`);
    logger.info('Press Ctrl+C to stop\n');
    let lastReport = null;
    const run = async () => {
        // Clear screen
        process.stdout.write('\x1Bc');
        logger.header('SYSTEM HEALTH MONITOR');
        logger.newline();
        const report = await healthCheck.runAllChecks();
        displayHealthReport(report, true);
        // Alert on status changes
        if (lastReport) {
            const changedServices = [];
            for (const [category, data] of Object.entries(report.categories)) {
                for (const [name, result] of Object.entries(data.checks)) {
                    const lastResult = lastReport.categories[category]?.checks[name];
                    if (lastResult && lastResult.status !== result.status) {
                        changedServices.push(`${category}.${name}: ${lastResult.status} → ${result.status}`);
                    }
                }
            }
            if (changedServices.length > 0) {
                logger.newline();
                logger.section('Status Changes Detected');
                for (const change of changedServices) {
                    const isImprovement = change.includes('unhealthy →') || change.includes('degraded → healthy');
                    if (isImprovement) {
                        logger.success(`↑ ${change}`);
                    }
                    else {
                        logger.warn(`↓ ${change}`);
                    }
                }
            }
            // Alert on overall status degradation
            if (lastReport.overallStatus !== report.overallStatus) {
                logger.newline();
                if (report.overallStatus === 'unhealthy') {
                    logger.error('⚠️  SYSTEM STATUS DEGRADED TO UNHEALTHY');
                }
                else if (report.overallStatus === 'degraded' && lastReport.overallStatus === 'healthy') {
                    logger.warn('⚠️  SYSTEM STATUS DEGRADED');
                }
                else if (report.overallStatus === 'healthy' && lastReport.overallStatus !== 'healthy') {
                    logger.success('✓ SYSTEM STATUS RECOVERED TO HEALTHY');
                }
            }
        }
        lastReport = report;
        logger.newline();
        logger.info(chalk.gray(`Last check: ${new Date().toLocaleTimeString()} | Press Ctrl+C to stop`));
    };
    await run();
    const timer = setInterval(run, interval);
    // Handle exit
    process.on('SIGINT', () => {
        clearInterval(timer);
        healthCheck.stopWatch();
        logger.newline();
        logger.info('Health monitoring stopped');
        process.exit(0);
    });
}
async function runCategoryCheck(category, options) {
    const categoryNames = {
        service: 'SERVICES',
        resource: 'RESOURCES',
        network: 'NETWORK',
        integration: 'INTEGRATIONS',
    };
    logger.header(`${categoryNames[category]} HEALTH CHECK`);
    logger.newline();
    const results = await healthCheck.runCheck(category);
    if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
    }
    const status = getWorstStatus(Object.values(results));
    const score = calculateScore(Object.values(results));
    displayHealthScore(score, status);
    logger.newline();
    displayCategoryResults(category, results);
    // Exit with appropriate code
    const exitCode = status === 'healthy' ? 0 : status === 'degraded' ? 1 : 2;
    process.exit(exitCode);
}
async function generateReport(options) {
    logger.header('GENERATING HEALTH REPORT');
    logger.newline();
    const report = await healthCheck.runAllChecks();
    const format = (options.format || 'md').toLowerCase();
    const output = options.output;
    let content;
    switch (format) {
        case 'json':
            content = JSON.stringify(report, null, 2);
            break;
        case 'html':
            content = generateHtmlReport(report);
            break;
        case 'md':
        default:
            content = generateMarkdownReport(report);
            break;
    }
    if (output) {
        await fs.writeFile(output, content, 'utf-8');
        logger.success(`Health report saved to: ${output}`);
    }
    else {
        console.log(content);
    }
}
function displayHealthReport(report, compact = false) {
    // Health Score
    displayHealthScore(report.healthScore, report.overallStatus);
    if (!compact) {
        logger.newline();
        logger.info(`Last Check: ${chalk.cyan(report.timestamp.toLocaleString())}`);
    }
    // Summary
    logger.newline();
    logger.info(`Summary: ${chalk.green(report.summary.healthy.toString())} healthy, ${chalk.yellow(report.summary.degraded.toString())} degraded, ${chalk.red(report.summary.unhealthy.toString())} unhealthy`);
    // Category details
    logger.newline();
    if (Object.keys(report.categories.service.checks).length > 0) {
        logger.section('Services');
        displayCategoryResults('service', report.categories.service.checks);
    }
    if (Object.keys(report.categories.resource.checks).length > 0) {
        logger.section('Resources');
        displayCategoryResults('resource', report.categories.resource.checks);
    }
    if (Object.keys(report.categories.network.checks).length > 0) {
        logger.section('Network');
        displayCategoryResults('network', report.categories.network.checks);
    }
    if (Object.keys(report.categories.integration.checks).length > 0) {
        logger.section('Integrations');
        displayCategoryResults('integration', report.categories.integration.checks);
    }
    // Alerts
    if (report.failedServices.length > 0 || report.degradedServices.length > 0) {
        logger.newline();
        logger.section('Alerts');
        for (const service of report.failedServices) {
            logger.error(`✗ ${service}`);
        }
        for (const service of report.degradedServices) {
            logger.warn(`⚠ ${service}`);
        }
    }
}
function displayHealthScore(score, status) {
    const color = status === 'healthy' ? chalk.green : status === 'degraded' ? chalk.yellow : chalk.red;
    const symbol = status === 'healthy' ? '✓' : status === 'degraded' ? '⚠' : '✗';
    const scoreBar = generateScoreBar(score);
    logger.info(`Health Score: ${color.bold(`${symbol} ${score}%`)}`);
    logger.info(`Status: ${color(status.toUpperCase())}`);
    logger.info(`[${color(scoreBar)}]`);
}
function generateScoreBar(score) {
    const filled = Math.round(score / 5);
    const empty = 20 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}
function displayCategoryResults(category, results) {
    const tableData = Object.entries(results).map(([name, result]) => ({
        SERVICE: formatServiceName(name),
        STATUS: formatStatus(result.status),
        MESSAGE: truncate(result.message, 40),
        RESPONSE: result.metrics?.responseTime ? `${result.metrics.responseTime}ms` : '-',
    }));
    logger.table(tableData);
}
function formatServiceName(name) {
    return name
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (str) => str.toUpperCase())
        .trim();
}
function formatStatus(status) {
    const colors = {
        healthy: (s) => chalk.green('✓ ' + s),
        degraded: (s) => chalk.yellow('⚠ ' + s),
        unhealthy: (s) => chalk.red('✗ ' + s),
    };
    return colors[status](status);
}
function truncate(str, maxLength) {
    if (str.length <= maxLength)
        return str;
    return str.slice(0, maxLength - 3) + '...';
}
function getWorstStatus(results) {
    if (results.some(r => r.status === 'unhealthy')) {
        return 'unhealthy';
    }
    if (results.some(r => r.status === 'degraded')) {
        return 'degraded';
    }
    return 'healthy';
}
function calculateScore(results) {
    if (results.length === 0)
        return 100;
    const weights = {
        healthy: 1,
        degraded: 0.5,
        unhealthy: 0,
    };
    const total = results.length;
    const score = results.reduce((acc, result) => {
        return acc + weights[result.status];
    }, 0);
    return Math.round((score / total) * 100);
}
function generateMarkdownReport(report) {
    const lines = [
        '# Hestia Health Report',
        '',
        `Generated: ${report.timestamp.toISOString()}`,
        '',
        `## Overall Status: ${report.overallStatus.toUpperCase()}`,
        '',
        `**Health Score:** ${report.healthScore}%`,
        '',
        '## Summary',
        '',
        `- Healthy: ${report.summary.healthy}`,
        `- Degraded: ${report.summary.degraded}`,
        `- Unhealthy: ${report.summary.unhealthy}`,
        `- Total Checks: ${report.summary.totalChecks}`,
        '',
    ];
    for (const [category, data] of Object.entries(report.categories)) {
        if (Object.keys(data.checks).length === 0)
            continue;
        lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`, '');
        lines.push(`**Status:** ${data.status}`, '');
        lines.push('| Service | Status | Message | Response Time |');
        lines.push('|---------|--------|---------|---------------|');
        for (const [name, result] of Object.entries(data.checks)) {
            const responseTime = result.metrics?.responseTime ? `${result.metrics.responseTime}ms` : '-';
            lines.push(`| ${name} | ${result.status} | ${result.message} | ${responseTime} |`);
        }
        lines.push('');
    }
    if (report.failedServices.length > 0) {
        lines.push('## Failed Services', '');
        for (const service of report.failedServices) {
            lines.push(`- ❌ ${service}`);
        }
        lines.push('');
    }
    if (report.degradedServices.length > 0) {
        lines.push('## Degraded Services', '');
        for (const service of report.degradedServices) {
            lines.push(`- ⚠️ ${service}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
function generateHtmlReport(report) {
    const statusColor = report.overallStatus === 'healthy' ? '#22c55e' : report.overallStatus === 'degraded' ? '#eab308' : '#ef4444';
    let categoriesHtml = '';
    for (const [category, data] of Object.entries(report.categories)) {
        if (Object.keys(data.checks).length === 0)
            continue;
        let rowsHtml = '';
        for (const [name, result] of Object.entries(data.checks)) {
            const color = result.status === 'healthy' ? '#22c55e' : result.status === 'degraded' ? '#eab308' : '#ef4444';
            const responseTime = result.metrics?.responseTime ? `${result.metrics.responseTime}ms` : '-';
            rowsHtml += `
        <tr>
          <td>${name}</td>
          <td style="color: ${color}; font-weight: bold;">${result.status}</td>
          <td>${result.message}</td>
          <td>${responseTime}</td>
        </tr>`;
        }
        categoriesHtml += `
      <div class="category">
        <h2>${category.charAt(0).toUpperCase() + category.slice(1)} <span style="color: ${data.status === 'healthy' ? '#22c55e' : data.status === 'degraded' ? '#eab308' : '#ef4444'};">(${data.status})</span></h2>
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Status</th>
              <th>Message</th>
              <th>Response Time</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
    }
    return `<!DOCTYPE html>
<html>
<head>
  <title>Hestia Health Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #333; border-bottom: 3px solid ${statusColor}; padding-bottom: 10px; }
    .score { font-size: 48px; font-weight: bold; color: ${statusColor}; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 20px 0; }
    .summary-item { background: #f9fafb; padding: 15px; border-radius: 6px; text-align: center; }
    .summary-value { font-size: 24px; font-weight: bold; }
    .category { margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: 600; }
    .alerts { margin-top: 20px; padding: 15px; background: #fef2f2; border-radius: 6px; border-left: 4px solid #ef4444; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Hestia Health Report</h1>
    <p>Generated: ${report.timestamp.toLocaleString()}</p>
    
    <div class="score">${report.healthScore}% - ${report.overallStatus.toUpperCase()}</div>
    
    <div class="summary">
      <div class="summary-item">
        <div class="summary-value" style="color: #22c55e;">${report.summary.healthy}</div>
        <div>Healthy</div>
      </div>
      <div class="summary-item">
        <div class="summary-value" style="color: #eab308;">${report.summary.degraded}</div>
        <div>Degraded</div>
      </div>
      <div class="summary-item">
        <div class="summary-value" style="color: #ef4444;">${report.summary.unhealthy}</div>
        <div>Unhealthy</div>
      </div>
      <div class="summary-item">
        <div class="summary-value">${report.summary.totalChecks}</div>
        <div>Total</div>
      </div>
    </div>

    ${categoriesHtml}

    ${report.failedServices.length > 0 ? `
    <div class="alerts">
      <h3>Failed Services</h3>
      <ul>${report.failedServices.map(s => `<li>❌ ${s}</li>`).join('')}</ul>
    </div>` : ''}
  </div>
</body>
</html>`;
}
//# sourceMappingURL=health.js.map