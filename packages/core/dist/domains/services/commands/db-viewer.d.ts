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
import { Command } from "commander";
/**
 * Register the db:viewer command and subcommands
 */
export declare function dbViewerCommand(program: Command): void;
//# sourceMappingURL=db-viewer.d.ts.map