/**
 * OS Manager - Operating System Management for Hestia Nodes
 *
 * Manages the operating system for Hestia nodes including package management,
 * service management, user management, network configuration, firewall, disk
 * management, and system configuration.
 *
 * Supports: Ubuntu/Debian (primary), CentOS/RHEL (secondary), macOS (tertiary)
 */
export type LinuxDistribution = 'ubuntu' | 'debian' | 'centos' | 'rhel' | 'fedora' | 'arch' | 'alpine' | 'unknown';
export type OSPlatform = 'linux' | 'darwin' | 'win32' | 'unknown';
export interface OSInfo {
    platform: OSPlatform;
    distribution: LinuxDistribution;
    version: string;
    codename: string;
    kernelVersion: string;
    architecture: string;
    hostname: string;
    uptime: number;
    supported: boolean;
}
export interface KernelInfo {
    version: string;
    buildDate: string;
    architecture: string;
    modules: KernelModule[];
    parameters: Record<string, string>;
}
export interface KernelModule {
    name: string;
    size: string;
    usedBy: string[];
    status: 'loaded' | 'builtin' | 'unloading';
}
export interface BootInfo {
    bootTime: Date;
    bootLoader: string;
    bootArgs: string[];
    kernelParams: Record<string, string>;
    initSystem: 'systemd' | 'sysvinit' | 'openrc' | 'launchd' | 'unknown';
}
export interface PackageInfo {
    name: string;
    version: string;
    description: string;
    installed: boolean;
    size?: string;
    repository?: string;
    dependencies?: string[];
    homepage?: string;
    maintainer?: string;
}
export interface ServiceInfo {
    name: string;
    description: string;
    status: 'running' | 'stopped' | 'failed' | 'activating' | 'deactivating' | 'unknown';
    enabled: boolean;
    loaded: boolean;
    pid?: number;
    uptime?: string;
    memoryUsage?: string;
    cpuUsage?: string;
}
export interface UserInfo {
    username: string;
    uid: number;
    gid: number;
    home: string;
    shell: string;
    groups: string[];
    isSystemUser: boolean;
    lastLogin?: Date;
}
export interface UserOptions {
    home?: string;
    shell?: string;
    uid?: number;
    gid?: number;
    groups?: string[];
    system?: boolean;
    password?: string;
    createHome?: boolean;
    comment?: string;
}
export interface NetworkConfig {
    hostname: string;
    interfaces: NetworkInterface[];
    dns: DNSServer[];
    hosts: HostEntry[];
    routes: Route[];
}
export interface NetworkInterface {
    name: string;
    type: 'ethernet' | 'wifi' | 'loopback' | 'bridge' | 'vlan' | 'unknown';
    ipAddresses: IPAddress[];
    macAddress: string;
    state: 'up' | 'down' | 'unknown';
    mtu: number;
    rxBytes: number;
    txBytes: number;
}
export interface IPAddress {
    address: string;
    family: 'IPv4' | 'IPv6';
    prefix: number;
    gateway?: string;
}
export interface DNSServer {
    address: string;
    priority: number;
    searchDomains?: string[];
}
export interface HostEntry {
    ip: string;
    hostnames: string[];
    comment?: string;
}
export interface Route {
    destination: string;
    gateway: string;
    interface: string;
    metric: number;
}
export interface FirewallRule {
    action: 'allow' | 'deny' | 'reject' | 'limit';
    port?: number;
    protocol: 'tcp' | 'udp' | 'tcpudp' | 'any';
    from?: string;
    to?: string;
    direction: 'in' | 'out';
    enabled: boolean;
    number?: number;
    comment?: string;
}
export interface FirewallStatus {
    enabled: boolean;
    active: boolean;
    defaultIncoming: 'allow' | 'deny' | 'reject';
    defaultOutgoing: 'allow' | 'deny' | 'reject';
    rules: FirewallRule[];
}
export interface DiskInfo {
    device: string;
    model: string;
    size: string;
    bytes: number;
    type: 'ssd' | 'hdd' | 'nvme' | 'loop' | 'unknown';
    serial?: string;
    partitions: PartitionInfo[];
    mounted: boolean;
    mountPoint?: string;
    filesystem?: string;
    usage?: DiskUsage;
}
export interface PartitionInfo {
    device: string;
    start: string;
    end: string;
    size: string;
    type: string;
    filesystem?: string;
    mountPoint?: string;
    flags: string[];
}
export interface DiskUsage {
    total: number;
    used: number;
    free: number;
    percentUsed: number;
}
export interface MountPoint {
    device: string;
    path: string;
    filesystem: string;
    options: string[];
    size: DiskUsage;
}
export interface SysctlParameter {
    key: string;
    value: string;
    persistent: boolean;
}
export interface OSRecommendation {
    category: 'security' | 'performance' | 'stability' | 'network' | 'storage';
    severity: 'critical' | 'warning' | 'info';
    title: string;
    description: string;
    currentValue?: string;
    recommendedValue?: string;
    command?: string;
}
export interface OSReport {
    timestamp: Date;
    os: OSInfo;
    kernel: KernelInfo;
    boot: BootInfo;
    network: NetworkConfig;
    services: ServiceInfo[];
    diskUsage: DiskInfo[];
    timezone: string;
    locale: string;
    recommendations: OSRecommendation[];
}
export interface BackupMetadata {
    timestamp: Date;
    hostname: string;
    distribution: LinuxDistribution;
    version: string;
    components: string[];
    size: number;
}
export declare class OSManager {
    private cachedDistro;
    private cachedVersion;
    private cachedInitSystem;
    /**
     * Get comprehensive OS information
     */
    getOSInfo(): OSInfo;
    /**
     * Get kernel information
     */
    getKernelInfo(): KernelInfo;
    /**
     * Get boot information
     */
    getBootInfo(): BootInfo;
    /**
     * Get current timezone
     */
    getTimezone(): string;
    /**
     * Get system locale
     */
    getLocale(): string;
    /**
     * Update package lists
     */
    updatePackages(): boolean;
    /**
     * Upgrade installed packages
     */
    upgradePackages(): boolean;
    /**
     * Install a package
     */
    installPackage(name: string): boolean;
    /**
     * Remove a package
     */
    removePackage(name: string, purge?: boolean): boolean;
    /**
     * Search for packages
     */
    searchPackage(name: string): PackageInfo[];
    /**
     * List installed packages
     */
    listInstalled(): PackageInfo[];
    /**
     * Get detailed package information
     */
    getPackageInfo(name: string): PackageInfo | null;
    /**
     * List all systemd services
     */
    listServices(): ServiceInfo[];
    /**
     * Start a service
     */
    startService(name: string): boolean;
    /**
     * Stop a service
     */
    stopService(name: string): boolean;
    /**
     * Restart a service
     */
    restartService(name: string): boolean;
    /**
     * Enable service on boot
     */
    enableService(name: string): boolean;
    /**
     * Disable service on boot
     */
    disableService(name: string): boolean;
    /**
     * Get detailed service status
     */
    getServiceStatus(name: string): ServiceInfo | null;
    /**
     * Check if service is running
     */
    isServiceRunning(name: string): boolean;
    /**
     * List system users
     */
    listUsers(): UserInfo[];
    /**
     * Create a new user
     */
    createUser(username: string, options?: UserOptions): boolean;
    /**
     * Delete a user
     */
    deleteUser(username: string, removeHome?: boolean): boolean;
    /**
     * Add user to group
     */
    addToGroup(username: string, group: string): boolean;
    /**
     * Set user password
     */
    setPassword(username: string, password: string): boolean;
    /**
     * Get network configuration
     */
    getNetworkConfig(): NetworkConfig;
    /**
     * Set system hostname
     */
    setHostname(name: string): boolean;
    /**
     * Configure network interface
     */
    configureInterface(name: string, config: Partial<NetworkInterface>): boolean;
    /**
     * Configure DNS servers
     */
    configureDNS(servers: string[]): boolean;
    /**
     * Configure /etc/hosts entries
     */
    configureHosts(entries: HostEntry[]): boolean;
    /**
     * Get UFW firewall status
     */
    getFirewallStatus(): FirewallStatus;
    /**
     * Enable firewall
     */
    enableFirewall(): boolean;
    /**
     * Disable firewall
     */
    disableFirewall(): boolean;
    /**
     * Allow port through firewall
     */
    allowPort(port: number, protocol?: 'tcp' | 'udp' | 'tcpudp', from?: string): boolean;
    /**
     * Deny port through firewall
     */
    denyPort(port: number, protocol?: 'tcp' | 'udp' | 'tcpudp'): boolean;
    /**
     * List firewall rules
     */
    listRules(): FirewallRule[];
    /**
     * List all disks
     */
    listDisks(): DiskInfo[];
    /**
     * Get detailed disk information
     */
    getDiskInfo(device: string): DiskInfo | null;
    /**
     * Format disk with filesystem
     */
    formatDisk(device: string, filesystem?: 'ext4' | 'xfs' | 'btrfs' | 'ntfs'): boolean;
    /**
     * Mount disk
     */
    mount(device: string, path: string, options?: string[]): boolean;
    /**
     * Unmount disk
     */
    unmount(path: string): boolean;
    /**
     * Resize filesystem
     */
    resizeFilesystem(device: string): boolean;
    /**
     * Create partition
     */
    createPartition(device: string, type: string, size?: string): boolean;
    /**
     * Set sysctl kernel parameter
     */
    setSysctl(key: string, value: string, persistent?: boolean): boolean;
    /**
     * Get sysctl kernel parameter
     */
    getSysctl(key: string): string | null;
    /**
     * Apply resource limits
     */
    applyLimits(): boolean;
    /**
     * Configure system logging
     */
    configureLogging(): boolean;
    /**
     * Configure NTP/time sync
     */
    configureTime(): boolean;
    /**
     * Detect Linux distribution
     */
    detectDistro(): LinuxDistribution;
    /**
     * Check if OS is supported
     */
    isSupported(): boolean;
    /**
     * Get OS tuning recommendations
     */
    getRecommendations(): OSRecommendation[];
    /**
     * Generate OS configuration report
     */
    generateReport(): OSReport;
    /**
     * Backup system configuration
     */
    backupConfig(path: string): boolean;
    /**
     * Restore system configuration
     */
    restoreConfig(backupPath: string): boolean;
    private getPlatform;
    private getKernelVersion;
    private getKernelBuildDate;
    private getArchitecture;
    private getHostname;
    private getUptime;
    private getOSVersion;
    private getCodename;
    private getBootTime;
    private getBootLoader;
    private getBootArgs;
    private getKernelParameters;
    private getInitSystem;
    private getLoadedModules;
    private getNetworkInterfaces;
    private getInterfaceType;
    private getDNSServers;
    private getHostsEntries;
    private getRoutes;
    private getPartitions;
    private getDiskType;
    private getUserGroups;
    private isServiceEnabled;
    private parseServiceStatus;
    private generateNetplanConfig;
    private generateInterfacesConfig;
    private generateNMConfig;
    private validatePackageName;
    private validateServiceName;
    private validateUsername;
    private validateGroupName;
    private validateHostname;
    private isValidIP;
    private exec;
    private commandExists;
    private parseSize;
    private formatBytes;
}
export declare const osManager: OSManager;
//# sourceMappingURL=os-manager.d.ts.map