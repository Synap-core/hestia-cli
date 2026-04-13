/**
 * db:viewer command - Manage WhoDB database viewer
 *
 * WhoDB is a lightweight, AI-powered database visualization tool that provides:
 * - Web UI for exploring database schemas
 * - AI-powered natural language queries (requires Ollama)
 * - Visual schema topology with relationship diagrams
 * - Support for PostgreSQL, MySQL, Redis, and more
 *
 * Commands:
 *   hestia db:viewer           - Show WhoDB status
 *   hestia db:viewer:enable    - Enable and start WhoDB
 *   hestia db:viewer:disable   - Disable WhoDB
 *   hestia db:viewer:open      - Open WhoDB in browser
 *   hestia db:viewer:status    - Show detailed status
 *   hestia db:viewer:logs      - Show logs
 *   hestia db:viewer:ai        - Enable/disable AI features
 *   hestia db:viewer:connect   - Connect to specific database
 *
 * When to use WhoDB:
 * - Debugging database issues without SQL knowledge
 * - Exploring unfamiliar database schemas
 * - Visualizing entity relationships in Synap
 * - Quick ad-hoc queries during development
 * - Teaching/learning database concepts
 *
 * @module db-viewer-command
 */
import { WhoDBService } from '../../../domains/services/lib/whodb-service.js';
import { logger, table } from '../../lib/utils/index';
import { withSpinner } from '../../lib/utils/index';
import { loadConfig, updateConfig } from '../../lib/utils/index';
import chalk from "chalk";
/**
 * Register the db:viewer command and subcommands
 */
export function dbViewerCommand(program) {
    const dbViewer = program
        .command("db:viewer")
        .description("Manage WhoDB database viewer (AI-powered database visualization)");
    // Main command - show status
    dbViewer.action(async (options) => {
        try {
            const hestiaHome = process.env.HESTIA_HOME || "/opt/hestia";
            const service = new WhoDBService(hestiaHome);
            await service.initialize();
            const status = await service.getStatus();
            const url = service.getUrl();
            if (options.json) {
                console.log(JSON.stringify({ status, url }, null, 2));
                return;
            }
            logger.header("WHODB DATABASE VIEWER");
            logger.info(`Status: ${formatStatus(status)}`);
            if (status === "running") {
                logger.info(`URL: ${chalk.cyan(url)}`);
                logger.info(``);
                logger.info(chalk.gray("Open with: hestia db:viewer:open"));
            }
            else {
                logger.info(``);
                logger.info(chalk.gray("Enable with: hestia db:viewer:enable"));
            }
        }
        catch (error) {
            logger.error(`Failed to get WhoDB status: ${error.message}`);
            process.exit(1);
        }
    });
    // Enable command
    dbViewer
        .command("enable")
        .description("Enable and start WhoDB database viewer")
        .option("-p, --port <port>", "Port to run WhoDB on", "8081")
        .option("--ai", "Enable AI integration immediately", false)
        .action(async (cmdOptions) => {
        try {
            const hestiaHome = process.env.HESTIA_HOME || "/opt/hestia";
            const service = new WhoDBService(hestiaHome);
            await service.initialize();
            // Update config with port
            await withSpinner("Configuring WhoDB...", async () => {
                await updateConfig({
                    dbViewer: {
                        enabled: true,
                        provider: "whodb",
                        port: parseInt(cmdOptions.port, 10),
                        aiEnabled: cmdOptions.ai,
                        databases: ["synap-postgres", "synap-redis"],
                    },
                });
            }, "Configuration updated");
            // Install WhoDB
            await withSpinner("Installing WhoDB...", () => service.install(), "WhoDB installed");
            // Configure
            await withSpinner("Configuring database connections...", () => service.configure(), "WhoDB configured");
            // Connect to Synap
            await withSpinner("Connecting to Synap database...", () => service.connectToSynap(), "Database connection established");
            // Enable AI if requested
            if (cmdOptions.ai) {
                await withSpinner("Enabling AI integration...", () => service.enableAI(), "AI features enabled");
            }
            // Start WhoDB
            await withSpinner("Starting WhoDB...", () => service.start(), "WhoDB started");
            logger.success("WhoDB is now running!");
            logger.info(`  URL: ${chalk.cyan(service.getUrl())}`);
            logger.info(``);
            logger.info("Features:");
            logger.info("  • Visual database schema exploration");
            logger.info("  • Run SQL queries with autocomplete");
            if (cmdOptions.ai) {
                logger.info("  • Ask questions in natural language (AI-powered)");
            }
            logger.info(``);
            logger.info(chalk.gray("Open with: hestia db:viewer:open"));
        }
        catch (error) {
            logger.error(`Failed to enable WhoDB: ${error.message}`);
            process.exit(1);
        }
    });
    // Disable command
    dbViewer
        .command("disable")
        .description("Disable WhoDB database viewer")
        .action(async () => {
        try {
            const hestiaHome = process.env.HESTIA_HOME || "/opt/hestia";
            const service = new WhoDBService(hestiaHome);
            await service.initialize();
            await withSpinner("Disabling WhoDB...", () => service.disable(), "WhoDB disabled");
            logger.success("WhoDB has been disabled");
        }
        catch (error) {
            logger.error(`Failed to disable WhoDB: ${error.message}`);
            process.exit(1);
        }
    });
    // Open command
    dbViewer
        .command("open")
        .description("Open WhoDB in your default browser")
        .action(async () => {
        try {
            const hestiaHome = process.env.HESTIA_HOME || "/opt/hestia";
            const service = new WhoDBService(hestiaHome);
            await service.initialize();
            const status = await service.getStatus();
            if (status !== "running") {
                logger.error("WhoDB is not running. Start it with: hestia db:viewer:enable");
                process.exit(1);
            }
            await service.open();
        }
        catch (error) {
            logger.error(`Failed to open WhoDB: ${error.message}`);
            process.exit(1);
        }
    });
    // Status command
    dbViewer
        .command("status")
        .description("Show detailed WhoDB status")
        .option("-j, --json", "Output as JSON")
        .action(async (options) => {
        try {
            const hestiaHome = process.env.HESTIA_HOME || "/opt/hestia";
            const service = new WhoDBService(hestiaHome);
            await service.initialize();
            const { config } = await loadConfig();
            const dbViewerConfig = config.dbViewer || {};
            const status = await service.getStatus();
            const url = service.getUrl();
            if (options.json) {
                console.log(JSON.stringify({
                    status,
                    url,
                    config: dbViewerConfig,
                }, null, 2));
                return;
            }
            logger.header("WHODB STATUS");
            // Status table
            const statusData = [
                { Property: "Status", Value: formatStatus(status) },
                { Property: "URL", Value: status === "running" ? chalk.cyan(url) : chalk.gray("N/A") },
                { Property: "Port", Value: String(dbViewerConfig.port || 8081) },
                { Property: "Provider", Value: dbViewerConfig.provider || "none" },
                { Property: "AI Enabled", Value: dbViewerConfig.aiEnabled ? chalk.green("Yes") : chalk.gray("No") },
            ];
            table(statusData);
            if (dbViewerConfig.databases?.length > 0) {
                logger.newline();
                logger.section("Connected Databases");
                for (const db of dbViewerConfig.databases) {
                    logger.info(`  • ${db}`);
                }
            }
            logger.newline();
            if (status === "running") {
                logger.info(chalk.gray("Commands:"));
                logger.info(chalk.gray("  hestia db:viewer:open  - Open in browser"));
                logger.info(chalk.gray("  hestia db:viewer:logs  - View logs"));
                logger.info(chalk.gray("  hestia db:viewer:ai    - Toggle AI features"));
            }
            else {
                logger.info(chalk.gray("WhoDB is not running. Enable with: hestia db:viewer:enable"));
            }
        }
        catch (error) {
            logger.error(`Failed to get status: ${error.message}`);
            process.exit(1);
        }
    });
    // Logs command
    dbViewer
        .command("logs")
        .description("Show WhoDB container logs")
        .option("-f, --follow", "Follow log output (like tail -f)", false)
        .option("-n, --tail <lines>", "Number of lines to show", "100")
        .action(async (options) => {
        try {
            const hestiaHome = process.env.HESTIA_HOME || "/opt/hestia";
            const service = new WhoDBService(hestiaHome);
            await service.initialize();
            if (options.follow) {
                logger.info("Following WhoDB logs (press Ctrl+C to exit)...");
                logger.newline();
                const { spawn } = await import("child_process");
                const tail = spawn("docker", [
                    "logs",
                    "-f",
                    "hestia-whodb",
                ]);
                tail.stdout.on("data", (data) => process.stdout.write(data));
                tail.stderr.on("data", (data) => process.stderr.write(data));
                process.on("SIGINT", () => {
                    tail.kill();
                    logger.newline();
                    logger.info("Stopped following logs");
                    process.exit(0);
                });
            }
            else {
                const logs = await service.getLogs(parseInt(options.tail, 10));
                console.log(logs);
            }
        }
        catch (error) {
            logger.error(`Failed to get logs: ${error.message}`);
            process.exit(1);
        }
    });
    // AI command
    dbViewer
        .command("ai")
        .description("Enable or disable AI features for natural language queries")
        .option("--enable", "Enable AI integration", false)
        .option("--disable", "Disable AI integration", false)
        .option("--model <model>", "Ollama model to use", "llama3.2")
        .action(async (options) => {
        try {
            const hestiaHome = process.env.HESTIA_HOME || "/opt/hestia";
            const service = new WhoDBService(hestiaHome);
            await service.initialize();
            if (options.disable) {
                await withSpinner("Disabling AI features...", () => service.disableAI(), "AI features disabled");
                logger.info("Users will now need to write SQL queries manually");
            }
            else if (options.enable || (!options.enable && !options.disable)) {
                // Default to enabling if no flag specified
                await withSpinner(`Enabling AI features (model: ${options.model})...`, () => service.enableAI(options.model), "AI features enabled");
                logger.success("AI integration is now active!");
                logger.info("Users can now ask questions in natural language");
                logger.info(``);
                logger.info("Example queries:");
                logger.info(chalk.gray('  "Show me all tasks due this week"'));
                logger.info(chalk.gray('  "How many users signed up last month?"'));
                logger.info(chalk.gray('  "What tables have a created_at column?"'));
            }
        }
        catch (error) {
            logger.error(`Failed to configure AI: ${error.message}`);
            process.exit(1);
        }
    });
    // Connect command
    dbViewer
        .command("connect <database>")
        .description("Configure connection to a specific database")
        .action(async (database) => {
        try {
            const hestiaHome = process.env.HESTIA_HOME || "/opt/hestia";
            const service = new WhoDBService(hestiaHome);
            await service.initialize();
            await withSpinner(`Configuring connection to ${database}...`, () => service.connectToDatabase(database), "Database connection configured");
            logger.success(`Database ${chalk.cyan(database)} added to WhoDB`);
            logger.info("Note: WhoDB auto-detects available databases on startup");
            const status = await service.getStatus();
            if (status === "running") {
                logger.info(chalk.gray("Restart WhoDB to apply changes: hestia db:viewer:disable && hestia db:viewer:enable"));
            }
        }
        catch (error) {
            logger.error(`Failed to connect to database: ${error.message}`);
            process.exit(1);
        }
    });
    // Alias commands for convenience
    program
        .command("db:viewer:enable")
        .description("Enable WhoDB (alias for 'db:viewer enable')")
        .action(() => {
        // Re-invoke with enable subcommand
        program.parse(["node", "hestia", "db:viewer", "enable"]);
    });
    program
        .command("db:viewer:disable")
        .description("Disable WhoDB (alias for 'db:viewer disable')")
        .action(() => {
        program.parse(["node", "hestia", "db:viewer", "disable"]);
    });
    program
        .command("db:viewer:open")
        .description("Open WhoDB in browser (alias for 'db:viewer open')")
        .action(() => {
        program.parse(["node", "hestia", "db:viewer", "open"]);
    });
    program
        .command("db:viewer:status")
        .description("Show WhoDB status (alias for 'db:viewer status')")
        .action(() => {
        program.parse(["node", "hestia", "db:viewer", "status"]);
    });
    program
        .command("db:viewer:logs")
        .description("Show WhoDB logs (alias for 'db:viewer logs')")
        .action(() => {
        program.parse(["node", "hestia", "db:viewer", "logs"]);
    });
    program
        .command("db:viewer:ai")
        .description("Toggle AI features (alias for 'db:viewer ai')")
        .action(() => {
        program.parse(["node", "hestia", "db:viewer", "ai"]);
    });
    program
        .command("db:viewer:connect <database>")
        .description("Connect to database (alias for 'db:viewer connect')")
        .action((database) => {
        program.parse(["node", "hestia", "db:viewer", "connect", database]);
    });
}
/**
 * Format status for display
 */
function formatStatus(status) {
    const colors = {
        running: (s) => chalk.green("✓ " + s),
        stopped: (s) => chalk.gray("○ " + s),
        error: (s) => chalk.red("✗ " + s),
    };
    return (colors[status] || chalk.gray)(status);
}
//# sourceMappingURL=db-viewer.js.map