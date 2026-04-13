/**
 * WhoDB Service - AI-powered database viewer for Hestia
 *
 * WhoDB is a lightweight (<50MB) database visualization tool that provides:
 * - Web UI for database inspection and querying
 * - AI-powered natural language queries (via Ollama)
 * - Visual schema topology and relationship diagrams
 * - Support for PostgreSQL, MySQL, Redis, and more
 *
 * This service manages the WhoDB Docker container lifecycle and configuration,
 * automatically connecting to Hestia's Synap Backend PostgreSQL database and Redis.
 *
 * When to use WhoDB:
 * - Debugging database issues without writing SQL
 * - Exploring unfamiliar database schemas
 * - Visualizing entity relationships in Synap
 * - Quick ad-hoc queries during development
 * - Learning database concepts with visual aids
 *
 * @module whodb-service
 */
export interface WhoDBConfig {
    enabled: boolean;
    provider: "whodb" | "none";
    port: number;
    aiEnabled: boolean;
    databases: string[];
}
/**
 * WhoDB Service class
 * Manages installation, configuration, and lifecycle of WhoDB container
 */
export declare class WhoDBService {
    private config;
    private configPath;
    private hestiaHome;
    /**
     * Create a new WhoDBService instance
     * @param hestiaHome - Path to Hestia installation directory (default: /opt/hestia)
     */
    constructor(hestiaHome?: string);
    /**
     * Initialize the service by loading configuration
     */
    initialize(): Promise<void>;
    /**
     * Install WhoDB by pulling the Docker image
     * This downloads the clidey/whodb image but doesn't start the container
     */
    install(): Promise<void>;
    /**
     * Configure WhoDB with database connections
     * Creates the docker-compose override file and environment configuration
     */
    configure(): Promise<void>;
    /**
     * Start the WhoDB Docker container
     */
    start(): Promise<void>;
    /**
     * Stop the WhoDB Docker container
     */
    stop(): Promise<void>;
    /**
     * Get the current status of WhoDB
     * @returns "running" | "stopped" | "error"
     */
    getStatus(): Promise<"running" | "stopped" | "error">;
    /**
     * Get the URL to access WhoDB
     */
    getUrl(): string;
    /**
     * Open WhoDB in the default browser
     */
    open(): Promise<void>;
    /**
     * Configure connection to Synap Backend PostgreSQL database
     * Automatically reads connection details from Hestia'configuration
     */
    connectToSynap(): Promise<void>;
    /**
     * Enable AI integration with Ollama for natural language queries
     * When enabled, users can ask questions in plain English instead of SQL
     */
    enableAI(model?: string): Promise<void>;
    /**
     * Disable AI integration
     */
    disableAI(): Promise<void>;
    /**
     * Get the logs from the WhoDB container
     */
    getLogs(tail?: number): Promise<string>;
    /**
     * Connect to a specific database by name
     * Adds the database to the list of configured databases
     */
    connectToDatabase(databaseName: string): Promise<void>;
    /**
     * Enable WhoDB in the Hestia configuration
     */
    enable(): Promise<void>;
    /**
     * Disable WhoDB in the Hestia configuration
     */
    disable(): Promise<void>;
    /**
     * Get WhoDB configuration from Hestia config
     */
    private getWhoDBConfig;
    /**
     * Update WhoDB configuration in Hestia config
     */
    private updateConfig;
    /**
     * Add a database to the configured databases list
     */
    private addDatabase;
    /**
     * Generate environment file content for WhoDB
     */
    private generateEnvFile;
    /**
     * Generate environment file content from key-value pairs
     */
    private generateEnvFileContent;
    /**
     * Generate a random session secret
     */
    private generateSessionSecret;
    /**
     * Generate a basic docker-compose file if template is not available
     */
    private generateBasicCompose;
    /**
     * Parse environment file content into key-value pairs
     */
    private parseEnvFile;
    /**
     * Check if WhoDB container is healthy
     */
    private checkHealth;
    /**
     * Wait for WhoDB to become healthy
     */
    private waitForHealthy;
}
export declare const whoDBService: WhoDBService;
//# sourceMappingURL=whodb-service.d.ts.map