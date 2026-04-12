/**
 * Hardware Monitor
 * Comprehensive hardware monitoring system for Hestia nodes
 * Cross-platform support (Linux primary, macOS secondary)
 */
export interface CPUCoreInfo {
    core: number;
    usage: number;
    frequency?: number;
}
export interface CPUInfo {
    model: string;
    cores: number;
    threads: number;
    architecture: string;
    vendor: string;
    speed: number;
    physicalCores: number;
}
export interface CPUUsage {
    cores: CPUCoreInfo[];
    average: number;
    user: number;
    system: number;
    idle: number;
}
export interface CPUTemperature {
    main?: number;
    cores: number[];
    max?: number;
}
export interface CPUFrequency {
    current: number;
    max: number;
    min: number;
    governor?: string;
}
export interface CPULoad {
    '1min': number;
    '5min': number;
    '15min': number;
}
export interface MemoryUsage {
    total: number;
    used: number;
    free: number;
    available: number;
    buffers: number;
    cached: number;
    percentage: number;
}
export interface MemoryInfo {
    type?: string;
    speed?: number;
    manufacturer?: string;
    voltage?: number;
    slots?: number;
    slotsUsed?: number;
}
export interface SwapUsage {
    total: number;
    used: number;
    free: number;
    percentage: number;
}
export interface MemoryPressure {
    level: 'normal' | 'warning' | 'critical';
    score: number;
    details: string;
}
export interface DiskMount {
    filesystem: string;
    mountpoint: string;
    total: number;
    used: number;
    free: number;
    percentage: number;
    type: string;
}
export interface DiskIO {
    device: string;
    readBytes: number;
    writeBytes: number;
    readOps: number;
    writeOps: number;
    readSpeed: number;
    writeSpeed: number;
    iops: number;
}
export interface SMARTAttribute {
    id: number;
    name: string;
    value: number;
    worst: number;
    threshold: number;
    raw: string;
    status: 'ok' | 'warning' | 'critical';
}
export interface DiskHealth {
    device: string;
    status: 'ok' | 'warning' | 'critical';
    temperature?: number;
    powerOnHours?: number;
    powerCycles?: number;
    attributes: SMARTAttribute[];
    errors: string[];
}
export interface DiskInfo {
    device: string;
    model: string;
    type: 'SSD' | 'HDD' | 'NVMe' | 'unknown';
    serial?: string;
    size: number;
    firmware?: string;
    sectorSize: number;
}
export interface NetworkInterface {
    name: string;
    type: 'ethernet' | 'wifi' | 'loopback' | 'tunnel' | 'other';
    mac?: string;
    ip4?: string[];
    ip6?: string[];
    status: 'up' | 'down' | 'unknown';
    speed?: number;
    duplex?: 'full' | 'half' | 'unknown';
    mtu: number;
}
export interface NetworkStats {
    interface: string;
    rxBytes: number;
    txBytes: number;
    rxPackets: number;
    txPackets: number;
    rxErrors: number;
    txErrors: number;
    rxDropped: number;
    txDropped: number;
}
export interface NetworkSpeed {
    interface: string;
    rxSpeed: number;
    txSpeed: number;
    rxPeak: number;
    txPeak: number;
}
export interface NetworkLatency {
    gateway?: {
        host: string;
        latency: number;
        packetLoss: number;
    };
    internet?: {
        host: string;
        latency: number;
        packetLoss: number;
    };
    dns?: {
        host: string;
        latency: number;
    };
}
export interface GPUInfo {
    index: number;
    model: string;
    vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown';
    driver?: string;
    vram: number;
    pci?: string;
}
export interface GPUUsage {
    index: number;
    utilization: number;
    memoryUsed: number;
    memoryTotal: number;
    memoryUtilization: number;
    temperature?: number;
    power?: number;
    fanSpeed?: number;
    clockGraphics?: number;
    clockMemory?: number;
}
export interface PowerUsage {
    source: 'AC' | 'battery' | 'unknown';
    battery?: {
        level: number;
        status: 'charging' | 'discharging' | 'full' | 'unknown';
        timeRemaining?: number;
        health?: number;
        cycles?: number;
    };
    powerDraw?: number;
}
export interface ThermalZone {
    zone: string;
    temperature: number;
    type?: string;
    status: 'normal' | 'warm' | 'hot' | 'critical';
}
export interface FanInfo {
    name: string;
    rpm?: number;
    percentage?: number;
    status: 'ok' | 'warning' | 'unknown';
}
export interface SystemInfo {
    hostname: string;
    platform: string;
    release: string;
    arch: string;
    uptime: number;
    bootTime: Date;
    timezone: string;
}
export interface Alert {
    type: 'cpu' | 'memory' | 'disk' | 'network' | 'gpu' | 'thermal' | 'power';
    severity: 'warning' | 'critical';
    message: string;
    value: number;
    threshold: number;
    timestamp: Date;
}
export interface HardwareMetrics {
    timestamp: Date;
    system: SystemInfo;
    cpu: {
        info: CPUInfo;
        usage: CPUUsage;
        temperature?: CPUTemperature;
        frequency?: CPUFrequency;
        load: CPULoad;
    };
    memory: {
        usage: MemoryUsage;
        info?: MemoryInfo;
        swap: SwapUsage;
        pressure: MemoryPressure;
    };
    disks: {
        mounts: DiskMount[];
        io: DiskIO[];
        health: DiskHealth[];
        info: DiskInfo[];
    };
    network: {
        interfaces: NetworkInterface[];
        stats: NetworkStats[];
        speed: NetworkSpeed[];
        latency?: NetworkLatency;
    };
    gpu?: {
        info: GPUInfo[];
        usage: GPUUsage[];
    };
    power: PowerUsage;
    thermal: ThermalZone[];
    fans: FanInfo[];
    alerts: Alert[];
}
export interface Thresholds {
    cpu: {
        warning: number;
        critical: number;
        temperatureWarning: number;
        temperatureCritical: number;
    };
    memory: {
        warning: number;
        critical: number;
    };
    disk: {
        warning: number;
        critical: number;
        temperatureWarning: number;
        temperatureCritical: number;
    };
    network: {
        packetLossWarning: number;
        packetLossCritical: number;
    };
    gpu: {
        temperatureWarning: number;
        temperatureCritical: number;
    };
    thermal: {
        warning: number;
        critical: number;
    };
}
export interface WatchOptions {
    interval: number;
    callback?: (metrics: HardwareMetrics) => void;
    alertCallback?: (alerts: Alert[]) => void;
    include?: (keyof HardwareMetrics)[];
    exclude?: (keyof HardwareMetrics)[];
}
export declare class HardwareMonitor {
    private thresholds;
    private watchInterval?;
    private lastDiskIO;
    private lastNetworkStats;
    private _platform;
    private _isLinux;
    private _isMacOS;
    constructor(thresholds?: Partial<Thresholds>);
    cpuUsage(): Promise<CPUUsage>;
    cpuTemperature(): Promise<CPUTemperature | undefined>;
    cpuFrequency(): Promise<CPUFrequency | undefined>;
    cpuLoad(): Promise<CPULoad>;
    cpuInfo(): Promise<CPUInfo>;
    memoryUsage(): Promise<MemoryUsage>;
    memoryInfo(): Promise<MemoryInfo | undefined>;
    swapUsage(): Promise<SwapUsage>;
    memoryPressure(): Promise<MemoryPressure>;
    diskUsage(): Promise<DiskMount[]>;
    private getFilesystemType;
    diskIO(): Promise<DiskIO[]>;
    diskHealth(): Promise<DiskHealth[]>;
    diskInfo(): Promise<DiskInfo[]>;
    networkInterfaces(): Promise<NetworkInterface[]>;
    networkUsage(): Promise<NetworkStats[]>;
    networkSpeed(): Promise<NetworkSpeed[]>;
    networkLatency(): Promise<NetworkLatency | undefined>;
    gpuInfo(): Promise<GPUInfo[] | undefined>;
    gpuUsage(): Promise<GPUUsage[] | undefined>;
    powerUsage(): Promise<PowerUsage>;
    thermalZones(): Promise<ThermalZone[]>;
    fanSpeed(): Promise<FanInfo[]>;
    systemUptime(): number;
    bootTime(): Date;
    hostname(): string;
    platform(): string;
    release(): string;
    arch(): string;
    getAlerts(metrics?: HardwareMetrics): Promise<Alert[]>;
    collectAll(): Promise<HardwareMetrics>;
    watch(options: WatchOptions): () => void;
    private filterMetrics;
    generateReport(format?: 'json' | 'markdown' | 'html'): Promise<string>;
    private generateMarkdownReport;
    private generateHtmlReport;
    exportMetrics(): Promise<string>;
    private formatDuration;
    private formatBytes;
    setThresholds(thresholds: Partial<Thresholds>): void;
    getThresholds(): Thresholds;
    resetThresholds(): void;
}
export declare const hardwareMonitor: HardwareMonitor;
export type NetworkInfo = {
    interfaces: NetworkInterface[];
    stats: NetworkStats[];
};
//# sourceMappingURL=hardware-monitor.d.ts.map