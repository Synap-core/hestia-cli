/**
 * USB Generator for eve Installation
 *
 * Creates bootable USB keys for eve installation with:
 * - USB device management and safety checks
 * - Ubuntu Server ISO management
 * - Ventoy bootloader installation
 * - Autoinstall configuration generation
 * - Progress tracking and logging
 * - Dry-run mode for safety
 */
import { EventEmitter } from 'eventemitter3';
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
    partitions: USBPartition[];
}
export interface USBPartition {
    name: string;
    size: number;
    type?: string;
    mounted: boolean;
    mountpoint?: string;
}
export interface ISOInfo {
    path: string;
    name: string;
    size: number;
    version: string;
    checksum?: string;
    checksumType?: 'sha256' | 'sha512' | 'md5';
    modifiedAt: Date;
    isValid: boolean;
}
export interface USBOptions {
    device: USBDevice;
    iso: ISOInfo;
    mode: 'safe' | 'wipe' | 'both';
    hearthName?: string;
    installType: 'local' | 'distributed' | 'hybrid';
    aiProvider?: 'ollama' | 'openrouter' | 'anthropic' | 'openai' | 'localai' | 'custom';
    aiModel?: string;
    aiEndpoint?: string;
    networkConfig?: USBNetworkConfig;
    diskConfig?: DiskConfig;
    dryRun?: boolean;
    force?: boolean;
    unattended?: boolean;
    backupFirst?: boolean;
    ventoyVersion?: string;
    ubuntuVersion?: string;
    workspaceId?: string;
    podUrl?: string;
    apiKey?: string;
    sshKey?: string;
    packages?: string[];
    postInstallScript?: string;
    timezone?: string;
    locale?: string;
    hostname?: string;
    username?: string;
    password?: string;
}
export interface USBNetworkConfig {
    type: 'dhcp' | 'static';
    interface?: string;
    ip?: string;
    netmask?: string;
    gateway?: string;
    dns?: string[];
    wifi?: {
        ssid: string;
        password?: string;
        hidden?: boolean;
    };
    proxy?: {
        http?: string;
        https?: string;
        noProxy?: string[];
    };
}
export interface DiskConfig {
    device: string;
    layout: 'lvm' | 'direct' | 'zfs' | 'btrfs';
    encryption?: boolean;
    swapSize?: string;
    rootSize?: string;
    dataSize?: string;
}
export interface USBProgress {
    phase: string;
    current: number;
    total: number;
    percentage: number;
    message: string;
    eta?: number;
    speed?: string;
    bytesTransferred?: number;
    totalBytes?: number;
}
export interface VentoyConfig {
    control: Array<{
        VTOY_DEFAULT_MENU_MODE?: number;
        VTOY_FILT_DOT_UNDERSCORE_FILE?: number;
        VTOY_DEFAULT_SEARCH_ROOT?: string;
        VTOY_MENU_TIMEOUT?: number;
        VTOY_DEFAULT_IMAGE?: string;
        [key: string]: any;
    }>;
    theme?: {
        file?: string;
        resolution?: string;
        default_mode?: string;
        [key: string]: any;
    };
    menu_class?: Array<{
        key: string;
        class: string;
    }>;
    menu_alias?: Array<{
        key: string;
        alias: string;
    }>;
    auto_install?: Array<{
        image: string;
        template: string[];
        [key: string]: any;
    }>;
}
export interface AutoinstallConfig {
    version: number;
    interactive?: boolean;
    early_commands?: Record<string, string>;
    late_commands?: Record<string, string>;
    storage?: StorageConfig;
    identity?: IdentityConfig;
    locale?: string;
    keyboard?: KeyboardConfig;
    network?: AutoinstallNetwork;
    proxy?: string;
    mirror?: string;
    apt?: AptConfig;
    packages?: string[];
    debconf_selections?: Record<string, string>;
    user_data?: CloudInitUserData;
    error_commands?: Record<string, string>;
    reporting?: ReportingConfig;
}
export interface StorageConfig {
    layout: StorageLayout;
    swap?: SwapConfig;
    config?: Array<DiskPartition | LVMConfig | ZFSConfig>;
}
export interface StorageLayout {
    name: string;
    match?: MatchCriteria;
    mode?: 'reformat_disk' | 'wipe' | 'direct' | 'preserve';
    mount?: string;
    device?: string;
    type?: 'disk' | 'lvm' | 'zfs' | 'raid';
    ptable?: string;
    preserve?: boolean;
    wipe?: string;
    grub_device?: boolean;
}
export interface MatchCriteria {
    ssd?: boolean;
    size?: string;
    model?: string;
    vendor?: string;
}
export interface SwapConfig {
    size: number;
    file?: string;
    device?: string;
    zvol?: string;
}
export interface DiskPartition {
    type: 'partition';
    id: string;
    device: string;
    size: string;
    wipe?: string;
    flag?: string;
    number: number;
    preserve?: boolean;
    grub_device?: boolean;
}
export interface LVMConfig {
    type: 'lvm_volgroup' | 'lvm_partition' | 'lvm_slice';
    id: string;
    name: string;
    devices?: string[];
    volgroup?: string;
    size?: string;
}
export interface ZFSConfig {
    type: 'zfs';
    id: string;
    pool: string;
    dataset?: string;
    vdevs?: Array<{
        type: string;
        devices: string[];
    }>;
}
export interface IdentityConfig {
    hostname: string;
    username: string;
    password?: string;
    realname?: string;
    encrypt_home?: boolean;
    ssh_import_id?: string[];
    ssh_authorized_keys?: string[];
}
export interface KeyboardConfig {
    layout: string;
    variant?: string;
}
export interface AutoinstallNetwork {
    version: number;
    ethernets?: Record<string, EthernetConfig>;
    wifis?: Record<string, WifiConfig>;
    bonds?: Record<string, BondConfig>;
    bridges?: Record<string, BridgeConfig>;
    vlans?: Record<string, VlanConfig>;
}
export interface EthernetConfig {
    dhcp4?: boolean;
    dhcp6?: boolean;
    addresses?: string[];
    gateway4?: string;
    gateway6?: string;
    nameservers?: Nameservers;
    match?: MatchConfig;
    set_name?: string;
    wakeonlan?: boolean;
    accept_ra?: boolean;
    critical?: boolean;
    mtu?: number;
    optional?: boolean;
    routes?: Route[];
    routing_policy?: RoutingPolicy[];
}
export interface WifiConfig {
    dhcp4?: boolean;
    dhcp6?: boolean;
    addresses?: string[];
    gateway4?: string;
    gateway6?: string;
    nameservers?: Nameservers;
    access_points?: Record<string, AccessPoint>;
    wakeonlan?: boolean;
    critical?: boolean;
    optional?: boolean;
}
export interface AccessPoint {
    password?: string;
    mode?: 'infrastructure' | 'ap' | 'adhoc';
    band?: string;
    channel?: number;
    bssid?: string;
    hidden?: boolean;
    auth?: {
        key_management?: string;
        method?: string;
        identity?: string;
        anonymous_identity?: string;
        ca_cert?: string;
        client_cert?: string;
        client_key?: string;
        phase2_auth?: string;
    };
}
export interface BondConfig {
    interfaces: string[];
    parameters: BondParameters;
    dhcp4?: boolean;
    dhcp6?: boolean;
    addresses?: string[];
    gateway4?: string;
    gateway6?: string;
    nameservers?: Nameservers;
}
export interface BondParameters {
    mode: 'balance-rr' | 'active-backup' | 'balance-xor' | 'broadcast' | '802.3ad' | 'balance-tlb' | 'balance-alb';
    mii_monitor_interval?: number;
    gratuitous_arp?: number;
    up_delay?: number;
    down_delay?: number;
    lacp_rate?: 'slow' | 'fast';
    min_links?: number;
    xmit_hash_policy?: string;
    arp_interval?: number;
    arp_ip_target?: string[];
    arp_validate?: string;
    primary?: string;
    primary_reselect?: string;
    fail_over_mac?: string;
    ad_select?: string;
    num_gratuitous_arp?: number;
    all_slaves_active?: boolean;
    resend_igmp?: number;
    lp_interval?: number;
    packets_per_slave?: number;
    tlb_dynamic_lb?: boolean;
}
export interface BridgeConfig {
    interfaces: string[];
    parameters?: BridgeParameters;
    dhcp4?: boolean;
    dhcp6?: boolean;
    addresses?: string[];
    gateway4?: string;
    gateway6?: string;
    nameservers?: Nameservers;
}
export interface BridgeParameters {
    stp?: boolean;
    forward_delay?: number;
    max_age?: number;
    priority?: number;
    hello_time?: number;
    ageing_time?: number;
    max_len?: number;
}
export interface VlanConfig {
    id: number;
    link: string;
    dhcp4?: boolean;
    dhcp6?: boolean;
    addresses?: string[];
    gateway4?: string;
    gateway6?: string;
    nameservers?: Nameservers;
    mtu?: number;
}
export interface Nameservers {
    addresses?: string[];
    search?: string[];
}
export interface Route {
    to: string;
    via?: string;
    from?: string;
    on_link?: boolean;
    metric?: number;
    type?: string;
    scope?: string;
    table?: number;
    mtu?: number;
    congestion_window?: number;
    advertised_receive_window?: number;
}
export interface RoutingPolicy {
    from?: string;
    to?: string;
    mark?: number;
    table?: number;
    priority?: number;
    dev?: string;
    family?: string;
}
export interface MatchConfig {
    driver?: string;
    macaddress?: string;
    name?: string;
}
export interface AptConfig {
    preserve_sources_list?: boolean;
    primary?: ArchiveMirror[];
    mirror?: string;
    geoip?: boolean;
    sources?: Record<string, SourceEntry>;
    security?: ArchiveMirror[];
    pockets?: string[];
}
export interface ArchiveMirror {
    arches?: string[];
    uri?: string;
    search?: string;
    search_dns?: boolean;
}
export interface SourceEntry {
    source?: string;
    keyid?: string;
    keyserver?: string;
}
export interface CloudInitUserData {
    package_update?: boolean;
    package_upgrade?: boolean;
    package_reboot_if_required?: boolean;
    packages?: string[];
    runcmd?: Array<string | string[]>;
    write_files?: WriteFile[];
    users?: UserConfig[];
    groups?: Record<string, string[]>;
    ssh_pwauth?: boolean;
    chpasswd?: ChpasswdConfig;
    hostname?: string;
    fqdn?: string;
    manage_etc_hosts?: boolean;
    apt?: AptConfig;
    snaps?: Snap[];
    debconf_selections?: Record<string, string>;
    ca_certs?: CACerts;
    phone_home?: PhoneHome;
    final_message?: string;
    power_state?: PowerState;
    growpart?: GrowpartConfig;
    resize_rootfs?: boolean;
}
export interface WriteFile {
    path: string;
    content: string;
    owner?: string;
    permissions?: string;
    append?: boolean;
    defer?: boolean;
    encoding?: string;
}
export interface UserConfig {
    name: string;
    gecos?: string;
    primary_group?: string;
    groups?: string[];
    selinux_user?: string;
    expiredate?: string;
    passwd?: string;
    hashed_passwd?: string;
    lock_passwd?: boolean;
    ssh_authorized_keys?: string[];
    ssh_import_id?: string[];
    sudo?: string | string[] | boolean;
    shell?: string;
    homedir?: string;
    system?: boolean;
    inactive?: boolean;
}
export interface ChpasswdConfig {
    expire?: boolean;
    list?: string;
    users?: Array<{
        name: string;
        password: string;
        type?: 'hash' | 'text';
    }>;
}
export interface Snap {
    name: string;
    classic?: boolean;
    channel?: string;
}
export interface CACerts {
    trusted?: string[];
    remove_defaults?: boolean;
}
export interface PhoneHome {
    url: string;
    post?: string[];
    tries?: number;
}
export interface PowerState {
    delay?: string;
    mode: 'reboot' | 'poweroff' | 'halt';
    message?: string;
    timeout?: number;
    condition?: string;
}
export interface GrowpartConfig {
    mode?: 'auto' | 'off' | 'growpart' | 'gpart';
    devices?: string[];
    ignore_growroot_disabled?: boolean;
}
export interface ReportingConfig {
    type: string;
    endpoint: string;
    token?: string;
}
export interface CloudInitMetaData {
    instance_id: string;
    local_hostname: string;
    hostname?: string;
    platform?: string;
    cloud_name?: string;
    availability_zone?: string;
    region?: string;
    public_keys?: string[];
}
export type ProgressCallback = (progress: USBProgress) => void;
export interface USBOperationResult<T = void> {
    success: boolean;
    data?: T;
    error?: string;
    warnings?: string[];
    duration: number;
}
export declare class USBGenerator extends EventEmitter {
    private readonly cacheDir;
    private readonly isoDir;
    private readonly ventoyDir;
    private readonly logger;
    private readonly isDryRun;
    private activeOperations;
    private progressInterval?;
    private startTime;
    constructor(options?: {
        cacheDir?: string;
        dryRun?: boolean;
    });
    listUSBDevices(): Promise<USBDevice[]>;
    private isBlockDeviceUSB;
    private parseBlockDevice;
    private parseUdevProperties;
    private parseSize;
    getDeviceInfo(device: USBDevice): Promise<USBDevice>;
    private getSmartInfo;
    private getFilesystemInfo;
    isDeviceUSB(device: USBDevice): boolean;
    getDeviceSize(device: USBDevice): number;
    verifyDevice(device: USBDevice): Promise<USBOperationResult<USBDevice>>;
    downloadUbuntu(version?: string): Promise<ISOInfo>;
    private downloadWithProgress;
    verifyISO(isoPath: string): Promise<boolean>;
    private isISOValid;
    private verifyISOChecksum;
    listAvailableISOs(): Promise<ISOInfo[]>;
    getISOInfo(isoPath: string): Promise<ISOInfo>;
    downloadVentoy(version?: string): Promise<string>;
    verifyVentoy(ventoyPath: string): Promise<boolean>;
    installVentoy(device: USBDevice, ventoyPath?: string): Promise<USBOperationResult>;
    updateVentoy(device: USBDevice, ventoyPath?: string): Promise<USBOperationResult>;
    private isVentoyInstalled;
    generateVentoyConfig(options?: Partial<USBOptions>): VentoyConfig;
    generateAutoinstallSafe(options: USBOptions): AutoinstallConfig;
    generateAutoinstallWipe(options: USBOptions): AutoinstallConfig;
    generateUserData(options: USBOptions): CloudInitUserData;
    private generateCloudInitUserData;
    generateMetaData(options: USBOptions): CloudInitMetaData;
    generateGrubConfig(options: USBOptions): string;
    private generateNetworkConfig;
    createUSB(options: USBOptions, onProgress?: ProgressCallback): Promise<USBOperationResult>;
    private writeConfigFiles;
    formatDevice(device: USBDevice, onProgress?: ProgressCallback): Promise<USBOperationResult>;
    copyISO(device: USBDevice, isoPath: string, onProgress?: ProgressCallback): Promise<USBOperationResult>;
    copyConfigs(device: USBDevice, configsDir: string, onProgress?: ProgressCallback): Promise<USBOperationResult>;
    copyInstaller(device: USBDevice, onProgress?: ProgressCallback): Promise<USBOperationResult>;
    createBootloader(device: USBDevice, configsDir: string): Promise<USBOperationResult>;
    private createBasicTheme;
    private generateInstallScript;
    private generatePreseed;
    verifyUSB(device: USBDevice): Promise<USBOperationResult>;
    testBootConfig(device: USBDevice): Promise<USBOperationResult>;
    getUSBCapacity(device: USBDevice): Promise<USBOperationResult<{
        total: number;
        used: number;
        free: number;
    }>>;
    estimateInstallTime(device: USBDevice): Promise<USBOperationResult<{
        seconds: number;
        formatted: string;
    }>>;
    private isUSB3;
    confirmDestruction(device: USBDevice): Promise<boolean>;
    backupUSBData(device: USBDevice): Promise<USBOperationResult<string>>;
    isSystemDisk(device: USBDevice): Promise<boolean>;
    preventSystemDestruction(): void;
    private ensureDir;
    private mountDevice;
    private unmountDevice;
    private copyFileWithProgress;
    private generateTempPassword;
    private formatBytes;
    private formatDuration;
    cancelAllOperations(): void;
    setDryRun(value: boolean): void;
    /**
     * Find the best USB device for installation
     */
    findBestDevice(minSize?: number): Promise<USBDevice | null>;
    /**
     * Check if a device is bootable
     */
    isBootable(device: USBDevice): Promise<boolean>;
    /**
     * Get detailed partition information
     */
    getPartitionInfo(device: USBDevice): Promise<USBPartition[]>;
    /**
     * Wipe device securely
     */
    wipeDevice(device: USBDevice, passes?: number): Promise<USBOperationResult>;
    /**
     * Eject device safely
     */
    ejectDevice(device: USBDevice): Promise<USBOperationResult>;
}
export declare class USBError extends Error {
    code: string;
    recoverable: boolean;
    constructor(message: string, code: string, recoverable?: boolean);
}
export declare const usbGenerator: USBGenerator;
export default USBGenerator;
//# sourceMappingURL=usb-generator.d.ts.map