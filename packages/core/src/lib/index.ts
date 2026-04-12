// @ts-nocheck
/**
 * Library index - Export all utilities
 */

export * from './logger.js';
export * from './spinner.js';
export * from './task-list.js';
export {
  loadConfig,
  getConfig,
  getConfigValue,
  loadCredentials,
  getCredentials,
  updateConfig,
  saveConfig,
  saveCredentials,
  getCredential,
  setCredential,
  defaultConfig,
  createInitialConfig,
  validateConfig,
  getConfigPaths,
  mergeConfigs,
  getConfigSummary,
  configExists,
  getPackageConfig,
  setPackageConfig,
  getIntelligenceConfig,
  setIntelligenceConfig,
  expandEnvVars,
  type HestiaConfig,
  type ConfigPath,
} from './config.js';
export { APIClient, createAPIClient } from './api-client.js';
export { PackageService } from './package-service.js';
export * from './a2a-bridge.js';
export {
  OpenClaudeService,
  openclaudeService,
  type OpenClaudeServiceOptions,
  type OpenClaudeStatus,
  type MCPInstallConfig,
  type MCPInstalledServer,
  type OpenClaudeProfile,
  type ProviderConfig,
  type ExecuteResult,
} from './openclaude-service.js';
export {
  UnifiedStateManager,
  stateManager,
  initializeStateManager,
  shutdownStateManager,
  StateManagerError,
  type NormalState,
  type LocalState,
  type RuntimeState,
  type SyncResult,
  type StateManagerOptions,
  type ConflictStrategy,
} from './state-manager.js';
export {
  OpenClawService,
  openclawService,
  type OpenClawConfig as OpenClawServiceConfig,
  type OpenClawStatus as OpenClawServiceStatus,
  type OpenClawInstallMethod,
  type OpenClawStatusInfo,
  type OpenClawActivity,
  type CommsPlatform,
  type CommsPlatformConfig,
  type SkillMetadata,
  type SkillCode,
  type SkillLanguage,
  type StartOptions as OpenClawStartOptions,
} from './openclaw-service.js';
export {
  HealthCheckSystem,
  healthCheck,
  type HealthStatus,
  type HealthCheckResult,
  type HealthReport,
  type HealthCheckConfig,
  type CheckCategory,
  type SystemMetrics,
} from './health-check.js';
export {
  ProductionValidator,
  productionValidator,
  quickValidate,
  validate,
  saveReport,
  checkProductionReady,
  type ValidationResult,
  type ValidationCategory,
  type ValidationReport,
  type SystemInfo,
  type FixOptions,
} from './validator.js';
export {
  RecoverySystem,
  recovery,
  initializeRecovery,
  type BackupMetadata,
  type BackupComponents,
  type RollbackPoint,
  type RollbackSnapshot,
  type RecoveryLog,
  type DiagnosisResult,
  type Issue,
  type SuggestedFix,
  type RecoveryOptions,
  type SafeModeConfig,
  type RecoveryProgress,
} from './recovery.js';

// OS Manager
export {
  OSManager,
  osManager,
  type OSInfo,
  type PackageInfo,
  type ServiceInfo,
  type UserInfo,
  type NetworkConfig,
  type LinuxDistribution,
  type OSPlatform,
  type KernelInfo,
  type KernelModule,
  type BootInfo,
  type UserOptions,
  type NetworkInterface,
  type IPAddress,
  type DNSServer,
  type HostEntry,
  type Route,
  type FirewallStatus,
  type FirewallRule,
  type DiskInfo,
  type PartitionInfo,
  type DiskUsage,
  type SysctlParameter,
  type MountPoint,
  type OSRecommendation,
  type OSReport,
  // Note: BackupMetadata is also exported from recovery.js - using the one from recovery
} from './os-manager.js';

// Test Suite
export {
  HestiaTestSuite,
  testSuite,
  main,
  type TestResult,
  type TestCategory,
  type TestFunction,
  type TestSuiteConfig,
  type TestSuiteReport,
  type MockApiConfig,
  type MockResponse,
  type TestEnvironment,
  type MockServer,
} from './test-suite.js';

// Pangolin Tunnel Service
export {
  PangolinService,
  pangolinService,
  type TunnelMode,
  type TunnelProvider,
  type TunnelStatus,
  type TunnelConfig,
  type TunnelInfo,
  type ServerConfig,
  type ClientConfig,
  type PangolinStatus,
} from './pangolin-service.js';

// USB Generator
export {
  USBGenerator,
  USBError,
  usbGenerator,
  type USBDevice,
  type USBPartition,
  type ISOInfo,
  type USBOptions,
  type USBProgress,
  type USBOperationResult,
  type DiskConfig,
  type VentoyConfig,
  type AutoinstallConfig,
  type CloudInitUserData,
  type CloudInitMetaData,
  type StorageConfig,
  type StorageLayout,
  type IdentityConfig,
  type AutoinstallNetwork,
  type EthernetConfig,
  type WifiConfig,
  type AccessPoint,
  type ProgressCallback,
  type USBNetworkConfig,
} from './usb-generator.js';

// Optional Services
export {
  serviceRegistry,
  getOptionalService,
  getAllOptionalServices,
  getServicesByCategory,
  getServiceCategories,
  isValidService,
  defaultServiceConfigs,
  serviceMetadata,
  type OptionalService,
  type ServiceCategory,
  type ServiceStatus,
  type ServiceStatusInfo,
  type ServiceConfig,
  type ServicePort,
  type ServiceDependency,
} from './optional-services.js';

// Service Manager
export {
  serviceManager,
  isServiceInstalled,
  isServiceRunning,
  getServiceInfo,
  type ServiceState,
  type ServiceManagerConfig,
  type PortAllocation,
} from './service-manager.js';

// WhoDB Database Viewer Service
export {
  WhoDBService,
  whoDBService,
  type WhoDBConfig,
} from './whodb-service.js';

// Server Provisioner
export {
  ServerProvisioner,
  serverProvisioner,
  type HardwareInfo,
  type CPUInfo,
  type MemoryInfo,
  type StorageDevice,
  type NetworkInterface,
  type GPUInfo,
  type RAIDInfo,
  type IPMIInfo,
  type ProvisionProfile,
  type DiskLayout,
  type NetworkConfig as ProvisionerNetworkConfig,
  type OptimizationConfig,
  type MetricsConfig,
  type LoggingConfig,
  type AlertingConfig,
  type MonitoringConfig,
  type ServerConfiguration,
  type ProvisionOptions,
  type InstallationPlan,
  type InstallationStep,
  type ProvisionReport,
  type BenchmarkResults,
  type CPUBenchmark,
  type MemoryBenchmark,
  type StorageBenchmark,
  type NetworkBenchmark,
  type ProvisionProgress,
  type ProvisionPhase,
  type IPMIResult,
  // Storage types
  type StorageType,
  type StorageInterface,
  // Network types
  type NetworkType,
  // Benchmark types
  type ProgressCallback,
} from './server-provisioner.js';
