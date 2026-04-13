/**
 * Hestia CLI - Package Service
 *
 * Manages package lifecycle: install, start, stop, update, remove.
 */
import type { Package, PackageInstance, HestiaConfig, Logger, ProgressReporter } from '../../lib/types/index';
interface PackageServiceConfig {
    packagesDir: string;
    config: HestiaConfig;
    logger: Logger;
}
export declare class PackageService {
    private config;
    constructor(config: PackageServiceConfig);
    install(pkg: Package, progress?: ProgressReporter): Promise<PackageInstance>;
    private downloadPackage;
    private downloadFile;
    private validatePackage;
    private checkDependencies;
    private configurePackage;
    private generateEnvVars;
    private flattenConfig;
    private installByType;
    start(packageName: string): Promise<void>;
    stop(packageName: string): Promise<void>;
    restart(packageName: string): Promise<void>;
    update(packageName: string, version: string): Promise<PackageInstance>;
    remove(packageName: string): Promise<void>;
    status(packageName: string): Promise<PackageInstance>;
    list(): Promise<PackageInstance[]>;
    private runDockerCompose;
    private startBinaryService;
    private stopBinaryService;
    private checkHealth;
    private getPackageDir;
    private loadPackageManifest;
    private getInstance;
    private updateInstanceStatus;
    private loadRegistry;
}
export {};
//# sourceMappingURL=package-service.d.ts.map