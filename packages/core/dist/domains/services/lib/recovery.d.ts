/**
 * Hestia CLI - Recovery and Rollback System
 *
 * Handles failures gracefully and recovers from bad states.
 * Provides backup, recovery, rollback, repair, and safe mode operations.
 */
import { HestiaConfig } from '../../lib/utils/index';
export interface BackupMetadata {
    name: string;
    createdAt: Date;
    description?: string;
    version: string;
    size: number;
    checksum: string;
    components: BackupComponents;
}
export interface BackupComponents {
    config: boolean;
    packages: boolean;
    state: boolean;
    logs: boolean;
    data?: boolean;
}
export interface RollbackPoint {
    id: string;
    name: string;
    createdAt: Date;
    description: string;
    snapshot: RollbackSnapshot;
}
export interface RollbackSnapshot {
    config?: HestiaConfig;
    packageVersions: Record<string, string>;
    stateHash: string;
    files: string[];
}
export interface RecoveryLog {
    id: string;
    timestamp: Date;
    operation: string;
    status: "success" | "failure" | "in_progress";
    message: string;
    details?: Record<string, unknown>;
    error?: string;
}
export interface DiagnosisResult {
    healthy: boolean;
    issues: Issue[];
    suggestions: SuggestedFix[];
    timestamp: Date;
}
export interface Issue {
    id: string;
    severity: "critical" | "warning" | "info";
    category: "config" | "packages" | "services" | "database" | "network" | "permissions" | "sync";
    message: string;
    details?: Record<string, unknown>;
}
export interface SuggestedFix {
    id: string;
    issueId: string;
    description: string;
    operation: string;
    risk: "low" | "medium" | "high";
    automatic: boolean;
}
export interface RecoveryOptions {
    dryRun?: boolean;
    skipConfirmation?: boolean;
    verbose?: boolean;
    timeout?: number;
}
export interface SafeModeConfig {
    enabled: boolean;
    minimalPackages: string[];
    disabledFeatures: string[];
    safeNetworkConfig: boolean;
    readonlyMode: boolean;
}
export interface RecoveryProgress {
    phase: string;
    current: number;
    total: number;
    message: string;
}
export declare class RecoverySystem {
    private backupDir;
    private logDir;
    private recoveryLog;
    private rollbackPoints;
    private safeModeConfig;
    private apiClient;
    private packageService;
    private rl;
    constructor();
    initialize(): Promise<void>;
    private loadRecoveryLog;
    private saveRecoveryLog;
    private loadRollbackPoints;
    private saveRollbackPoints;
    private logOperation;
    private confirm;
    private closeReadline;
    private reportProgress;
    private executeWithTimeout;
    createBackup(name: string, description?: string, components?: Partial<BackupComponents>, options?: RecoveryOptions): Promise<BackupMetadata>;
    listBackups(): Promise<BackupMetadata[]>;
    restoreBackup(name: string, options?: RecoveryOptions): Promise<void>;
    deleteBackup(name: string, options?: RecoveryOptions): Promise<void>;
    autoBackup(options?: RecoveryOptions): Promise<void>;
    recoverConfig(options?: RecoveryOptions): Promise<void>;
    recoverServices(options?: RecoveryOptions): Promise<void>;
    recoverDatabase(options?: RecoveryOptions): Promise<void>;
    recoverState(options?: RecoveryOptions): Promise<void>;
    recoverInstallation(options?: RecoveryOptions): Promise<void>;
    createRollbackPoint(name: string, description?: string): Promise<RollbackPoint>;
    rollbackPackage(packageName: string, options?: RecoveryOptions): Promise<void>;
    rollbackConfig(options?: RecoveryOptions): Promise<void>;
    rollbackInstallation(options?: RecoveryOptions): Promise<void>;
    repairPermissions(options?: RecoveryOptions): Promise<void>;
    repairDependencies(options?: RecoveryOptions): Promise<void>;
    repairNetwork(options?: RecoveryOptions): Promise<void>;
    repairDocker(options?: RecoveryOptions): Promise<void>;
    repairDatabase(options?: RecoveryOptions): Promise<void>;
    repairSync(options?: RecoveryOptions): Promise<void>;
    enableSafeMode(options?: RecoveryOptions): Promise<void>;
    disableSafeMode(options?: RecoveryOptions): Promise<void>;
    diagnoseIssues(options?: RecoveryOptions): Promise<DiagnosisResult>;
    suggestFixes(diagnosis?: DiagnosisResult): Promise<SuggestedFix[]>;
    applyFix(fixId: string, options?: RecoveryOptions): Promise<void>;
    private copyDirectory;
    private computeChecksum;
    private computeStateHash;
    getRecoveryLogs(limit?: number): Promise<RecoveryLog[]>;
    getRollbackPoints(): Promise<RollbackPoint[]>;
    clearRecoveryLogs(): Promise<void>;
    isSafeMode(): Promise<boolean>;
    /**
     * Check if an operation is already in progress or recently completed
     * to ensure idempotency
     */
    private isOperationPending;
    /**
     * Mark operation as in progress
     */
    private markOperationInProgress;
    /**
     * Mark operation as complete
     */
    private markOperationComplete;
}
export declare const recovery: RecoverySystem;
export declare function initializeRecovery(): Promise<void>;
export default RecoverySystem;
//# sourceMappingURL=recovery.d.ts.map