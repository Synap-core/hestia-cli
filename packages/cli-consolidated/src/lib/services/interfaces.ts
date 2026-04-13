/**
 * Service Interfaces
 *
 * Defines clear TypeScript contracts for all services to improve:
 * - Contract clarity between components
 * - Testability (mock implementations)
 * - IDE autocomplete
 * - Compile-time verification
 */

import type { HestiaConfig } from '../types/index.js';

// ============================================================================
// Service Status Type
// ============================================================================

export interface ServiceStatus {
  isRunning: boolean;
  pid?: number;
  uptime?: number;
  errors: string[];
}

// ============================================================================
// Config Service Interface
// ============================================================================

export interface IConfigService {
  /** Load configuration from file */
  load(): Promise<HestiaConfig>;
  /** Save configuration to file */
  save(config: HestiaConfig): Promise<void>;
  /** Update specific configuration fields */
  update(updates: Partial<HestiaConfig>): Promise<HestiaConfig>;
  /** Validate unknown data as HestiaConfig */
  validate(config: unknown): config is HestiaConfig;
}

// ============================================================================
// Credentials Service Interface
// ============================================================================

export interface ICredentialsService {
  /** Load all credentials from secure storage */
  load(): Promise<Record<string, string>>;
  /** Save all credentials to secure storage */
  save(credentials: Record<string, string>): Promise<void>;
  /** Get a specific credential by key */
  get(key: string): Promise<string | undefined>;
  /** Set a specific credential */
  set(key: string, value: string): Promise<void>;
}

// ============================================================================
// Sync Service Interface
// ============================================================================

export interface ISyncService {
  /** Sync configuration with remote */
  sync(config: HestiaConfig): Promise<void>;
  /** Check if sync is enabled */
  isEnabled(): boolean;
}

// ============================================================================
// AI Service Interface
// ============================================================================

export interface IAIService {
  /** Start the AI service */
  start(): Promise<void>;
  /** Stop the AI service */
  stop(): Promise<void>;
  /** Get current service status */
  getStatus(): ServiceStatus;
  /** Sync AI configuration with Hestia */
  syncWithHestia(config: HestiaConfig): Promise<void>;
}

// ============================================================================
// USB Service Interfaces
// ============================================================================

export interface USBDevice {
  device: string;
  path: string;
  size: number;
  model: string;
  vendor: string;
  serial?: string;
  removable: boolean;
  readonly: boolean;
  mounted: boolean;
  mountpoints: string[];
  isUSB: boolean;
}

export interface IUSBService {
  /** List all available USB devices */
  listDevices(): Promise<USBDevice[]>;
  /** Create a bootable USB device from an ISO */
  createBootable(device: USBDevice, iso: string): Promise<void>;
  /** Validate if a device is suitable for operations */
  validateDevice(device: USBDevice): boolean;
}

// ============================================================================
// Docker Service Interfaces
// ============================================================================

export interface ComposeConfig {
  version?: string;
  services: Record<string, ComposeServiceConfig>;
  networks?: Record<string, ComposeNetworkConfig>;
  volumes?: Record<string, ComposeVolumeConfig>;
}

export interface ComposeServiceConfig {
  image: string;
  ports?: string[];
  environment?: Record<string, string>;
  volumes?: string[];
  networks?: string[];
  depends_on?: string[];
  restart?: string;
  command?: string;
  healthcheck?: {
    test: string[];
    interval?: string;
    timeout?: string;
    retries?: number;
  };
}

export interface ComposeNetworkConfig {
  driver?: string;
  external?: boolean;
}

export interface ComposeVolumeConfig {
  driver?: string;
  external?: boolean;
}

export interface IDockerService {
  /** Start a Docker service */
  startService(name: string): Promise<void>;
  /** Stop a Docker service */
  stopService(name: string): Promise<void>;
  /** Get status of a Docker service */
  getStatus(name: string): Promise<ServiceStatus>;
  /** Generate docker-compose.yml content */
  generateCompose(config: ComposeConfig): Promise<string>;
}

// ============================================================================
// Service Registry Type
// ============================================================================

export interface ServiceRegistry {
  config: IConfigService;
  credentials: ICredentialsService;
  ai: IAIService;
  usb: IUSBService;
  docker: IDockerService;
}

// ============================================================================
// Service Factory Types
// ============================================================================

export type ServiceFactory<T> = () => T | Promise<T>;

export interface ServiceProvider {
  getConfigService(): IConfigService;
  getCredentialsService(): ICredentialsService;
  getAIService(): IAIService;
  getUSBService(): IUSBService;
  getDockerService(): IDockerService;
}
