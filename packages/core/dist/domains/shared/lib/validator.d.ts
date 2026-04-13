/**
 * Production Validation Framework for Hestia CLI
 *
 * Validates the entire Hestia system before production deployment.
 * Provides comprehensive checks for system health, dependencies, configuration,
 * and integrations across all components.
 */
/**
 * Result of a single validation check
 */
export interface ValidationResult {
    /** Whether the validation passed */
    valid: boolean;
    /** Critical errors that must be fixed */
    errors: string[];
    /** Non-critical warnings */
    warnings: string[];
    /** Informational messages */
    info: string[];
    /** Time taken to run validation in ms */
    duration?: number;
    /** Suggested fixes for errors */
    fixes: string[];
}
/**
 * Category of validations
 */
export type ValidationCategory = "system" | "dependency" | "hestia" | "openclaude" | "openclaw" | "a2a" | "integration" | "all";
/**
 * Complete validation report
 */
export interface ValidationReport {
    /** Overall validation status */
    valid: boolean;
    /** Results by category */
    categories: Record<ValidationCategory, ValidationResult>;
    /** Timestamp of validation */
    timestamp: Date;
    /** Total duration in ms */
    totalDuration: number;
    /** System information */
    systemInfo: SystemInfo;
    /** Summary counts */
    summary: {
        totalChecks: number;
        passed: number;
        failed: number;
        warnings: number;
        autoFixable: number;
    };
}
/**
 * System information collected during validation
 */
export interface SystemInfo {
    platform: string;
    arch: string;
    nodeVersion: string;
    hestiaVersion: string;
    cpuCount: number;
    totalMemory: string;
    freeMemory: string;
    homeDir: string;
    configDir: string;
    shell: string;
}
/**
 * Fix options for auto-fixing issues
 */
export interface FixOptions {
    /** Automatically fix without prompting */
    autoFix?: boolean;
    /** Fix specific category only */
    category?: ValidationCategory;
    /** Dry run - show what would be fixed */
    dryRun?: boolean;
}
export declare class ProductionValidator {
    private apiClient;
    private stateManager;
    private a2aBridge;
    private validationCache;
    private cacheExpiry;
    private readonly CACHE_TTL;
    private currentReport;
    /**
     * Validate Node.js version is >= 18
     */
    validateNodeVersion(): Promise<ValidationResult>;
    /**
     * Validate platform is supported (Linux/macOS)
     */
    validatePlatform(): Promise<ValidationResult>;
    /**
     * Validate architecture is supported
     */
    validateArchitecture(): Promise<ValidationResult>;
    /**
     * Validate write permissions to required directories
     */
    validatePermissions(): Promise<ValidationResult>;
    /**
     * Validate Docker is installed and running
     */
    validateDocker(): Promise<ValidationResult>;
    /**
     * Validate docker-compose is available
     */
    validateDockerCompose(): Promise<ValidationResult>;
    /**
     * Validate git is installed
     */
    validateGit(): Promise<ValidationResult>;
    /**
     * Validate internet connectivity
     */
    validateNetwork(): Promise<ValidationResult>;
    /**
     * Validate required ports are available
     */
    validatePorts(): Promise<ValidationResult>;
    /**
     * Validate Hestia configuration file
     */
    validateHestiaConfig(): Promise<ValidationResult>;
    /**
     * Validate Hestia directories exist and are writable
     */
    validateHestiaDirectories(): Promise<ValidationResult>;
    /**
     * Validate connection to Synap backend
     */
    validateSynapBackend(): Promise<ValidationResult>;
    /**
     * Validate API key is valid
     */
    validateApiKey(): Promise<ValidationResult>;
    /**
     * Validate @gitlawb/openclaude is installed
     */
    validateOpenClaudeInstalled(): Promise<ValidationResult>;
    /**
     * Validate OpenClaude profile configuration
     */
    validateOpenClaudeConfig(): Promise<ValidationResult>;
    /**
     * Validate AI provider is configured
     */
    validateOpenClaudeProvider(): Promise<ValidationResult>;
    /**
     * Validate MCP servers are configured
     */
    validateMCPServers(): Promise<ValidationResult>;
    /**
     * Validate OpenClaw is installed
     */
    validateOpenClawInstalled(): Promise<ValidationResult>;
    /**
     * Validate OpenClaw configuration
     */
    validateOpenClawConfig(): Promise<ValidationResult>;
    /**
     * Validate at least one communications platform is configured
     */
    validateOpenClawComms(): Promise<ValidationResult>;
    /**
     * Validate OpenClaw skills directory
     */
    validateOpenClawSkills(): Promise<ValidationResult>;
    /**
     * Validate A2A Bridge can start
     */
    validateA2ABridge(): Promise<ValidationResult>;
    /**
     * Validate agents can register
     */
    validateAgentConnectivity(): Promise<ValidationResult>;
    /**
     * Validate shared memory store is accessible
     */
    validateSharedMemory(): Promise<ValidationResult>;
    /**
     * Validate state manager sync works
     */
    validateStateSync(): Promise<ValidationResult>;
    /**
     * Validate agents can message each other
     */
    validateAgentCommunication(): Promise<ValidationResult>;
    /**
     * Validate end-to-end system functionality
     */
    validateEndToEnd(): Promise<ValidationResult>;
    /**
     * Run all validations and return comprehensive report
     */
    validateAll(): Promise<ValidationReport>;
    /**
     * Run validation for a specific category
     */
    validateCategory(category: ValidationCategory): Promise<ValidationResult>;
    /**
     * Generate markdown report of validation results
     */
    generateReport(format?: "markdown" | "json" | "html"): string;
    /**
     * Generate markdown report
     */
    private generateMarkdownReport;
    /**
     * Generate HTML report
     */
    private generateHtmlReport;
    /**
     * Auto-fix common issues with user confirmation
     */
    fixIssues(options?: FixOptions): Promise<{
        fixed: string[];
        failed: string[];
        skipped: string[];
    }>;
    /**
     * Check if system passes all critical validations
     */
    isProductionReady(): boolean;
    /**
     * Get detailed production readiness status
     */
    getProductionReadiness(): {
        ready: boolean;
        blockers: string[];
        warnings: string[];
        recommendations: string[];
    };
    /**
     * Run a single validation with caching and timing
     */
    private runValidation;
    /**
     * Merge multiple validation results into one
     */
    private mergeResults;
    /**
     * Collect system information
     */
    private collectSystemInfo;
    /**
     * Format bytes to human-readable string
     */
    private formatBytes;
    /**
     * Prompt user for yes/no input
     */
    private promptYesNo;
    /**
     * Clear validation cache
     */
    clearCache(): void;
    /**
     * Get validation cache statistics
     */
    getCacheStats(): {
        size: number;
        entries: string[];
    };
    /**
     * Dispose of validator resources
     */
    dispose(): void;
}
export declare const productionValidator: ProductionValidator;
/**
 * Quick validation - run all checks and return boolean
 */
export declare function quickValidate(): Promise<boolean>;
/**
 * Validate specific category
 */
export declare function validate(category: ValidationCategory): Promise<ValidationResult>;
/**
 * Generate and save report to file
 */
export declare function saveReport(filePath: string, format?: "markdown" | "json" | "html"): Promise<void>;
/**
 * Check if production ready (with validation)
 */
export declare function checkProductionReady(): Promise<{
    ready: boolean;
    details: ReturnType<typeof productionValidator.getProductionReadiness>;
}>;
export default ProductionValidator;
//# sourceMappingURL=validator.d.ts.map