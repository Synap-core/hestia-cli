/**
 * OS Manager - Operating System Management for Hestia Nodes
 *
 * Manages the operating system for Hestia nodes including package management,
 * service management, user management, network configuration, firewall, disk
 * management, and system configuration.
 *
 * Supports: Ubuntu/Debian (primary), CentOS/RHEL (secondary), macOS (tertiary)
 */

import { execSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { promisify } from 'util';
import { logger } from './logger.js';

const execAsync = promisify(execSync);

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// OS Manager Class
// ============================================================================

export class OSManager {
  private cachedDistro: LinuxDistribution | null = null;
  private cachedVersion: string | null = null;
  private cachedInitSystem: BootInfo['initSystem'] | null = null;

  // ========================================================================
  // OS Information
  // ========================================================================

  /**
   * Get comprehensive OS information
   */
  getOSInfo(): OSInfo {
    const platform = this.getPlatform();
    const distribution = this.detectDistro();
    const version = this.getOSVersion();
    const codename = this.getCodename();
    const kernelVersion = this.getKernelVersion();
    const architecture = this.getArchitecture();
    const hostname = this.getHostname();
    const uptime = this.getUptime();

    return {
      platform,
      distribution,
      version,
      codename,
      kernelVersion,
      architecture,
      hostname,
      uptime,
      supported: this.isSupported(),
    };
  }

  /**
   * Get kernel information
   */
  getKernelInfo(): KernelInfo {
    const version = this.getKernelVersion();
    const buildDate = this.getKernelBuildDate();
    const architecture = this.getArchitecture();
    const modules = this.getLoadedModules();
    const parameters = this.getKernelParameters();

    return {
      version,
      buildDate,
      architecture,
      modules,
      parameters,
    };
  }

  /**
   * Get boot information
   */
  getBootInfo(): BootInfo {
    const bootTime = this.getBootTime();
    const bootLoader = this.getBootLoader();
    const bootArgs = this.getBootArgs();
    const kernelParams = this.getKernelParameters();
    const initSystem = this.getInitSystem();

    return {
      bootTime,
      bootLoader,
      bootArgs,
      kernelParams,
      initSystem,
    };
  }

  /**
   * Get current timezone
   */
  getTimezone(): string {
    try {
      // Try timedatectl first (systemd)
      if (this.commandExists('timedatectl')) {
        const output = this.exec('timedatectl show --property=Timezone --value');
        if (output) return output.trim();
      }

      // Fallback to /etc/timezone
      if (existsSync('/etc/timezone')) {
        return readFileSync('/etc/timezone', 'utf8').trim();
      }

      // Fallback to /etc/localtime symlink
      if (existsSync('/etc/localtime')) {
        const stats = statSync('/etc/localtime');
        // On macOS, use systemsetup
        if (this.getPlatform() === 'darwin') {
          return this.exec('systemsetup -gettimezone').replace('Time Zone: ', '').trim();
        }
      }

      return 'UTC';
    } catch (error) {
      logger.warn(`Failed to get timezone: ${error}`);
      return 'UTC';
    }
  }

  /**
   * Get system locale
   */
  getLocale(): string {
    try {
      // Check environment variables
      const envLocale = process.env.LC_ALL || process.env.LANG;
      if (envLocale) return envLocale;

      // Try locale command
      if (this.commandExists('locale')) {
        const output = this.exec('locale | grep LANG= | head -1');
        if (output) {
          const match = output.match(/LANG="?([^"]+)"?/);
          if (match) return match[1];
        }
      }

      // Fallback to /etc/default/locale
      if (existsSync('/etc/default/locale')) {
        const content = readFileSync('/etc/default/locale', 'utf8');
        const match = content.match(/LANG="?([^"]+)"?/);
        if (match) return match[1];
      }

      return 'en_US.UTF-8';
    } catch (error) {
      logger.warn(`Failed to get locale: ${error}`);
      return 'en_US.UTF-8';
    }
  }

  // ========================================================================
  // Package Management
  // ========================================================================

  /**
   * Update package lists
   */
  updatePackages(): boolean {
    try {
      const distro = this.detectDistro();

      switch (distro) {
        case 'ubuntu':
        case 'debian':
          this.exec('apt-get update -qq');
          break;
        case 'centos':
        case 'rhel':
        case 'fedora':
          this.exec('dnf check-update -y || true');
          break;
        case 'arch':
          this.exec('pacman -Sy --noconfirm');
          break;
        case 'alpine':
          this.exec('apk update');
          break;
        case 'unknown':
          if (this.getPlatform() === 'darwin') {
            this.exec('brew update');
          } else {
            throw new Error('Unsupported distribution for package management');
          }
          break;
        default:
          throw new Error(`Unsupported distribution: ${distro}`);
      }

      logger.success('Package lists updated');
      return true;
    } catch (error) {
      logger.error(`Failed to update packages: ${error}`);
      return false;
    }
  }

  /**
   * Upgrade installed packages
   */
  upgradePackages(): boolean {
    try {
      const distro = this.detectDistro();

      switch (distro) {
        case 'ubuntu':
        case 'debian':
          this.exec('apt-get upgrade -y -qq');
          break;
        case 'centos':
        case 'rhel':
        case 'fedora':
          this.exec('dnf upgrade -y');
          break;
        case 'arch':
          this.exec('pacman -Su --noconfirm');
          break;
        case 'alpine':
          this.exec('apk upgrade');
          break;
        case 'unknown':
          if (this.getPlatform() === 'darwin') {
            this.exec('brew upgrade');
          } else {
            throw new Error('Unsupported distribution for package management');
          }
          break;
        default:
          throw new Error(`Unsupported distribution: ${distro}`);
      }

      logger.success('Packages upgraded');
      return true;
    } catch (error) {
      logger.error(`Failed to upgrade packages: ${error}`);
      return false;
    }
  }

  /**
   * Install a package
   */
  installPackage(name: string): boolean {
    try {
      this.validatePackageName(name);
      const distro = this.detectDistro();

      switch (distro) {
        case 'ubuntu':
        case 'debian':
          this.exec(`apt-get install -y -qq ${name}`);
          break;
        case 'centos':
        case 'rhel':
        case 'fedora':
          this.exec(`dnf install -y ${name}`);
          break;
        case 'arch':
          this.exec(`pacman -S --noconfirm ${name}`);
          break;
        case 'alpine':
          this.exec(`apk add ${name}`);
          break;
        case 'unknown':
          if (this.getPlatform() === 'darwin') {
            this.exec(`brew install ${name}`);
          } else {
            throw new Error('Unsupported distribution for package management');
          }
          break;
        default:
          throw new Error(`Unsupported distribution: ${distro}`);
      }

      logger.success(`Package installed: ${name}`);
      return true;
    } catch (error) {
      logger.error(`Failed to install package ${name}: ${error}`);
      return false;
    }
  }

  /**
   * Remove a package
   */
  removePackage(name: string, purge = false): boolean {
    try {
      this.validatePackageName(name);
      const distro = this.detectDistro();

      switch (distro) {
        case 'ubuntu':
        case 'debian':
          const cmd = purge ? 'purge' : 'remove';
          this.exec(`apt-get ${cmd} -y -qq ${name}`);
          break;
        case 'centos':
        case 'rhel':
        case 'fedora':
          this.exec(`dnf remove -y ${name}`);
          break;
        case 'arch':
          this.exec(`pacman -R --noconfirm ${name}`);
          break;
        case 'alpine':
          this.exec(`apk del ${name}`);
          break;
        case 'unknown':
          if (this.getPlatform() === 'darwin') {
            this.exec(`brew uninstall ${name}`);
          } else {
            throw new Error('Unsupported distribution for package management');
          }
          break;
        default:
          throw new Error(`Unsupported distribution: ${distro}`);
      }

      logger.success(`Package removed: ${name}`);
      return true;
    } catch (error) {
      logger.error(`Failed to remove package ${name}: ${error}`);
      return false;
    }
  }

  /**
   * Search for packages
   */
  searchPackage(name: string): PackageInfo[] {
    try {
      this.validatePackageName(name);
      const distro = this.detectDistro();
      const packages: PackageInfo[] = [];

      switch (distro) {
        case 'ubuntu':
        case 'debian':
          const aptOutput = this.exec(`apt-cache search --names-only ${name} 2>/dev/null || true`);
          for (const line of aptOutput.split('\n')) {
            const match = line.match(/^([^\s]+)\s+-\s+(.+)$/);
            if (match) {
              packages.push({
                name: match[1],
                version: '',
                description: match[2],
                installed: false,
              });
            }
          }
          break;
        case 'centos':
        case 'rhel':
        case 'fedora':
          const dnfOutput = this.exec(`dnf search ${name} 2>/dev/null || true`);
          for (const line of dnfOutput.split('\n')) {
            const match = line.match(/^([^\s]+)\s*\.\s*[^:]+\s*:\s*(.+)$/);
            if (match) {
              packages.push({
                name: match[1].trim(),
                version: '',
                description: match[2],
                installed: false,
              });
            }
          }
          break;
        case 'arch':
          const pacmanOutput = this.exec(`pacman -Ss ${name} 2>/dev/null || true`);
          for (const line of pacmanOutput.split('\n')) {
            const match = line.match(/^([^\/]+\/[^\s]+)\s+(.+)$/);
            if (match) {
              packages.push({
                name: match[1].split('/')[1],
                version: '',
                description: match[2],
                installed: false,
              });
            }
          }
          break;
        case 'unknown':
          if (this.getPlatform() === 'darwin') {
            const brewOutput = this.exec(`brew search ${name} 2>/dev/null || true`);
            for (const line of brewOutput.split('\n')) {
              if (line.trim() && !line.startsWith('==>')) {
                packages.push({
                  name: line.trim(),
                  version: '',
                  description: '',
                  installed: false,
                });
              }
            }
          }
          break;
      }

      return packages;
    } catch (error) {
      logger.warn(`Failed to search packages: ${error}`);
      return [];
    }
  }

  /**
   * List installed packages
   */
  listInstalled(): PackageInfo[] {
    try {
      const distro = this.detectDistro();
      const packages: PackageInfo[] = [];

      switch (distro) {
        case 'ubuntu':
        case 'debian':
          const dpkgOutput = this.exec("dpkg-query -W -f='${Package}|${Version}|${Description}\n' 2>/dev/null");
          for (const line of dpkgOutput.split('\n')) {
            const parts = line.split('|');
            if (parts.length >= 2) {
              packages.push({
                name: parts[0],
                version: parts[1],
                description: parts[2] || '',
                installed: true,
              });
            }
          }
          break;
        case 'centos':
        case 'rhel':
        case 'fedora':
          const rpmOutput = this.exec("rpm -qa --queryformat '%{NAME}|%{VERSION}-%{RELEASE}|%{SUMMARY}\n' 2>/dev/null");
          for (const line of rpmOutput.split('\n')) {
            const parts = line.split('|');
            if (parts.length >= 2) {
              packages.push({
                name: parts[0],
                version: parts[1],
                description: parts[2] || '',
                installed: true,
              });
            }
          }
          break;
        case 'arch':
          const pacmanOutput = this.exec("pacman -Q --query '%n|%v|%d\n' 2>/dev/null || pacman -Q 2>/dev/null");
          for (const line of pacmanOutput.split('\n')) {
            const parts = line.split(' ');
            if (parts.length >= 1) {
              packages.push({
                name: parts[0],
                version: parts[1] || '',
                description: '',
                installed: true,
              });
            }
          }
          break;
        case 'alpine':
          const apkOutput = this.exec('apk list --installed 2>/dev/null');
          for (const line of apkOutput.split('\n')) {
            const match = line.match(/^([^-]+)-(\d[\w.-]*)\s/);
            if (match) {
              packages.push({
                name: match[1],
                version: match[2],
                description: '',
                installed: true,
              });
            }
          }
          break;
        case 'unknown':
          if (this.getPlatform() === 'darwin') {
            const brewOutput = this.exec('brew list --versions 2>/dev/null');
            for (const line of brewOutput.split('\n')) {
              const parts = line.split(' ');
              if (parts.length >= 1) {
                packages.push({
                  name: parts[0],
                  version: parts[1] || '',
                  description: '',
                  installed: true,
                });
              }
            }
          }
          break;
      }

      return packages;
    } catch (error) {
      logger.warn(`Failed to list installed packages: ${error}`);
      return [];
    }
  }

  /**
   * Get detailed package information
   */
  getPackageInfo(name: string): PackageInfo | null {
    try {
      this.validatePackageName(name);
      const distro = this.detectDistro();

      switch (distro) {
        case 'ubuntu':
        case 'debian':
          const aptShow = this.exec(`apt-cache show ${name} 2>/dev/null || true`);
          if (!aptShow.trim()) return null;

          const info: PackageInfo = {
            name,
            version: '',
            description: '',
            installed: false,
          };

          for (const line of aptShow.split('\n')) {
            if (line.startsWith('Package: ')) info.name = line.substring(9);
            if (line.startsWith('Version: ')) info.version = line.substring(9);
            if (line.startsWith('Description: ')) info.description = line.substring(13);
            if (line.startsWith('Homepage: ')) info.homepage = line.substring(10);
            if (line.startsWith('Maintainer: ')) info.maintainer = line.substring(12);
            if (line.startsWith('Depends: ')) info.dependencies = line.substring(9).split(', ');
            if (line.startsWith('Size: ')) info.size = this.formatBytes(parseInt(line.substring(6), 10));
          }

          // Check if installed
          try {
            this.exec(`dpkg-query -W ${name} 2>/dev/null`);
            info.installed = true;
          } catch {
            info.installed = false;
          }

          return info;

        case 'centos':
        case 'rhel':
        case 'fedora':
          const rpmInfo = this.exec(`rpm -qi ${name} 2>/dev/null || true`);
          if (!rpmInfo.trim() || rpmInfo.includes('not installed')) {
            // Try to get info from repo
            const dnfInfo = this.exec(`dnf info ${name} 2>/dev/null || true`);
            if (!dnfInfo.trim()) return null;
            // Parse dnf info output
          }

          return {
            name,
            version: '',
            description: '',
            installed: !rpmInfo.includes('not installed'),
          };

        default:
          return { name, version: '', description: '', installed: false };
      }
    } catch (error) {
      logger.warn(`Failed to get package info for ${name}: ${error}`);
      return null;
    }
  }

  // ========================================================================
  // Service Management
  // ========================================================================

  /**
   * List all systemd services
   */
  listServices(): ServiceInfo[] {
    try {
      const initSystem = this.getInitSystem();

      if (initSystem !== 'systemd') {
        logger.warn(`Service management not fully supported for ${initSystem}`);
        return [];
      }

      const services: ServiceInfo[] = [];
      const output = this.exec('systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null');

      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4) {
          const name = parts[0].replace('.service', '');
          const status = this.parseServiceStatus(parts[3]);
          const loaded = parts[1] === 'loaded';

          services.push({
            name,
            description: parts.slice(4).join(' '),
            status,
            enabled: this.isServiceEnabled(name),
            loaded,
          });
        }
      }

      return services;
    } catch (error) {
      logger.warn(`Failed to list services: ${error}`);
      return [];
    }
  }

  /**
   * Start a service
   */
  startService(name: string): boolean {
    try {
      this.validateServiceName(name);

      if (this.getInitSystem() === 'systemd') {
        this.exec(`systemctl start ${name}`);
      } else if (this.getInitSystem() === 'launchd') {
        this.exec(`launchctl start ${name}`);
      } else {
        this.exec(`service ${name} start`);
      }

      logger.success(`Service started: ${name}`);
      return true;
    } catch (error) {
      logger.error(`Failed to start service ${name}: ${error}`);
      return false;
    }
  }

  /**
   * Stop a service
   */
  stopService(name: string): boolean {
    try {
      this.validateServiceName(name);

      if (this.getInitSystem() === 'systemd') {
        this.exec(`systemctl stop ${name}`);
      } else if (this.getInitSystem() === 'launchd') {
        this.exec(`launchctl stop ${name}`);
      } else {
        this.exec(`service ${name} stop`);
      }

      logger.success(`Service stopped: ${name}`);
      return true;
    } catch (error) {
      logger.error(`Failed to stop service ${name}: ${error}`);
      return false;
    }
  }

  /**
   * Restart a service
   */
  restartService(name: string): boolean {
    try {
      this.validateServiceName(name);

      if (this.getInitSystem() === 'systemd') {
        this.exec(`systemctl restart ${name}`);
      } else if (this.getInitSystem() === 'launchd') {
        this.exec(`launchctl stop ${name} && launchctl start ${name}`);
      } else {
        this.exec(`service ${name} restart`);
      }

      logger.success(`Service restarted: ${name}`);
      return true;
    } catch (error) {
      logger.error(`Failed to restart service ${name}: ${error}`);
      return false;
    }
  }

  /**
   * Enable service on boot
   */
  enableService(name: string): boolean {
    try {
      this.validateServiceName(name);

      if (this.getInitSystem() === 'systemd') {
        this.exec(`systemctl enable ${name}`);
      } else if (this.getInitSystem() === 'launchd') {
        this.exec(`launchctl enable ${name}`);
      } else {
        // SysV init
        this.exec(`update-rc.d ${name} defaults`);
      }

      logger.success(`Service enabled: ${name}`);
      return true;
    } catch (error) {
      logger.error(`Failed to enable service ${name}: ${error}`);
      return false;
    }
  }

  /**
   * Disable service on boot
   */
  disableService(name: string): boolean {
    try {
      this.validateServiceName(name);

      if (this.getInitSystem() === 'systemd') {
        this.exec(`systemctl disable ${name}`);
      } else if (this.getInitSystem() === 'launchd') {
        this.exec(`launchctl disable ${name}`);
      } else {
        // SysV init
        this.exec(`update-rc.d ${name} remove`);
      }

      logger.success(`Service disabled: ${name}`);
      return true;
    } catch (error) {
      logger.error(`Failed to disable service ${name}: ${error}`);
      return false;
    }
  }

  /**
   * Get detailed service status
   */
  getServiceStatus(name: string): ServiceInfo | null {
    try {
      this.validateServiceName(name);

      if (this.getInitSystem() === 'systemd') {
        const output = this.exec(`systemctl status ${name} --no-pager 2>/dev/null || true`);

        const info: ServiceInfo = {
          name,
          description: '',
          status: 'unknown',
          enabled: false,
          loaded: false,
        };

        for (const line of output.split('\n')) {
          if (line.includes('Loaded:')) {
            info.loaded = line.includes('loaded');
            info.enabled = line.includes('enabled');
          }
          if (line.includes('Active:')) {
            if (line.includes('active (running)')) info.status = 'running';
            else if (line.includes('inactive')) info.status = 'stopped';
            else if (line.includes('failed')) info.status = 'failed';
            else if (line.includes('activating')) info.status = 'activating';
            else if (line.includes('deactivating')) info.status = 'deactivating';
          }
          if (line.includes('Main PID:')) {
            const match = line.match(/Main PID:\s*(\d+)/);
            if (match) info.pid = parseInt(match[1], 10);
          }
        }

        return info;
      }

      return null;
    } catch (error) {
      logger.warn(`Failed to get service status for ${name}: ${error}`);
      return null;
    }
  }

  /**
   * Check if service is running
   */
  isServiceRunning(name: string): boolean {
    try {
      this.validateServiceName(name);

      if (this.getInitSystem() === 'systemd') {
        this.exec(`systemctl is-active --quiet ${name}`);
        return true;
      } else if (this.getInitSystem() === 'launchd') {
        const output = this.exec(`launchctl list ${name} 2>/dev/null || true`);
        return output.includes('"PID"');
      } else {
        const output = this.exec(`service ${name} status 2>/dev/null || true`);
        return output.toLowerCase().includes('running');
      }
    } catch {
      return false;
    }
  }

  // ========================================================================
  // User Management
  // ========================================================================

  /**
   * List system users
   */
  listUsers(): UserInfo[] {
    try {
      const users: UserInfo[] = [];
      const output = this.exec('getent passwd 2>/dev/null');

      for (const line of output.split('\n')) {
        const parts = line.split(':');
        if (parts.length >= 7) {
          const uid = parseInt(parts[2], 10);
          const gid = parseInt(parts[3], 10);

          users.push({
            username: parts[0],
            uid,
            gid,
            home: parts[5],
            shell: parts[6],
            groups: this.getUserGroups(parts[0]),
            isSystemUser: uid < 1000,
          });
        }
      }

      return users;
    } catch (error) {
      logger.warn(`Failed to list users: ${error}`);
      return [];
    }
  }

  /**
   * Create a new user
   */
  createUser(username: string, options: UserOptions = {}): boolean {
    try {
      this.validateUsername(username);

      const args: string[] = [];

      if (options.system) args.push('--system');
      if (options.uid) args.push(`--uid ${options.uid}`);
      if (options.gid) args.push(`--gid ${options.gid}`);
      if (options.home) args.push(`--home ${options.home}`);
      if (options.shell) args.push(`--shell ${options.shell}`);
      if (options.createHome !== false && !options.system) args.push('--create-home');
      if (options.comment) args.push(`--comment "${options.comment}"`);

      this.exec(`useradd ${args.join(' ')} ${username}`);

      // Set password if provided
      if (options.password) {
        this.setPassword(username, options.password);
      }

      // Add to groups
      if (options.groups) {
        for (const group of options.groups) {
          this.addToGroup(username, group);
        }
      }

      logger.success(`User created: ${username}`);
      return true;
    } catch (error) {
      logger.error(`Failed to create user ${username}: ${error}`);
      return false;
    }
  }

  /**
   * Delete a user
   */
  deleteUser(username: string, removeHome = false): boolean {
    try {
      this.validateUsername(username);

      const args = removeHome ? '-r' : '';
      this.exec(`userdel ${args} ${username}`);

      logger.success(`User deleted: ${username}`);
      return true;
    } catch (error) {
      logger.error(`Failed to delete user ${username}: ${error}`);
      return false;
    }
  }

  /**
   * Add user to group
   */
  addToGroup(username: string, group: string): boolean {
    try {
      this.validateUsername(username);
      this.validateGroupName(group);

      this.exec(`usermod -aG ${group} ${username}`);

      logger.success(`User ${username} added to group ${group}`);
      return true;
    } catch (error) {
      logger.error(`Failed to add ${username} to ${group}: ${error}`);
      return false;
    }
  }

  /**
   * Set user password
   */
  setPassword(username: string, password: string): boolean {
    try {
      this.validateUsername(username);

      // Use chpasswd for non-interactive password setting
      this.exec(`echo "${username}:${password}" | chpasswd`);

      logger.success(`Password set for user: ${username}`);
      return true;
    } catch (error) {
      logger.error(`Failed to set password for ${username}: ${error}`);
      return false;
    }
  }

  // ========================================================================
  // Network Configuration
  // ========================================================================

  /**
   * Get network configuration
   */
  getNetworkConfig(): NetworkConfig {
    try {
      const hostname = this.getHostname();
      const interfaces = this.getNetworkInterfaces();
      const dns = this.getDNSServers();
      const hosts = this.getHostsEntries();
      const routes = this.getRoutes();

      return {
        hostname,
        interfaces,
        dns,
        hosts,
        routes,
      };
    } catch (error) {
      logger.warn(`Failed to get network config: ${error}`);
      return {
        hostname: '',
        interfaces: [],
        dns: [],
        hosts: [],
        routes: [],
      };
    }
  }

  /**
   * Set system hostname
   */
  setHostname(name: string): boolean {
    try {
      this.validateHostname(name);

      if (this.getInitSystem() === 'systemd') {
        this.exec(`hostnamectl set-hostname ${name}`);
      } else {
        this.exec(`hostname ${name}`);

        // Update /etc/hostname
        writeFileSync('/etc/hostname', name);

        // Update /etc/hosts
        const hostsContent = readFileSync('/etc/hosts', 'utf8');
        const lines = hostsContent.split('\n');
        const newLines = lines.map(line => {
          if (line.includes('127.0.1.1') || line.includes('127.0.0.1') && line.includes(this.getHostname())) {
            return line.replace(this.getHostname(), name);
          }
          return line;
        });
        writeFileSync('/etc/hosts', newLines.join('\n'));
      }

      logger.success(`Hostname set to: ${name}`);
      return true;
    } catch (error) {
      logger.error(`Failed to set hostname: ${error}`);
      return false;
    }
  }

  /**
   * Configure network interface
   */
  configureInterface(name: string, config: Partial<NetworkInterface>): boolean {
    try {
      const distro = this.detectDistro();

      if (distro === 'ubuntu' || distro === 'debian') {
        // Netplan (Ubuntu 18.04+)
        if (existsSync('/etc/netplan')) {
          const netplanConfig = this.generateNetplanConfig(name, config);
          writeFileSync(`/etc/netplan/99-hestia-${name}.yaml`, netplanConfig);
          this.exec('netplan apply');
        } else {
          // /etc/network/interfaces
          const ifaceConfig = this.generateInterfacesConfig(name, config);
          writeFileSync('/etc/network/interfaces.d/hestia', ifaceConfig);
          this.exec('ifup ' + name);
        }
      } else if (distro === 'centos' || distro === 'rhel' || distro === 'fedora') {
        // NetworkManager or /etc/sysconfig/network-scripts
        const nmConfig = this.generateNMConfig(name, config);
        writeFileSync(`/etc/sysconfig/network-scripts/ifcfg-${name}`, nmConfig);
        this.exec(`ifup ${name}`);
      } else if (this.getPlatform() === 'darwin') {
        // macOS networksetup
        if (config.ipAddresses && config.ipAddresses.length > 0) {
          const ip = config.ipAddresses[0];
          this.exec(`networksetup -setmanual "${name}" ${ip.address} 255.255.255.0 ${ip.gateway || ''}`);
        }
      }

      logger.success(`Interface ${name} configured`);
      return true;
    } catch (error) {
      logger.error(`Failed to configure interface ${name}: ${error}`);
      return false;
    }
  }

  /**
   * Configure DNS servers
   */
  configureDNS(servers: string[]): boolean {
    try {
      // Validate DNS servers
      for (const server of servers) {
        if (!this.isValidIP(server)) {
          throw new Error(`Invalid DNS server IP: ${server}`);
        }
      }

      const distro = this.detectDistro();

      if (distro === 'ubuntu' || distro === 'debian') {
        // systemd-resolved
        if (existsSync('/etc/systemd/resolved.conf')) {
          let content = readFileSync('/etc/systemd/resolved.conf', 'utf8');
          const dnsLine = `DNS=${servers.join(' ')}`;

          if (content.includes('DNS=')) {
            content = content.replace(/DNS=.*/g, dnsLine);
          } else {
            content += `\n${dnsLine}\n`;
          }

          writeFileSync('/etc/systemd/resolved.conf', content);
          this.exec('systemctl restart systemd-resolved');
        } else {
          // /etc/resolv.conf
          const resolvConf = servers.map(s => `nameserver ${s}`).join('\n');
          writeFileSync('/etc/resolv.conf', resolvConf + '\n');
        }
      } else {
        // /etc/resolv.conf
        const resolvConf = servers.map(s => `nameserver ${s}`).join('\n');
        writeFileSync('/etc/resolv.conf', resolvConf + '\n');
      }

      logger.success('DNS servers configured');
      return true;
    } catch (error) {
      logger.error(`Failed to configure DNS: ${error}`);
      return false;
    }
  }

  /**
   * Configure /etc/hosts entries
   */
  configureHosts(entries: HostEntry[]): boolean {
    try {
      let content = '# Hestia managed hosts\n';

      for (const entry of entries) {
        if (!this.isValidIP(entry.ip)) {
          throw new Error(`Invalid IP address: ${entry.ip}`);
        }

        const hostnames = entry.hostnames.join(' ');
        const comment = entry.comment ? ` # ${entry.comment}` : '';
        content += `${entry.ip} ${hostnames}${comment}\n`;
      }

      // Preserve existing non-Hestia entries
      if (existsSync('/etc/hosts')) {
        const existing = readFileSync('/etc/hosts', 'utf8');
        const nonHestia = existing
          .split('\n')
          .filter(line => !line.includes('# Hestia managed hosts') && !line.trim().startsWith('#'))
          .join('\n');
        content += '\n# Original entries\n' + nonHestia;
      }

      writeFileSync('/etc/hosts', content);

      logger.success('/etc/hosts configured');
      return true;
    } catch (error) {
      logger.error(`Failed to configure hosts: ${error}`);
      return false;
    }
  }

  // ========================================================================
  // Firewall Management
  // ========================================================================

  /**
   * Get UFW firewall status
   */
  getFirewallStatus(): FirewallStatus {
    try {
      if (!this.commandExists('ufw')) {
        return {
          enabled: false,
          active: false,
          defaultIncoming: 'deny',
          defaultOutgoing: 'allow',
          rules: [],
        };
      }

      const output = this.exec('ufw status verbose 2>/dev/null || ufw status 2>/dev/null');
      const enabled = output.includes('Status: active');

      const rules: FirewallRule[] = [];
      let direction: 'in' | 'out' = 'in';

      for (const line of output.split('\n')) {
        // Parse rules
        const match = line.match(/^(\d+)\/(\w+)\s+(ALLOW|DENY|REJECT|LIMIT)\s+(.+)$/);
        if (match) {
          rules.push({
            port: parseInt(match[1], 10),
            protocol: match[2] as FirewallRule['protocol'],
            action: match[3].toLowerCase() as FirewallRule['action'],
            from: match[4].trim(),
            to: 'Anywhere',
            direction,
            enabled: true,
          });
        }

        // Parse default policies
        if (line.includes('Default:')) {
          // Extract default policies
        }
      }

      return {
        enabled,
        active: enabled,
        defaultIncoming: 'deny',
        defaultOutgoing: 'allow',
        rules,
      };
    } catch (error) {
      logger.warn(`Failed to get firewall status: ${error}`);
      return {
        enabled: false,
        active: false,
        defaultIncoming: 'deny',
        defaultOutgoing: 'allow',
        rules: [],
      };
    }
  }

  /**
   * Enable firewall
   */
  enableFirewall(): boolean {
    try {
      if (!this.commandExists('ufw')) {
        this.installPackage('ufw');
      }

      this.exec('ufw --force enable');

      logger.success('Firewall enabled');
      return true;
    } catch (error) {
      logger.error(`Failed to enable firewall: ${error}`);
      return false;
    }
  }

  /**
   * Disable firewall
   */
  disableFirewall(): boolean {
    try {
      if (this.commandExists('ufw')) {
        this.exec('ufw disable');
      }

      logger.success('Firewall disabled');
      return true;
    } catch (error) {
      logger.error(`Failed to disable firewall: ${error}`);
      return false;
    }
  }

  /**
   * Allow port through firewall
   */
  allowPort(port: number, protocol: 'tcp' | 'udp' | 'tcpudp' = 'tcp', from?: string): boolean {
    try {
      if (!this.commandExists('ufw')) {
        throw new Error('UFW not installed');
      }

      let cmd = `ufw allow ${port}/${protocol}`;
      if (from) {
        cmd += ` from ${from}`;
      }

      this.exec(cmd);

      logger.success(`Port ${port}/${protocol} allowed`);
      return true;
    } catch (error) {
      logger.error(`Failed to allow port ${port}: ${error}`);
      return false;
    }
  }

  /**
   * Deny port through firewall
   */
  denyPort(port: number, protocol: 'tcp' | 'udp' | 'tcpudp' = 'tcp'): boolean {
    try {
      if (!this.commandExists('ufw')) {
        throw new Error('UFW not installed');
      }

      this.exec(`ufw deny ${port}/${protocol}`);

      logger.success(`Port ${port}/${protocol} denied`);
      return true;
    } catch (error) {
      logger.error(`Failed to deny port ${port}: ${error}`);
      return false;
    }
  }

  /**
   * List firewall rules
   */
  listRules(): FirewallRule[] {
    return this.getFirewallStatus().rules;
  }

  // ========================================================================
  // Disk Management
  // ========================================================================

  /**
   * List all disks
   */
  listDisks(): DiskInfo[] {
    try {
      const disks: DiskInfo[] = [];
      const output = this.exec('lsblk -J -o NAME,SIZE,TYPE,MODEL,MOUNTPOINT,FSTYPE,ROTA 2>/dev/null');

      try {
        const data = JSON.parse(output);
        for (const device of data.blockdevices || []) {
          if (device.type === 'disk') {
            disks.push({
              device: `/dev/${device.name}`,
              model: device.model || 'Unknown',
              size: device.size,
              bytes: this.parseSize(device.size),
              type: this.getDiskType(device),
              partitions: this.getPartitions(device),
              mounted: !!device.mountpoint,
              mountPoint: device.mountpoint,
              filesystem: device.fstype,
            });
          }
        }
      } catch {
        // Fallback to lsblk without JSON
        const fallback = this.exec('lsblk -b -o NAME,SIZE,TYPE,MODEL,MOUNTPOINT,FSTYPE,ROTA -n 2>/dev/null');
        for (const line of fallback.split('\n')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3 && parts[2] === 'disk') {
            disks.push({
              device: `/dev/${parts[0]}`,
              model: parts[3] || 'Unknown',
              size: this.formatBytes(parseInt(parts[1], 10)),
              bytes: parseInt(parts[1], 10),
              type: parts[6] === '0' ? 'ssd' : 'hdd',
              partitions: [],
              mounted: !!parts[4],
              mountPoint: parts[4] || undefined,
              filesystem: parts[5] || undefined,
            });
          }
        }
      }

      return disks;
    } catch (error) {
      logger.warn(`Failed to list disks: ${error}`);
      return [];
    }
  }

  /**
   * Get detailed disk information
   */
  getDiskInfo(device: string): DiskInfo | null {
    try {
      // Validate device path
      if (!device.startsWith('/dev/')) {
        throw new Error('Invalid device path');
      }

      const disks = this.listDisks();
      const disk = disks.find(d => d.device === device);

      if (!disk) return null;

      // Get additional info using smartctl if available
      if (this.commandExists('smartctl')) {
        try {
          const smartOutput = this.exec(`smartctl -i ${device} 2>/dev/null || true`);
          if (smartOutput.includes('Serial Number')) {
            const serialMatch = smartOutput.match(/Serial Number:\s*(.+)/);
            if (serialMatch) disk.serial = serialMatch[1].trim();
          }
        } catch {
          // Ignore smartctl errors
        }
      }

      // Get usage info
      if (disk.mountPoint) {
        try {
          const dfOutput = this.exec(`df -B1 ${disk.mountPoint} 2>/dev/null | tail -1`);
          const parts = dfOutput.trim().split(/\s+/);
          if (parts.length >= 6) {
            disk.usage = {
              total: parseInt(parts[1], 10),
              used: parseInt(parts[2], 10),
              free: parseInt(parts[3], 10),
              percentUsed: parseInt(parts[4].replace('%', ''), 10),
            };
          }
        } catch {
          // Ignore df errors
        }
      }

      return disk;
    } catch (error) {
      logger.warn(`Failed to get disk info for ${device}: ${error}`);
      return null;
    }
  }

  /**
   * Format disk with filesystem
   */
  formatDisk(device: string, filesystem: 'ext4' | 'xfs' | 'btrfs' | 'ntfs' = 'ext4'): boolean {
    try {
      if (!device.startsWith('/dev/')) {
        throw new Error('Invalid device path');
      }

      // Safety check: ensure it's a real disk
      if (!existsSync(device)) {
        throw new Error(`Device ${device} does not exist`);
      }

      // Unmount if mounted
      this.exec(`umount ${device}* 2>/dev/null || true`);

      // Create partition table and partition
      this.exec(`parted -s ${device} mklabel gpt`);
      this.exec(`parted -s ${device} mkpart primary ${filesystem} 0% 100%`);

      // Format
      const partition = `${device}1`;
      switch (filesystem) {
        case 'ext4':
          this.exec(`mkfs.ext4 -F ${partition}`);
          break;
        case 'xfs':
          this.exec(`mkfs.xfs -f ${partition}`);
          break;
        case 'btrfs':
          this.exec(`mkfs.btrfs -f ${partition}`);
          break;
        case 'ntfs':
          this.exec(`mkfs.ntfs -f ${partition}`);
          break;
      }

      logger.success(`Disk ${device} formatted with ${filesystem}`);
      return true;
    } catch (error) {
      logger.error(`Failed to format disk ${device}: ${error}`);
      return false;
    }
  }

  /**
   * Mount disk
   */
  mount(device: string, path: string, options: string[] = []): boolean {
    try {
      if (!device.startsWith('/dev/')) {
        throw new Error('Invalid device path');
      }

      // Create mount point if needed
      if (!existsSync(path)) {
        this.exec(`mkdir -p ${path}`);
      }

      const opts = options.length > 0 ? `-o ${options.join(',')}` : '';
      this.exec(`mount ${opts} ${device} ${path}`);

      logger.success(`Mounted ${device} to ${path}`);
      return true;
    } catch (error) {
      logger.error(`Failed to mount ${device}: ${error}`);
      return false;
    }
  }

  /**
   * Unmount disk
   */
  unmount(path: string): boolean {
    try {
      this.exec(`umount ${path}`);

      logger.success(`Unmounted ${path}`);
      return true;
    } catch (error) {
      logger.error(`Failed to unmount ${path}: ${error}`);
      return false;
    }
  }

  /**
   * Resize filesystem
   */
  resizeFilesystem(device: string): boolean {
    try {
      if (!device.startsWith('/dev/')) {
        throw new Error('Invalid device path');
      }

      // First resize partition
      this.exec(`parted ${device} resizepart 1 100%`);

      // Then resize filesystem
      const partition = `${device}1`;
      this.exec(`resize2fs ${partition}`);

      logger.success(`Filesystem on ${device} resized`);
      return true;
    } catch (error) {
      logger.error(`Failed to resize filesystem on ${device}: ${error}`);
      return false;
    }
  }

  /**
   * Create partition
   */
  createPartition(device: string, type: string, size?: string): boolean {
    try {
      if (!device.startsWith('/dev/')) {
        throw new Error('Invalid device path');
      }

      const end = size || '100%';
      this.exec(`parted -s ${device} mkpart ${type} 0% ${end}`);

      logger.success(`Partition created on ${device}`);
      return true;
    } catch (error) {
      logger.error(`Failed to create partition on ${device}: ${error}`);
      return false;
    }
  }

  // ========================================================================
  // System Configuration
  // ========================================================================

  /**
   * Set sysctl kernel parameter
   */
  setSysctl(key: string, value: string, persistent = true): boolean {
    try {
      // Validate key format
      if (!/^[\w\.]+$/.test(key)) {
        throw new Error('Invalid sysctl key format');
      }

      // Set immediately
      this.exec(`sysctl -w ${key}=${value}`);

      // Make persistent
      if (persistent) {
        const sysctlFile = '/etc/sysctl.d/99-hestia.conf';
        let content = '';

        if (existsSync(sysctlFile)) {
          content = readFileSync(sysctlFile, 'utf8');
          // Remove existing entry
          const lines = content.split('\n');
          const newLines = lines.filter(line => !line.startsWith(`${key}=`));
          content = newLines.join('\n');
        }

        content += `${key}=${value}\n`;
        writeFileSync(sysctlFile, content);

        // Reload sysctl
        this.exec('sysctl -p /etc/sysctl.d/99-hestia.conf');
      }

      logger.success(`Sysctl ${key} set to ${value}`);
      return true;
    } catch (error) {
      logger.error(`Failed to set sysctl ${key}: ${error}`);
      return false;
    }
  }

  /**
   * Get sysctl kernel parameter
   */
  getSysctl(key: string): string | null {
    try {
      return this.exec(`sysctl -n ${key} 2>/dev/null`).trim();
    } catch {
      return null;
    }
  }

  /**
   * Apply resource limits
   */
  applyLimits(): boolean {
    try {
      // Create limits.d entry
      const limitsConfig = `# Hestia resource limits
* soft nofile 65536
* hard nofile 65536
* soft nproc 32768
* hard nproc 32768
root soft nofile 65536
root hard nofile 65536
`;

      writeFileSync('/etc/security/limits.d/99-hestia.conf', limitsConfig);

      logger.success('Resource limits applied');
      return true;
    } catch (error) {
      logger.error(`Failed to apply limits: ${error}`);
      return false;
    }
  }

  /**
   * Configure system logging
   */
  configureLogging(): boolean {
    try {
      if (this.commandExists('journalctl')) {
        // Configure systemd journal
        const journalConfig = `[Journal]
Storage=persistent
SystemMaxUse=500M
SystemMaxFileSize=100M
MaxRetentionSec=1week
`;

        writeFileSync('/etc/systemd/journald.conf.d/99-hestia.conf', journalConfig);
        this.exec('systemctl restart systemd-journald');
      }

      // Configure logrotate for Hestia logs
      const logrotateConfig = `/var/log/hestia/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
    sharedscripts
    postrotate
        systemctl reload rsyslog > /dev/null 2>&1 || true
    endscript
}`;

      writeFileSync('/etc/logrotate.d/hestia', logrotateConfig);

      logger.success('Logging configured');
      return true;
    } catch (error) {
      logger.error(`Failed to configure logging: ${error}`);
      return false;
    }
  }

  /**
   * Configure NTP/time sync
   */
  configureTime(): boolean {
    try {
      const distro = this.detectDistro();

      if (distro === 'ubuntu' || distro === 'debian') {
        // Use systemd-timesyncd or chrony
        if (this.commandExists('timedatectl')) {
          // Set NTP
          this.exec('timedatectl set-ntp true');

          // Configure timesyncd
          const timesyncdConfig = `[Time]
NTP=0.pool.ntp.org 1.pool.ntp.org 2.pool.ntp.org 3.pool.ntp.org
FallbackNTP=ntp.ubuntu.com
`;
          writeFileSync('/etc/systemd/timesyncd.conf.d/99-hestia.conf', timesyncdConfig);
          this.exec('systemctl restart systemd-timesyncd');
        }
      } else if (distro === 'centos' || distro === 'rhel' || distro === 'fedora') {
        // Use chronyd
        this.installPackage('chrony');
        this.exec('systemctl enable --now chronyd');
      }

      logger.success('Time sync configured');
      return true;
    } catch (error) {
      logger.error(`Failed to configure time sync: ${error}`);
      return false;
    }
  }

  // ========================================================================
  // Features
  // ========================================================================

  /**
   * Detect Linux distribution
   */
  detectDistro(): LinuxDistribution {
    if (this.cachedDistro) return this.cachedDistro;

    try {
      if (this.getPlatform() === 'darwin') {
        this.cachedDistro = 'unknown';
        return 'unknown';
      }

      // Check /etc/os-release
      if (existsSync('/etc/os-release')) {
        const content = readFileSync('/etc/os-release', 'utf8');
        const id = content.match(/^ID=(.+)$/m)?.[1]?.replace(/"/g, '');
        const idLike = content.match(/^ID_LIKE=(.+)$/m)?.[1]?.replace(/"/g, '');

        if (id === 'ubuntu') {
          this.cachedDistro = 'ubuntu';
        } else if (id === 'debian') {
          this.cachedDistro = 'debian';
        } else if (id === 'centos' || id === 'rhel' || id === 'rocky' || id === 'almalinux') {
          this.cachedDistro = id === 'centos' ? 'centos' : 'rhel';
        } else if (id === 'fedora') {
          this.cachedDistro = 'fedora';
        } else if (id === 'arch' || idLike?.includes('arch')) {
          this.cachedDistro = 'arch';
        } else if (id === 'alpine') {
          this.cachedDistro = 'alpine';
        } else if (idLike?.includes('debian') || idLike?.includes('ubuntu')) {
          this.cachedDistro = 'debian';
        } else if (idLike?.includes('rhel') || idLike?.includes('fedora')) {
          this.cachedDistro = 'rhel';
        } else {
          this.cachedDistro = 'unknown';
        }
      } else if (existsSync('/etc/redhat-release')) {
        this.cachedDistro = 'rhel';
      } else if (existsSync('/etc/debian_version')) {
        this.cachedDistro = 'debian';
      } else if (existsSync('/etc/arch-release')) {
        this.cachedDistro = 'arch';
      } else if (existsSync('/etc/alpine-release')) {
        this.cachedDistro = 'alpine';
      } else {
        this.cachedDistro = 'unknown';
      }

      return this.cachedDistro;
    } catch {
      this.cachedDistro = 'unknown';
      return 'unknown';
    }
  }

  /**
   * Check if OS is supported
   */
  isSupported(): boolean {
    const distro = this.detectDistro();
    const supportedDistros: LinuxDistribution[] = ['ubuntu', 'debian', 'centos', 'rhel', 'fedora', 'arch', 'alpine'];

    return supportedDistros.includes(distro) || this.getPlatform() === 'darwin';
  }

  /**
   * Get OS tuning recommendations
   */
  getRecommendations(): OSRecommendation[] {
    const recommendations: OSRecommendation[] = [];

    try {
      // Check kernel swappiness
      const swappiness = this.getSysctl('vm.swappiness');
      if (swappiness && parseInt(swappiness, 10) > 10) {
        recommendations.push({
          category: 'performance',
          severity: 'warning',
          title: 'High swappiness value',
          description: 'Current swappiness is too high for a server workload',
          currentValue: swappiness,
          recommendedValue: '10',
          command: 'sysctl -w vm.swappiness=10',
        });
      }

      // Check file descriptor limits
      const maxFiles = this.getSysctl('fs.file-max');
      if (maxFiles && parseInt(maxFiles, 10) < 100000) {
        recommendations.push({
          category: 'performance',
          severity: 'warning',
          title: 'Low file descriptor limit',
          description: 'File descriptor limit may be too low for high-concurrency workloads',
          currentValue: maxFiles,
          recommendedValue: '2097152',
          command: 'sysctl -w fs.file-max=2097152',
        });
      }

      // Check if firewall is enabled
      const fwStatus = this.getFirewallStatus();
      if (!fwStatus.enabled) {
        recommendations.push({
          category: 'security',
          severity: 'critical',
          title: 'Firewall not enabled',
          description: 'UFW firewall is not active on this system',
          command: 'ufw --force enable',
        });
      }

      // Check for automatic updates
      if (existsSync('/etc/apt/apt.conf.d/20auto-upgrades')) {
        const content = readFileSync('/etc/apt/apt.conf.d/20auto-upgrades', 'utf8');
        if (!content.includes('APT::Periodic::Unattended-Upgrade "1"')) {
          recommendations.push({
            category: 'security',
            severity: 'warning',
            title: 'Automatic updates not configured',
            description: 'Security updates may not be applied automatically',
          });
        }
      }

      // Check time sync
      if (this.commandExists('timedatectl')) {
        const output = this.exec('timedatectl status');
        if (!output.includes('NTP enabled: yes')) {
          recommendations.push({
            category: 'stability',
            severity: 'warning',
            title: 'NTP not enabled',
            description: 'System time may drift without NTP synchronization',
            command: 'timedatectl set-ntp true',
          });
        }
      }

      // Check disk space
      const disks = this.listDisks();
      for (const disk of disks) {
        if (disk.usage && disk.usage.percentUsed > 90) {
          recommendations.push({
            category: 'storage',
            severity: 'critical',
            title: `Disk ${disk.device} nearly full`,
            description: `Disk usage is at ${disk.usage.percentUsed}%`,
            currentValue: `${disk.usage.percentUsed}%`,
            recommendedValue: '< 80%',
          });
        }
      }

      return recommendations;
    } catch (error) {
      logger.warn(`Failed to generate recommendations: ${error}`);
      return recommendations;
    }
  }

  /**
   * Generate OS configuration report
   */
  generateReport(): OSReport {
    return {
      timestamp: new Date(),
      os: this.getOSInfo(),
      kernel: this.getKernelInfo(),
      boot: this.getBootInfo(),
      network: this.getNetworkConfig(),
      services: this.listServices().slice(0, 50), // Limit to first 50
      diskUsage: this.listDisks(),
      timezone: this.getTimezone(),
      locale: this.getLocale(),
      recommendations: this.getRecommendations(),
    };
  }

  /**
   * Backup system configuration
   */
  backupConfig(path: string): boolean {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = `${path}/os-backup-${timestamp}`;

      this.exec(`mkdir -p ${backupDir}`);

      // Backup network config
      this.exec(`cp -r /etc/network ${backupDir}/ 2>/dev/null || true`);
      this.exec(`cp -r /etc/netplan ${backupDir}/ 2>/dev/null || true`);
      this.exec(`cp /etc/resolv.conf ${backupDir}/ 2>/dev/null || true`);
      this.exec(`cp /etc/hosts ${backupDir}/ 2>/dev/null || true`);
      this.exec(`cp /etc/hostname ${backupDir}/ 2>/dev/null || true`);

      // Backup sysctl
      this.exec(`cp -r /etc/sysctl.d ${backupDir}/ 2>/dev/null || true`);
      this.exec(`cp /etc/sysctl.conf ${backupDir}/ 2>/dev/null || true`);

      // Backup limits
      this.exec(`cp -r /etc/security ${backupDir}/ 2>/dev/null || true`);

      // Backup UFW
      this.exec(`cp -r /etc/ufw ${backupDir}/ 2>/dev/null || true`);

      // Backup package list
      const packages = this.listInstalled().map(p => `${p.name}=${p.version}`).join('\n');
      writeFileSync(`${backupDir}/packages.txt`, packages);

      // Create metadata
      const metadata: BackupMetadata = {
        timestamp: new Date(),
        hostname: this.getHostname(),
        distribution: this.detectDistro(),
        version: this.getOSVersion(),
        components: ['network', 'sysctl', 'limits', 'ufw', 'packages'],
        size: 0,
      };

      writeFileSync(`${backupDir}/metadata.json`, JSON.stringify(metadata, null, 2));

      // Create tarball
      this.exec(`tar -czf ${path}/os-backup-${timestamp}.tar.gz -C ${path} os-backup-${timestamp}`);
      this.exec(`rm -rf ${backupDir}`);

      logger.success(`Configuration backed up to ${path}/os-backup-${timestamp}.tar.gz`);
      return true;
    } catch (error) {
      logger.error(`Failed to backup configuration: ${error}`);
      return false;
    }
  }

  /**
   * Restore system configuration
   */
  restoreConfig(backupPath: string): boolean {
    try {
      // Extract tarball
      const extractDir = '/tmp/hestia-restore';
      this.exec(`rm -rf ${extractDir} && mkdir -p ${extractDir}`);
      this.exec(`tar -xzf ${backupPath} -C ${extractDir}`);

      // Find backup directory
      const entries = this.exec(`ls ${extractDir}`).split('\n').filter(e => e.startsWith('os-backup-'));
      if (entries.length === 0) {
        throw new Error('Invalid backup archive');
      }

      const backupDir = `${extractDir}/${entries[0]}`;

      // Verify metadata
      if (!existsSync(`${backupDir}/metadata.json`)) {
        throw new Error('Backup metadata not found');
      }

      // Restore files
      this.exec(`cp -r ${backupDir}/network/* /etc/network/ 2>/dev/null || true`);
      this.exec(`cp -r ${backupDir}/netplan/* /etc/netplan/ 2>/dev/null || true`);
      this.exec(`cp ${backupDir}/resolv.conf /etc/resolv.conf 2>/dev/null || true`);
      this.exec(`cp ${backupDir}/hosts /etc/hosts 2>/dev/null || true`);
      this.exec(`cp ${backupDir}/hostname /etc/hostname 2>/dev/null || true`);
      this.exec(`cp -r ${backupDir}/sysctl.d/* /etc/sysctl.d/ 2>/dev/null || true`);
      this.exec(`cp -r ${backupDir}/security/* /etc/security/ 2>/dev/null || true`);
      this.exec(`cp -r ${backupDir}/ufw/* /etc/ufw/ 2>/dev/null || true`);

      // Apply sysctl
      this.exec('sysctl -p /etc/sysctl.d/*.conf 2>/dev/null || true');

      // Cleanup
      this.exec(`rm -rf ${extractDir}`);

      logger.success('Configuration restored');
      return true;
    } catch (error) {
      logger.error(`Failed to restore configuration: ${error}`);
      return false;
    }
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  private getPlatform(): OSPlatform {
    const platform = process.platform;
    if (platform === 'linux') return 'linux';
    if (platform === 'darwin') return 'darwin';
    if (platform === 'win32') return 'win32';
    return 'unknown';
  }

  private getKernelVersion(): string {
    try {
      return this.exec('uname -r').trim();
    } catch {
      return 'unknown';
    }
  }

  private getKernelBuildDate(): string {
    try {
      const output = this.exec('uname -v');
      return output.trim();
    } catch {
      return 'unknown';
    }
  }

  private getArchitecture(): string {
    try {
      return this.exec('uname -m').trim();
    } catch {
      return 'unknown';
    }
  }

  private getHostname(): string {
    try {
      return this.exec('hostname').trim();
    } catch {
      return 'unknown';
    }
  }

  private getUptime(): number {
    try {
      const output = this.exec('cat /proc/uptime 2>/dev/null || uptime');
      const match = output.match(/^(\d+)/);
      if (match) return parseInt(match[1], 10);
      return 0;
    } catch {
      return 0;
    }
  }

  private getOSVersion(): string {
    if (this.cachedVersion) return this.cachedVersion;

    try {
      if (existsSync('/etc/os-release')) {
        const content = readFileSync('/etc/os-release', 'utf8');
        const version = content.match(/^VERSION_ID="?([^"]+)"?/m)?.[1];
        if (version) {
          this.cachedVersion = version;
          return version;
        }
      }

      // Fallback
      this.cachedVersion = 'unknown';
      return 'unknown';
    } catch {
      this.cachedVersion = 'unknown';
      return 'unknown';
    }
  }

  private getCodename(): string {
    try {
      if (existsSync('/etc/os-release')) {
        const content = readFileSync('/etc/os-release', 'utf8');
        const codename = content.match(/^VERSION_CODENAME="?([^"]+)"?/m)?.[1];
        if (codename) return codename;

        const version = content.match(/^VERSION="?([^"]+)"?/m)?.[1];
        if (version) {
          const match = version.match(/\(([^)]+)\)/);
          if (match) return match[1];
        }
      }

      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private getBootTime(): Date {
    try {
      const output = this.exec('cat /proc/stat | grep btime');
      const match = output.match(/btime\s+(\d+)/);
      if (match) {
        return new Date(parseInt(match[1], 10) * 1000);
      }
      return new Date();
    } catch {
      return new Date();
    }
  }

  private getBootLoader(): string {
    try {
      if (existsSync('/boot/grub/grub.cfg')) {
        return 'grub2';
      }
      if (existsSync('/boot/grub/menu.lst')) {
        return 'grub-legacy';
      }
      if (existsSync('/sys/firmware/efi')) {
        return 'systemd-boot/EFI';
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private getBootArgs(): string[] {
    try {
      const output = this.exec('cat /proc/cmdline');
      return output.trim().split(' ');
    } catch {
      return [];
    }
  }

  private getKernelParameters(): Record<string, string> {
    try {
      const args = this.getBootArgs();
      const params: Record<string, string> = {};

      for (const arg of args) {
        if (arg.includes('=')) {
          const [key, value] = arg.split('=', 2);
          params[key] = value;
        }
      }

      return params;
    } catch {
      return {};
    }
  }

  private getInitSystem(): BootInfo['initSystem'] {
    if (this.cachedInitSystem) return this.cachedInitSystem;

    try {
      if (this.getPlatform() === 'darwin') {
        this.cachedInitSystem = 'launchd';
        return 'launchd';
      }

      if (existsSync('/run/systemd/system')) {
        this.cachedInitSystem = 'systemd';
        return 'systemd';
      }

      if (existsSync('/etc/init.d')) {
        this.cachedInitSystem = 'sysvinit';
        return 'sysvinit';
      }

      if (this.commandExists('rc-service')) {
        this.cachedInitSystem = 'openrc';
        return 'openrc';
      }

      this.cachedInitSystem = 'unknown';
      return 'unknown';
    } catch {
      this.cachedInitSystem = 'unknown';
      return 'unknown';
    }
  }

  private getLoadedModules(): KernelModule[] {
    try {
      const modules: KernelModule[] = [];
      const output = this.exec('lsmod 2>/dev/null || true');

      // Skip header line
      const lines = output.split('\n').slice(1);

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          modules.push({
            name: parts[0],
            size: parts[1],
            usedBy: parts[2] !== '-' ? parts[2].split(',') : [],
            status: 'loaded',
          });
        }
      }

      return modules;
    } catch {
      return [];
    }
  }

  private getNetworkInterfaces(): NetworkInterface[] {
    const interfaces: NetworkInterface[] = [];

    try {
      if (this.commandExists('ip')) {
        const output = this.exec('ip -j addr show 2>/dev/null || ip addr show');

        try {
          const data = JSON.parse(output);
          for (const iface of data) {
            const ipAddresses: IPAddress[] = [];

            for (const addr of iface.addr_info || []) {
              ipAddresses.push({
                address: addr.local,
                family: addr.family === 'inet' ? 'IPv4' : 'IPv6',
                prefix: addr.prefixlen,
              });
            }

            interfaces.push({
              name: iface.ifname,
              type: this.getInterfaceType(iface.ifname),
              ipAddresses,
              macAddress: iface.address || '',
              state: iface.operstate?.toLowerCase() || 'unknown',
              mtu: iface.mtu || 1500,
              rxBytes: 0,
              txBytes: 0,
            });
          }
        } catch {
          // Fallback to parsing text output
        }
      }
    } catch (error) {
      logger.warn(`Failed to get network interfaces: ${error}`);
    }

    return interfaces;
  }

  private getInterfaceType(name: string): NetworkInterface['type'] {
    if (name.startsWith('lo')) return 'loopback';
    if (name.startsWith('eth') || name.startsWith('en')) return 'ethernet';
    if (name.startsWith('wl') || name.startsWith('wifi')) return 'wifi';
    if (name.startsWith('br')) return 'bridge';
    if (name.startsWith('vlan') || name.includes('.')) return 'vlan';
    return 'unknown';
  }

  private getDNSServers(): DNSServer[] {
    const servers: DNSServer[] = [];

    try {
      if (existsSync('/etc/resolv.conf')) {
        const content = readFileSync('/etc/resolv.conf', 'utf8');
        let priority = 1;

        for (const line of content.split('\n')) {
          if (line.startsWith('nameserver')) {
            const parts = line.split(/\s+/);
            if (parts.length >= 2) {
              servers.push({
                address: parts[1],
                priority: priority++,
              });
            }
          }
        }
      }
    } catch (error) {
      logger.warn(`Failed to get DNS servers: ${error}`);
    }

    return servers;
  }

  private getHostsEntries(): HostEntry[] {
    const entries: HostEntry[] = [];

    try {
      if (existsSync('/etc/hosts')) {
        const content = readFileSync('/etc/hosts', 'utf8');

        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;

          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2) {
            const ip = parts[0];
            const hostnames = parts.slice(1).filter(h => !h.startsWith('#'));
            const commentMatch = line.match(/#\s*(.+)$/);

            entries.push({
              ip,
              hostnames,
              comment: commentMatch ? commentMatch[1] : undefined,
            });
          }
        }
      }
    } catch (error) {
      logger.warn(`Failed to get hosts entries: ${error}`);
    }

    return entries;
  }

  private getRoutes(): Route[] {
    const routes: Route[] = [];

    try {
      if (this.commandExists('ip')) {
        const output = this.exec('ip -j route show 2>/dev/null || ip route show');

        try {
          const data = JSON.parse(output);
          for (const route of data) {
            routes.push({
              destination: route.dst || 'default',
              gateway: route.gateway || '',
              interface: route.dev || '',
              metric: route.metric || 0,
            });
          }
        } catch {
          // Fallback to text parsing
        }
      }
    } catch (error) {
      logger.warn(`Failed to get routes: ${error}`);
    }

    return routes;
  }

  private getPartitions(device: unknown): PartitionInfo[] {
    const partitions: PartitionInfo[] = [];

    try {
      if (typeof device === 'object' && device && 'children' in device) {
        const children = (device as { children?: unknown[] }).children;
        if (Array.isArray(children)) {
          for (const child of children) {
            const c = child as { name: string; size: string; type: string; mountpoint?: string; fstype?: string };
            partitions.push({
              device: `/dev/${c.name}`,
              start: '',
              end: '',
              size: c.size,
              type: c.type,
              filesystem: c.fstype,
              mountPoint: c.mountpoint || undefined,
              flags: [],
            });
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return partitions;
  }

  private getDiskType(device: unknown): DiskInfo['type'] {
    try {
      if (typeof device === 'object' && device && 'rota' in device) {
        const rota = (device as { rota?: boolean }).rota;
        if (rota === false) return 'ssd';
        if (rota === true) return 'hdd';
      }

      if (typeof device === 'object' && device && 'name' in device) {
        const name = (device as { name: string }).name;
        if (name.startsWith('nvme')) return 'nvme';
        if (name.startsWith('loop')) return 'loop';
      }
    } catch {
      // Ignore errors
    }

    return 'unknown';
  }

  private getUserGroups(username: string): string[] {
    try {
      const output = this.exec(`groups ${username} 2>/dev/null || true`);
      const match = output.match(new RegExp(`${username}\s*:\s*(.+)`));
      if (match) {
        return match[1].trim().split(/\s+/);
      }
      return [];
    } catch {
      return [];
    }
  }

  private isServiceEnabled(name: string): boolean {
    try {
      this.exec(`systemctl is-enabled --quiet ${name} 2>/dev/null`);
      return true;
    } catch {
      return false;
    }
  }

  private parseServiceStatus(status: string): ServiceInfo['status'] {
    switch (status) {
      case 'active':
        return 'running';
      case 'inactive':
        return 'stopped';
      case 'failed':
        return 'failed';
      case 'activating':
        return 'activating';
      case 'deactivating':
        return 'deactivating';
      default:
        return 'unknown';
    }
  }

  private generateNetplanConfig(name: string, config: Partial<NetworkInterface>): string {
    const addresses = config.ipAddresses?.map(ip => `${ip.address}/${ip.prefix}`) || [];
    const gateway = config.ipAddresses?.[0]?.gateway;

    let yaml = `network:\n  version: 2\n  ethernets:\n    ${name}:\n`;

    if (addresses.length > 0) {
      yaml += `      addresses:\n`;
      for (const addr of addresses) {
        yaml += `        - ${addr}\n`;
      }
    }

    if (gateway) {
      yaml += `      gateway4: ${gateway}\n`;
    }

    yaml += `      nameservers:\n        addresses: [8.8.8.8, 8.8.4.4]\n`;

    return yaml;
  }

  private generateInterfacesConfig(name: string, config: Partial<NetworkInterface>): string {
    const ip = config.ipAddresses?.[0];

    let content = `auto ${name}\n`;
    content += `iface ${name} inet static\n`;

    if (ip) {
      content += `  address ${ip.address}\n`;
      content += `  netmask 255.255.255.0\n`;
      if (ip.gateway) {
        content += `  gateway ${ip.gateway}\n`;
      }
    }

    return content;
  }

  private generateNMConfig(name: string, config: Partial<NetworkInterface>): string {
    const ip = config.ipAddresses?.[0];

    let content = `TYPE=Ethernet\n`;
    content += `BOOTPROTO=static\n`;
    content += `NAME=${name}\n`;
    content += `DEVICE=${name}\n`;
    content += `ONBOOT=yes\n`;

    if (ip) {
      content += `IPADDR=${ip.address}\n`;
      content += `PREFIX=${ip.prefix || 24}\n`;
      if (ip.gateway) {
        content += `GATEWAY=${ip.gateway}\n`;
      }
    }

    content += `DNS1=8.8.8.8\n`;
    content += `DNS2=8.8.4.4\n`;

    return content;
  }

  // ========================================================================
  // Validation Methods
  // ========================================================================

  private validatePackageName(name: string): void {
    if (!/^[\w\-\.+]+$/.test(name)) {
      throw new Error(`Invalid package name: ${name}`);
    }
  }

  private validateServiceName(name: string): void {
    if (!/^[\w\-\.]+$/.test(name)) {
      throw new Error(`Invalid service name: ${name}`);
    }
  }

  private validateUsername(username: string): void {
    if (!/^[a-z_][a-z0-9_-]*[$]?$/.test(username)) {
      throw new Error(`Invalid username: ${username}`);
    }
  }

  private validateGroupName(group: string): void {
    if (!/^[a-z_][a-z0-9_-]*$/.test(group)) {
      throw new Error(`Invalid group name: ${group}`);
    }
  }

  private validateHostname(hostname: string): void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9\-]{0,63}$/.test(hostname)) {
      throw new Error(`Invalid hostname: ${hostname}`);
    }
  }

  private isValidIP(ip: string): boolean {
    // Basic IP validation
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F:]+)$/;
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  }

  // ========================================================================
  // Utility Methods
  // ========================================================================

  private exec(command: string): string {
    try {
      return execSync(command, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      }).toString();
    } catch (error) {
      if (error instanceof Error && 'stderr' in error) {
        throw new Error(`Command failed: ${command}\n${error.stderr}`);
      }
      throw error;
    }
  }

  private commandExists(command: string): boolean {
    try {
      execSync(`which ${command}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private parseSize(sizeStr: string): number {
    const units: Record<string, number> = {
      B: 1,
      K: 1024,
      M: 1024 ** 2,
      G: 1024 ** 3,
      T: 1024 ** 4,
    };

    const match = sizeStr.match(/^([\d.]+)([BKMGTP])/);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[2];
      return Math.floor(value * (units[unit] || 1));
    }

    return 0;
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'K', 'M', 'G', 'T', 'P'];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    return `${value.toFixed(1)}${units[unitIndex]}`;
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export const osManager = new OSManager();
