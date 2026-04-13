/**
 * Server Provisioner - Hardware detection and bare metal provisioning
 *
 * Provides comprehensive server provisioning capabilities including:
 * - Hardware detection (CPU, memory, storage, network, GPU)
 * - Profile-based provisioning
 * - Benchmarking and optimization
 * - Multi-server cluster configuration
 * - IPMI remote management
 */
export type ProvisionPhase = 'detecting' | 'partitioning' | 'formatting' | 'mounting' | 'installing' | 'configuring' | 'optimizing' | 'finalizing';
export interface ProvisionProgress {
    phase: ProvisionPhase;
    currentStep: number;
    totalSteps: number;
    stepName: string;
    percentComplete: number;
    message: string;
}
export type ProgressCallback = (progress: ProvisionProgress) => void;
export interface CPUInfo {
    model: string;
    vendor: string;
    cores: number;
    threads: number;
    architecture: string;
    baseFrequency: number;
    maxFrequency: number;
    virtualization: boolean;
}
export interface MemoryInfo {
    total: number;
    available: number;
    type: string;
    speed: number;
    channels: number;
    ecc: boolean;
    slots: Array<{
        size: number;
        type: string;
        speed: number;
    }>;
}
export type StorageType = 'nvme' | 'ssd' | 'hdd' | 'usb' | 'loop' | 'other';
export type StorageInterface = 'nvme' | 'sata' | 'sas' | 'ide' | 'usb' | 'other';
export interface StorageDevice {
    name: string;
    model: string;
    type: StorageType;
    size: number;
    interface: StorageInterface;
    health?: string;
    smartStatus?: string;
    rota?: boolean;
}
export type NetworkType = 'ethernet' | 'wifi' | 'virtual' | 'bridge' | 'bond' | 'loopback' | 'other';
export interface NetworkInterface {
    name: string;
    macAddress: string;
    type: NetworkType;
    state: string;
    speed?: number;
    ipAddresses: Array<{
        address: string;
        family: string;
        prefixLen: number;
    }>;
}
export interface GPUInfo {
    model: string;
    vendor: string;
    vram: number;
    pciAddress: string;
}
export interface RAIDInfo {
    controller?: {
        vendor: string;
        model: string;
    };
    arrays: Array<{
        name: string;
        level: string;
        size: number;
        status: string;
    }>;
}
export interface IPMIInfo {
    available: boolean;
    vendor?: string;
    firmwareVersion?: string;
    ipAddress?: string;
    macAddress?: string;
}
export interface HardwareInfo {
    cpu: CPUInfo;
    memory: MemoryInfo;
    storage: StorageDevice[];
    network: NetworkInterface[];
    gpu: GPUInfo[];
    raid?: RAIDInfo;
    ipmi?: IPMIInfo;
}
export interface CPUBenchmark {
    singleCore: number;
    multiCore: number;
    score: number;
}
export interface MemoryBenchmark {
    readSpeed: number;
    writeSpeed: number;
    latency: number;
    score: number;
}
export interface StorageBenchmark {
    device: string;
    readIOPS: number;
    writeIOPS: number;
    readThroughput: number;
    writeThroughput: number;
    latency: number;
    score: number;
}
export interface NetworkBenchmark {
    interface: string;
    throughput: number;
    latency: number;
    jitter: number;
    packetLoss: number;
    score: number;
}
export interface BenchmarkResults {
    overall: number;
    cpu?: CPUBenchmark;
    memory?: MemoryBenchmark;
    storage?: StorageBenchmark[];
    network?: NetworkBenchmark[];
}
export interface IPMIResult {
    success: boolean;
    output?: string;
    error?: string;
    exitCode?: number;
}
export interface DiskLayout {
    scheme: 'standard' | 'lvm' | 'zfs' | 'raid';
    partitions: Array<{
        name: string;
        size: string;
        mountpoint: string;
        type: string;
    }>;
}
export interface NetworkConfig {
    dhcp: boolean;
    staticIp?: string;
    gateway?: string;
    dns?: string[];
}
export interface ProvisionProfile {
    name: string;
    type: 'minimal' | 'standard' | 'enterprise' | 'edge' | 'ai';
    description: string;
    minCpu: number;
    minMemory: number;
    minStorage: number;
    diskLayout: DiskLayout;
    network: NetworkConfig;
    packages: string[];
    optimizations: string[];
}
export interface InstallationStep {
    name: string;
    description: string;
    estimatedTime: number;
}
export interface InstallationPlan {
    profile: ProvisionProfile;
    hardware: HardwareInfo;
    steps: InstallationStep[];
    estimatedTotalTime: number;
}
export interface ProvisionReport {
    hostname: string;
    profile: string;
    hardware: HardwareInfo;
    benchmarks?: BenchmarkResults;
    timestamp: Date;
    duration: number;
    success: boolean;
    warnings: string[];
    errors: string[];
}
export interface KernelOptimization {
    swappiness: number;
    vfsCachePressure: number;
    dirtyRatio: number;
    dirtyBackgroundRatio: number;
    overcommitMemory: number;
    overcommitRatio: number;
    tcpTimestamps: boolean;
    tcpSack: boolean;
    tcpWindowScaling: boolean;
    customParams?: Record<string, string>;
}
export interface NetworkOptimization {
    bufferSizes: {
        rmemMax: number;
        wmemMax: number;
    };
    tcpCongestionControl: string;
    tcpFastOpen: boolean;
}
export interface OptimizationConfig {
    kernel: KernelOptimization;
    network: NetworkOptimization;
}
export interface MetricsConfig {
    enabled: boolean;
    interval: number;
}
export interface LoggingConfig {
    enabled: boolean;
    level: string;
}
export interface AlertingConfig {
    enabled: boolean;
    channels?: string[];
}
export interface MonitoringConfig {
    enabled: boolean;
    metrics: MetricsConfig;
    logging: LoggingConfig;
    alerting?: AlertingConfig;
}
export interface ServerConfiguration {
    version: string;
    exportedAt: Date;
    hostname: string;
    hardware: HardwareInfo;
    profile?: ProvisionProfile;
    customizations: Record<string, unknown>;
}
export interface ProvisionOptions {
    profile?: string;
    targetDisk?: string;
    dryRun?: boolean;
    skipConfirmation?: boolean;
    preserveData?: boolean;
    networkConfig?: NetworkConfig;
}
export declare class ServerProvisioner {
    private profiles;
    private logs;
    private progressCallback?;
    private currentProgress;
    constructor();
    private registerDefaultProfiles;
    registerProfile(name: string, profile: ProvisionProfile): void;
    getProfile(name: string): ProvisionProfile | undefined;
    listProfiles(): ProvisionProfile[];
    getRecommendedProfile(hardware: HardwareInfo): ProvisionProfile;
    detectHardware(): Promise<HardwareInfo>;
    private detectCPU;
    private detectMemory;
    private detectStorage;
    private detectNetwork;
    private detectGPU;
    private detectIPMI;
    generateProfile(hardware: HardwareInfo): Promise<ProvisionProfile>;
    generateInstallationPlan(hardware: HardwareInfo, profileName: string): Promise<InstallationPlan>;
    validatePlan(plan: InstallationPlan): Promise<{
        valid: boolean;
        issues: string[];
    }>;
    provisionServer(options: ProvisionOptions): Promise<ProvisionReport>;
    verifyInstallation(): Promise<boolean>;
    runBenchmarks(): Promise<BenchmarkResults>;
    optimizeSystem(optimization: OptimizationConfig): Promise<void>;
    configureMonitoring(config: MonitoringConfig): Promise<void>;
    generateDocumentation(report: ProvisionReport): Promise<string>;
    detectOtherNodes(): Promise<Array<{
        hostname: string;
        ip: string;
        status: string;
    }>>;
    configureCluster(nodes: Array<{
        hostname: string;
        ip: string;
        status: string;
    }>): Promise<void>;
    setupReplication(nodes: Array<{
        hostname: string;
        ip: string;
        status: string;
    }>): Promise<void>;
    configureLoadBalancing(nodes: Array<{
        hostname: string;
        ip: string;
        status: string;
    }>): Promise<void>;
    generateReport(): Promise<string>;
    exportConfiguration(): Promise<ServerConfiguration>;
    importConfiguration(config: ServerConfiguration): Promise<void>;
    simulateProvisioning(options: ProvisionOptions): Promise<ProvisionReport>;
    ipmiCommand(command: string): Promise<IPMIResult>;
    ipmiPowerOn(): Promise<IPMIResult>;
    ipmiPowerOff(): Promise<IPMIResult>;
    ipmiPowerCycle(): Promise<IPMIResult>;
    ipmiStatus(): Promise<IPMIResult>;
    private log;
    private updateProgress;
    private formatBytes;
    private parseSize;
    private classifyStorageType;
    private detectInterface;
    private classifyInterfaceType;
    private cidrToNetmask;
    private checkRequiredTools;
    private generateRecommendations;
    private simulateInstallation;
    onProgress(callback: ProgressCallback): void;
    getLogs(): string[];
    getCurrentProgress(): ProvisionProgress;
}
export declare const serverProvisioner: ServerProvisioner;
//# sourceMappingURL=server-provisioner.d.ts.map