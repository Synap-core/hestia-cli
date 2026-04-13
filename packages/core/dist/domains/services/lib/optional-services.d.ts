/**
 * Optional Services Registry
 *
 * Service registry for optional components including:
 * - Network: Traefik (reverse proxy), Pangolin (tunnel)
 * - Database: WhoDB (database UI)
 * - AI/UI: LobeChat, OpenWebUI, LibreChat
 */
export type ServiceCategory = 'network' | 'database' | 'ui' | 'ai';
export type ServiceStatus = 'not-installed' | 'installed' | 'enabled' | 'running' | 'stopped' | 'error';
export interface ServicePort {
    internal: number;
    external: number;
    protocol?: 'tcp' | 'udp';
    description?: string;
}
export interface ServiceDependency {
    name: string;
    type: 'service' | 'port' | 'package';
    optional?: boolean;
}
export interface OptionalService {
    name: string;
    displayName: string;
    description: string;
    category: ServiceCategory;
    icon?: string;
    defaultPort: number;
    ports: ServicePort[];
    dependencies: ServiceDependency[];
    dockerComposeProfile?: string;
    environmentVariables?: Record<string, string>;
    install: () => Promise<void>;
    configure: (config: Record<string, unknown>) => Promise<void>;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    status: () => Promise<ServiceStatusInfo>;
    isInstalled: () => Promise<boolean>;
    isEnabled: () => boolean;
    getLogs?: (lines?: number) => Promise<string>;
}
export interface ServiceStatusInfo {
    status: ServiceStatus;
    message?: string;
    uptime?: number;
    lastError?: string;
    version?: string;
    url?: string;
    ports?: ServicePort[];
}
export interface ServiceConfig {
    enabled: boolean;
    autoStart: boolean;
    ports?: Record<string, number>;
    environment?: Record<string, string>;
    volumeMounts?: Record<string, string>;
    customConfig?: Record<string, unknown>;
}
declare const defaultServiceConfigs: Record<string, ServiceConfig>;
declare const serviceMetadata: Record<string, Omit<OptionalService, 'install' | 'configure' | 'start' | 'stop' | 'status' | 'isInstalled' | 'isEnabled'>>;
declare class ServiceRegistry {
    private services;
    constructor();
    get(name: string): OptionalService | undefined;
    getAll(): OptionalService[];
    getByCategory(category: ServiceCategory): OptionalService[];
    getCategories(): ServiceCategory[];
    exists(name: string): boolean;
}
export declare const serviceRegistry: ServiceRegistry;
export declare function getOptionalService(name: string): OptionalService | undefined;
export declare function getAllOptionalServices(): OptionalService[];
export declare function getServicesByCategory(category: ServiceCategory): OptionalService[];
export declare function getServiceCategories(): ServiceCategory[];
export declare function isValidService(name: string): boolean;
export { defaultServiceConfigs, serviceMetadata };
//# sourceMappingURL=optional-services.d.ts.map