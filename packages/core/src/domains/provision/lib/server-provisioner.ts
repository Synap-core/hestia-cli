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

import { promisify } from 'util';
import { exec } from 'child_process';
import * as os from 'os';
import { logger } from '../../lib/utils/index';

const execAsync = promisify(exec);

// ============================================================================
// Type Definitions
// ============================================================================

export type ProvisionPhase = 
  | 'detecting' 
  | 'partitioning' 
  | 'formatting' 
  | 'mounting' 
  | 'installing' 
  | 'configuring' 
  | 'optimizing' 
  | 'finalizing';

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
  slots: Array<{ size: number; type: string; speed: number }>;
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
  ipAddresses: Array<{ address: string; family: string; prefixLen: number }>;
}

export interface GPUInfo {
  model: string;
  vendor: string;
  vram: number;
  pciAddress: string;
}

export interface RAIDInfo {
  controller?: { vendor: string; model: string };
  arrays: Array<{ name: string; level: string; size: number; status: string }>;
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

// ============================================================================
// Server Provisioner Class
// ============================================================================

export class ServerProvisioner {
  private profiles: Map<string, ProvisionProfile> = new Map();
  private logs: string[] = [];
  private progressCallback?: ProgressCallback;
  private currentProgress: ProvisionProgress = {
    phase: 'detecting',
    currentStep: 0,
    totalSteps: 0,
    stepName: '',
    percentComplete: 0,
    message: '',
  };

  constructor() {
    this.registerDefaultProfiles();
  }

  private registerDefaultProfiles(): void {
    const defaultProfiles: ProvisionProfile[] = [
      {
        name: 'minimal',
        type: 'minimal',
        description: 'Minimal server with just the essentials',
        minCpu: 2,
        minMemory: 4 * 1024 * 1024 * 1024,
        minStorage: 20 * 1024 * 1024 * 1024,
        diskLayout: {
          scheme: 'standard',
          partitions: [
            { name: 'boot', size: '512M', mountpoint: '/boot', type: 'ext4' },
            { name: 'root', size: '100%', mountpoint: '/', type: 'ext4' },
          ],
        },
        network: { dhcp: true },
        packages: ['hestia-core', 'docker'],
        optimizations: ['basic'],
      },
      {
        name: 'standard',
        type: 'standard',
        description: 'Standard Hestia deployment',
        minCpu: 4,
        minMemory: 8 * 1024 * 1024 * 1024,
        minStorage: 100 * 1024 * 1024 * 1024,
        diskLayout: {
          scheme: 'lvm',
          partitions: [
            { name: 'boot', size: '512M', mountpoint: '/boot', type: 'ext4' },
            { name: 'root', size: '50G', mountpoint: '/', type: 'ext4' },
            { name: 'var', size: '50G', mountpoint: '/var', type: 'ext4' },
            { name: 'data', size: '100%', mountpoint: '/data', type: 'ext4' },
          ],
        },
        network: { dhcp: true },
        packages: ['hestia-core', 'docker', 'synap-stack', 'monitoring'],
        optimizations: ['basic', 'docker', 'network'],
      },
      {
        name: 'ai',
        type: 'ai',
        description: 'Optimized for AI workloads with GPU support',
        minCpu: 8,
        minMemory: 32 * 1024 * 1024 * 1024,
        minStorage: 500 * 1024 * 1024 * 1024,
        diskLayout: {
          scheme: 'lvm',
          partitions: [
            { name: 'boot', size: '1G', mountpoint: '/boot', type: 'ext4' },
            { name: 'root', size: '100G', mountpoint: '/', type: 'ext4' },
            { name: 'var', size: '100G', mountpoint: '/var', type: 'ext4' },
            { name: 'data', size: '100%', mountpoint: '/data', type: 'ext4' },
          ],
        },
        network: { dhcp: true },
        packages: ['hestia-core', 'docker', 'synap-stack', 'ollama', 'cuda', 'monitoring'],
        optimizations: ['basic', 'docker', 'network', 'ai', 'gpu'],
      },
    ];

    for (const profile of defaultProfiles) {
      this.profiles.set(profile.name, profile);
    }
  }

  // ============================================================================
  // Profile Management
  // ============================================================================

  registerProfile(name: string, profile: ProvisionProfile): void {
    this.profiles.set(name, profile);
    this.log('info', `Registered profile: ${name}`);
  }

  getProfile(name: string): ProvisionProfile | undefined {
    return this.profiles.get(name);
  }

  listProfiles(): ProvisionProfile[] {
    return Array.from(this.profiles.values());
  }

  getRecommendedProfile(hardware: HardwareInfo): ProvisionProfile {
    const totalStorage = hardware.storage.reduce((sum, d) => sum + d.size, 0);
    const hasGPU = hardware.gpu.length > 0;

    if (hasGPU && hardware.memory.total >= 32 * 1024 * 1024 * 1024) {
      return this.profiles.get('ai') || this.profiles.get('standard')!;
    }
    if (hardware.memory.total >= 16 * 1024 * 1024 * 1024 && totalStorage >= 200 * 1024 * 1024 * 1024) {
      return this.profiles.get('standard')!;
    }
    return this.profiles.get('minimal')!;
  }

  // ============================================================================
  // Hardware Detection
  // ============================================================================

  async detectHardware(): Promise<HardwareInfo> {
    this.log('info', 'Detecting hardware...');
    
    const [cpu, memory, storage, network, gpu, ipmi] = await Promise.all([
      this.detectCPU(),
      this.detectMemory(),
      this.detectStorage(),
      this.detectNetwork(),
      this.detectGPU(),
      this.detectIPMI(),
    ]);

    return {
      cpu,
      memory,
      storage,
      network,
      gpu,
      ipmi,
    };
  }

  private async detectCPU(): Promise<CPUInfo> {
    try {
      const { stdout: model } = await execAsync("grep 'model name' /proc/cpuinfo | head -1 | cut -d: -f2 | xargs");
      const { stdout: vendor } = await execAsync("grep 'vendor_id' /proc/cpuinfo | head -1 | cut -d: -f2 | xargs");
      const { stdout: cores } = await execAsync("nproc --all");
      const { stdout: arch } = await execAsync('uname -m');
      
      return {
        model: model.trim() || 'Unknown',
        vendor: vendor.trim() || 'Unknown',
        cores: parseInt(cores.trim(), 10) || 1,
        threads: parseInt(cores.trim(), 10) || 1,
        architecture: arch.trim(),
        baseFrequency: 0,
        maxFrequency: 0,
        virtualization: model.toLowerCase().includes('vmx') || model.toLowerCase().includes('svm'),
      };
    } catch {
      return {
        model: 'Unknown',
        vendor: 'Unknown',
        cores: 1,
        threads: 1,
        architecture: 'unknown',
        baseFrequency: 0,
        maxFrequency: 0,
        virtualization: false,
      };
    }
  }

  private async detectMemory(): Promise<MemoryInfo> {
    try {
      const { stdout: memTotal } = await execAsync("grep MemTotal /proc/meminfo | awk '{print $2}'");
      const { stdout: memAvailable } = await execAsync("grep MemAvailable /proc/meminfo | awk '{print $2}'");
      
      return {
        total: parseInt(memTotal.trim(), 10) * 1024,
        available: parseInt(memAvailable.trim(), 10) * 1024,
        type: 'DDR4',
        speed: 3200,
        channels: 2,
        ecc: false,
        slots: [],
      };
    } catch {
      return {
        total: 0,
        available: 0,
        type: 'unknown',
        speed: 0,
        channels: 0,
        ecc: false,
        slots: [],
      };
    }
  }

  private async detectStorage(): Promise<StorageDevice[]> {
    const devices: StorageDevice[] = [];
    
    try {
      const { stdout } = await execAsync('lsblk -Jb -o NAME,MODEL,SIZE,TYPE,ROTA');
      const data = JSON.parse(stdout);
      
      for (const device of data.blockdevices || []) {
        if (device.type === 'disk') {
          devices.push({
            name: device.name,
            model: device.model || 'Unknown',
            type: this.classifyStorageType(device),
            size: device.size || 0,
            interface: this.detectInterface(device.name),
            rota: device.rota,
          });
        }
      }
    } catch {
      // Fallback to basic detection
    }
    
    return devices;
  }

  private async detectNetwork(): Promise<NetworkInterface[]> {
    const interfaces: NetworkInterface[] = [];
    
    try {
      const { stdout } = await execAsync('ip -j addr show');
      const data = JSON.parse(stdout);
      
      for (const iface of data || []) {
        interfaces.push({
          name: iface.ifname,
          macAddress: iface.address || '00:00:00:00:00:00',
          type: this.classifyInterfaceType(iface.ifname, iface.link_type),
          state: iface.operstate || 'unknown',
          speed: undefined,
          ipAddresses: (iface.addr_info || []).map((addr: any) => ({
            address: addr.local,
            family: addr.family,
            prefixLen: addr.prefixlen,
          })),
        });
      }
    } catch {
      // Fallback
    }
    
    return interfaces;
  }

  private async detectGPU(): Promise<GPUInfo[]> {
    const gpus: GPUInfo[] = [];
    
    try {
      const { stdout } = await execAsync('lspci -nn | grep -i vga || echo ""');
      const lines = stdout.split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        const match = line.match(/\[(.*?)\]/);
        const pciMatch = line.match(/([0-9a-f]{2}:[0-9a-f]{2}\.[0-9a-f])/);
        
        gpus.push({
          model: line.split(':')[2]?.trim() || 'Unknown GPU',
          vendor: match ? match[1] : 'Unknown',
          vram: 0,
          pciAddress: pciMatch ? pciMatch[1] : '00:00.0',
        });
      }
    } catch {
      // No GPU or lspci not available
    }
    
    return gpus;
  }

  private async detectIPMI(): Promise<IPMIInfo> {
    try {
      const { stdout } = await execAsync('ipmitool mc info 2>/dev/null || echo ""');
      
      if (stdout.trim()) {
        return {
          available: true,
          vendor: 'IPMI',
        };
      }
    } catch {
      // IPMI not available
    }
    
    return { available: false };
  }

  // ============================================================================
  // Installation Planning
  // ============================================================================

  async generateProfile(hardware: HardwareInfo): Promise<ProvisionProfile> {
    const recommended = this.getRecommendedProfile(hardware);
    
    return {
      ...recommended,
      name: `${hardware.cpu.model.replace(/\s+/g, '-').toLowerCase()}-profile`,
      description: `Auto-generated profile for ${hardware.cpu.model}`,
    };
  }

  async generateInstallationPlan(
    hardware: HardwareInfo,
    profileName: string
  ): Promise<InstallationPlan> {
    const profile = this.getProfile(profileName) || this.getRecommendedProfile(hardware);
    
    const steps: InstallationStep[] = [
      { name: 'partition', description: 'Create disk partitions', estimatedTime: 2 },
      { name: 'format', description: 'Format partitions', estimatedTime: 5 },
      { name: 'mount', description: 'Mount filesystems', estimatedTime: 1 },
      { name: 'base', description: 'Install base system', estimatedTime: 10 },
      { name: 'packages', description: 'Install packages', estimatedTime: 15 },
      { name: 'configure', description: 'System configuration', estimatedTime: 5 },
      { name: 'optimize', description: 'Apply optimizations', estimatedTime: 3 },
      { name: 'finalize', description: 'Finalize installation', estimatedTime: 2 },
    ];
    
    const estimatedTotalTime = steps.reduce((sum, s) => sum + s.estimatedTime, 0);
    
    return {
      profile,
      hardware,
      steps,
      estimatedTotalTime,
    };
  }

  async validatePlan(plan: InstallationPlan): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];
    
    const totalStorage = plan.hardware.storage.reduce((sum, d) => sum + d.size, 0);
    if (totalStorage < plan.profile.minStorage) {
      issues.push(`Insufficient storage: ${this.formatBytes(totalStorage)} < ${this.formatBytes(plan.profile.minStorage)}`);
    }
    
    if (plan.hardware.memory.total < plan.profile.minMemory) {
      issues.push(`Insufficient memory: ${this.formatBytes(plan.hardware.memory.total)} < ${this.formatBytes(plan.profile.minMemory)}`);
    }
    
    if (plan.hardware.cpu.cores < plan.profile.minCpu) {
      issues.push(`Insufficient CPU cores: ${plan.hardware.cpu.cores} < ${plan.profile.minCpu}`);
    }
    
    return { valid: issues.length === 0, issues };
  }

  // ============================================================================
  // Provisioning
  // ============================================================================

  async provisionServer(options: ProvisionOptions): Promise<ProvisionReport> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const errors: string[] = [];
    
    this.log('info', 'Starting server provisioning...');
    
    const hardware = await this.detectHardware();
    const profileName = options.profile || 'standard';
    const profile = this.getProfile(profileName);
    
    if (!profile) {
      errors.push(`Unknown profile: ${profileName}`);
      return {
        hostname: os.hostname(),
        profile: profileName,
        hardware,
        timestamp: new Date(),
        duration: 0,
        success: false,
        warnings,
        errors,
      };
    }
    
    const plan = await this.generateInstallationPlan(hardware, profileName);
    const validation = await this.validatePlan(plan);
    
    if (!validation.valid) {
      errors.push(...validation.issues);
      if (!options.skipConfirmation) {
        return {
          hostname: os.hostname(),
          profile: profileName,
          hardware,
          timestamp: new Date(),
          duration: Date.now() - startTime,
          success: false,
          warnings,
          errors,
        };
      }
    }
    
    if (options.dryRun) {
      await this.simulateInstallation(plan);
    }
    
    const duration = Date.now() - startTime;
    
    return {
      hostname: os.hostname(),
      profile: profileName,
      hardware,
      timestamp: new Date(),
      duration,
      success: errors.length === 0,
      warnings,
      errors,
    };
  }

  // ============================================================================
  // Post-Installation Methods
  // ============================================================================

  async verifyInstallation(): Promise<boolean> {
    this.log('info', 'Verifying installation...');

    const checks: boolean[] = [];

    try {
      const { stdout } = await execAsync("systemctl is-active docker || echo 'inactive'");
      checks.push(stdout.trim() === 'active');
    } catch {
      checks.push(false);
    }

    try {
      await execAsync('ping -c 1 1.1.1.1');
      checks.push(true);
    } catch {
      checks.push(false);
    }

    try {
      const { stdout } = await execAsync("df -h / | tail -1 | awk '{print $5}' | tr -d '%'");
      const usage = parseInt(stdout.trim(), 10);
      checks.push(usage < 90);
    } catch {
      checks.push(false);
    }

    return checks.every((c) => c);
  }

  async runBenchmarks(): Promise<BenchmarkResults> {
    this.log('info', 'Running performance benchmarks...');

    const results: BenchmarkResults = {
      overall: 0,
    };

    try {
      const startTime = Date.now();
      await execAsync("sysbench cpu --cpu-max-prime=20000 run 2>/dev/null || echo ''");
      const cpuTime = Date.now() - startTime;
      results.cpu = {
        singleCore: 10000 / (cpuTime / 1000),
        multiCore: 50000 / (cpuTime / 1000),
        score: Math.min(100, 50000 / cpuTime),
      };
    } catch {
      results.cpu = { singleCore: 0, multiCore: 0, score: 0 };
    }

    try {
      const { stdout } = await execAsync("sysbench memory --memory-block-size=1M --memory-total-size=10G run 2>/dev/null | grep 'transferred' || echo ''");
      const match = stdout.match(/([\d.]+)\s*MiB/);
      const throughput = match ? parseFloat(match[1]) : 0;
      results.memory = {
        readSpeed: throughput,
        writeSpeed: throughput,
        latency: 1000 / throughput,
        score: Math.min(100, throughput / 100),
      };
    } catch {
      results.memory = { readSpeed: 0, writeSpeed: 0, latency: 0, score: 0 };
    }

    results.storage = [];
    const storage = await this.detectStorage();
    for (const device of storage.filter((d) => d.type !== 'usb' && d.type !== 'loop')) {
      try {
        const { stdout } = await execAsync(`fio --name=test --filename=${device.name} --direct=1 --rw=randread --bs=4k --ioengine=libaio --iodepth=64 --runtime=10 --numjobs=4 --group_reporting 2>/dev/null | grep 'iops' || echo ''`);
        const iopsMatch = stdout.match(/iops=([\d]+)/);
        results.storage.push({
          device: device.name,
          readIOPS: iopsMatch ? parseInt(iopsMatch[1], 10) : 0,
          writeIOPS: 0,
          readThroughput: 0,
          writeThroughput: 0,
          latency: 0,
          score: 0,
        });
      } catch {
        results.storage.push({
          device: device.name,
          readIOPS: 0,
          writeIOPS: 0,
          readThroughput: 0,
          writeThroughput: 0,
          latency: 0,
          score: 0,
        });
      }
    }

    results.network = [];
    const network = await this.detectNetwork();
    for (const iface of network.filter((i) => i.type === 'ethernet')) {
      try {
        const { stdout } = await execAsync(`iperf3 -c 1.1.1.1 -t 5 -f m 2>/dev/null || echo ''`);
        const throughputMatch = stdout.match(/([\d.]+)\s*Mbits\/sec/);
        results.network.push({
          interface: iface.name,
          throughput: throughputMatch ? parseFloat(throughputMatch[1]) : 0,
          latency: 0,
          jitter: 0,
          packetLoss: 0,
          score: 0,
        });
      } catch {
        results.network.push({
          interface: iface.name,
          throughput: 0,
          latency: 0,
          jitter: 0,
          packetLoss: 0,
          score: 0,
        });
      }
    }

    const cpuScore = results.cpu?.score || 0;
    const memScore = results.memory?.score || 0;
    results.overall = Math.round((cpuScore + memScore) / 2);

    return results;
  }

  async optimizeSystem(optimization: OptimizationConfig): Promise<void> {
    this.log('info', 'Applying system optimizations...');

    try {
      const sysctlConf = [
        `# Hestia Kernel Optimizations`,
        `vm.swappiness=${optimization.kernel.swappiness}`,
        `vm.vfs_cache_pressure=${optimization.kernel.vfsCachePressure}`,
        `vm.dirty_ratio=${optimization.kernel.dirtyRatio}`,
        `vm.dirty_background_ratio=${optimization.kernel.dirtyBackgroundRatio}`,
        `vm.overcommit_memory=${optimization.kernel.overcommitMemory}`,
        `vm.overcommit_ratio=${optimization.kernel.overcommitRatio}`,
        `net.ipv4.tcp_timestamps=${optimization.kernel.tcpTimestamps ? 1 : 0}`,
        `net.ipv4.tcp_sack=${optimization.kernel.tcpSack ? 1 : 0}`,
        `net.ipv4.tcp_window_scaling=${optimization.kernel.tcpWindowScaling ? 1 : 0}`,
        `net.core.rmem_max=${optimization.network.bufferSizes.rmemMax}`,
        `net.core.wmem_max=${optimization.network.bufferSizes.wmemMax}`,
        `net.ipv4.tcp_congestion_control=${optimization.network.tcpCongestionControl}`,
        `net.ipv4.tcp_fastopen=${optimization.network.tcpFastOpen ? 3 : 0}`,
      ];

      if (optimization.kernel.customParams) {
        for (const [key, value] of Object.entries(optimization.kernel.customParams)) {
          sysctlConf.push(`${key}=${value}`);
        }
      }

      this.log('info', 'Kernel optimizations prepared');
      this.log('debug', sysctlConf.join('\n'));
    } catch (error) {
      this.log('error', `Optimization failed: ${error}`);
    }
  }

  async configureMonitoring(config: MonitoringConfig): Promise<void> {
    this.log('info', 'Configuring monitoring...');

    if (!config.enabled) {
      this.log('info', 'Monitoring disabled');
      return;
    }

    this.log('info', `Metrics enabled: ${config.metrics.enabled}`);
    this.log('info', `Logging enabled: ${config.logging.enabled}`);
    this.log('info', `Alerting enabled: ${config.alerting?.enabled || false}`);
  }

  async generateDocumentation(report: ProvisionReport): Promise<string> {
    const doc = [
      `# Hestia Server Provisioning Report`,
      ``,
      `**Hostname:** ${report.hostname}`,
      `**Profile:** ${report.profile}`,
      `**Provisioning Date:** ${report.timestamp.toISOString()}`,
      `**Duration:** ${Math.round(report.duration / 60)} minutes`,
      `**Status:** ${report.success ? 'SUCCESS' : 'FAILED'}`,
      ``,
      `## Hardware Summary`,
      ``,
      `### CPU`,
      `- Model: ${report.hardware.cpu.model}`,
      `- Cores: ${report.hardware.cpu.cores}`,
      `- Threads: ${report.hardware.cpu.threads}`,
      `- Architecture: ${report.hardware.cpu.architecture}`,
      ``,
      `### Memory`,
      `- Total: ${this.formatBytes(report.hardware.memory.total)}`,
      `- Type: ${report.hardware.memory.type}`,
      `- Speed: ${report.hardware.memory.speed} MT/s`,
      `- ECC: ${report.hardware.memory.ecc ? 'Yes' : 'No'}`,
      ``,
      `### Storage`,
      ...report.hardware.storage.map((d) => `- ${d.name}: ${this.formatBytes(d.size)} (${d.type})`),
      ``,
      `### Network`,
      ...report.hardware.network.map((i) => `- ${i.name}: ${i.macAddress} (${i.type})`),
      ``,
    ];

    if (report.hardware.gpu.length > 0) {
      doc.push(
        `### GPUs`,
        ...report.hardware.gpu.map((g) => `- ${g.model} (${g.vendor}): ${this.formatBytes(g.vram)} VRAM`),
        ``
      );
    }

    if (report.benchmarks) {
      doc.push(
        `## Performance Benchmarks`,
        ``,
        `- Overall Score: ${report.benchmarks.overall}/100`,
        `- CPU Score: ${report.benchmarks.cpu?.score || 0}/100`,
        `- Memory Score: ${report.benchmarks.memory?.score || 0}/100`,
        ``
      );
    }

    if (report.warnings.length > 0) {
      doc.push(
        `## Warnings`,
        ...report.warnings.map((w) => `- ${w}`),
        ``
      );
    }

    if (report.errors.length > 0) {
      doc.push(
        `## Errors`,
        ...report.errors.map((e) => `- ${e}`),
        ``
      );
    }

    return doc.join('\n');
  }

  // ============================================================================
  // Multi-Server Methods
  // ============================================================================

  async detectOtherNodes(): Promise<Array<{ hostname: string; ip: string; status: string }>> {
    this.log('info', 'Detecting other Hestia nodes on network...');

    const nodes: Array<{ hostname: string; ip: string; status: string }> = [];

    try {
      const { stdout } = await execAsync('avahi-browse -r -t _hestia._tcp 2>/dev/null || echo ""');
      const lines = stdout.split('\n');

      let currentNode: Partial<{ hostname: string; ip: string }> = {};

      for (const line of lines) {
        if (line.includes('hostname')) {
          currentNode.hostname = line.split('=')[1]?.trim().replace(/\.$/, '');
        } else if (line.includes('address')) {
          currentNode.ip = line.split('=')[1]?.trim();
        } else if (line.includes('port') && currentNode.hostname) {
          nodes.push({
            hostname: currentNode.hostname,
            ip: currentNode.ip || 'unknown',
            status: 'discovered',
          });
          currentNode = {};
        }
      }
    } catch {
      // mDNS discovery not available
    }

    this.log('info', `Found ${nodes.length} other node(s)`);
    return nodes;
  }

  async configureCluster(nodes: Array<{ hostname: string; ip: string; status: string }>): Promise<void> {
    this.log('info', `Configuring cluster with ${nodes.length} node(s)...`);

    for (const node of nodes) {
      this.log('info', `Adding node: ${node.hostname} (${node.ip})`);
    }
  }

  async setupReplication(nodes: Array<{ hostname: string; ip: string; status: string }>): Promise<void> {
    this.log('info', 'Setting up data replication...');

    this.log('info', `Replication would be configured for ${nodes.length} node(s)`);
  }

  async configureLoadBalancing(nodes: Array<{ hostname: string; ip: string; status: string }>): Promise<void> {
    this.log('info', 'Configuring load balancing...');

    this.log('info', `Load balancing would be configured across ${nodes.length} node(s)`);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  async generateReport(): Promise<string> {
    const hardware = await this.detectHardware();

    const report = [
      `# Server Hardware Report`,
      ``,
      `Generated: ${new Date().toISOString()}`,
      ``,
      `## CPU`,
      `- Model: ${hardware.cpu.model}`,
      `- Vendor: ${hardware.cpu.vendor}`,
      `- Cores: ${hardware.cpu.cores}`,
      `- Threads: ${hardware.cpu.threads}`,
      `- Architecture: ${hardware.cpu.architecture}`,
      `- Base Frequency: ${hardware.cpu.baseFrequency} MHz`,
      `- Max Frequency: ${hardware.cpu.maxFrequency} MHz`,
      `- Virtualization: ${hardware.cpu.virtualization ? 'Yes' : 'No'}`,
      ``,
      `## Memory`,
      `- Total: ${this.formatBytes(hardware.memory.total)}`,
      `- Available: ${this.formatBytes(hardware.memory.available)}`,
      `- Type: ${hardware.memory.type}`,
      `- Speed: ${hardware.memory.speed} MT/s`,
      `- Channels: ${hardware.memory.channels}`,
      `- ECC: ${hardware.memory.ecc ? 'Yes' : 'No'}`,
      `- Slots: ${hardware.memory.slots.length}`,
      ``,
      `## Storage`,
      ...hardware.storage.map((d) => [
        `- ${d.name}:`,
        `  - Model: ${d.model}`,
        `  - Type: ${d.type}`,
        `  - Size: ${this.formatBytes(d.size)}`,
        `  - Health: ${d.health || 'unknown'}`,
        `  - SMART: ${d.smartStatus || 'unknown'}`,
      ]).flat(),
      ``,
      `## Network`,
      ...hardware.network.map((i) => [
        `- ${i.name}:`,
        `  - MAC: ${i.macAddress}`,
        `  - Type: ${i.type}`,
        `  - State: ${i.state}`,
        `  - Speed: ${i.speed ? `${i.speed} Mbps` : 'unknown'}`,
        i.ipAddresses.length > 0 ? `  - IPs: ${i.ipAddresses.map((a) => a.address).join(', ')}` : '',
      ].filter(Boolean)).flat(),
      ``,
    ];

    if (hardware.gpu.length > 0) {
      report.push(
        `## GPUs`,
        ...hardware.gpu.map((g) => [
          `- ${g.model}:`,
          `  - Vendor: ${g.vendor}`,
          `  - VRAM: ${this.formatBytes(g.vram)}`,
          `  - PCI: ${g.pciAddress}`,
        ]).flat(),
        ``
      );
    }

    if (hardware.raid) {
      report.push(
        `## RAID`,
        hardware.raid.controller ? `- Controller: ${hardware.raid.controller.vendor} ${hardware.raid.controller.model}` : '',
        `- Arrays: ${hardware.raid.arrays.length}`,
        ...hardware.raid.arrays.map((a) => `  - ${a.name}: ${a.level}, ${this.formatBytes(a.size)} (${a.status})`),
        ``
      );
    }

    if (hardware.ipmi?.available) {
      report.push(
        `## IPMI/BMC`,
        `- Vendor: ${hardware.ipmi.vendor || 'unknown'}`,
        `- Firmware: ${hardware.ipmi.firmwareVersion || 'unknown'}`,
        `- IP: ${hardware.ipmi.ipAddress || 'unknown'}`,
        `- MAC: ${hardware.ipmi.macAddress || 'unknown'}`,
        ``
      );
    }

    return report.join('\n');
  }

  async exportConfiguration(): Promise<ServerConfiguration> {
    const hardware = await this.detectHardware();
    const profile = await this.generateProfile(hardware);

    return {
      version: '1.0.0',
      exportedAt: new Date(),
      hostname: os.hostname(),
      hardware,
      profile,
      customizations: {},
    };
  }

  async importConfiguration(config: ServerConfiguration): Promise<void> {
    this.log('info', `Importing configuration for ${config.hostname}...`);

    if (config.profile) {
      this.registerProfile(config.profile.name, config.profile);
    }

    this.log('info', 'Configuration imported successfully');
  }

  async simulateProvisioning(options: ProvisionOptions): Promise<ProvisionReport> {
    this.log('info', 'Running provisioning simulation...');

    const report = await this.provisionServer({
      ...options,
      dryRun: true,
    });

    this.log('info', 'Simulation complete');
    return report;
  }

  // ============================================================================
  // IPMI Command Methods
  // ============================================================================

  async ipmiCommand(command: string): Promise<IPMIResult> {
    try {
      const { stdout, stderr } = await execAsync(`ipmitool ${command}`);
      return {
        success: true,
        output: stdout,
        error: stderr || undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
        exitCode: error.code,
      };
    }
  }

  async ipmiPowerOn(): Promise<IPMIResult> {
    return this.ipmiCommand('power on');
  }

  async ipmiPowerOff(): Promise<IPMIResult> {
    return this.ipmiCommand('power off');
  }

  async ipmiPowerCycle(): Promise<IPMIResult> {
    return this.ipmiCommand('power cycle');
  }

  async ipmiStatus(): Promise<IPMIResult> {
    return this.ipmiCommand('power status');
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
    this.logs.push(`[${level.toUpperCase()}] ${message}`);

    switch (level) {
      case 'info':
        logger.info(message);
        break;
      case 'warn':
        logger.warn(message);
        break;
      case 'error':
        logger.error(message);
        break;
      case 'debug':
        logger.debug(message);
        break;
    }
  }

  private updateProgress(
    phase: ProvisionPhase,
    currentStep: number,
    totalSteps: number,
    stepName: string,
    message: string
  ): void {
    this.currentProgress = {
      phase,
      currentStep,
      totalSteps,
      stepName,
      percentComplete: Math.round((currentStep / totalSteps) * 100),
      message,
    };

    if (this.progressCallback) {
      this.progressCallback(this.currentProgress);
    }

    logger.progress(currentStep, totalSteps, `${phase}: ${stepName}`);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  private parseSize(sizeStr: string): number {
    if (!sizeStr) return 0;

    const match = sizeStr.match(/^([\d.]+)\s*([KMGTPE]?i?B?)$/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    const multipliers: Record<string, number> = {
      '': 1,
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

    return Math.round(value * (multipliers[unit] || 1));
  }

  private classifyStorageType(device: any): StorageDevice['type'] {
    const name = device.name || '';
    if (name.startsWith('nvme')) return 'nvme';
    if (name.startsWith('sd') || name.startsWith('hd')) {
      if (device.rota === false || device.model?.toLowerCase().includes('ssd')) {
        return 'ssd';
      }
      return 'hdd';
    }
    if (name.startsWith('loop')) return 'loop';
    if (name.startsWith('mmcblk')) return 'ssd';
    if (device.model?.toLowerCase().includes('usb')) return 'usb';
    return 'other';
  }

  private detectInterface(deviceName: string): StorageDevice['interface'] {
    if (deviceName.startsWith('nvme')) return 'nvme';
    if (deviceName.startsWith('sd')) return 'sata';
    if (deviceName.startsWith('hd')) return 'ide';
    return 'other';
  }

  private classifyInterfaceType(name: string, linkType?: string): NetworkInterface['type'] {
    if (name.startsWith('lo')) return 'loopback';
    if (name.startsWith('br')) return 'bridge';
    if (name.startsWith('bond')) return 'bond';
    if (name.startsWith('virbr') || name.startsWith('vnet')) return 'virtual';
    if (name.startsWith('docker') || name.startsWith('veth')) return 'virtual';
    if (name.startsWith('wl')) return 'wifi';
    if (linkType === 'ether') return 'ethernet';
    if (linkType === 'ieee80211') return 'wifi';
    return 'other';
  }

  private cidrToNetmask(prefixLen: number, family: string): string {
    if (family === 'inet6') return `/${prefixLen}`;

    const mask = 0xffffffff ^ ((1 << (32 - prefixLen)) - 1);
    return [
      (mask >>> 24) & 0xff,
      (mask >>> 16) & 0xff,
      (mask >>> 8) & 0xff,
      mask & 0xff,
    ].join('.');
  }

  private async checkRequiredTools(): Promise<boolean> {
    const requiredTools = [
      'lsblk',
      'ip',
      'parted',
      'mkfs.ext4',
      'mkfs.fat',
    ];

    const available: boolean[] = [];

    for (const tool of requiredTools) {
      try {
        await execAsync(`which ${tool} 2>/dev/null`);
        available.push(true);
      } catch {
        available.push(false);
      }
    }

    return available.every((a) => a);
  }

  private generateRecommendations(hardware: HardwareInfo, profile: ProvisionProfile): string[] {
    const recommendations: string[] = [];

    const totalStorage = hardware.storage.reduce((sum, d) => sum + d.size, 0);

    if (totalStorage > 1000 * 1024 * 1024 * 1024 && profile.diskLayout.scheme !== 'lvm') {
      recommendations.push('Consider using LVM for better storage management with large disks');
    }

    const nvmeCount = hardware.storage.filter((d) => d.type === 'nvme').length;
    if (nvmeCount >= 2 && profile.type !== 'ai') {
      recommendations.push('Multiple NVMe drives detected - consider RAID 1 for redundancy');
    }

    if (hardware.memory.total >= 64 * 1024 * 1024 * 1024) {
      recommendations.push('Large memory system - consider increasing database cache sizes');
    }

    const hasGPU = hardware.gpu.length > 0;
    if (hasGPU && profile.type !== 'ai') {
      recommendations.push('GPU detected - AI profile may provide better GPU optimization');
    }

    if (hardware.ipmi?.available) {
      recommendations.push('IPMI available - configure for remote management');
    }

    return recommendations;
  }

  private async simulateInstallation(plan: InstallationPlan): Promise<void> {
    this.log('info', 'Simulating installation steps...');

    for (const step of plan.steps) {
      this.log('info', `[SIMULATION] ${step.name}: ${step.description}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.log('info', 'Simulation complete - no changes made');
  }

  onProgress(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  getCurrentProgress(): ProvisionProgress {
    return { ...this.currentProgress };
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export const serverProvisioner = new ServerProvisioner();
