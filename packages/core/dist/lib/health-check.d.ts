/**
 * Health Check System for Hestia CLI
 *
 * Comprehensive real-time monitoring system for all Hestia services.
 * Monitors service health, resources, network, and integrations with
 * automatic alerting and optional auto-restart capabilities.
 */
import * as EventEmitter from 'eventemitter3';
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';
export type CheckCategory = 'service' | 'resource' | 'network' | 'integration';
export interface HealthCheckResult {
    healthy: boolean;
    status: HealthStatus;
    message: string;
    metrics?: Record<string, number | string | boolean | Date | string[]>;
    lastCheck: Date;
    duration?: number;
    error?: string;
}
export interface HealthReport {
    timestamp: Date;
    overallStatus: HealthStatus;
    healthScore: number;
    categories: Record<CheckCategory, {
        status: HealthStatus;
        checks: Record<string, HealthCheckResult>;
    }>;
    degradedServices: string[];
    failedServices: string[];
    summary: {
        totalChecks: number;
        healthy: number;
        degraded: number;
        unhealthy: number;
    };
}
export interface HealthCheckConfig {
    autoRestart?: boolean;
    alertThreshold?: number;
    checkInterval?: number;
    diskThreshold?: number;
    memoryThreshold?: number;
    cpuThreshold?: number;
    logHistory?: boolean;
    historySize?: number;
}
export interface SystemMetrics {
    timestamp: Date;
    cpu: {
        loadAvg: number[];
        usage: number;
        cores: number;
    };
    memory: {
        total: number;
        free: number;
        used: number;
        percentage: number;
    };
    disk: {
        total: number;
        free: number;
        used: number;
        percentage: number;
    };
}
export declare class HealthCheckSystem extends EventEmitter {
    private config;
    private checkResults;
    private checkHistory;
    private watchInterval;
    private degradedCount;
    private isWatching;
    constructor(config?: HealthCheckConfig);
    /**
     * Check Synap Backend health via HTTP endpoint
     */
    checkSynapBackend(): Promise<HealthCheckResult>;
    /**
     * Check PostgreSQL container status and connectivity
     */
    checkPostgres(): Promise<HealthCheckResult>;
    /**
     * Check Redis container status and connectivity
     */
    checkRedis(): Promise<HealthCheckResult>;
    /**
     * Check Typesense container and API
     */
    checkTypesense(): Promise<HealthCheckResult>;
    /**
     * Check OpenClaw process and API
     */
    checkOpenClaw(): Promise<HealthCheckResult>;
    /**
     * Check OpenClaude process and gRPC port
     */
    checkOpenClaude(): Promise<HealthCheckResult>;
    /**
     * Check A2A Bridge status
     */
    checkA2ABridge(): Promise<HealthCheckResult>;
    /**
     * Check disk space on /opt/hestia
     */
    checkDiskSpace(): Promise<HealthCheckResult>;
    /**
     * Check system memory
     */
    checkMemory(): Promise<HealthCheckResult>;
    /**
     * Check CPU load
     */
    checkCPU(): Promise<HealthCheckResult>;
    /**
     * Check Docker storage space
     */
    checkDockerStorage(): Promise<HealthCheckResult>;
    /**
     * Check internet connectivity
     */
    checkInternet(): Promise<HealthCheckResult>;
    /**
     * Check DNS resolution
     */
    checkDNS(): Promise<HealthCheckResult>;
    /**
     * Check firewall (UFW) rules
     */
    checkFirewall(): Promise<HealthCheckResult>;
    /**
     * Check port bindings
     */
    checkPortBindings(): Promise<HealthCheckResult>;
    /**
     * Check state sync between local and remote
     */
    checkStateSync(): Promise<HealthCheckResult>;
    /**
     * Check agent connectivity via A2A bridge
     */
    checkAgentConnectivity(): Promise<HealthCheckResult>;
    /**
     * Check Synap database connectivity
     */
    checkDatabaseConnection(): Promise<HealthCheckResult>;
    /**
     * Check backup status
     */
    checkBackupStatus(): Promise<HealthCheckResult>;
    /**
     * Run all health checks
     */
    runAllChecks(): Promise<HealthReport>;
    /**
     * Run checks for a specific category
     */
    runCheck(category: CheckCategory): Promise<Record<string, HealthCheckResult>>;
    /**
     * Start continuous monitoring
     */
    watch(interval?: number): void;
    /**
     * Stop continuous monitoring
     */
    stopWatch(): void;
    /**
     * Get overall health score (0-100%)
     */
    getHealthScore(): number;
    /**
     * Generate health report
     */
    generateHealthReport(): HealthReport | null;
    /**
     * Get health check history
     */
    getHistory(limit?: number): HealthReport[];
    /**
     * Get the result of a specific check
     */
    getCheckResult(checkName: string): HealthCheckResult | undefined;
    /**
     * Get all check results
     */
    getAllResults(): Map<string, HealthCheckResult>;
    /**
     * Update configuration
     */
    updateConfig(config: Partial<HealthCheckConfig>): void;
    /**
     * Dispose of the health check system
     */
    dispose(): void;
    private createResult;
    private getWorstStatus;
    private calculateHealthScore;
    private alertOnDegraded;
    private autoRestart;
    private restartService;
    private formatBytes;
}
export declare const healthCheck: HealthCheckSystem;
export default HealthCheckSystem;
//# sourceMappingURL=health-check.d.ts.map