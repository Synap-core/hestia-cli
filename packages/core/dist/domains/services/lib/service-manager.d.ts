/**
 * Service Manager
 *
 * Central service management for Hestia.
 * Handles service lifecycle, state tracking, dependency management,
 * port allocation, and Docker Compose profile management.
 */
import { type OptionalService, type ServiceStatus, type ServiceCategory, type ServiceStatusInfo, type ServiceConfig } from '../../../domains/services/lib/optional-services.js';
interface ServiceState {
    name: string;
    installed: boolean;
    enabled: boolean;
    status: ServiceStatus;
    lastStartTime?: Date;
    lastError?: string;
    pid?: number;
    ports?: number[];
}
interface ServiceManagerConfig {
    autoStartEnabled: boolean;
    portRange: {
        min: number;
        max: number;
    };
    reservedPorts: number[];
    stateFilePath: string;
}
interface PortAllocation {
    port: number;
    service: string;
    assignedAt: Date;
}
declare class ServiceManager {
    private config;
    private states;
    private portAllocations;
    private initialized;
    constructor();
    initialize(): Promise<void>;
    private loadStates;
    private saveStates;
    private initializePortAllocations;
    private loadServiceConfig;
    private saveServiceConfig;
    findAvailablePort(serviceName: string, preferredPort?: number): Promise<number>;
    private isPortAvailable;
    allocatePort(serviceName: string, port: number): Promise<void>;
    releasePort(port: number): Promise<void>;
    install(serviceName: string): Promise<void>;
    remove(serviceName: string): Promise<void>;
    private checkDependencies;
    enable(serviceName: string): Promise<void>;
    disable(serviceName: string): Promise<void>;
    start(serviceName: string): Promise<void>;
    stop(serviceName: string): Promise<void>;
    getStatus(serviceName: string): Promise<ServiceStatusInfo>;
    getAllStatuses(): Promise<Array<{
        service: OptionalService;
        status: ServiceStatusInfo;
    }>>;
    configure(serviceName: string, config: Record<string, unknown>): Promise<void>;
    getLogs(serviceName: string, lines?: number): Promise<string>;
    getEnabledProfiles(): Promise<string[]>;
    startAllEnabled(): Promise<void>;
    stopAll(): Promise<void>;
    getServicesSummary(): Promise<{
        installed: number;
        enabled: number;
        running: number;
        byCategory: Record<ServiceCategory, number>;
    }>;
    validateConfig(serviceName: string): Promise<{
        valid: boolean;
        errors: string[];
    }>;
}
export declare const serviceManager: ServiceManager;
export type { ServiceState, ServiceManagerConfig, PortAllocation, ServiceCategory, ServiceStatus, ServiceStatusInfo, ServiceConfig, };
export declare function isServiceInstalled(serviceName: string): Promise<boolean>;
export declare function isServiceRunning(serviceName: string): Promise<boolean>;
export declare function getServiceInfo(serviceName: string): OptionalService | undefined;
//# sourceMappingURL=service-manager.d.ts.map