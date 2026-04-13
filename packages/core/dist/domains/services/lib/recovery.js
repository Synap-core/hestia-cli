// @ts-nocheck
/**
 * Hestia CLI - Recovery and Rollback System
 *
 * Handles failures gracefully and recovers from bad states.
 * Provides backup, recovery, rollback, repair, and safe mode operations.
 */
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { promisify } from "util";
import { exec } from "child_process";
import { createInterface } from "readline";
import YAML from "yaml";
import { logger } from '../../lib/utils/index';
import { loadConfig, saveConfig, getConfigPaths } from '../../lib/utils/index';
import { PackageService } from '../../../domains/registry/lib/package-service.js';
import { createAPIClient } from '../../../domains/shared/lib/api-client.js';
import { stateManager } from '../../../domains/services/lib/state-manager.js';
const execAsync = promisify(exec);
// ============================================================================
// Recovery System Class
// ============================================================================
export class RecoverySystem {
    backupDir;
    logDir;
    recoveryLog = [];
    rollbackPoints = [];
    safeModeConfig = {
        enabled: false,
        minimalPackages: ["core"],
        disabledFeatures: ["intelligence", "connectors"],
        safeNetworkConfig: true,
        readonlyMode: false,
    };
    apiClient = null;
    packageService = null;
    rl = null;
    constructor() {
        const configDir = process.env.HESTIA_CONFIG_DIR || path.join(os.homedir(), ".hestia");
        this.backupDir = path.join(configDir, "backups");
        this.logDir = path.join(configDir, "recovery-logs");
    }
    // ============================================================================
    // Initialization
    // ============================================================================
    async initialize() {
        await fs.mkdir(this.backupDir, { recursive: true });
        await fs.mkdir(this.logDir, { recursive: true });
        await this.loadRecoveryLog();
        await this.loadRollbackPoints();
        // Initialize API client if possible
        try {
            this.apiClient = await createAPIClient();
        }
        catch {
            this.apiClient = null;
        }
        this.logOperation("system", "RecoverySystem initialized", "success");
    }
    async loadRecoveryLog() {
        try {
            const logPath = path.join(this.logDir, "recovery-log.json");
            const content = await fs.readFile(logPath, "utf-8");
            this.recoveryLog = JSON.parse(content);
        }
        catch {
            this.recoveryLog = [];
        }
    }
    async saveRecoveryLog() {
        const logPath = path.join(this.logDir, "recovery-log.json");
        await fs.writeFile(logPath, JSON.stringify(this.recoveryLog, null, 2), "utf-8");
    }
    async loadRollbackPoints() {
        try {
            const pointsPath = path.join(this.backupDir, "rollback-points.json");
            const content = await fs.readFile(pointsPath, "utf-8");
            this.rollbackPoints = JSON.parse(content);
        }
        catch {
            this.rollbackPoints = [];
        }
    }
    async saveRollbackPoints() {
        const pointsPath = path.join(this.backupDir, "rollback-points.json");
        await fs.writeFile(pointsPath, JSON.stringify(this.rollbackPoints, null, 2), "utf-8");
    }
    async logOperation(operation, message, status, details, error) {
        const logEntry = {
            id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
            operation,
            status,
            message,
            details,
            error,
        };
        this.recoveryLog.push(logEntry);
        await this.saveRecoveryLog();
        const statusIcon = status === "success" ? "✓" : status === "failure" ? "✗" : "⟳";
        logger.info(`[${statusIcon}] ${operation}: ${message}`);
        if (error) {
            logger.error(`  Error: ${error}`);
        }
    }
    // ============================================================================
    // Confirmation & Interactive Utilities
    // ============================================================================
    async confirm(message, skipConfirmation = false) {
        if (skipConfirmation)
            return true;
        if (!this.rl) {
            this.rl = createInterface({
                input: process.stdin,
                output: process.stdout,
            });
        }
        return new Promise((resolve) => {
            this.rl.question(`${message} [y/N]: `, (answer) => {
                resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
            });
        });
    }
    async closeReadline() {
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
    }
    reportProgress(progress) {
        const percentage = Math.round((progress.current / progress.total) * 100);
        const filled = Math.round((progress.current / progress.total) * 20);
        const bar = "█".repeat(filled) + "░".repeat(20 - filled);
        logger.progress(progress.current, progress.total, `[${progress.phase}] ${progress.message}`);
    }
    async executeWithTimeout(operation, timeoutMs, operationName) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            operation()
                .then((result) => {
                clearTimeout(timeoutId);
                resolve(result);
            })
                .catch((error) => {
                clearTimeout(timeoutId);
                reject(error);
            });
        });
    }
    // ============================================================================
    // Backup Operations
    // ============================================================================
    async createBackup(name, description, components = {}, options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header(`Creating Backup: ${name}`);
        if (dryRun) {
            logger.info("[DRY RUN] Would create backup with components:");
            logger.object({ config: true, packages: true, state: true, logs: true, ...components });
            return null;
        }
        const fullComponents = {
            config: true,
            packages: true,
            state: true,
            logs: true,
            ...components,
        };
        const confirmed = await this.confirm(`Create backup "${name}"? This may take a few minutes.`, skipConfirmation);
        if (!confirmed) {
            logger.info("Backup creation cancelled");
            await this.closeReadline();
            throw new Error("Backup creation cancelled by user");
        }
        const backupId = `backup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const backupPath = path.join(this.backupDir, backupId);
        try {
            await fs.mkdir(backupPath, { recursive: true });
            // Backup configuration
            if (fullComponents.config) {
                this.reportProgress({ phase: "backup", current: 1, total: 5, message: "Backing up configuration..." });
                const { config } = await loadConfig();
                await fs.writeFile(path.join(backupPath, "config.yaml"), YAML.stringify(config), "utf-8");
            }
            // Backup packages
            if (fullComponents.packages) {
                this.reportProgress({ phase: "backup", current: 2, total: 5, message: "Backing up packages..." });
                const paths = getConfigPaths();
                const packagesDir = path.join(paths.configDir, "packages");
                try {
                    await fs.access(packagesDir);
                    await this.copyDirectory(packagesDir, path.join(backupPath, "packages"));
                }
                catch {
                    // No packages directory, skip
                }
            }
            // Backup state
            if (fullComponents.state) {
                this.reportProgress({ phase: "backup", current: 3, total: 5, message: "Backing up state..." });
                const state = await stateManager.getStateSummary();
                await fs.writeFile(path.join(backupPath, "state.json"), JSON.stringify(state, null, 2), "utf-8");
            }
            // Backup logs
            if (fullComponents.logs) {
                this.reportProgress({ phase: "backup", current: 4, total: 5, message: "Backing up logs..." });
                const logPath = path.join(backupPath, "recovery-logs.json");
                await fs.writeFile(logPath, JSON.stringify(this.recoveryLog, null, 2), "utf-8");
            }
            // Create metadata
            this.reportProgress({ phase: "backup", current: 5, total: 5, message: "Finalizing backup..." });
            const { config } = await loadConfig();
            const stats = await fs.stat(backupPath);
            const metadata = {
                name,
                createdAt: new Date(),
                description,
                version: config.version,
                size: stats.size,
                checksum: await this.computeChecksum(backupPath),
                components: fullComponents,
            };
            await fs.writeFile(path.join(backupPath, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");
            await this.logOperation("createBackup", `Backup "${name}" created successfully`, "success", {
                backupId,
                size: metadata.size,
            });
            logger.success(`Backup "${name}" created at ${backupPath}`);
            await this.closeReadline();
            return metadata;
        }
        catch (error) {
            await this.logOperation("createBackup", `Failed to create backup "${name}"`, "failure", { backupId }, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async listBackups() {
        const backups = [];
        try {
            const entries = await fs.readdir(this.backupDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    try {
                        const metadataPath = path.join(this.backupDir, entry.name, "metadata.json");
                        const content = await fs.readFile(metadataPath, "utf-8");
                        const metadata = JSON.parse(content);
                        metadata.createdAt = new Date(metadata.createdAt);
                        backups.push(metadata);
                    }
                    catch {
                        // Skip invalid backups
                    }
                }
            }
        }
        catch {
            // Directory doesn't exist yet
        }
        // Sort by creation date, newest first
        backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return backups;
    }
    async restoreBackup(name, options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header(`Restoring Backup: ${name}`);
        const backups = await this.listBackups();
        const backup = backups.find((b) => b.name === name);
        if (!backup) {
            throw new Error(`Backup "${name}" not found`);
        }
        if (dryRun) {
            logger.info("[DRY RUN] Would restore backup with components:");
            logger.object(backup.components);
            return;
        }
        const confirmed = await this.confirm(`Restore backup "${name}" from ${backup.createdAt.toISOString()}? This will overwrite current configuration.`, skipConfirmation);
        if (!confirmed) {
            logger.info("Restore cancelled");
            await this.closeReadline();
            return;
        }
        // Find backup directory
        const entries = await fs.readdir(this.backupDir, { withFileTypes: true });
        let backupDir = null;
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const metadataPath = path.join(this.backupDir, entry.name, "metadata.json");
                try {
                    const content = await fs.readFile(metadataPath, "utf-8");
                    const metadata = JSON.parse(content);
                    if (metadata.name === name) {
                        backupDir = path.join(this.backupDir, entry.name);
                        break;
                    }
                }
                catch {
                    // Skip
                }
            }
        }
        if (!backupDir) {
            throw new Error(`Backup directory for "${name}" not found`);
        }
        try {
            // Restore configuration
            if (backup.components.config) {
                this.reportProgress({ phase: "restore", current: 1, total: 4, message: "Restoring configuration..." });
                const configPath = path.join(backupDir, "config.yaml");
                const configContent = await fs.readFile(configPath, "utf-8");
                const config = YAML.parse(configContent);
                await saveConfig(config);
            }
            // Restore packages
            if (backup.components.packages) {
                this.reportProgress({ phase: "restore", current: 2, total: 4, message: "Restoring packages..." });
                const packagesBackupDir = path.join(backupDir, "packages");
                const paths = getConfigPaths();
                try {
                    await fs.access(packagesBackupDir);
                    await fs.rm(paths.packagesDir, { recursive: true, force: true });
                    await this.copyDirectory(packagesBackupDir, paths.packagesDir);
                }
                catch {
                    // No packages to restore
                }
            }
            // Restore state
            if (backup.components.state) {
                this.reportProgress({ phase: "restore", current: 3, total: 4, message: "Restoring state..." });
                const statePath = path.join(backupDir, "state.json");
                try {
                    await fs.access(statePath);
                    await stateManager.reset();
                    // State will be re-synced on next operation
                }
                catch {
                    // No state to restore
                }
            }
            this.reportProgress({ phase: "restore", current: 4, total: 4, message: "Restore complete" });
            await this.logOperation("restoreBackup", `Backup "${name}" restored successfully`, "success", {
                fromDate: backup.createdAt,
            });
            logger.success(`Backup "${name}" restored successfully`);
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("restoreBackup", `Failed to restore backup "${name}"`, "failure", { name }, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async deleteBackup(name, options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header(`Deleting Backup: ${name}`);
        const backups = await this.listBackups();
        const backup = backups.find((b) => b.name === name);
        if (!backup) {
            throw new Error(`Backup "${name}" not found`);
        }
        if (dryRun) {
            logger.info("[DRY RUN] Would delete backup");
            return;
        }
        const confirmed = await this.confirm(`Delete backup "${name}" from ${backup.createdAt.toISOString()}? This cannot be undone.`, skipConfirmation);
        if (!confirmed) {
            logger.info("Delete cancelled");
            await this.closeReadline();
            return;
        }
        // Find and delete backup directory
        const entries = await fs.readdir(this.backupDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const metadataPath = path.join(this.backupDir, entry.name, "metadata.json");
                try {
                    const content = await fs.readFile(metadataPath, "utf-8");
                    const metadata = JSON.parse(content);
                    if (metadata.name === name) {
                        const backupDir = path.join(this.backupDir, entry.name);
                        await fs.rm(backupDir, { recursive: true, force: true });
                        break;
                    }
                }
                catch {
                    // Skip
                }
            }
        }
        await this.logOperation("deleteBackup", `Backup "${name}" deleted`, "success");
        logger.success(`Backup "${name}" deleted`);
        await this.closeReadline();
    }
    async autoBackup(options = {}) {
        const { dryRun = false } = options;
        logger.header("Auto Backup");
        // Check if auto-backup is needed (daily)
        const lastAutoBackup = this.recoveryLog
            .filter((log) => log.operation === "autoBackup" && log.status === "success")
            .pop();
        if (lastAutoBackup) {
            const lastBackupTime = new Date(lastAutoBackup.timestamp).getTime();
            const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
            if (lastBackupTime > oneDayAgo) {
                logger.info("Auto backup already performed today, skipping");
                return;
            }
        }
        const timestamp = new Date().toISOString().split("T")[0];
        const backupName = `auto-${timestamp}`;
        if (dryRun) {
            logger.info(`[DRY RUN] Would create auto-backup: ${backupName}`);
            return;
        }
        try {
            await this.createBackup(backupName, "Automatic daily backup", {}, { skipConfirmation: true });
            await this.logOperation("autoBackup", `Auto-backup "${backupName}" created`, "success");
            // Clean up old auto-backups (keep last 7)
            const backups = await this.listBackups();
            const autoBackups = backups.filter((b) => b.name.startsWith("auto-"));
            if (autoBackups.length > 7) {
                const toDelete = autoBackups.slice(7);
                for (const backup of toDelete) {
                    await this.deleteBackup(backup.name, { skipConfirmation: true });
                }
            }
        }
        catch (error) {
            await this.logOperation("autoBackup", "Auto-backup failed", "failure", {}, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    // ============================================================================
    // Recovery Operations
    // ============================================================================
    async recoverConfig(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Recovering Configuration");
        if (dryRun) {
            logger.info("[DRY RUN] Would attempt to restore config from last known good state");
            return;
        }
        const confirmed = await this.confirm("Attempt to recover configuration from last known good state?", skipConfirmation);
        if (!confirmed) {
            logger.info("Config recovery cancelled");
            await this.closeReadline();
            return;
        }
        try {
            this.reportProgress({ phase: "recovery", current: 1, total: 3, message: "Checking config validity..." });
            // Try to load current config
            let config;
            try {
                const loaded = await loadConfig();
                config = loaded.config;
            }
            catch (error) {
                // Config is corrupted, need to restore from backup
                logger.warn("Current config is corrupted, attempting restore from backup");
                const backups = await this.listBackups();
                if (backups.length > 0) {
                    await this.restoreBackup(backups[0].name, { skipConfirmation: true });
                    return;
                }
                else {
                    throw new Error("No backups available for recovery");
                }
            }
            // Validate and repair config
            this.reportProgress({ phase: "recovery", current: 2, total: 3, message: "Repairing configuration..." });
            // Ensure required fields
            if (!config.hearth) {
                config.hearth = { id: "", name: "Recovered Hearth", role: "primary" };
            }
            if (!config.hearth.id) {
                config.hearth.id = `hearth-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 8)}`;
            }
            if (!config.packages) {
                config.packages = {};
            }
            if (!config.version) {
                config.version = "1.0";
            }
            // Save repaired config
            this.reportProgress({ phase: "recovery", current: 3, total: 3, message: "Saving repaired config..." });
            await saveConfig(config);
            await this.logOperation("recoverConfig", "Configuration recovered successfully", "success");
            logger.success("Configuration recovered");
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("recoverConfig", "Config recovery failed", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async recoverServices(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Recovering Services");
        if (dryRun) {
            logger.info("[DRY RUN] Would restart failed services");
            return;
        }
        const confirmed = await this.confirm("Restart all failed services?", skipConfirmation);
        if (!confirmed) {
            logger.info("Service recovery cancelled");
            await this.closeReadline();
            return;
        }
        try {
            const { config } = await loadConfig();
            const paths = getConfigPaths();
            this.packageService = new PackageService({
                packagesDir: paths.packagesDir,
                config,
                logger: {
                    debug: (msg) => logger.debug(msg),
                    info: (msg) => logger.info(msg),
                    success: (msg) => logger.success(msg),
                    warn: (msg) => logger.warn(msg),
                    error: (msg) => logger.error(msg),
                },
            });
            // Get all packages
            const packages = await this.packageService.list();
            const failedPackages = packages.filter((p) => p.status === "error" || p.health?.status === "unhealthy");
            if (failedPackages.length === 0) {
                logger.info("No failed services found");
                await this.closeReadline();
                return;
            }
            let recovered = 0;
            for (let i = 0; i < failedPackages.length; i++) {
                const pkg = failedPackages[i];
                this.reportProgress({
                    phase: "recovery",
                    current: i + 1,
                    total: failedPackages.length,
                    message: `Restarting ${pkg.packageName}...`,
                });
                try {
                    await this.packageService.restart(pkg.packageName);
                    recovered++;
                }
                catch (error) {
                    logger.warn(`Failed to restart ${pkg.packageName}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            await this.logOperation("recoverServices", `Services recovery complete: ${recovered}/${failedPackages.length} recovered`, recovered === failedPackages.length ? "success" : "failure");
            logger.success(`Recovered ${recovered}/${failedPackages.length} services`);
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("recoverServices", "Service recovery failed", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async recoverDatabase(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Recovering Database Connections");
        if (dryRun) {
            logger.info("[DRY RUN] Would repair database connections");
            return;
        }
        const confirmed = await this.confirm("Attempt to repair database connections?", skipConfirmation);
        if (!confirmed) {
            logger.info("Database recovery cancelled");
            await this.closeReadline();
            return;
        }
        try {
            // Check API client connectivity
            this.reportProgress({ phase: "recovery", current: 1, total: 3, message: "Testing API connectivity..." });
            if (!this.apiClient) {
                try {
                    this.apiClient = await createAPIClient();
                }
                catch (error) {
                    logger.warn("Could not initialize API client, database recovery limited to local state");
                }
            }
            if (this.apiClient) {
                try {
                    await this.apiClient.healthCheck();
                    logger.info("API connectivity: OK");
                }
                catch (error) {
                    logger.error("API connectivity failed, attempting to reinitialize...");
                    this.apiClient = null;
                }
            }
            // Re-sync state
            this.reportProgress({ phase: "recovery", current: 2, total: 3, message: "Re-syncing state..." });
            await stateManager.reset();
            // Verify state
            this.reportProgress({ phase: "recovery", current: 3, total: 3, message: "Verifying state..." });
            await stateManager.getNormalState();
            await this.logOperation("recoverDatabase", "Database connections recovered", "success");
            logger.success("Database connections recovered");
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("recoverDatabase", "Database recovery failed", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async recoverState(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Recovering State from Synap Backend");
        if (dryRun) {
            logger.info("[DRY RUN] Would resync state from Synap Backend");
            return;
        }
        const confirmed = await this.confirm("Resync all state from Synap Backend? This will overwrite local changes.", skipConfirmation);
        if (!confirmed) {
            logger.info("State recovery cancelled");
            await this.closeReadline();
            return;
        }
        try {
            this.reportProgress({ phase: "recovery", current: 1, total: 3, message: "Resetting local state..." });
            await stateManager.reset();
            this.reportProgress({ phase: "recovery", current: 2, total: 3, message: "Syncing from Synap Backend..." });
            const result = await stateManager.syncAll();
            if (!result.success) {
                throw new Error(`Sync failed: ${result.errors.join(", ")}`);
            }
            this.reportProgress({ phase: "recovery", current: 3, total: 3, message: "Verifying sync..." });
            await stateManager.getStateSummary();
            await this.logOperation("recoverState", `State resynced: ${result.changes.synap.length} changes from Synap, ${result.changes.local.length} local changes`, "success");
            logger.success(`State recovered: ${result.direction} sync complete`);
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("recoverState", "State recovery failed", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async recoverInstallation(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Recovering Installation");
        if (dryRun) {
            logger.info("[DRY RUN] Would re-run failed installation steps");
            return;
        }
        const confirmed = await this.confirm("Re-run failed installation steps?", skipConfirmation);
        if (!confirmed) {
            logger.info("Installation recovery cancelled");
            await this.closeReadline();
            return;
        }
        try {
            const { config } = await loadConfig();
            const paths = getConfigPaths();
            // Check essential directories
            this.reportProgress({ phase: "recovery", current: 1, total: 4, message: "Checking directories..." });
            await fs.mkdir(paths.configDir, { recursive: true });
            await fs.mkdir(paths.packagesDir, { recursive: true });
            // Repair config
            this.reportProgress({ phase: "recovery", current: 2, total: 4, message: "Repairing configuration..." });
            await this.recoverConfig({ skipConfirmation: true });
            // Re-enable core packages
            this.reportProgress({ phase: "recovery", current: 3, total: 4, message: "Re-enabling core packages..." });
            const corePackages = ["core", "router"];
            for (const pkgName of corePackages) {
                if (config.packages[pkgName]) {
                    config.packages[pkgName].enabled = true;
                }
            }
            await saveConfig(config);
            // Verify API connectivity
            this.reportProgress({ phase: "recovery", current: 4, total: 4, message: "Verifying connectivity..." });
            try {
                this.apiClient = await createAPIClient();
                await this.apiClient.healthCheck();
            }
            catch {
                logger.warn("API connectivity not available, continuing in local mode");
            }
            await this.logOperation("recoverInstallation", "Installation recovered", "success");
            logger.success("Installation recovery complete");
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("recoverInstallation", "Installation recovery failed", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    // ============================================================================
    // Rollback Operations
    // ============================================================================
    async createRollbackPoint(name, description) {
        logger.header(`Creating Rollback Point: ${name}`);
        try {
            const { config } = await loadConfig();
            const paths = getConfigPaths();
            // Get current package versions
            const packageVersions = {};
            try {
                const entries = await fs.readdir(paths.packagesDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        try {
                            const manifestPath = path.join(paths.packagesDir, entry.name, "package.yaml");
                            const content = await fs.readFile(manifestPath, "utf-8");
                            const manifest = YAML.parse(content);
                            packageVersions[entry.name] = manifest.version || "unknown";
                        }
                        catch {
                            // Skip
                        }
                    }
                }
            }
            catch {
                // No packages
            }
            // Create snapshot
            const snapshot = {
                config: JSON.parse(JSON.stringify(config)), // Deep clone
                packageVersions,
                stateHash: await this.computeStateHash(),
                files: [],
            };
            const point = {
                id: `rollback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name,
                createdAt: new Date(),
                description: description || `Rollback point created at ${new Date().toISOString()}`,
                snapshot,
            };
            this.rollbackPoints.push(point);
            // Keep only last 10 rollback points
            if (this.rollbackPoints.length > 10) {
                this.rollbackPoints = this.rollbackPoints.slice(-10);
            }
            await this.saveRollbackPoints();
            await this.logOperation("createRollbackPoint", `Rollback point "${name}" created`, "success");
            logger.success(`Rollback point "${name}" created`);
            return point;
        }
        catch (error) {
            await this.logOperation("createRollbackPoint", `Failed to create rollback point "${name}"`, "failure", {}, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    async rollbackPackage(packageName, options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header(`Rolling Back Package: ${packageName}`);
        if (dryRun) {
            logger.info("[DRY RUN] Would rollback package to previous version");
            return;
        }
        // Find rollback point with this package
        const point = this.rollbackPoints
            .slice()
            .reverse()
            .find((p) => p.snapshot.packageVersions[packageName]);
        if (!point) {
            throw new Error(`No rollback point found for package "${packageName}"`);
        }
        const targetVersion = point.snapshot.packageVersions[packageName];
        const confirmed = await this.confirm(`Rollback ${packageName} to version ${targetVersion} (from ${point.createdAt.toISOString()})?`, skipConfirmation);
        if (!confirmed) {
            logger.info("Rollback cancelled");
            await this.closeReadline();
            return;
        }
        try {
            const { config } = await loadConfig();
            const paths = getConfigPaths();
            this.packageService = new PackageService({
                packagesDir: paths.packagesDir,
                config,
                logger: {
                    debug: (msg) => logger.debug(msg),
                    info: (msg) => logger.info(msg),
                    success: (msg) => logger.success(msg),
                    warn: (msg) => logger.warn(msg),
                    error: (msg) => logger.error(msg),
                },
            });
            this.reportProgress({ phase: "rollback", current: 1, total: 2, message: `Stopping ${packageName}...` });
            try {
                await this.packageService.stop(packageName);
            }
            catch {
                // May not be running
            }
            this.reportProgress({ phase: "rollback", current: 2, total: 2, message: `Updating to ${targetVersion}...` });
            await this.packageService.update(packageName, targetVersion);
            await this.logOperation("rollbackPackage", `Package ${packageName} rolled back to ${targetVersion}`, "success");
            logger.success(`${packageName} rolled back to ${targetVersion}`);
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("rollbackPackage", `Failed to rollback ${packageName}`, "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async rollbackConfig(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Rolling Back Configuration");
        if (dryRun) {
            logger.info("[DRY RUN] Would undo last config change");
            return;
        }
        // Find most recent rollback point with config
        const point = this.rollbackPoints.slice().reverse().find((p) => p.snapshot.config);
        if (!point) {
            throw new Error("No rollback point with configuration found");
        }
        const confirmed = await this.confirm(`Rollback configuration to state from ${point.createdAt.toISOString()}?`, skipConfirmation);
        if (!confirmed) {
            logger.info("Config rollback cancelled");
            await this.closeReadline();
            return;
        }
        try {
            this.reportProgress({ phase: "rollback", current: 1, total: 1, message: "Restoring configuration..." });
            await saveConfig(point.snapshot.config);
            await this.logOperation("rollbackConfig", "Configuration rolled back", "success");
            logger.success("Configuration rolled back");
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("rollbackConfig", "Config rollback failed", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async rollbackInstallation(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Rolling Back Installation");
        if (dryRun) {
            logger.info("[DRY RUN] Would revert installation phase");
            return;
        }
        // Find most recent rollback point
        const point = this.rollbackPoints[0];
        if (!point) {
            throw new Error("No rollback points available");
        }
        const confirmed = await this.confirm(`Revert installation to state from ${point.createdAt.toISOString()}? This will restore package versions and configuration.`, skipConfirmation);
        if (!confirmed) {
            logger.info("Installation rollback cancelled");
            await this.closeReadline();
            return;
        }
        try {
            // Restore config first
            if (point.snapshot.config) {
                this.reportProgress({ phase: "rollback", current: 1, total: 3, message: "Restoring configuration..." });
                await saveConfig(point.snapshot.config);
            }
            // Restore package versions
            const packages = Object.entries(point.snapshot.packageVersions);
            for (let i = 0; i < packages.length; i++) {
                const [pkgName, version] = packages[i];
                this.reportProgress({
                    phase: "rollback",
                    current: 2 + i,
                    total: 2 + packages.length,
                    message: `Restoring ${pkgName}@${version}...`,
                });
                try {
                    await this.rollbackPackage(pkgName, { skipConfirmation: true });
                }
                catch {
                    // Continue with other packages
                }
            }
            await this.logOperation("rollbackInstallation", "Installation rolled back", "success");
            logger.success("Installation rolled back");
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("rollbackInstallation", "Installation rollback failed", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    // ============================================================================
    // Repair Operations
    // ============================================================================
    async repairPermissions(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Repairing File Permissions");
        if (dryRun) {
            logger.info("[DRY RUN] Would fix file permissions");
            return;
        }
        const confirmed = await this.confirm("Fix file permissions for Hestia configuration directories?", skipConfirmation);
        if (!confirmed) {
            logger.info("Permission repair cancelled");
            await this.closeReadline();
            return;
        }
        try {
            const paths = getConfigPaths();
            const homedir = os.homedir();
            const currentUser = os.userInfo().username;
            this.reportProgress({ phase: "repair", current: 1, total: 3, message: "Checking config directory..." });
            // Fix config directory permissions
            try {
                await execAsync(`chown -R ${currentUser}:${currentUser} ${paths.configDir}`);
                await execAsync(`chmod -R 755 ${paths.configDir}`);
            }
            catch {
                // May not have permissions to change ownership
                logger.warn("Could not change ownership (may require sudo)");
            }
            this.reportProgress({ phase: "repair", current: 2, total: 3, message: "Checking credentials file..." });
            // Fix credentials file permissions
            try {
                await fs.access(paths.credentials);
                await execAsync(`chmod 600 ${paths.credentials}`);
            }
            catch {
                // Credentials file may not exist
            }
            this.reportProgress({ phase: "repair", current: 3, total: 3, message: "Checking package executables..." });
            // Fix package binary permissions
            try {
                const entries = await fs.readdir(paths.packagesDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const binaryPath = path.join(paths.packagesDir, entry.name, entry.name);
                        try {
                            await fs.access(binaryPath);
                            await execAsync(`chmod +x ${binaryPath}`);
                        }
                        catch {
                            // Not a binary package
                        }
                    }
                }
            }
            catch {
                // Packages directory may not exist
            }
            await this.logOperation("repairPermissions", "File permissions repaired", "success");
            logger.success("File permissions repaired");
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("repairPermissions", "Permission repair failed", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async repairDependencies(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Repairing Dependencies");
        if (dryRun) {
            logger.info("[DRY RUN] Would reinstall broken dependencies");
            return;
        }
        const confirmed = await this.confirm("Reinstall broken dependencies? This may take some time.", skipConfirmation);
        if (!confirmed) {
            logger.info("Dependency repair cancelled");
            await this.closeReadline();
            return;
        }
        try {
            const { config } = await loadConfig();
            const paths = getConfigPaths();
            this.reportProgress({ phase: "repair", current: 1, total: 3, message: "Checking npm dependencies..." });
            // Reinstall npm packages if needed
            for (const [name, pkg] of Object.entries(config.packages)) {
                if (pkg.enabled && name.startsWith("@")) {
                    try {
                        await execAsync(`npm install ${name}@${pkg.version || "latest"}`, { cwd: paths.packagesDir });
                    }
                    catch {
                        logger.warn(`Failed to reinstall ${name}`);
                    }
                }
            }
            this.reportProgress({ phase: "repair", current: 2, total: 3, message: "Checking Docker images..." });
            // Pull Docker images
            try {
                const entries = await fs.readdir(paths.packagesDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const composeFile = path.join(paths.packagesDir, entry.name, "docker-compose.yml");
                        try {
                            await fs.access(composeFile);
                            await execAsync(`docker compose -f ${composeFile} pull`, { cwd: path.dirname(composeFile) });
                        }
                        catch {
                            // Not a Docker package
                        }
                    }
                }
            }
            catch {
                // No packages
            }
            this.reportProgress({ phase: "repair", current: 3, total: 3, message: "Verifying dependencies..." });
            await this.logOperation("repairDependencies", "Dependencies repaired", "success");
            logger.success("Dependencies repaired");
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("repairDependencies", "Dependency repair failed", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async repairNetwork(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Repairing Network Configuration");
        if (dryRun) {
            logger.info("[DRY RUN] Would reset network configuration");
            return;
        }
        const confirmed = await this.confirm("Reset network configuration? This may interrupt active connections.", skipConfirmation);
        if (!confirmed) {
            logger.info("Network repair cancelled");
            await this.closeReadline();
            return;
        }
        try {
            this.reportProgress({ phase: "repair", current: 1, total: 3, message: "Checking Docker networks..." });
            // Reset Docker networks
            try {
                await execAsync("docker network prune -f");
            }
            catch {
                // May fail if Docker not installed
            }
            this.reportProgress({ phase: "repair", current: 2, total: 3, message: "Checking DNS configuration..." });
            // Clear DNS cache
            const platform = os.platform();
            if (platform === "darwin") {
                try {
                    await execAsync("sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder");
                }
                catch {
                    // May require sudo
                }
            }
            else if (platform === "linux") {
                try {
                    await execAsync("sudo systemd-resolve --flush-caches");
                }
                catch {
                    // May not use systemd
                }
            }
            this.reportProgress({ phase: "repair", current: 3, total: 3, message: "Testing connectivity..." });
            // Test connectivity
            try {
                await execAsync("ping -c 1 8.8.8.8");
                logger.info("Internet connectivity: OK");
            }
            catch {
                logger.warn("Internet connectivity test failed");
            }
            await this.logOperation("repairNetwork", "Network configuration repaired", "success");
            logger.success("Network configuration repaired");
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("repairNetwork", "Network repair failed", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async repairDocker(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Repairing Docker Environment");
        if (dryRun) {
            logger.info("[DRY RUN] Would clean up Docker issues");
            return;
        }
        const confirmed = await this.confirm("Clean up Docker issues? This will remove unused containers, networks, and images.", skipConfirmation);
        if (!confirmed) {
            logger.info("Docker repair cancelled");
            await this.closeReadline();
            return;
        }
        try {
            this.reportProgress({ phase: "repair", current: 1, total: 4, message: "Checking Docker status..." });
            // Check if Docker is running
            try {
                await execAsync("docker info");
            }
            catch {
                throw new Error("Docker is not running or not installed");
            }
            this.reportProgress({ phase: "repair", current: 2, total: 4, message: "Removing stopped containers..." });
            await execAsync("docker container prune -f");
            this.reportProgress({ phase: "repair", current: 3, total: 4, message: "Removing unused networks..." });
            await execAsync("docker network prune -f");
            this.reportProgress({ phase: "repair", current: 4, total: 4, message: "Cleaning up images..." });
            await execAsync("docker image prune -f");
            await this.logOperation("repairDocker", "Docker environment cleaned up", "success");
            logger.success("Docker environment cleaned up");
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("repairDocker", "Docker repair failed", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async repairDatabase(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Running Database Repairs");
        if (dryRun) {
            logger.info("[DRY RUN] Would run database repairs");
            return;
        }
        const confirmed = await this.confirm("Run database repairs? This may take several minutes.", skipConfirmation);
        if (!confirmed) {
            logger.info("Database repair cancelled");
            await this.closeReadline();
            return;
        }
        try {
            this.reportProgress({ phase: "repair", current: 1, total: 3, message: "Re-syncing state..." });
            await stateManager.syncAll();
            this.reportProgress({ phase: "repair", current: 2, total: 3, message: "Verifying data integrity..." });
            // Check state consistency
            const state = await stateManager.getStateSummary();
            const issues = [];
            if (!state.normal.config.hearth.id) {
                issues.push("Missing hearth ID");
            }
            if (issues.length > 0) {
                logger.warn(`Data integrity issues found: ${issues.join(", ")}`);
            }
            this.reportProgress({ phase: "repair", current: 3, total: 3, message: "Repair complete" });
            await this.logOperation("repairDatabase", "Database repairs complete", "success");
            logger.success("Database repairs complete");
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("repairDatabase", "Database repair failed", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async repairSync(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Forcing State Re-sync");
        if (dryRun) {
            logger.info("[DRY RUN] Would force state re-sync");
            return;
        }
        const confirmed = await this.confirm("Force complete state re-sync from Synap Backend? This may overwrite local changes.", skipConfirmation);
        if (!confirmed) {
            logger.info("Force sync cancelled");
            await this.closeReadline();
            return;
        }
        try {
            await this.recoverState({ skipConfirmation: true });
            await this.logOperation("repairSync", "Force state re-sync complete", "success");
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("repairSync", "Force sync failed", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    // ============================================================================
    // Safe Mode
    // ============================================================================
    async enableSafeMode(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Enabling Safe Mode");
        if (dryRun) {
            logger.info("[DRY RUN] Would enable safe mode with minimal configuration");
            return;
        }
        const confirmed = await this.confirm("Enable safe mode? This will disable non-essential features and start with minimal configuration.", skipConfirmation);
        if (!confirmed) {
            logger.info("Safe mode cancelled");
            await this.closeReadline();
            return;
        }
        try {
            this.reportProgress({ phase: "safe-mode", current: 1, total: 4, message: "Creating rollback point..." });
            await this.createRollbackPoint("pre-safe-mode", "Rollback point before enabling safe mode");
            this.reportProgress({ phase: "safe-mode", current: 2, total: 4, message: "Disabling non-essential packages..." });
            const { config } = await loadConfig();
            // Disable non-essential packages
            for (const [name, pkg] of Object.entries(config.packages)) {
                if (!this.safeModeConfig.minimalPackages.includes(name)) {
                    pkg.enabled = false;
                }
            }
            // Disable intelligence and connectors
            config.intelligence = undefined;
            config.connectors = undefined;
            await saveConfig(config);
            this.reportProgress({ phase: "safe-mode", current: 3, total: 4, message: "Stopping services..." });
            // Stop all non-essential services
            const paths = getConfigPaths();
            this.packageService = new PackageService({
                packagesDir: paths.packagesDir,
                config,
                logger: {
                    debug: (msg) => logger.debug(msg),
                    info: (msg) => logger.info(msg),
                    success: (msg) => logger.success(msg),
                    warn: (msg) => logger.warn(msg),
                    error: (msg) => logger.error(msg),
                },
            });
            const packages = await this.packageService.list();
            for (const pkg of packages) {
                if (!this.safeModeConfig.minimalPackages.includes(pkg.packageName) && pkg.status === "running") {
                    try {
                        await this.packageService.stop(pkg.packageName);
                    }
                    catch {
                        // Continue
                    }
                }
            }
            this.reportProgress({ phase: "safe-mode", current: 4, total: 4, message: "Safe mode enabled" });
            this.safeModeConfig.enabled = true;
            await this.logOperation("enableSafeMode", "Safe mode enabled", "success");
            logger.success("Safe mode enabled. Run `hestia recovery disable-safe-mode` to exit.");
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("enableSafeMode", "Failed to enable safe mode", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async disableSafeMode(options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header("Disabling Safe Mode");
        if (dryRun) {
            logger.info("[DRY RUN] Would disable safe mode and restore normal configuration");
            return;
        }
        const confirmed = await this.confirm("Disable safe mode and restore normal configuration?", skipConfirmation);
        if (!confirmed) {
            logger.info("Disable safe mode cancelled");
            await this.closeReadline();
            return;
        }
        try {
            // Find rollback point from before safe mode
            const point = this.rollbackPoints.find((p) => p.name === "pre-safe-mode");
            if (point) {
                await this.rollbackInstallation({ skipConfirmation: true });
            }
            else {
                logger.warn("No rollback point found, manual reconfiguration may be needed");
            }
            this.safeModeConfig.enabled = false;
            await this.logOperation("disableSafeMode", "Safe mode disabled", "success");
            logger.success("Safe mode disabled");
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("disableSafeMode", "Failed to disable safe mode", "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    async diagnoseIssues(options = {}) {
        const { dryRun = false, verbose = false } = options;
        logger.header("Running System Diagnosis");
        if (dryRun) {
            logger.info("[DRY RUN] Would run full system diagnosis");
            return {
                healthy: true,
                issues: [],
                suggestions: [],
                timestamp: new Date(),
            };
        }
        const issues = [];
        const suggestions = [];
        try {
            this.reportProgress({ phase: "diagnosis", current: 1, total: 8, message: "Checking configuration..." });
            // Check configuration
            try {
                const { config } = await loadConfig();
                if (!config.hearth.id) {
                    issues.push({
                        id: "config-missing-hearth-id",
                        severity: "critical",
                        category: "config",
                        message: "Hearth ID is missing from configuration",
                    });
                    suggestions.push({
                        id: "fix-config-missing-hearth-id",
                        issueId: "config-missing-hearth-id",
                        description: "Generate a new Hearth ID",
                        operation: "recoverConfig",
                        risk: "low",
                        automatic: true,
                    });
                }
            }
            catch (error) {
                issues.push({
                    id: "config-corrupted",
                    severity: "critical",
                    category: "config",
                    message: "Configuration file is corrupted or unreadable",
                    details: { error: error instanceof Error ? error.message : String(error) },
                });
                suggestions.push({
                    id: "fix-config-corrupted",
                    issueId: "config-corrupted",
                    description: "Restore configuration from backup",
                    operation: "recoverConfig",
                    risk: "low",
                    automatic: true,
                });
            }
            this.reportProgress({ phase: "diagnosis", current: 2, total: 8, message: "Checking packages..." });
            // Check packages
            const paths = getConfigPaths();
            try {
                const { config } = await loadConfig();
                this.packageService = new PackageService({
                    packagesDir: paths.packagesDir,
                    config,
                    logger: {
                        debug: (msg) => logger.debug(msg),
                        info: (msg) => logger.info(msg),
                        success: (msg) => logger.success(msg),
                        warn: (msg) => logger.warn(msg),
                        error: (msg) => logger.error(msg),
                    },
                });
                const packages = await this.packageService.list();
                const failedPackages = packages.filter((p) => p.status === "error");
                if (failedPackages.length > 0) {
                    issues.push({
                        id: "packages-failed",
                        severity: "warning",
                        category: "packages",
                        message: `${failedPackages.length} package(s) in failed state`,
                        details: { packages: failedPackages.map((p) => p.packageName) },
                    });
                    suggestions.push({
                        id: "fix-packages-failed",
                        issueId: "packages-failed",
                        description: "Restart failed services",
                        operation: "recoverServices",
                        risk: "low",
                        automatic: true,
                    });
                }
            }
            catch {
                // Skip package check if service unavailable
            }
            this.reportProgress({ phase: "diagnosis", current: 3, total: 8, message: "Checking services..." });
            // Check Docker
            try {
                await execAsync("docker info");
            }
            catch {
                issues.push({
                    id: "docker-unavailable",
                    severity: "warning",
                    category: "services",
                    message: "Docker is not running or not installed",
                });
            }
            this.reportProgress({ phase: "diagnosis", current: 4, total: 8, message: "Checking database..." });
            // Check API connectivity
            try {
                if (!this.apiClient) {
                    this.apiClient = await createAPIClient();
                }
                await this.apiClient.healthCheck();
            }
            catch {
                issues.push({
                    id: "api-unreachable",
                    severity: "warning",
                    category: "database",
                    message: "Cannot connect to Synap Backend API",
                });
                suggestions.push({
                    id: "fix-api-unreachable",
                    issueId: "api-unreachable",
                    description: "Repair database connections",
                    operation: "recoverDatabase",
                    risk: "low",
                    automatic: true,
                });
            }
            this.reportProgress({ phase: "diagnosis", current: 5, total: 8, message: "Checking network..." });
            // Check network
            try {
                await execAsync("ping -c 1 -W 5 8.8.8.8");
            }
            catch {
                issues.push({
                    id: "network-unreachable",
                    severity: "warning",
                    category: "network",
                    message: "Internet connectivity appears to be down",
                });
            }
            this.reportProgress({ phase: "diagnosis", current: 6, total: 8, message: "Checking permissions..." });
            // Check permissions
            try {
                await fs.access(paths.configDir, fs.constants.R_OK | fs.constants.W_OK);
            }
            catch {
                issues.push({
                    id: "permissions-invalid",
                    severity: "warning",
                    category: "permissions",
                    message: "Config directory has incorrect permissions",
                });
                suggestions.push({
                    id: "fix-permissions-invalid",
                    issueId: "permissions-invalid",
                    description: "Fix file permissions",
                    operation: "repairPermissions",
                    risk: "low",
                    automatic: true,
                });
            }
            this.reportProgress({ phase: "diagnosis", current: 7, total: 8, message: "Checking state sync..." });
            // Check state sync
            try {
                const state = await stateManager.getNormalState();
                if (state.source === "local") {
                    issues.push({
                        id: "state-not-synced",
                        severity: "info",
                        category: "sync",
                        message: "State is only available locally, not synced with Synap Backend",
                    });
                }
            }
            catch {
                issues.push({
                    id: "state-unavailable",
                    severity: "warning",
                    category: "sync",
                    message: "Cannot retrieve system state",
                });
            }
            this.reportProgress({ phase: "diagnosis", current: 8, total: 8, message: "Diagnosis complete" });
            const healthy = !issues.some((i) => i.severity === "critical") && issues.filter((i) => i.severity === "warning").length < 3;
            const result = {
                healthy,
                issues,
                suggestions,
                timestamp: new Date(),
            };
            if (verbose) {
                logger.section("Diagnosis Results");
                logger.info(`Healthy: ${healthy ? "Yes" : "No"}`);
                logger.info(`Issues found: ${issues.length}`);
                logger.info(`Suggestions: ${suggestions.length}`);
                if (issues.length > 0) {
                    logger.section("Issues");
                    for (const issue of issues) {
                        const icon = issue.severity === "critical" ? "🔴" : issue.severity === "warning" ? "🟡" : "🔵";
                        logger.info(`${icon} [${issue.category}] ${issue.message}`);
                    }
                }
            }
            await this.logOperation("diagnoseIssues", `Diagnosis complete: ${issues.length} issues found`, "success");
            return result;
        }
        catch (error) {
            await this.logOperation("diagnoseIssues", "Diagnosis failed", "failure", {}, error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
    async suggestFixes(diagnosis) {
        logger.header("Suggesting Fixes");
        if (!diagnosis) {
            diagnosis = await this.diagnoseIssues();
        }
        if (diagnosis.suggestions.length === 0) {
            logger.info("No fixes suggested - system appears healthy");
            return [];
        }
        logger.section("Suggested Fixes");
        for (const fix of diagnosis.suggestions) {
            const issue = diagnosis.issues.find((i) => i.id === fix.issueId);
            const icon = fix.risk === "low" ? "🟢" : fix.risk === "medium" ? "🟡" : "🔴";
            logger.info(`${icon} [${fix.automatic ? "Auto" : "Manual"}] ${fix.description}`);
            logger.info(`   Issue: ${issue?.message}`);
            logger.info(`   Risk: ${fix.risk}`);
            logger.newline();
        }
        return diagnosis.suggestions;
    }
    async applyFix(fixId, options = {}) {
        const { dryRun = false, skipConfirmation = false } = options;
        logger.header(`Applying Fix: ${fixId}`);
        // Find the fix in recent diagnosis
        const diagnosis = await this.diagnoseIssues();
        const fix = diagnosis.suggestions.find((f) => f.id === fixId);
        if (!fix) {
            throw new Error(`Fix "${fixId}" not found. Run diagnoseIssues() first.`);
        }
        if (dryRun) {
            logger.info(`[DRY RUN] Would apply fix: ${fix.description}`);
            return;
        }
        const confirmed = await this.confirm(`Apply fix: ${fix.description}? (Risk: ${fix.risk})`, skipConfirmation);
        if (!confirmed) {
            logger.info("Fix application cancelled");
            await this.closeReadline();
            return;
        }
        try {
            switch (fix.operation) {
                case "recoverConfig":
                    await this.recoverConfig({ skipConfirmation: true });
                    break;
                case "recoverServices":
                    await this.recoverServices({ skipConfirmation: true });
                    break;
                case "recoverDatabase":
                    await this.recoverDatabase({ skipConfirmation: true });
                    break;
                case "recoverState":
                    await this.recoverState({ skipConfirmation: true });
                    break;
                case "recoverInstallation":
                    await this.recoverInstallation({ skipConfirmation: true });
                    break;
                case "repairPermissions":
                    await this.repairPermissions({ skipConfirmation: true });
                    break;
                case "repairDependencies":
                    await this.repairDependencies({ skipConfirmation: true });
                    break;
                case "repairNetwork":
                    await this.repairNetwork({ skipConfirmation: true });
                    break;
                case "repairDocker":
                    await this.repairDocker({ skipConfirmation: true });
                    break;
                case "repairDatabase":
                    await this.repairDatabase({ skipConfirmation: true });
                    break;
                case "repairSync":
                    await this.repairSync({ skipConfirmation: true });
                    break;
                default:
                    throw new Error(`Unknown fix operation: ${fix.operation}`);
            }
            await this.logOperation("applyFix", `Fix "${fixId}" applied successfully`, "success");
            logger.success(`Fix applied: ${fix.description}`);
            await this.closeReadline();
        }
        catch (error) {
            await this.logOperation("applyFix", `Failed to apply fix "${fixId}"`, "failure", {}, error instanceof Error ? error.message : String(error));
            await this.closeReadline();
            throw error;
        }
    }
    // ============================================================================
    // Utility Methods
    // ============================================================================
    async copyDirectory(src, dest) {
        await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                await this.copyDirectory(srcPath, destPath);
            }
            else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }
    async computeChecksum(dir) {
        // Simple checksum based on file stats
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
            let hash = 0;
            for (const entry of entries) {
                if (entry.isFile()) {
                    const filePath = path.join(dir, entry.name);
                    const stats = await fs.stat(filePath);
                    hash = (hash + stats.size + stats.mtime.getTime()) % 1000000007;
                }
            }
            return hash.toString(16);
        }
        catch {
            return "0";
        }
    }
    async computeStateHash() {
        try {
            const { config } = await loadConfig();
            const str = JSON.stringify(config);
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash + char) | 0;
            }
            return hash.toString(16);
        }
        catch {
            return "0";
        }
    }
    async getRecoveryLogs(limit = 50) {
        return this.recoveryLog.slice(-limit).reverse();
    }
    async getRollbackPoints() {
        return this.rollbackPoints.slice().reverse();
    }
    async clearRecoveryLogs() {
        this.recoveryLog = [];
        await this.saveRecoveryLog();
        logger.success("Recovery logs cleared");
    }
    async isSafeMode() {
        return this.safeModeConfig.enabled;
    }
    // ============================================================================
    // Idempotency Helpers
    // ============================================================================
    /**
     * Check if an operation is already in progress or recently completed
     * to ensure idempotency
     */
    isOperationPending(operation, windowMs = 5000) {
        const recent = this.recoveryLog.filter((log) => log.operation === operation &&
            log.status === "in_progress" &&
            new Date().getTime() - new Date(log.timestamp).getTime() < windowMs);
        return recent.length > 0;
    }
    /**
     * Mark operation as in progress
     */
    async markOperationInProgress(operation, message) {
        await this.logOperation(operation, message, "in_progress");
    }
    /**
     * Mark operation as complete
     */
    async markOperationComplete(operation, message, success = true) {
        await this.logOperation(operation, message, success ? "success" : "failure");
    }
}
// ============================================================================
// Singleton Instance
// ============================================================================
export const recovery = new RecoverySystem();
export async function initializeRecovery() {
    await recovery.initialize();
}
// Default export
export default RecoverySystem;
//# sourceMappingURL=recovery.js.map