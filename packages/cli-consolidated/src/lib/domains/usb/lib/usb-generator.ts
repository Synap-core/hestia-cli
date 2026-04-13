// @ts-nocheck
/**
 * USB Generator for Hestia Installation
 *
 * Creates bootable USB keys for Hestia installation with:
 * - USB device management and safety checks
 * - Ubuntu Server ISO management
 * - Ventoy bootloader installation
 * - Autoinstall configuration generation
 * - Progress tracking and logging
 * - Dry-run mode for safety
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { createInterface } from 'readline';
import { logger, createLogger } from '../../../utils/index.js';
import { spinner } from '../../../utils/index.js';
import { EventEmitter } from 'eventemitter3';
import * as YAML from 'js-yaml';

const execAsync = promisify(exec);

// ============== Types ==============

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

// ============== USB Generator Class ==============

export class USBGenerator extends EventEmitter {
  private readonly cacheDir: string;
  private readonly isoDir: string;
  private readonly ventoyDir: string;
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly isDryRun: boolean;
  private activeOperations: Map<string, AbortController> = new Map();
  private progressInterval?: NodeJS.Timeout;
  private startTime: number = 0;

  constructor(options: { cacheDir?: string; dryRun?: boolean } = {}) {
    super();
    this.cacheDir = options.cacheDir || path.join(os.homedir(), '.hestia', 'usb-cache');
    this.isoDir = path.join(this.cacheDir, 'isos');
    this.ventoyDir = path.join(this.cacheDir, 'ventoy');
    this.logger = createLogger('usb-gen');
    this.isDryRun = options.dryRun || false;
  }

  // ============== USB Device Management ==============

  async listUSBDevices(): Promise<USBDevice[]> {
    this.logger.debug('Listing USB storage devices');

    try {
      // Get block devices with detailed info
      const { stdout } = await execAsync('lsblk -J -O');
      const data = JSON.parse(stdout);

      const devices: USBDevice[] = [];

      for (const blockdev of data.blockdevices || []) {
        if (this.isBlockDeviceUSB(blockdev)) {
          const device = await this.parseBlockDevice(blockdev);
          if (device) {
            devices.push(device);
          }
        }
      }

      this.logger.debug(`Found ${devices.length} USB storage devices`);
      return devices;
    } catch (error: any) {
      throw new USBError(`Failed to list USB devices: ${error.message}`, 'LIST_FAILED');
    }
  }

  private isBlockDeviceUSB(blockdev: any): boolean {
    // Check if it'a disk (not a partition)
    if (blockdev.type !== 'disk') return false;

    // Check hotplug attribute (USB devices usually have hotplug=1)
    if (blockdev.hotplug === '1') return true;

    // Check tran (transport) field
    if (blockdev.tran === 'usb') return true;

    // Check subsystem
    if (blockdev.subsystems?.includes('usb')) return true;

    // Check for removable flag
    if (blockdev.rm === '1' && blockdev.rota === '0') {
      // Removable non-rotational (likely USB flash)
      return true;
    }

    return false;
  }

  private async parseBlockDevice(blockdev: any): Promise<USBDevice | null> {
    const devicePath = `/dev/${blockdev.name}`;

    // Get additional info from udev
    let vendor = blockdev.vendor || 'Unknown';
    let model = blockdev.model || 'Unknown';
    let serial = blockdev.serial;

    try {
      const { stdout: udevInfo } = await execAsync(
        `udevadm info --query=property --name=${blockdev.name} 2>/dev/null || echo ''`
      );
      const props = this.parseUdevProperties(udevInfo);
      vendor = props.ID_VENDOR || vendor;
      model = props.ID_MODEL || model;
      serial = props.ID_SERIAL || serial;
    } catch {
      // Ignore udev errors
    }

    // Parse partitions
    const partitions: USBPartition[] = [];
    if (blockdev.children) {
      for (const child of blockdev.children) {
        if (child.type === 'part') {
          partitions.push({
            name: child.name,
            size: this.parseSize(child.size),
            type: child.fstype,
            mounted: child.mountpoints?.some((m: string | null) => m !== null) || false,
            mountpoint: child.mountpoints?.find((m: string | null) => m !== null) || undefined,
          });
        }
      }
    }

    // Check if mounted
    const mountpoints = blockdev.mountpoints?.filter((m: string | null) => m !== null) || [];
    const mounted = mountpoints.length > 0 || partitions.some((p) => p.mounted);

    return {
      device: blockdev.name,
      path: devicePath,
      size: this.parseSize(blockdev.size),
      model: model.trim(),
      vendor: vendor.trim(),
      serial: serial || undefined,
      removable: blockdev.rm === '1',
      readonly: blockdev.ro === '1',
      mounted,
      mountpoints: [...mountpoints, ...partitions.filter((p) => p.mounted).map((p) => p.mountpoint!)],
      isUSB: true,
      partitions,
    };
  }

  private parseUdevProperties(output: string): Record<string, string> {
    const props: Record<string, string> = {};
    for (const line of output.split('\n')) {
      const [key, value] = line.split('=');
      if (key && value) {
        props[key] = value;
      }
    }
    return props;
  }

  private parseSize(size: string): number {
    if (!size) return 0;
    const match = size.match(/^([\d.]+)\s*(\w+)?$/);
    if (!match) return 0;

    const num = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();

    const multipliers: Record<string, number> = {
      B: 1,
      K: 1024,
      KB: 1024,
      M: 1024 ** 2,
      MB: 1024 ** 2,
      G: 1024 ** 3,
      GB: 1024 ** 3,
      T: 1024 ** 4,
      TB: 1024 ** 4,
    };

    return Math.round(num * (multipliers[unit] || 1));
  }

  async getDeviceInfo(device: USBDevice): Promise<USBDevice> {
    this.logger.debug(`Getting detailed info for device: ${device.device}`);

    try {
      // Get SMART info if available
      const smartInfo = await this.getSmartInfo(device.path);

      // Get filesystem info
      const fsInfo = await this.getFilesystemInfo(device);

      // Combine info
      return {
        ...device,
        ...smartInfo,
        ...fsInfo,
      };
    } catch (error: any) {
      this.logger.warn(`Failed to get detailed info: ${error.message}`);
      return device;
    }
  }

  private async getSmartInfo(devicePath: string): Promise<Partial<USBDevice>> {
    try {
      const { stdout } = await execAsync(
        `smartctl -i ${devicePath} 2>/dev/null || echo ''`,
        { timeout: 5000 }
      );

      const info: Partial<USBDevice> = {};
      // Parse SMART info if needed
      return info;
    } catch {
      return {};
    }
  }

  private async getFilesystemInfo(device: USBDevice): Promise<Partial<USBDevice>> {
    try {
      const { stdout } = await execAsync(`df -h ${device.path} 2>/dev/null | tail -1 || echo ''`);
      // Parse df output if needed
      return {};
    } catch {
      return {};
    }
  }

  isDeviceUSB(device: USBDevice): boolean {
    return device.isUSB;
  }

  getDeviceSize(device: USBDevice): number {
    return device.size;
  }

  async verifyDevice(device: USBDevice): Promise<USBOperationResult<USBDevice>> {
    this.logger.info(`Verifying device: ${device.device}`);
    const warnings: string[] = [];

    // Check if device exists
    try {
      await fs.access(device.path);
    } catch {
      return {
        success: false,
        error: `Device ${device.device} does not exist`,
        duration: 0,
      };
    }

    // Check if it'a system disk
    if (await this.isSystemDisk(device)) {
      return {
        success: false,
        error: `Device ${device.device} appears to be a system disk. Operation blocked for safety.`,
        duration: 0,
      };
    }

    // Check if mounted
    if (device.mounted) {
      warnings.push('Device is currently mounted. Will attempt to unmount before operations.');
    }

    // Check size constraints
    const minSize = 4 * 1024 ** 3; // 4GB minimum
    if (device.size < minSize) {
      return {
        success: false,
        error: `Device ${device.device} is too small (${this.formatBytes(device.size)}). Minimum: 4GB`,
        duration: 0,
      };
    }

    // Check if readonly
    if (device.readonly) {
      return {
        success: false,
        error: `Device ${device.device} is read-only`,
        duration: 0,
      };
    }

    // Verify it'actually USB by checking the driver
    try {
      const { stdout } = await execAsync(
        `udevadm info --query=all --name=${device.device} | grep -i usb || echo ''`,
        { timeout: 3000 }
      );
      if (!stdout.trim()) {
        warnings.push('Could not verify USB connection type');
      }
    } catch {
      warnings.push('Could not verify USB connection type');
    }

    this.logger.success(`Device ${device.device} verified`);

    return {
      success: true,
      data: device,
      warnings: warnings.length > 0 ? warnings : undefined,
      duration: Date.now() - this.startTime,
    };
  }

  // ============== ISO Management ==============

  async downloadUbuntu(version: string = '24.04'): Promise<ISOInfo> {
    const startTime = Date.now();
    this.logger.header(`Downloading Ubuntu Server ${version}`);

    const isoName = `ubuntu-${version}-live-server-amd64.iso`;
    const isoPath = path.join(this.isoDir, isoName);
    const url = `https://releases.ubuntu.com/${version}/${isoName}`;

    // Check if already downloaded and valid
    if (await this.isISOValid(isoPath)) {
      this.logger.success(`Using cached ISO: ${isoPath}`);
      return this.getISOInfo(isoPath);
    }

    await this.ensureDir(this.isoDir);

    if (this.isDryRun) {
      this.logger.info(`[DRY RUN] Would download: ${url}`);
      return {
        path: isoPath,
        name: isoName,
        size: 0,
        version,
        modifiedAt: new Date(),
        isValid: true,
      };
    }

    // Download with progress
    const spinnerId = `download-ubuntu-${version}`;
    spinner.start(spinnerId, `Downloading Ubuntu ${version}...`);

    try {
      // Get file size first
      const { stdout: sizeOutput } = await execAsync(
        `curl -sI "${url}" | grep -i content-length | awk '{print $2}' | tr -d '\\r'`
      );
      const totalSize = parseInt(sizeOutput.trim()) || 0;

      // Download with progress
      await this.downloadWithProgress(url, isoPath, totalSize, (progress) => {
        spinner.update(spinnerId, `Downloading Ubuntu ${version}... ${progress.percentage}%`);
        this.emit('progress', {
          phase: 'download-iso',
          current: progress.bytesTransferred,
          total: totalSize,
          percentage: progress.percentage,
          message: `Downloading Ubuntu ${version}`,
          eta: progress.eta,
          speed: progress.speed,
          bytesTransferred: progress.bytesTransferred,
          totalBytes: totalSize,
        });
      });

      spinner.succeed(spinnerId, `Downloaded Ubuntu ${version}`);

      // Verify checksum
      await this.verifyISOChecksum(isoPath, version);

      return this.getISOInfo(isoPath);
    } catch (error: any) {
      spinner.fail(spinnerId, `Download failed: ${error.message}`);
      throw new USBError(`Failed to download Ubuntu: ${error.message}`, 'DOWNLOAD_FAILED');
    }
  }

  private async downloadWithProgress(
    url: string,
    outputPath: string,
    totalSize: number,
    onProgress: (progress: { bytesTransferred: number; percentage: number; eta: number; speed: string }) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let bytesReceived = 0;
      let lastUpdate = Date.now();
      let lastBytes = 0;

      const curl = spawn('curl', ['-fSL', '--progress-bar', '-o', outputPath, url], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      curl.stderr?.on('data', (data: Buffer) => {
        // curl progress bar output
        const line = data.toString();
        const match = line.match(/(\d+)\s+(\d+\.\d+\w?)\s+(\d+\.\d+\w?)\s+(\d+:\d+:\d+|\d+:\d+).*/);
        if (match && totalSize > 0) {
          bytesReceived = parseInt(match[1]);
          const percentage = Math.round((bytesReceived / totalSize) * 100);
          const speed = match[3];
          const etaStr = match[4];
          const etaParts = etaStr.split(':').map(Number);
          const eta = etaParts.length === 3
            ? etaParts[0] * 3600 + etaParts[1] * 60 + etaParts[2]
            : etaParts[0] * 60 + etaParts[1];

          onProgress({
            bytesTransferred: bytesReceived,
            percentage,
            eta,
            speed,
          });
        }
      });

      curl.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`curl exited with code ${code}`));
        }
      });

      curl.on('error', reject);
    });
  }

  async verifyISO(isoPath: string): Promise<boolean> {
    this.logger.debug(`Verifying ISO: ${isoPath}`);

    // Check if file exists
    try {
      await fs.access(isoPath);
    } catch {
      return false;
    }

    // Verify it'a valid ISO file
    try {
      const { stdout } = await execAsync(`file "${isoPath}"`);
      if (!stdout.toLowerCase().includes('iso 9660')) {
        this.logger.warn(`File does not appear to be a valid ISO: ${stdout}`);
        return false;
      }
    } catch {
      return false;
    }

    // Check minimum size
    const stats = await fs.stat(isoPath);
    if (stats.size < 100 * 1024 * 1024) {
      // Less than 100MB
      this.logger.warn('ISO file is too small to be valid');
      return false;
    }

    return true;
  }

  private async isISOValid(isoPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(isoPath);
      if (stats.size < 100 * 1024 * 1024) return false;

      const { stdout } = await execAsync(`file "${isoPath}"`);
      return stdout.toLowerCase().includes('iso 9660');
    } catch {
      return false;
    }
  }

  private async verifyISOChecksum(isoPath: string, version: string): Promise<void> {
    this.logger.info('Verifying ISO checksum...');

    try {
      // Download SHA256SUMS
      const checksumsUrl = `https://releases.ubuntu.com/${version}/SHA256SUMS`;
      const { stdout: checksums } = await execAsync(`curl -sL "${checksumsUrl}"`);

      const isoName = path.basename(isoPath);
      const expectedLine = checksums.split('\n').find((line) => line.includes(isoName));

      if (!expectedLine) {
        this.logger.warn('Could not find expected checksum. Skipping verification.');
        return;
      }

      const expectedChecksum = expectedLine.split(' ')[0];

      // Calculate actual checksum
      const { stdout: actualChecksum } = await execAsync(`sha256sum "${isoPath}" | awk '{print $1}'`);

      if (actualChecksum.trim() !== expectedChecksum.trim()) {
        throw new USBError('ISO checksum verification failed', 'CHECKSUM_MISMATCH');
      }

      this.logger.success('ISO checksum verified');
    } catch (error: any) {
      if (error instanceof USBError) throw error;
      this.logger.warn(`Checksum verification skipped: ${error.message}`);
    }
  }

  async listAvailableISOs(): Promise<ISOInfo[]> {
    this.logger.debug('Listing available ISOs');

    try {
      await this.ensureDir(this.isoDir);
      const files = await fs.readdir(this.isoDir);
      const isos: ISOInfo[] = [];

      for (const file of files) {
        if (file.endsWith('.iso')) {
          const info = await this.getISOInfo(path.join(this.isoDir, file));
          if (info.isValid) {
            isos.push(info);
          }
        }
      }

      return isos.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    } catch (error: any) {
      this.logger.error(`Failed to list ISOs: ${error.message}`);
      return [];
    }
  }

  async getISOInfo(isoPath: string): Promise<ISOInfo> {
    const stats = await fs.stat(isoPath);
    const name = path.basename(isoPath);

    // Extract version from filename
    const versionMatch = name.match(/ubuntu-(\d+(?:\.\d+)?)/);
    const version = versionMatch?.[1] || 'unknown';

    // Check if valid
    const isValid = await this.verifyISO(isoPath);

    return {
      path: isoPath,
      name,
      size: stats.size,
      version,
      modifiedAt: stats.mtime,
      isValid,
    };
  }

  // ============== Ventoy Management ==============

  async downloadVentoy(version: string = '1.0.96'): Promise<string> {
    const startTime = Date.now();
    this.logger.header(`Downloading Ventoy ${version}`);

    const platform = os.platform();
    const arch = os.arch();
    const ventoyName = `ventoy-${version}-${platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux'}-${arch === 'arm64' ? 'aarch64' : arch === 'ia32' ? 'i386' : 'tar.gz'}`;
    const ventoyPath = path.join(this.ventoyDir, version);
    const ventoyBin = path.join(ventoyPath, platform === 'win32' ? 'Ventoy2Disk.exe' : 'Ventoy2Disk.sh');

    // Check if already downloaded
    try {
      await fs.access(ventoyBin);
      this.logger.success(`Using cached Ventoy ${version}`);
      return ventoyPath;
    } catch {
      // Not cached, download
    }

    await this.ensureDir(ventoyPath);

    if (this.isDryRun) {
      this.logger.info(`[DRY RUN] Would download Ventoy ${version}`);
      return ventoyPath;
    }

    const spinnerId = `download-ventoy-${version}`;
    spinner.start(spinnerId, `Downloading Ventoy ${version}...`);

    try {
      const url = `https://github.com/ventoy/Ventoy/releases/download/v${version}/ventoy-${version}-${platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux'}.tar.gz`;
      const downloadPath = path.join(this.ventoyDir, `ventoy-${version}.tar.gz`);

      await execAsync(`curl -fsSL -o "${downloadPath}" "${url}"`);
      await execAsync(`tar -xzf "${downloadPath}" -C "${ventoyPath}" --strip-components=1`);
      await fs.unlink(downloadPath);

      // Make executable
      if (platform !== 'win32') {
        await execAsync(`chmod +x "${ventoyPath}"/*.sh`);
        await execAsync(`chmod +x "${ventoyPath}"/tool/*`);
      }

      spinner.succeed(spinnerId, `Downloaded Ventoy ${version}`);

      // Verify
      await this.verifyVentoy(ventoyPath);

      return ventoyPath;
    } catch (error: any) {
      spinner.fail(spinnerId, `Download failed: ${error.message}`);
      throw new USBError(`Failed to download Ventoy: ${error.message}`, 'VENTOY_DOWNLOAD_FAILED');
    }
  }

  async verifyVentoy(ventoyPath: string): Promise<boolean> {
    this.logger.debug(`Verifying Ventoy installation: ${ventoyPath}`);

    try {
      const platform = os.platform();
      const ventoyBin = path.join(ventoyPath, platform === 'win32' ? 'Ventoy2Disk.exe' : 'Ventoy2Disk.sh');

      await fs.access(ventoyBin);

      // Check version
      const { stdout } = await execAsync(`"${ventoyBin}" -v 2>&1 || echo ''`);
      this.logger.debug(`Ventoy version: ${stdout.trim()}`);

      return true;
    } catch {
      return false;
    }
  }

  async installVentoy(device: USBDevice, ventoyPath?: string): Promise<USBOperationResult> {
    const startTime = Date.now();
    this.logger.header(`Installing Ventoy to ${device.device}`);

    if (!ventoyPath) {
      ventoyPath = await this.downloadVentoy();
    }

    // Safety checks
    const verification = await this.verifyDevice(device);
    if (!verification.success) {
      return { ...verification, duration: Date.now() - startTime };
    }

    // Confirm destruction
    if (!verification.data?.unattended && !(await this.confirmDestruction(device))) {
      return {
        success: false,
        error: 'User cancelled operation',
        duration: Date.now() - startTime,
      };
    }

    // Backup if requested
    if (verification.data?.backupFirst) {
      await this.backupUSBData(device);
    }

    if (this.isDryRun) {
      this.logger.info(`[DRY RUN] Would install Ventoy to ${device.device}`);
      return { success: true, duration: Date.now() - startTime };
    }

    // Unmount if mounted
    if (device.mounted) {
      await this.unmountDevice(device);
    }

    const spinnerId = `install-ventoy-${device.device}`;
    spinner.start(spinnerId, `Installing Ventoy to ${device.device}...`);

    try {
      const platform = os.platform();
      const ventoyBin = path.join(ventoyPath, platform === 'win32' ? 'Ventoy2Disk.exe' : 'Ventoy2Disk.sh');

      // Install Ventoy
      const installCmd = platform === 'win32'
        ? `"${ventoyBin}" -i ${device.path}`
        : `sudo "${ventoyBin}" -i -I -s -r 0 ${device.path}`;

      const { stdout, stderr } = await execAsync(installCmd, { timeout: 120000 });

      if (stderr && !stderr.includes('OK')) {
        throw new Error(stderr);
      }

      spinner.succeed(spinnerId, `Ventoy installed on ${device.device}`);

      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      spinner.fail(spinnerId, `Installation failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  async updateVentoy(device: USBDevice, ventoyPath?: string): Promise<USBOperationResult> {
    const startTime = Date.now();
    this.logger.header(`Updating Ventoy on ${device.device}`);

    if (!ventoyPath) {
      ventoyPath = await this.downloadVentoy();
    }

    // Check if Ventoy is installed
    if (!(await this.isVentoyInstalled(device))) {
      return {
        success: false,
        error: 'Ventoy is not installed on this device. Use installVentoy instead.',
        duration: Date.now() - startTime,
      };
    }

    // Unmount if mounted
    if (device.mounted) {
      await this.unmountDevice(device);
    }

    if (this.isDryRun) {
      this.logger.info(`[DRY RUN] Would update Ventoy on ${device.device}`);
      return { success: true, duration: Date.now() - startTime };
    }

    const spinnerId = `update-ventoy-${device.device}`;
    spinner.start(spinnerId, `Updating Ventoy on ${device.device}...`);

    try {
      const platform = os.platform();
      const ventoyBin = path.join(ventoyPath, platform === 'win32' ? 'Ventoy2Disk.exe' : 'Ventoy2Disk.sh');

      const updateCmd = platform === 'win32'
        ? `"${ventoyBin}" -u ${device.path}`
        : `sudo "${ventoyBin}" -u -s ${device.path}`;

      await execAsync(updateCmd, { timeout: 120000 });

      spinner.succeed(spinnerId, `Ventoy updated on ${device.device}`);

      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      spinner.fail(spinnerId, `Update failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private async isVentoyInstalled(device: USBDevice): Promise<boolean> {
    try {
      // Check for Ventoy partition label
      const { stdout } = await execAsync(
        `lsblk -o LABEL -n ${device.path}1 2>/dev/null | grep -i ventoy || echo ''`
      );
      return stdout.toLowerCase().includes('ventoy');
    } catch {
      return false;
    }
  }

  // ============== Configuration Generation ==============

  generateVentoyConfig(options: Partial<USBOptions> = {}): VentoyConfig {
    this.logger.debug('Generating Ventoy configuration');

    const config: VentoyConfig = {
      control: [
        {
          VTOY_DEFAULT_MENU_MODE: 1,
          VTOY_FILT_DOT_UNDERSCORE_FILE: 1,
          VTOY_DEFAULT_SEARCH_ROOT: '/ISO',
          VTOY_MENU_TIMEOUT: 10,
        },
      ],
    };

    // Add theme configuration
    config.theme = {
      file: '/ventoy/themes/hestia/theme.txt',
      resolution: '1920x1080',
      default_mode: 'both',
    };

    // Add menu aliases for Hestia ISOs
    config.menu_alias = [
      {
        key: 'hestia-safe',
        alias: 'Hestia Install (Safe - Preserve Data)',
      },
      {
        key: 'hestia-wipe',
        alias: 'Hestia Install (Wipe Disk)',
      },
    ];

    // Add auto-install configuration
    if (options.mode) {
      const templates: string[] = [];
      if (options.mode === 'safe' || options.mode === 'both') {
        templates.push('/ventoy/hestia/safe.yaml');
      }
      if (options.mode === 'wipe' || options.mode === 'both') {
        templates.push('/ventoy/hestia/wipe.yaml');
      }

      config.auto_install = [
        {
          image: '/ISO/hestia-*.iso',
          template: templates,
        },
      ];
    }

    return config;
  }

  generateAutoinstallSafe(options: USBOptions): AutoinstallConfig {
    this.logger.debug('Generating safe autoinstall configuration');

    const config: AutoinstallConfig = {
      version: 1,
      interactive: false,
      early_commands: {
        '00-update-subiquity': 'snap refresh subiquity || true',
      },
      storage: {
        layout: {
          name: 'direct',
          match: {
            ssd: true,
          },
          mode: 'preserve',
        },
        config: [
          {
            type: 'partition',
            id: 'boot-partition',
            device: options.diskConfig?.device || 'disk-volatile',
            size: '1G',
            wipe: 'superblock-recursive',
            flag: 'boot',
            number: 1,
            preserve: false,
            grub_device: true,
          } as DiskPartition,
          {
            type: 'partition',
            id: 'root-partition',
            device: 'disk-volatile',
            size: options.diskConfig?.rootSize || '100%',
            wipe: 'superblock-recursive',
            flag: '',
            number: 2,
            preserve: false,
          } as DiskPartition,
        ],
      },
      identity: {
        hostname: options.hostname || 'hestia',
        username: options.username || 'hestia',
        password: options.password || this.generateTempPassword(),
        realname: 'Hestia Administrator',
        ssh_authorized_keys: options.sshKey ? [options.sshKey] : [],
      },
      locale: options.locale || 'en_US.UTF-8',
      keyboard: {
        layout: 'us',
      },
      network: this.generateNetworkConfig(options.networkConfig),
      proxy: options.networkConfig?.proxy?.http || '',
      apt: {
        preserve_sources_list: false,
        primary: [
          {
            arches: ['default'],
            uri: 'http://archive.ubuntu.com/ubuntu',
          },
        ],
        geoip: true,
      },
      packages: [
        'curl',
        'wget',
        'git',
        'vim',
        'htop',
        'docker.io',
        'docker-compose',
        'jq',
        'unzip',
        'ca-certificates',
        'gnupg',
        'lsb-release',
        ...(options.packages || []),
      ],
      user_data: this.generateCloudInitUserData(options),
      late_commands: {
        '00-hestia-setup': 'curl -fsSL https://get.hestia.io | bash',
        '01-hestia-init': `hestia init --unattended --hearth-name "${options.hearthName || 'My Digital Hearth'}" --install-type ${options.installType}`,
      },
      reporting: {
        type: 'hestia',
        endpoint: options.podUrl || 'https://api.hestia.io/v1/install/reports',
        token: options.apiKey,
      },
    };

    return config;
  }

  generateAutoinstallWipe(options: USBOptions): AutoinstallConfig {
    this.logger.debug('Generating wipe autoinstall configuration');

    const config = this.generateAutoinstallSafe(options);

    // Modify for wipe mode
    config.storage.layout.mode = 'reformat_disk';
    config.storage.layout.wipe = 'superblock-recursive';

    // Add wipe confirmation in early commands
    config.early_commands = {
      ...config.early_commands,
      '01-wipe-warning': 'echo "WARNING: All data will be destroyed!"',
    };

    return config;
  }

  generateUserData(options: USBOptions): CloudInitUserData {
    return this.generateCloudInitUserData(options);
  }

  private generateCloudInitUserData(options: USBOptions): CloudInitUserData {
    const userData: CloudInitUserData = {
      package_update: true,
      package_upgrade: true,
      package_reboot_if_required: false,
      packages: ['curl', 'wget', 'git', 'vim', 'htop'],
      runcmd: [],
      write_files: [
        {
          path: '/etc/hestia/config.json',
          content: JSON.stringify(
            {
              hearth: {
                name: options.hearthName || 'My Digital Hearth',
                type: options.installType,
              },
              intelligence: options.aiProvider
                ? {
                    provider: options.aiProvider,
                    model: options.aiModel,
                    endpoint: options.aiEndpoint,
                  }
                : undefined,
              workspaceId: options.workspaceId,
              podUrl: options.podUrl,
            },
            null,
            2
          ),
          owner: 'root:root',
          permissions: '0644',
        },
      ],
      users: [
        {
          name: options.username || 'hestia',
          gecos: 'Hestia Administrator',
          groups: ['sudo', 'docker'],
          sudo: 'ALL=(ALL) NOPASSWD:ALL',
          shell: '/bin/bash',
          ssh_authorized_keys: options.sshKey ? [options.sshKey] : [],
        },
      ],
      ssh_pwauth: false,
      hostname: options.hostname || 'hestia',
      timezone: options.timezone || 'UTC',
    };

    // Add post-install script if provided
    if (options.postInstallScript) {
      userData.write_files?.push({
        path: '/tmp/hestia-post-install.sh',
        content: options.postInstallScript,
        owner: 'root:root',
        permissions: '0755',
      });
      userData.runcmd?.push('/tmp/hestia-post-install.sh');
    }

    // Final message
    userData.final_message = 'Hestia installation complete! System will reboot in 5 seconds.';

    // Power state
    userData.power_state = {
      delay: '+5',
      mode: 'reboot',
      message: 'Rebooting for final configuration...',
      timeout: 300,
      condition: 'test -f /var/run/hestia-install-complete',
    };

    return userData;
  }

  generateMetaData(options: USBOptions): CloudInitMetaData {
    return {
      instance_id: `hestia-${Date.now()}`,
      local_hostname: options.hostname || 'hestia',
      hostname: options.hostname || 'hestia',
      platform: 'hestia',
      cloud_name: 'hestia',
    };
  }

  generateGrubConfig(options: USBOptions): string {
    const timeout = options.unattended ? 5 : 30;
    const defaultEntry = options.mode === 'wipe' ? 'Hestia Install (Wipe)' : 'Hestia Install (Safe)';

    return `set timeout=${timeout}
set default="${defaultEntry}"

# Hestia Boot Configuration
insmod all_video
insmod gfxterm
insmod part_gpt
insmod ext2
insmod loopback
insmod iso9660

# Set graphics mode
set gfxmode=auto
set gfxpayload=keep
terminal_output gfxterm

# Load theme if available
if [ -s /boot/grub/themes/hestia/theme.txt ]; then
    set theme=/boot/grub/themes/hestia/theme.txt
fi

# Hestia Install (Safe - Preserve Data)
menuentry "Hestia Install (Safe - Preserve Data)" {
    set isofile="/ISO/hestia-safe.iso"
    loopback loop $isofile
    linux (loop)/casper/vmlinuz iso-scan/filename=$isofile autoinstall ds=nocloud;s=/cdrom/hestia/
    initrd (loop)/casper/initrd
}

# Hestia Install (Wipe Disk)
menuentry "Hestia Install (Wipe Disk)" {
    set isofile="/ISO/hestia-wipe.iso"
    loopback loop $isofile
    linux (loop)/casper/vmlinuz iso-scan/filename=$isofile autoinstall ds=nocloud;s=/cdrom/hestia/
    initrd (loop)/casper/initrd
}

# Try Ubuntu without installing
menuentry "Try Ubuntu Server without installing" {
    set isofile="/ISO/ubuntu-server.iso"
    loopback loop $isofile
    linux (loop)/casper/vmlinuz iso-scan/filename=$isofile ---
    initrd (loop)/casper/initrd
}
`;
  }

  private generateNetworkConfig(networkConfig?: USBNetworkConfig): AutoinstallNetwork {
    if (!networkConfig || networkConfig.type === 'dhcp') {
      return {
        version: 2,
        ethernets: {
          'id0': {
            dhcp4: true,
            dhcp6: true,
          },
        },
      };
    }

    // Static configuration
    const network: AutoinstallNetwork = {
      version: 2,
      ethernets: {
        [networkConfig.interface || 'id0']: {
          dhcp4: false,
          dhcp6: false,
          addresses: networkConfig.ip ? [networkConfig.ip] : undefined,
          gateway4: networkConfig.gateway,
          nameservers: networkConfig.dns
            ? {
                addresses: networkConfig.dns,
              }
            : undefined,
        },
      },
    };

    // WiFi configuration
    if (networkConfig.wifi) {
      network.wifis = {
        [networkConfig.interface || 'wlan0']: {
          dhcp4: true,
          access_points: {
            [networkConfig.wifi.ssid]: {
              password: networkConfig.wifi.password || '',
              hidden: networkConfig.wifi.hidden || false,
            },
          },
        },
      };
    }

    return network;
  }

  // ============== USB Creation ==============

  async createUSB(options: USBOptions, onProgress?: ProgressCallback): Promise<USBOperationResult> {
    this.startTime = Date.now();
    this.logger.header('HESTIA USB CREATOR');

    // Validate options
    if (!options.device) {
      throw new USBError('Device is required', 'MISSING_DEVICE');
    }
    if (!options.iso) {
      throw new USBError('ISO is required', 'MISSING_ISO');
    }

    this.logger.section('Configuration');
    this.logger.info(`Device: ${options.device.device} (${this.formatBytes(options.device.size)})`);
    this.logger.info(`ISO: ${options.iso.name}`);
    this.logger.info(`Mode: ${options.mode}`);
    this.logger.info(`Hearth: ${options.hearthName || 'My Digital Hearth'}`);
    this.logger.info(`Install Type: ${options.installType}`);

    if (options.dryRun) {
      this.logger.info('\n[DRY RUN] - No changes will be made');
    }

    // Verify device
    this.logger.section('Device Verification');
    const deviceCheck = await this.verifyDevice(options.device);
    if (!deviceCheck.success) {
      return deviceCheck;
    }

    // Generate all configurations
    this.logger.section('Generating Configurations');

    const ventoyConfig = this.generateVentoyConfig(options);
    const safeConfig = options.mode !== 'wipe' ? this.generateAutoinstallSafe(options) : null;
    const wipeConfig = options.mode !== 'safe' ? this.generateAutoinstallWipe(options) : null;
    const userData = this.generateUserData(options);
    const metaData = this.generateMetaData(options);
    const grubConfig = this.generateGrubConfig(options);

    this.logger.success('Configurations generated');

    // Create temporary config directory
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hestia-usb-'));
    const configsDir = path.join(tempDir, 'configs');
    await this.ensureDir(configsDir);

    try {
      // Write configuration files
      await this.writeConfigFiles(configsDir, {
        ventoy: ventoyConfig,
        safe: safeConfig,
        wipe: wipeConfig,
        userData,
        metaData,
        grub: grubConfig,
      });

      // Install Ventoy
      this.logger.section('Installing Ventoy');
      const ventoyPath = await this.downloadVentoy(options.ventoyVersion);

      if (!options.dryRun) {
        const ventoyResult = await this.installVentoy(options.device, ventoyPath);
        if (!ventoyResult.success) {
          return ventoyResult;
        }
      }

      // Copy ISO
      this.logger.section('Copying ISO');
      if (!options.dryRun) {
        await this.copyISO(options.device, options.iso.path, onProgress);
      } else {
        this.logger.info(`[DRY RUN] Would copy ISO to ${options.device.device}`);
      }

      // Copy configurations
      this.logger.section('Copying Configurations');
      if (!options.dryRun) {
        await this.copyConfigs(options.device, configsDir, onProgress);
      } else {
        this.logger.info(`[DRY RUN] Would copy configurations to ${options.device.device}`);
      }

      // Copy installer files
      this.logger.section('Copying Installer Files');
      if (!options.dryRun) {
        await this.copyInstaller(options.device, onProgress);
      } else {
        this.logger.info(`[DRY RUN] Would copy installer to ${options.device.device}`);
      }

      // Create bootloader
      this.logger.section('Creating Bootloader');
      if (!options.dryRun) {
        await this.createBootloader(options.device, configsDir);
      }

      // Final verification
      this.logger.section('Verification');
      if (!options.dryRun) {
        const verifyResult = await this.verifyUSB(options.device);
        if (!verifyResult.success) {
          this.logger.warn('USB verification had issues, but bootable media was created');
        }
      }

      const duration = Date.now() - this.startTime;

      this.logger.newline();
      this.logger.success('USB creation complete!');
      this.logger.info(`Duration: ${this.formatDuration(duration)}`);
      this.logger.newline();
      this.logger.section('Next Steps');
      this.logger.info('1. Eject the USB drive safely');
      this.logger.info('2. Insert into target machine');
      this.logger.info('3. Boot from USB (may need to change BIOS/UEFI settings)');
      this.logger.info('4. Select Hestia installation option');

      return {
        success: true,
        duration,
      };
    } finally {
      // Cleanup
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private async writeConfigFiles(
    dir: string,
    configs: {
      ventoy: VentoyConfig;
      safe: AutoinstallConfig | null;
      wipe: AutoinstallConfig | null;
      userData: CloudInitUserData;
      metaData: CloudInitMetaData;
      grub: string;
    }
  ): Promise<void> {
    // Write Ventoy config
    await fs.writeFile(path.join(dir, 'ventoy.json'), JSON.stringify(configs.ventoy, null, 2));

    // Write autoinstall configs
    if (configs.safe) {
      await fs.writeFile(path.join(dir, 'safe.yaml'), YAML.dump(configs.safe));
    }
    if (configs.wipe) {
      await fs.writeFile(path.join(dir, 'wipe.yaml'), YAML.dump(configs.wipe));
    }

    // Write cloud-init configs
    await fs.writeFile(path.join(dir, 'user-data'), YAML.dump(configs.userData));
    await fs.writeFile(path.join(dir, 'meta-data'), YAML.dump(configs.metaData));

    // Write GRUB config
    await fs.writeFile(path.join(dir, 'grub.cfg'), configs.grub);

    this.logger.success(`Configuration files written to ${dir}`);
  }

  async formatDevice(device: USBDevice, onProgress?: ProgressCallback): Promise<USBOperationResult> {
    const startTime = Date.now();
    this.logger.header(`Formatting ${device.device}`);

    // Safety check
    if (await this.isSystemDisk(device)) {
      return {
        success: false,
        error: 'Cannot format system disk',
        duration: Date.now() - startTime,
      };
    }

    if (this.isDryRun) {
      this.logger.info(`[DRY RUN] Would format ${device.device}`);
      return { success: true, duration: Date.now() - startTime };
    }

    // Unmount
    if (device.mounted) {
      await this.unmountDevice(device);
    }

    const spinnerId = `format-${device.device}`;
    spinner.start(spinnerId, `Formatting ${device.device}...`);

    try {
      // Create new partition table
      await execAsync(`sudo parted -s ${device.path} mklabel gpt`);

      // Create FAT32 partition (for Ventoy compatibility)
      await execAsync(
        `sudo parted -s ${device.path} mkpart primary fat32 1MiB 100%`
      );

      // Format as FAT32
      await execAsync(`sudo mkfs.vfat -F 32 ${device.path}1`);

      spinner.succeed(spinnerId, `Formatted ${device.device}`);

      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      spinner.fail(spinnerId, `Format failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  async copyISO(
    device: USBDevice,
    isoPath: string,
    onProgress?: ProgressCallback
  ): Promise<USBOperationResult> {
    const startTime = Date.now();
    const isoSize = (await fs.stat(isoPath)).size;

    this.logger.info(`Copying ISO (${this.formatBytes(isoSize)}) to USB...`);

    if (this.isDryRun) {
      this.logger.info(`[DRY RUN] Would copy ${isoPath} to ${device.device}`);
      return { success: true, duration: Date.now() - startTime };
    }

    // Mount the Ventoy partition
    const mountPoint = await this.mountDevice(device);

    try {
      // Ensure ISO directory exists
      const isoDir = path.join(mountPoint, 'ISO');
      await this.ensureDir(isoDir);

      // Copy with progress
      const destPath = path.join(isoDir, path.basename(isoPath));
      await this.copyFileWithProgress(isoPath, destPath, isoSize, onProgress);

      // Sync to ensure write is complete
      await execAsync('sync');

      this.logger.success('ISO copied successfully');

      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } finally {
      await this.unmountDevice(device);
    }
  }

  async copyConfigs(
    device: USBDevice,
    configsDir: string,
    onProgress?: ProgressCallback
  ): Promise<USBOperationResult> {
    const startTime = Date.now();
    this.logger.info('Copying configuration files...');

    if (this.isDryRun) {
      this.logger.info(`[DRY RUN] Would copy configs from ${configsDir}`);
      return { success: true, duration: Date.now() - startTime };
    }

    // Mount the Ventoy partition
    const mountPoint = await this.mountDevice(device);

    try {
      // Copy to ventoy/hestia directory
      const ventoyDir = path.join(mountPoint, 'ventoy', 'hestia');
      await this.ensureDir(ventoyDir);

      // Copy all config files
      const files = await fs.readdir(configsDir);
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const src = path.join(configsDir, file);
        const dest = path.join(ventoyDir, file);

        await fs.copyFile(src, dest);

        onProgress?.({
          phase: 'copy-configs',
          current: i + 1,
          total: files.length,
          percentage: Math.round(((i + 1) / files.length) * 100),
          message: `Copying ${file}`,
        });
      }

      // Sync
      await execAsync('sync');

      this.logger.success('Configuration files copied');

      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } finally {
      await this.unmountDevice(device);
    }
  }

  async copyInstaller(device: USBDevice, onProgress?: ProgressCallback): Promise<USBOperationResult> {
    const startTime = Date.now();
    this.logger.info('Copying Hestia installer files...');

    if (this.isDryRun) {
      this.logger.info(`[DRY RUN] Would copy installer to ${device.device}`);
      return { success: true, duration: Date.now() - startTime };
    }

    // Mount
    const mountPoint = await this.mountDevice(device);

    try {
      // Create hestia directory structure
      const hestiaDir = path.join(mountPoint, 'hestia');
      await this.ensureDir(hestiaDir);
      await this.ensureDir(path.join(hestiaDir, 'scripts'));
      await this.ensureDir(path.join(hestiaDir, 'assets'));

      // Write install script
      const installScript = this.generateInstallScript();
      await fs.writeFile(path.join(hestiaDir, 'install.sh'), installScript);

      // Write preseed for compatibility
      const preseed = this.generatePreseed();
      await fs.writeFile(path.join(hestiaDir, 'preseed.cfg'), preseed);

      // Sync
      await execAsync('sync');

      this.logger.success('Installer files copied');

      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } finally {
      await this.unmountDevice(device);
    }
  }

  async createBootloader(device: USBDevice, configsDir: string): Promise<USBOperationResult> {
    const startTime = Date.now();
    this.logger.info('Creating bootloader configuration...');

    if (this.isDryRun) {
      this.logger.info(`[DRY RUN] Would create bootloader on ${device.device}`);
      return { success: true, duration: Date.now() - startTime };
    }

    // Mount
    const mountPoint = await this.mountDevice(device);

    try {
      // Create boot directory
      const bootDir = path.join(mountPoint, 'boot', 'grub');
      await this.ensureDir(bootDir);

      // Copy GRUB config
      const grubSrc = path.join(configsDir, 'grub.cfg');
      const grubDest = path.join(bootDir, 'grub.cfg');
      await fs.copyFile(grubSrc, grubDest);

      // Create themes directory
      const themesDir = path.join(bootDir, 'themes', 'hestia');
      await this.ensureDir(themesDir);

      // Create basic theme
      await this.createBasicTheme(themesDir);

      // Sync
      await execAsync('sync');

      this.logger.success('Bootloader configuration created');

      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } finally {
      await this.unmountDevice(device);
    }
  }

  private async createBasicTheme(themesDir: string): Promise<void> {
    const themeTxt = `title-text: "Hestia Installation"
title-color: "#ffffff"
title-font: "DejaVu Sans Regular 16"

declare bg_image = Variable {
    image = "background.png"
}
declare theme_color = "#3498db"
declare selected_item_color = "#2ecc71"
declare title_color = "#ecf0f1"
declare terminal_box = "terminal_box_*.png"

+ boot_menu {
    left = 30%
    width = 40%
    top = 30%
    height = 40%
    item_font = "DejaVu Sans Regular 14"
    item_color = "#ffffff"
    selected_item_color = "#3498db"
    icon_width = 32
    icon_height = 32
    item_icon_space = 20
    item_height = 40
    item_padding = 15
    menu_pixmap_style = "menu_*.png"
}

+ label {
    left = 0
    top = 90%
    width = 100%
    align = "center"
    color = "#95a5a6"
    font = "DejaVu Sans Regular 12"
    text = "Use ↑ and ↓ keys to select, Enter to boot"
}
`;

    await fs.writeFile(path.join(themesDir, 'theme.txt'), themeTxt);
  }

  private generateInstallScript(): string {
    return `#!/bin/bash
#
# Hestia Installer Script
# Automatically called during Ubuntu installation
#

set -e

echo "=========================================="
echo "  Hestia Installation"
echo "=========================================="

# Detect installation environment
HEARTH_CONFIG="/etc/hestia/config.json"
INSTALL_LOG="/var/log/hestia-install.log"

# Create log directory
mkdir -p "$(dirname "$INSTALL_LOG")"
exec 1> >(tee -a "$INSTALL_LOG")
exec 2>&1

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

log "Starting Hestia installation..."

# Install prerequisites
log "Installing prerequisites..."
apt-get update
apt-get install -y \\
    curl \\
    wget \\
    git \\
    jq \\
    docker.io \\
    docker-compose \\
    ca-certificates \\
    gnupg \\
    lsb-release

# Setup Docker
log "Configuring Docker..."
systemctl enable docker
systemctl start docker
usermod -aG docker hestia || true

# Download and install Hestia CLI
log "Installing Hestia CLI..."
curl -fsSL https://get.hestia.io | bash

# Initialize Hestia if config exists
if [ -f "$HEARTH_CONFIG" ]; then
    log "Initializing Hestia from configuration..."
    hearth_name=$(jq -r '.hearth.name // "My Digital Hearth"' "$HEARTH_CONFIG")
    install_type=$(jq -r '.hearth.type // "local"' "$HEARTH_CONFIG")
    
    hestia init --unattended \\
        --hearth-name "$hearth_name" \\
        --install-type "$install_type" || true
fi

# Mark installation as complete
log "Installation complete!"
touch /var/run/hestia-install-complete

# Final reboot handled by cloud-init
`;
  }

  private generatePreseed(): string {
    return `# Hestia Preseed Configuration
# For compatibility with older installers

d-i debian-installer/locale string en_US
d-i debian-installer/language string en
d-i debian-installer/country string US
d-i keyboard-configuration/xkb-keymap select us

d-i netcfg/choose_interface select auto
d-i netcfg/get_hostname string hestia
d-i netcfg/get_domain string local

d-i mirror/country string manual
d-i mirror/http/hostname string archive.ubuntu.com
d-i mirror/http/directory string /ubuntu
d-i mirror/http/proxy string

d-i passwd/user-fullname string Hestia Administrator
d-i passwd/username string hestia
d-i passwd/user-password-crypted password [CRYPTED_PASSWORD]
d-i passwd/user-default-groups string audio cdrom video sudo docker
d-i user-setup/allow-password-weak boolean true
d-i user-setup/encrypt-home boolean false

d-i clock-setup/utc boolean true
d-i time/zone string UTC
d-i clock-setup/ntp boolean true

# Partitioning - will be overridden by autoinstall
d-i partman-auto/method string regular
d-i partman-lvm/device_remove_lvm boolean true
d-i partman-md/device_remove_md boolean true
d-i partman-auto/choose_recipe select atomic

d-i pkgsel/include string curl wget git vim htop docker.io docker-compose jq
d-i pkgsel/upgrade select safe-upgrade

d-i grub-installer/only_debian boolean true
d-i grub-installer/bootdev string default

d-i finish-install/reboot_in_progress note

# Run Hestia setup after installation
d-i preseed/late_command string \\
    mkdir -p /target/etc/hestia; \\
    cp -r /cdrom/hestia/* /target/etc/hestia/ 2>/dev/null || true; \\
    in-target bash /etc/hestia/install.sh || true
`;
  }

  // ============== Verification ==============

  async verifyUSB(device: USBDevice): Promise<USBOperationResult> {
    const startTime = Date.now();
    this.logger.header(`Verifying USB: ${device.device}`);

    const warnings: string[] = [];

    try {
      // Check if device still exists
      await fs.access(device.path);

      // Verify partition table
      const { stdout: partInfo } = await execAsync(`parted -s ${device.path} print 2>&1 || echo 'ERROR'`);

      if (partInfo.includes('ERROR')) {
        return {
          success: false,
          error: 'USB partition table appears corrupted',
          duration: Date.now() - startTime,
        };
      }

      // Mount and check contents
      const mountPoint = await this.mountDevice(device);

      try {
        // Check for required files
        const requiredFiles = ['ISO', 'ventoy', 'boot'];
        for (const file of requiredFiles) {
          const filePath = path.join(mountPoint, file);
          try {
            await fs.access(filePath);
          } catch {
            warnings.push(`Missing directory: ${file}`);
          }
        }

        // Check for ISO files
        const isoDir = path.join(mountPoint, 'ISO');
        try {
          const isos = await fs.readdir(isoDir);
          const isoFiles = isos.filter((f) => f.endsWith('.iso'));
          if (isoFiles.length === 0) {
            warnings.push('No ISO files found in ISO directory');
          } else {
            this.logger.success(`Found ${isoFiles.length} ISO file(s)`);
          }
        } catch {
          warnings.push('Cannot access ISO directory');
        }

        // Check Ventoy installation
        const ventoyDir = path.join(mountPoint, 'ventoy');
        try {
          await fs.access(ventoyDir);
          this.logger.success('Ventoy directory exists');
        } catch {
          warnings.push('Ventoy directory not found');
        }
      } finally {
        await this.unmountDevice(device);
      }

      // Test bootloader config
      const bootResult = await this.testBootConfig(device);
      if (!bootResult.success) {
        warnings.push('Bootloader configuration test failed');
      }

      if (warnings.length > 0) {
        this.logger.warn('Verification warnings:');
        warnings.forEach((w) => this.logger.warn(`  - ${w}`));
      }

      this.logger.success('USB verification complete');

      return {
        success: true,
        warnings: warnings.length > 0 ? warnings : undefined,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  async testBootConfig(device: USBDevice): Promise<USBOperationResult> {
    const startTime = Date.now();
    this.logger.debug('Testing bootloader configuration...');

    try {
      // Check if GRUB config exists
      const mountPoint = await this.mountDevice(device);

      try {
        const grubConfig = path.join(mountPoint, 'boot', 'grub', 'grub.cfg');
        await fs.access(grubConfig);

        // Validate GRUB syntax (basic check)
        const content = await fs.readFile(grubConfig, 'utf-8');
        if (!content.includes('menuentry')) {
          return {
            success: false,
            error: 'GRUB config missing menu entries',
            duration: Date.now() - startTime,
          };
        }

        this.logger.success('Bootloader config is valid');

        return {
          success: true,
          duration: Date.now() - startTime,
        };
      } finally {
        await this.unmountDevice(device);
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  async getUSBCapacity(device: USBDevice): Promise<USBOperationResult<{ total: number; used: number; free: number }>> {
    const startTime = Date.now();

    try {
      const mountPoint = await this.mountDevice(device);

      try {
        const { stdout } = await execAsync(`df -B1 ${mountPoint} | tail -1`);
        const parts = stdout.trim().split(/\s+/);

        const total = parseInt(parts[1]);
        const used = parseInt(parts[2]);
        const free = parseInt(parts[3]);

        return {
          success: true,
          data: { total, used, free },
          duration: Date.now() - startTime,
        };
      } finally {
        await this.unmountDevice(device);
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  async estimateInstallTime(device: USBDevice): Promise<USBOperationResult<{ seconds: number; formatted: string }>> {
    const startTime = Date.now();

    try {
      // Estimate based on device type and size
      const isUSB3 = await this.isUSB3(device);
      const speed = isUSB3 ? 100 * 1024 * 1024 : 20 * 1024 * 1024; // MB/s

      const isoSize = 2 * 1024 ** 3; // Assume 2GB ISO
      const configSize = 10 * 1024 ** 2; // Assume 10MB configs
      const totalSize = isoSize + configSize;

      const seconds = Math.ceil(totalSize / speed);
      const formatted = this.formatDuration(seconds * 1000);

      return {
        success: true,
        data: { seconds, formatted },
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private async isUSB3(device: USBDevice): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        `udevadm info --query=property --name=${device.device} | grep -i "usb.*3\\|5000" || echo ''`
      );
      return stdout.includes('5000') || stdout.toLowerCase().includes('usb3');
    } catch {
      return false;
    }
  }

  // ============== Safety Features ==============

  async confirmDestruction(device: USBDevice): Promise<boolean> {
    if (process.env.HESTIA_FORCE_USB_WRITE === '1') {
      return true;
    }

    this.logger.newline();
    this.logger.warn('⚠️  WARNING: All data on this device will be destroyed!');
    this.logger.info(`Device: ${device.device}`);
    this.logger.info(`Model: ${device.vendor} ${device.model}`);
    this.logger.info(`Size: ${this.formatBytes(device.size)}`);
    if (device.partitions.length > 0) {
      this.logger.info(`Partitions: ${device.partitions.length}`);
      device.partitions.forEach((p) => {
        this.logger.info(`  - ${p.name}: ${this.formatBytes(p.size)}`);
      });
    }
    this.logger.newline();

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(`Type "DESTROY ${device.device}" to confirm: `, (answer) => {
        rl.close();
        resolve(answer === `DESTROY ${device.device}`);
      });
    });
  }

  async backupUSBData(device: USBDevice): Promise<USBOperationResult<string>> {
    const startTime = Date.now();
    this.logger.info(`Backing up data from ${device.device}...`);

    if (this.isDryRun) {
      this.logger.info(`[DRY RUN] Would backup ${device.device}`);
      return { success: true, duration: Date.now() - startTime };
    }

    if (!device.mounted && device.partitions.length === 0) {
      this.logger.info('No data to backup');
      return {
        success: true,
        duration: Date.now() - startTime,
      };
    }

    const backupDir = path.join(os.homedir(), '.hestia', 'backups', `usb-${device.device}-${Date.now()}`);
    await this.ensureDir(backupDir);

    try {
      const mountPoint = await this.mountDevice(device);

      try {
        // Copy all files
        await execAsync(`cp -r "${mountPoint}/." "${backupDir}/"`);

        this.logger.success(`Backed up to ${backupDir}`);

        return {
          success: true,
          data: backupDir,
          duration: Date.now() - startTime,
        };
      } finally {
        await this.unmountDevice(device);
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  async isSystemDisk(device: USBDevice): Promise<boolean> {
    // Check if device contains root filesystem
    try {
      const { stdout: rootDev } = await execAsync('findmnt -n -o SOURCE / 2>/dev/null || echo ""');
      const rootDisk = rootDev.trim().replace(/\d+$/, ''); // Remove partition number

      if (device.path === rootDisk || device.path === rootDev.trim()) {
        return true;
      }
    } catch {
      // Ignore errors
    }

    // Check if device is mounted at critical locations
    const criticalMounts = ['/boot', '/home', '/var', '/etc', '/usr'];
    for (const mount of device.mountpoints) {
      if (criticalMounts.some((cm) => mount?.startsWith(cm))) {
        return true;
      }
    }

    // Check if device is in fstab
    try {
      const { stdout: fstab } = await execAsync(`grep ${device.device} /etc/fstab || echo ''`);
      if (fstab.trim()) {
        return true;
      }
    } catch {
      // Ignore errors
    }

    return false;
  }

  preventSystemDestruction(): void {
    // Set environment variable to prevent accidental writes
    process.env.HESTIA_USB_SAFE_MODE = '1';

    // Register signal handlers
    const cleanup = () => {
      this.logger.info('Cleaning up...');
      this.cancelAllOperations();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);
  }

  // ============== Helper Methods ==============

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  private async mountDevice(device: USBDevice): Promise<string> {
    const mountPoint = `/tmp/hestia-mount-${device.device.replace(/[^a-zA-Z0-9]/g, '_')}`;
    await this.ensureDir(mountPoint);

    // Find first partition or use device directly
    const partition = device.partitions[0]?.name || `${device.device}1`;
    const partitionPath = `/dev/${partition}`;

    try {
      await execAsync(`sudo mount ${partitionPath} ${mountPoint} 2>/dev/null || sudo mount ${device.path} ${mountPoint}`);
      return mountPoint;
    } catch (error: any) {
      // Try with different filesystem types
      const fsTypes = ['vfat', 'exfat', 'ntfs', 'ext4'];
      for (const fsType of fsTypes) {
        try {
          await execAsync(`sudo mount -t ${fsType} ${partitionPath} ${mountPoint} 2>/dev/null || true`);
          return mountPoint;
        } catch {
          continue;
        }
      }
      throw new USBError(`Failed to mount device: ${error.message}`, 'MOUNT_FAILED');
    }
  }

  private async unmountDevice(device: USBDevice): Promise<void> {
    try {
      // Unmount all partitions
      for (const partition of device.partitions) {
        if (partition.mounted && partition.mountpoint) {
          await execAsync(`sudo umount "${partition.mountpoint}" 2>/dev/null || true`);
        }
      }

      // Unmount any hestia temp mounts
      const { stdout } = await execAsync('mount | grep hestia-mount | awk "{print \$3}" || echo ""');
      for (const mount of stdout.trim().split('\n').filter(Boolean)) {
        await execAsync(`sudo umount "${mount}" 2>/dev/null || true`);
      }
    } catch {
      // Ignore unmount errors
    }
  }

  private async copyFileWithProgress(
    src: string,
    dest: string,
    totalSize: number,
    onProgress?: ProgressCallback
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const readStream = require('fs').createReadStream(src);
      const writeStream = require('fs').createWriteStream(dest);

      let bytesTransferred = 0;
      let lastUpdate = Date.now();

      readStream.on('data', (chunk: Buffer) => {
        bytesTransferred += chunk.length;

        // Throttle progress updates
        if (Date.now() - lastUpdate > 500) {
          const percentage = Math.round((bytesTransferred / totalSize) * 100);
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = bytesTransferred / elapsed;
          const remaining = totalSize - bytesTransferred;
          const eta = Math.ceil(remaining / speed);

          onProgress?.({
            phase: 'copy-iso',
            current: bytesTransferred,
            total: totalSize,
            percentage,
            message: 'Copying ISO to USB',
            eta,
            speed: this.formatBytes(speed) + '/s',
            bytesTransferred,
            totalBytes: totalSize,
          });

          lastUpdate = Date.now();
        }
      });

      readStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);

      readStream.pipe(writeStream);
    });
  }

  private generateTempPassword(): string {
    return crypto.randomBytes(16).toString('base64').slice(0, 16);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  cancelAllOperations(): void {
    this.activeOperations.forEach((controller) => controller.abort());
    this.activeOperations.clear();
  }

  setDryRun(value: boolean): void {
    (this as any).isDryRun = value;
  }

  // ============== Utility Methods ==============

  /**
   * Find the best USB device for installation
   */
  async findBestDevice(minSize: number = 4 * 1024 ** 3): Promise<USBDevice | null> {
    const devices = await this.listUSBDevices();

    // Filter by size and prefer unmounted devices
    const candidates = devices
      .filter((d) => d.size >= minSize && !d.readonly)
      .sort((a, b) => {
        // Prefer unmounted devices
        if (a.mounted && !b.mounted) return 1;
        if (!a.mounted && b.mounted) return -1;
        // Prefer larger devices
        return b.size - a.size;
      });

    return candidates[0] || null;
  }

  /**
   * Check if a device is bootable
   */
  async isBootable(device: USBDevice): Promise<boolean> {
    try {
      // Check for boot sector signature
      const { stdout } = await execAsync(
        `sudo dd if=${device.path} bs=512 count=1 2>/dev/null | xxd | grep -E "55 aa|aa 55" || echo ''`
      );
      return stdout.includes('55 aa') || stdout.includes('aa 55');
    } catch {
      return false;
    }
  }

  /**
   * Get detailed partition information
   */
  async getPartitionInfo(device: USBDevice): Promise<USBPartition[]> {
    try {
      const { stdout } = await execAsync(
        `parted -s ${device.path} print 2>/dev/null | grep -E "^\\s*[0-9]" || echo ''`
      );

      const partitions: USBPartition[] = [];
      for (const line of stdout.trim().split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4) {
          partitions.push({
            name: `${device.device}${parts[0]}`,
            size: this.parseSize(parts[3]),
            type: parts[4] || undefined,
            mounted: false,
          });
        }
      }

      return partitions;
    } catch {
      return device.partitions;
    }
  }

  /**
   * Wipe device securely
   */
  async wipeDevice(device: USBDevice, passes: number = 1): Promise<USBOperationResult> {
    const startTime = Date.now();
    this.logger.header(`Wiping ${device.device}`);

    if (await this.isSystemDisk(device)) {
      return {
        success: false,
        error: 'Cannot wipe system disk',
        duration: Date.now() - startTime,
      };
    }

    if (this.isDryRun) {
      this.logger.info(`[DRY RUN] Would wipe ${device.device} with ${passes} pass(es)`);
      return { success: true, duration: Date.now() - startTime };
    }

    // Unmount
    if (device.mounted) {
      await this.unmountDevice(device);
    }

    const spinnerId = `wipe-${device.device}`;
    spinner.start(spinnerId, `Wiping ${device.device}...`);

    try {
      for (let pass = 1; pass <= passes; pass++) {
        spinner.update(spinnerId, `Wiping pass ${pass}/${passes}...`);

        if (pass === 1) {
          // First pass: zeros
          await execAsync(`sudo dd if=/dev/zero of=${device.path} bs=1M status=progress 2>&1 || true`, {
            timeout: 3600000, // 1 hour timeout
          });
        } else {
          // Random data for additional passes
          await execAsync(`sudo dd if=/dev/urandom of=${device.path} bs=1M status=progress 2>&1 || true`, {
            timeout: 3600000,
          });
        }
      }

      // Final pass: zeros
      await execAsync(`sudo dd if=/dev/zero of=${device.path} bs=1M count=10 2>/dev/null || true`);

      spinner.succeed(spinnerId, `Wiped ${device.device}`);

      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      spinner.fail(spinnerId, `Wipe failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Eject device safely
   */
  async ejectDevice(device: USBDevice): Promise<USBOperationResult> {
    const startTime = Date.now();
    this.logger.info(`Ejecting ${device.device}...`);

    try {
      // Unmount
      await this.unmountDevice(device);

      // Eject
      await execAsync(`sudo eject ${device.path} 2>/dev/null || sudo umount -l ${device.path} 2>/dev/null || true`);

      this.logger.success(`Ejected ${device.device}`);

      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }
}

// ============== Error Classes ==============

export class USBError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = false
  ) {
    super(message);
    this.name = 'USBError';
  }
}

// ============== Exports ==============

export const usbGenerator = new USBGenerator();

export default USBGenerator;
