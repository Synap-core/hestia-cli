/**
 * Hardware Monitor
 * Comprehensive hardware monitoring system for Hestia nodes
 * Cross-platform support (Linux primary, macOS secondary)
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

// =============================================================================
// TYPES
// =============================================================================

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

// =============================================================================
// DEFAULT THRESHOLDS
// =============================================================================

const DEFAULT_THRESHOLDS: Thresholds = {
  cpu: {
    warning: 70,
    critical: 90,
    temperatureWarning: 70,
    temperatureCritical: 85,
  },
  memory: {
    warning: 80,
    critical: 95,
  },
  disk: {
    warning: 80,
    critical: 95,
    temperatureWarning: 50,
    temperatureCritical: 60,
  },
  network: {
    packetLossWarning: 1,
    packetLossCritical: 5,
  },
  gpu: {
    temperatureWarning: 75,
    temperatureCritical: 85,
  },
  thermal: {
    warning: 70,
    critical: 85,
  },
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function execPromise(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error && !stdout) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function spawnPromise(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`Command failed: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    child.on('error', (error) => {
      reject(error);
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      child.kill();
      reject(new Error('Command timeout'));
    }, 30000);
  });
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? undefined : parsed;
}

function bytesToGB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100;
}

function kbToGB(kb: number): number {
  return Math.round((kb / 1024 / 1024) * 100) / 100;
}

function kbToMB(kb: number): number {
  return Math.round((kb / 1024) * 100) / 100;
}

// =============================================================================
// HARDWARE MONITOR CLASS
// =============================================================================

export class HardwareMonitor {
  private thresholds: Thresholds;
  private watchInterval?: NodeJS.Timeout;
  private lastDiskIO: Map<string, { readBytes: number; writeBytes: number; readOps: number; writeOps: number; timestamp: number }> = new Map();
  private lastNetworkStats: Map<string, { rxBytes: number; txBytes: number; rxSpeed: number; txSpeed: number; timestamp: number }> = new Map();
  private _platform: string;
  private _isLinux: boolean;
  private _isMacOS: boolean;

  constructor(thresholds: Partial<Thresholds> = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this._platform = os.platform();
    this._isLinux = this._platform === 'linux';
    this._isMacOS = this._platform === 'darwin';
  }

  // ===========================================================================
  // CPU MONITORING
  // ===========================================================================

  async cpuUsage(): Promise<CPUUsage> {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    // Get detailed CPU usage from /proc/stat on Linux
    let user = 0;
    let system = 0;
    let idle = 0;

    if (this._isLinux) {
      try {
        const { stdout } = await execPromise('cat /proc/stat | grep "^cpu "');
        const parts = stdout.trim().split(/\s+/).slice(1).map(Number);
        if (parts.length >= 4) {
          user = parts[0] + parts[1]; // user + nice
          system = parts[2]; // system
          idle = parts[3]; // idle
        }
      } catch {
        // Fallback to os.cpus()
      }
    }

    const coreUsages: CPUCoreInfo[] = cpus.map((cpu, index) => ({
      core: index,
      usage: 100 - Math.floor((cpu.times.idle / Object.values(cpu.times).reduce((a, b) => a + b, 0)) * 100),
      frequency: cpu.speed,
    }));

    const average = coreUsages.reduce((sum, c) => sum + c.usage, 0) / coreUsages.length;

    return {
      cores: coreUsages,
      average: Math.round(average * 100) / 100,
      user: Math.round((user / (user + system + idle)) * 100) || 0,
      system: Math.round((system / (user + system + idle)) * 100) || 0,
      idle: Math.round((idle / (user + system + idle)) * 100) || 0,
    };
  }

  async cpuTemperature(): Promise<CPUTemperature | undefined> {
    if (this._isLinux) {
      try {
        // Try sensors command first
        try {
          const { stdout } = await execPromise('sensors -u 2>/dev/null');
          const lines = stdout.split('\n');
          const temps: number[] = [];
          let mainTemp: number | undefined;

          for (const line of lines) {
            if (line.includes('_input')) {
              const match = line.match(/([\d.]+)/);
              if (match) {
                const temp = parseFloat(match[1]);
                if (!isNaN(temp)) {
                  temps.push(temp);
                  if (mainTemp === undefined) mainTemp = temp;
                }
              }
            }
          }

          if (temps.length > 0) {
            return {
              main: mainTemp,
              cores: temps.slice(1),
              max: Math.max(...temps),
            };
          }
        } catch {
          // Fallback to thermal zones
        }

        // Fallback to thermal zones
        const zones = await this.thermalZones();
        const cpuZones = zones.filter(z => 
          z.type?.toLowerCase().includes('cpu') || 
          z.zone.toLowerCase().includes('x86')
        );

        if (cpuZones.length > 0) {
          return {
            main: cpuZones[0].temperature,
            cores: cpuZones.slice(1).map(z => z.temperature),
            max: Math.max(...cpuZones.map(z => z.temperature)),
          };
        }
      } catch {
        // Temperature monitoring not available
      }
    } else if (this._isMacOS) {
      try {
        // Try to get temperature from powermetrics or sysctl
        const { stdout } = await execPromise('sysctl -a 2>/dev/null | grep machdep.xcpm.cpu_thermal_level || true');
        // macOS thermal monitoring is limited without third-party tools
      } catch {
        // Temperature monitoring not available on macOS without additional tools
      }
    }

    return undefined;
  }

  async cpuFrequency(): Promise<CPUFrequency | undefined> {
    const cpus = os.cpus();
    const current = cpus[0]?.speed || 0;

    if (this._isLinux) {
      try {
        // Get max and min frequency
        let max = current;
        let min = current;
        let governor: string | undefined;

        try {
          const { stdout: maxFreq } = await execPromise('cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq 2>/dev/null || echo 0');
          max = parseInt(maxFreq.trim()) / 1000 || current;
        } catch {
          // Ignore
        }

        try {
          const { stdout: minFreq } = await execPromise('cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_min_freq 2>/dev/null || echo 0');
          min = parseInt(minFreq.trim()) / 1000 || current;
        } catch {
          // Ignore
        }

        try {
          const { stdout: gov } = await execPromise('cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo unknown');
          governor = gov.trim();
        } catch {
          // Ignore
        }

        return {
          current,
          max,
          min,
          governor: governor !== 'unknown' ? governor : undefined,
        };
      } catch {
        // Frequency info not available
      }
    }

    return {
      current,
      max: current,
      min: current,
    };
  }

  async cpuLoad(): Promise<CPULoad> {
    const load = os.loadavg();
    const cpus = os.cpus().length;

    return {
      '1min': Math.round((load[0] / cpus) * 100) / 100,
      '5min': Math.round((load[1] / cpus) * 100) / 100,
      '15min': Math.round((load[2] / cpus) * 100) / 100,
    };
  }

  async cpuInfo(): Promise<CPUInfo> {
    const cpus = os.cpus();
    const model = cpus[0]?.model || 'Unknown';
    
    // Parse vendor from model
    let vendor = 'Unknown';
    if (model.includes('Intel')) vendor = 'Intel';
    else if (model.includes('AMD')) vendor = 'AMD';
    else if (model.includes('Apple')) vendor = 'Apple';
    else if (model.includes('ARM')) vendor = 'ARM';

    let physicalCores = cpus.length / 2; // Assume SMT for unknown

    if (this._isLinux) {
      try {
        const { stdout } = await execPromise('lscpu -p 2>/dev/null | grep -v "#" | sort -u -t, -k 2 | wc -l');
        physicalCores = parseInt(stdout.trim()) || physicalCores;
      } catch {
        // Fallback
      }
    }

    return {
      model,
      cores: cpus.length,
      threads: cpus.length,
      architecture: os.arch(),
      vendor,
      speed: cpus[0]?.speed || 0,
      physicalCores,
    };
  }

  // ===========================================================================
  // MEMORY MONITORING
  // ===========================================================================

  async memoryUsage(): Promise<MemoryUsage> {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;

    let buffers = 0;
    let cached = 0;
    let available = free;

    if (this._isLinux) {
      try {
        const { stdout } = await execPromise('cat /proc/meminfo');
        const lines = stdout.split('\n');

        for (const line of lines) {
          const [key, value] = line.split(':');
          if (value) {
            const num = parseInt(value.trim().split(/\s+/)[0]) * 1024; // Convert KB to bytes
            if (key === 'Buffers') buffers = num;
            if (key === 'Cached') cached = num;
            if (key === 'MemAvailable') available = num;
          }
        }
      } catch {
        // Fallback to estimation
        available = free + buffers + cached;
      }
    } else if (this._isMacOS) {
      try {
        // On macOS, use vm_statistics for more accurate info
        const { stdout } = await execPromise('vm_stat 2>/dev/null');
        const lines = stdout.split('\n');
        let pageSize = 4096;

        for (const line of lines) {
          if (line.includes('page size')) {
            const match = line.match(/(\d+)/);
            if (match) pageSize = parseInt(match[1]);
          }
          if (line.includes('Pages free')) {
            const match = line.match(/:\s+(\d+)/);
            if (match) available = parseInt(match[1]) * pageSize;
          }
        }
      } catch {
        // Use os.freemem()
      }
    }

    return {
      total: bytesToGB(total),
      used: bytesToGB(used),
      free: bytesToGB(free),
      available: bytesToGB(available),
      buffers: bytesToGB(buffers),
      cached: bytesToGB(cached),
      percentage: Math.round((used / total) * 100),
    };
  }

  async memoryInfo(): Promise<MemoryInfo | undefined> {
    if (this._isLinux) {
      try {
        const { stdout } = await execPromise('dmidecode -t memory 2>/dev/null || echo ""');
        const sections = stdout.split('Memory Device');
        
        let type: string | undefined;
        let speed: number | undefined;
        let manufacturer: string | undefined;
        let voltage: number | undefined;
        let slots = 0;
        let slotsUsed = 0;

        for (const section of sections) {
          if (section.includes('Size:') && !section.includes('No Module Installed')) {
            slotsUsed++;
            
            const typeMatch = section.match(/Type:\s*(\S+)/);
            if (typeMatch && !type) type = typeMatch[1];

            const speedMatch = section.match(/Speed:\s*(\d+)\s*MHz/);
            if (speedMatch && !speed) speed = parseInt(speedMatch[1]);

            const manufMatch = section.match(/Manufacturer:\s*(.+)/);
            if (manufMatch && !manufacturer) manufacturer = manufMatch[1].trim();

            const voltageMatch = section.match(/Configured Voltage:\s*([\d.]+)/);
            if (voltageMatch && !voltage) voltage = parseFloat(voltageMatch[1]);
          }
          if (section.includes('Memory Device')) {
            slots++;
          }
        }

        if (slotsUsed > 0) {
          return {
            type,
            speed,
            manufacturer,
            voltage,
            slots,
            slotsUsed,
          };
        }
      } catch {
        // dmidecode requires root
      }
    } else if (this._isMacOS) {
      try {
        const { stdout } = await execPromise('system_profiler SPMemoryDataType 2>/dev/null | head -20 || true');
        // Parse memory info from system_profiler
        const typeMatch = stdout.match(/Type:\s*(\S+)/);
        const speedMatch = stdout.match(/Speed:\s*(\d+)\s*MHz/);

        if (typeMatch || speedMatch) {
          return {
            type: typeMatch?.[1],
            speed: speedMatch ? parseInt(speedMatch[1]) : undefined,
          };
        }
      } catch {
        // Ignore
      }
    }

    return undefined;
  }

  async swapUsage(): Promise<SwapUsage> {
    if (this._isLinux) {
      try {
        const { stdout } = await execPromise('cat /proc/swaps');
        const lines = stdout.trim().split('\n').slice(1); // Skip header

        let total = 0;
        let used = 0;

        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 4) {
            total += parseInt(parts[2]) * 1024; // KB to bytes
            used += parseInt(parts[3]) * 1024;
          }
        }

        return {
          total: bytesToGB(total),
          used: bytesToGB(used),
          free: bytesToGB(total - used),
          percentage: total > 0 ? Math.round((used / total) * 100) : 0,
        };
      } catch {
        // Fallback
      }
    } else if (this._isMacOS) {
      try {
        const { stdout } = await execPromise('sysctl vm.swapusage 2>/dev/null || true');
        const totalMatch = stdout.match(/total = ([\d.]+)(\w)/);
        const usedMatch = stdout.match(/used = ([\d.]+)(\w)/);

        if (totalMatch && usedMatch) {
          const total = parseFloat(totalMatch[1]);
          const used = parseFloat(usedMatch[1]);
          return {
            total,
            used,
            free: total - used,
            percentage: Math.round((used / total) * 100),
          };
        }
      } catch {
        // Ignore
      }
    }

    return {
      total: 0,
      used: 0,
      free: 0,
      percentage: 0,
    };
  }

  async memoryPressure(): Promise<MemoryPressure> {
    const mem = await this.memoryUsage();
    const swap = await this.swapUsage();

    let score = mem.percentage;
    let level: MemoryPressure['level'] = 'normal';
    let details = 'Memory usage is normal';

    if (mem.percentage > this.thresholds.memory.critical || swap.percentage > 50) {
      level = 'critical';
      details = `Critical: Memory at ${mem.percentage}%, Swap at ${swap.percentage}%`;
      score = 100;
    } else if (mem.percentage > this.thresholds.memory.warning || swap.percentage > 25) {
      level = 'warning';
      details = `Warning: Memory at ${mem.percentage}%, Swap at ${swap.percentage}%`;
      score = mem.percentage + swap.percentage;
    }

    return { level, score, details };
  }

  // ===========================================================================
  // DISK MONITORING
  // ===========================================================================

  async diskUsage(): Promise<DiskMount[]> {
    const mounts: DiskMount[] = [];

    if (this._isLinux || this._isMacOS) {
      try {
        const { stdout } = await execPromise('df -kP 2>/dev/null');
        const lines = stdout.trim().split('\n').slice(1); // Skip header

        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 6) {
            const filesystem = parts[0];
            const total = parseInt(parts[1]) * 1024; // KB to bytes
            const used = parseInt(parts[2]) * 1024;
            const free = parseInt(parts[3]) * 1024;
            const percentage = parseInt(parts[4].replace('%', ''));
            const mountpoint = parts.slice(5).join(' ');

            mounts.push({
              filesystem,
              mountpoint,
              total: bytesToGB(total),
              used: bytesToGB(used),
              free: bytesToGB(free),
              percentage,
              type: this._isLinux ? await this.getFilesystemType(filesystem) : 'unknown',
            });
          }
        }
      } catch {
        // Fallback to os module
      }
    }

    return mounts;
  }

  private async getFilesystemType(filesystem: string): Promise<string> {
    try {
      const { stdout } = await execPromise(`findmnt -no FSTYPE "${filesystem}" 2>/dev/null || echo "unknown"`);
      return stdout.trim() || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async diskIO(): Promise<DiskIO[]> {
    const ioStats: DiskIO[] = [];

    if (this._isLinux) {
      try {
        const { stdout } = await execPromise('cat /proc/diskstats');
        const lines = stdout.trim().split('\n');
        const now = Date.now();

        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 14) {
            const device = parts[2];
            
            // Skip loop devices and partitions (keep only main disks)
            if (device.startsWith('loop') || /^\D+\d+\w*$/.test(device)) continue;

            const readOps = parseInt(parts[3]);
            const readSectors = parseInt(parts[5]);
            const writeOps = parseInt(parts[7]);
            const writeSectors = parseInt(parts[9]);

            const sectorSize = 512;
            const readBytes = readSectors * sectorSize;
            const writeBytes = writeSectors * sectorSize;

            const last = this.lastDiskIO.get(device);
            let readSpeed = 0;
            let writeSpeed = 0;
            let iops = 0;

            if (last) {
              const timeDiff = (now - last.timestamp) / 1000;
              if (timeDiff > 0) {
                readSpeed = (readBytes - last.readBytes) / timeDiff;
                writeSpeed = (writeBytes - last.writeBytes) / timeDiff;
                iops = ((readOps + writeOps) - (last.readOps || 0)) / timeDiff;
              }
            }

            this.lastDiskIO.set(device, {
              readBytes,
              writeBytes,
              readOps,
              writeOps,
              timestamp: now,
            });

            ioStats.push({
              device,
              readBytes,
              writeBytes,
              readOps,
              writeOps,
              readSpeed: Math.max(0, readSpeed),
              writeSpeed: Math.max(0, writeSpeed),
              iops: Math.max(0, iops),
            });
          }
        }
      } catch {
        // Disk I/O monitoring not available
      }
    } else if (this._isMacOS) {
      try {
        const { stdout } = await execPromise('iostat -d -I -c 2 2>/dev/null | tail -n +4 || true');
        // Parse macOS iostat output
      } catch {
        // Ignore
      }
    }

    return ioStats;
  }

  async diskHealth(): Promise<DiskHealth[]> {
    const health: DiskHealth[] = [];

    if (this._isLinux) {
      try {
        // Check if smartctl is available
        await execPromise('which smartctl');

        // Get disk list
        const { stdout: diskList } = await execPromise('lsblk -d -o NAME,TYPE -n 2>/dev/null | grep disk | awk \'{print $1}\' || true');
        const disks = diskList.trim().split('\n').filter(Boolean);

        for (const disk of disks) {
          try {
            const { stdout } = await execPromise(`sudo smartctl -a /dev/${disk} 2>/dev/null || true`);
            
            const attributes: SMARTAttribute[] = [];
            let status: DiskHealth['status'] = 'ok';
            let temperature: number | undefined;
            let powerOnHours: number | undefined;
            let powerCycles: number | undefined;
            const errors: string[] = [];

            // Parse SMART data
            if (stdout.includes('SMART overall-health self-assessment test result: PASSED')) {
              status = 'ok';
            } else if (stdout.includes('FAILED')) {
              status = 'critical';
            }

            // Extract temperature
            const tempMatch = stdout.match(/Temperature:\s*(\d+)/);
            if (tempMatch) {
              temperature = parseInt(tempMatch[1]);
              if (temperature > this.thresholds.disk.temperatureCritical) {
                status = 'critical';
              } else if (temperature > this.thresholds.disk.temperatureWarning) {
                status = 'warning';
              }
            }

            // Extract power on hours
            const hoursMatch = stdout.match(/Power_On_Hours\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\d+)/);
            if (hoursMatch) {
              powerOnHours = parseInt(hoursMatch[1]);
            }

            // Extract power cycles
            const cyclesMatch = stdout.match(/Power_Cycle_Count\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\d+)/);
            if (cyclesMatch) {
              powerCycles = parseInt(cyclesMatch[1]);
            }

            health.push({
              device: `/dev/${disk}`,
              status,
              temperature,
              powerOnHours,
              powerCycles,
              attributes,
              errors,
            });
          } catch {
            // Skip this disk
          }
        }
      } catch {
        // smartctl not available
      }
    }

    return health;
  }

  async diskInfo(): Promise<DiskInfo[]> {
    const info: DiskInfo[] = [];

    if (this._isLinux) {
      try {
        const { stdout } = await execPromise('lsblk -d -o NAME,MODEL,SIZE,TYPE,ROTA,SERIAL -J 2>/dev/null || true');
        const data = JSON.parse(stdout);

        if (data.blockdevices) {
          for (const device of data.blockdevices) {
            info.push({
              device: `/dev/${device.name}`,
              model: device.model || 'Unknown',
              type: device.rota ? 'HDD' : (device.model?.includes('NVMe') ? 'NVMe' : 'SSD'),
              serial: device.serial,
              size: bytesToGB(parseInt(device.size) || 0),
              sectorSize: 512,
            });
          }
        }
      } catch {
        // Fallback
        try {
          const { stdout } = await execPromise('lsblk -d -o NAME,MODEL,SIZE 2>/dev/null || true');
          const lines = stdout.trim().split('\n').slice(1);
          for (const line of lines) {
            const parts = line.trim().split(/\s{2,}/);
            if (parts.length >= 2) {
              info.push({
                device: `/dev/${parts[0]}`,
                model: parts[1] || 'Unknown',
                type: 'unknown',
                size: bytesToGB(parseInt(parts[2]) || 0),
                sectorSize: 512,
              });
            }
          }
        } catch {
          // Ignore
        }
      }
    } else if (this._isMacOS) {
      try {
        const { stdout } = await execPromise('diskutil list -plist 2>/dev/null | plutil -convert json -o - - || true');
        // Parse macOS disk info
      } catch {
        // Ignore
      }
    }

    return info;
  }

  // ===========================================================================
  // NETWORK MONITORING
  // ===========================================================================

  async networkInterfaces(): Promise<NetworkInterface[]> {
    const interfaces: NetworkInterface[] = [];
    const ifaces = os.networkInterfaces();

    for (const [name, addrs] of Object.entries(ifaces)) {
      if (!addrs) continue;

      const type: NetworkInterface['type'] = 
        name.startsWith('lo') ? 'loopback' :
        name.startsWith('eth') || name.startsWith('en') ? 'ethernet' :
        name.startsWith('wlan') || name.startsWith('wl') || name.startsWith('wifi') ? 'wifi' :
        name.startsWith('tun') || name.startsWith('wg') ? 'tunnel' :
        'other';

      const ip4 = addrs.filter(a => a.family === 'IPv4').map(a => a.address);
      const ip6 = addrs.filter(a => a.family === 'IPv6').map(a => a.address);
      const mac = addrs.find(a => a.family === 'IPv4')?.mac;

      let status: NetworkInterface['status'] = 'unknown';
      let speed: number | undefined;
      let duplex: NetworkInterface['duplex'] = 'unknown';
      let mtu = 1500;

      if (this._isLinux && type !== 'loopback') {
        try {
          const { stdout } = await execPromise(`cat /sys/class/net/${name}/operstate 2>/dev/null || echo "unknown"`);
          status = stdout.trim() === 'up' ? 'up' : 'down';

          const { stdout: mtuStr } = await execPromise(`cat /sys/class/net/${name}/mtu 2>/dev/null || echo "1500"`);
          mtu = parseInt(mtuStr.trim()) || 1500;

          // Try to get speed
          try {
            const { stdout: speedStr } = await execPromise(`cat /sys/class/net/${name}/speed 2>/dev/null || echo "0"`);
            const s = parseInt(speedStr.trim());
            if (s > 0) speed = s;
          } catch {
            // Ignore
          }

          // Try to get duplex
          try {
            const { stdout: duplexStr } = await execPromise(`cat /sys/class/net/${name}/duplex 2>/dev/null || echo "unknown"`);
            const d = duplexStr.trim();
            if (d === 'full') duplex = 'full';
            else if (d === 'half') duplex = 'half';
          } catch {
            // Ignore
          }
        } catch {
          // Ignore
        }
      }

      interfaces.push({
        name,
        type,
        mac,
        ip4,
        ip6,
        status: status || (addrs.length > 0 ? 'up' : 'down'),
        speed,
        duplex,
        mtu,
      });
    }

    return interfaces;
  }

  async networkUsage(): Promise<NetworkStats[]> {
    const stats: NetworkStats[] = [];

    if (this._isLinux) {
      try {
        const { stdout } = await execPromise('cat /proc/net/dev');
        const lines = stdout.trim().split('\n').slice(2); // Skip headers

        for (const line of lines) {
          const [name, data] = line.split(':');
          if (!data) continue;

          const values = data.trim().split(/\s+/).map(Number);
          if (values.length >= 16) {
            stats.push({
              interface: name.trim(),
              rxBytes: values[0],
              rxPackets: values[1],
              rxErrors: values[2],
              rxDropped: values[3],
              txBytes: values[8],
              txPackets: values[9],
              txErrors: values[10],
              txDropped: values[11],
            });
          }
        }
      } catch {
        // Fallback
      }
    }

    return stats;
  }

  async networkSpeed(): Promise<NetworkSpeed[]> {
    const speed: NetworkSpeed[] = [];
    const now = Date.now();

    const stats = await this.networkUsage();

    for (const stat of stats) {
      const last = this.lastNetworkStats.get(stat.interface);
      let rxSpeed = 0;
      let txSpeed = 0;
      let rxPeak = 0;
      let txPeak = 0;

      if (last) {
        const timeDiff = (now - last.timestamp) / 1000;
        if (timeDiff > 0) {
          rxSpeed = Math.max(0, (stat.rxBytes - last.rxBytes) / timeDiff);
          txSpeed = Math.max(0, (stat.txBytes - last.txBytes) / timeDiff);
        }
        rxPeak = Math.max(rxSpeed, last.rxSpeed || 0);
        txPeak = Math.max(txSpeed, last.txSpeed || 0);
      }

      this.lastNetworkStats.set(stat.interface, {
        rxBytes: stat.rxBytes,
        txBytes: stat.txBytes,
        rxSpeed,
        txSpeed,
        timestamp: now,
      });

      speed.push({
        interface: stat.interface,
        rxSpeed,
        txSpeed,
        rxPeak,
        txPeak,
      });
    }

    return speed;
  }

  async networkLatency(): Promise<NetworkLatency | undefined> {
    const latency: NetworkLatency = {};

    // Get default gateway
    let gateway: string | undefined;
    if (this._isLinux) {
      try {
        const { stdout } = await execPromise("ip route | grep default | awk '{print $3}' | head -1");
        gateway = stdout.trim();
      } catch {
        // Ignore
      }
    } else if (this._isMacOS) {
      try {
        const { stdout } = await execPromise("netstat -rn | grep default | awk '{print $2}' | head -1");
        gateway = stdout.trim();
      } catch {
        // Ignore
      }
    }

    // Ping gateway
    if (gateway && gateway !== 'default') {
      try {
        const { stdout } = await execPromise(`ping -c 3 -W 2 ${gateway} 2>/dev/null || true`);
        const avgMatch = stdout.match(/avg.*?=.*?([\d.]+)/);
        const lossMatch = stdout.match(/(\d+)% packet loss/);
        
        latency.gateway = {
          host: gateway,
          latency: avgMatch ? parseFloat(avgMatch[1]) : 0,
          packetLoss: lossMatch ? parseInt(lossMatch[1]) : 0,
        };
      } catch {
        // Ignore
      }
    }

    // Ping internet
    try {
      const { stdout } = await execPromise('ping -c 3 -W 2 8.8.8.8 2>/dev/null || true');
      const avgMatch = stdout.match(/avg.*?=.*?([\d.]+)/);
      const lossMatch = stdout.match(/(\d+)% packet loss/);

      latency.internet = {
        host: '8.8.8.8',
        latency: avgMatch ? parseFloat(avgMatch[1]) : 0,
        packetLoss: lossMatch ? parseInt(lossMatch[1]) : 0,
      };
    } catch {
      // Ignore
    }

    // DNS latency
    try {
      const start = Date.now();
      await execPromise('nslookup google.com 8.8.8.8 >/dev/null 2>&1 || true');
      latency.dns = {
        host: '8.8.8.8',
        latency: Date.now() - start,
      };
    } catch {
      // Ignore
    }

    return Object.keys(latency).length > 0 ? latency : undefined;
  }

  // ===========================================================================
  // GPU MONITORING
  // ===========================================================================

  async gpuInfo(): Promise<GPUInfo[] | undefined> {
    const gpus: GPUInfo[] = [];

    // Try NVIDIA first
    try {
      const { stdout } = await execPromise('nvidia-smi --query-gpu=index,name,driver_version,memory.total,pci.bus_id --format=csv,noheader 2>/dev/null || true');
      const lines = stdout.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        const parts = line.split(',').map(s => s.trim());
        if (parts.length >= 4) {
          const memStr = parts[3].replace('MiB', '').replace('MB', '');
          gpus.push({
            index: parseInt(parts[0]),
            model: parts[1],
            vendor: 'nvidia',
            driver: parts[2],
            vram: parseInt(memStr) || 0,
            pci: parts[4],
          });
        }
      }
    } catch {
      // nvidia-smi not available
    }

    // Try AMD (rocm-smi)
    if (gpus.length === 0) {
      try {
        const { stdout } = await execPromise('rocm-smi --showproductname --showbus --csv 2>/dev/null || true');
        const lines = stdout.trim().split('\n').slice(1);

        for (let i = 0; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length >= 2) {
            gpus.push({
              index: i,
              model: parts[0].trim(),
              vendor: 'amd',
              vram: 0,
              pci: parts[1].trim(),
            });
          }
        }
      } catch {
        // rocm-smi not available
      }
    }

    // Try Intel GPU (intel_gpu_top or similar)
    if (gpus.length === 0 && this._isLinux) {
      try {
        // Check for Intel GPU via lspci
        const { stdout } = await execPromise('lspci | grep -i vga | grep -i intel || true');
        if (stdout.trim()) {
          const match = stdout.match(/:\s*(.+?)\s*\[/);
          if (match) {
            gpus.push({
              index: 0,
              model: match[1].trim(),
              vendor: 'intel',
              vram: 0,
            });
          }
        }
      } catch {
        // Ignore
      }
    }

    // Apple Silicon
    if (this._isMacOS && gpus.length === 0) {
      try {
        const { stdout } = await execPromise('system_profiler SPDisplaysDataType -json 2>/dev/null || true');
        const data = JSON.parse(stdout);
        if (data.SPDisplaysDataType) {
          for (let i = 0; i < data.SPDisplaysDataType.length; i++) {
            const gpu = data.SPDisplaysDataType[i];
            gpus.push({
              index: i,
              model: gpu.sppci_model || 'Apple GPU',
              vendor: 'apple',
              vram: gpu.spdisplays_vram || 0,
            });
          }
        }
      } catch {
        // Ignore
      }
    }

    return gpus.length > 0 ? gpus : undefined;
  }

  async gpuUsage(): Promise<GPUUsage[] | undefined> {
    const usage: GPUUsage[] = [];

    // NVIDIA
    try {
      const { stdout } = await execPromise('nvidia-smi --query-gpu=index,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,fan.speed,clocks.current.graphics,clocks.current.memory --format=csv,noheader,nounits 2>/dev/null || true');
      const lines = stdout.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        const parts = line.split(',').map(s => parseFloat(s.trim()));
        if (parts.length >= 5) {
          usage.push({
            index: parts[0],
            utilization: parts[1] || 0,
            memoryUsed: parts[3] || 0,
            memoryTotal: parts[4] || 0,
            memoryUtilization: parts[2] || ((parts[4] > 0 ? (parts[3] / parts[4]) * 100 : 0)),
            temperature: parts[5],
            power: parts[6],
            fanSpeed: parts[7],
            clockGraphics: parts[8],
            clockMemory: parts[9],
          });
        }
      }
    } catch {
      // nvidia-smi not available
    }

    // AMD
    if (usage.length === 0) {
      try {
        const { stdout } = await execPromise('rocm-smi --showuse --showmeminfo vram --showtemp --showpower --csv 2>/dev/null || true');
        const lines = stdout.trim().split('\n').slice(1);

        for (let i = 0; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length >= 2) {
            usage.push({
              index: i,
              utilization: parseFloat(parts[0]) || 0,
              memoryUsed: parseFloat(parts[1]) || 0,
              memoryTotal: 0,
              memoryUtilization: 0,
              temperature: parseFloat(parts[2]),
              power: parseFloat(parts[3]),
            });
          }
        }
      } catch {
        // rocm-smi not available
      }
    }

    return usage.length > 0 ? usage : undefined;
  }

  // ===========================================================================
  // POWER & THERMAL MONITORING
  // ===========================================================================

  async powerUsage(): Promise<PowerUsage> {
    const power: PowerUsage = {
      source: 'unknown',
    };

    if (this._isLinux) {
      // Check battery status
      try {
        const { stdout } = await execPromise('find /sys/class/power_supply -name "BAT*" 2>/dev/null | head -1');
        const batteryPath = stdout.trim();

        if (batteryPath) {
          const { stdout: status } = await execPromise(`cat ${batteryPath}/status 2>/dev/null || echo "Unknown"`);
          const { stdout: capacity } = await execPromise(`cat ${batteryPath}/capacity 2>/dev/null || echo "0"`);
          const { stdout: powerNow } = await execPromise(`cat ${batteryPath}/power_now 2>/dev/null || echo "0"`);

          power.source = status.trim() === 'Charging' ? 'AC' : 'battery';
          power.battery = {
            level: parseInt(capacity.trim()) || 0,
            status: status.trim().toLowerCase() as 'charging' | 'discharging' | 'full' | 'unknown',
          };

          const powerDraw = parseInt(powerNow.trim());
          if (powerDraw > 0) {
            power.powerDraw = powerDraw / 1000000; // Convert µW to W
          }

          // Try to get time remaining
          try {
            const { stdout: energy } = await execPromise(`cat ${batteryPath}/energy_now 2>/dev/null || echo "0"`);
            const energyNow = parseInt(energy.trim());
            if (energyNow > 0 && powerDraw > 0) {
              const hoursRemaining = (energyNow / powerDraw);
              power.battery.timeRemaining = Math.round(hoursRemaining * 60); // Convert to minutes
            }
          } catch {
            // Ignore
          }
        } else {
          // No battery, must be AC
          power.source = 'AC';
        }

        // Try to get system power draw (RAPL)
        if (!power.powerDraw) {
          try {
            const { stdout } = await execPromise('cat /sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj 2>/dev/null || echo "0"');
            const energy = parseInt(stdout.trim());
            if (energy > 0) {
              // Would need delta calculation over time for accurate power
            }
          } catch {
            // Ignore
          }
        }
      } catch {
        power.source = 'AC';
      }
    } else if (this._isMacOS) {
      try {
        const { stdout } = await execPromise('pmset -g batt 2>/dev/null || true');
        
        const acMatch = stdout.match(/AC Power/);
        const batteryMatch = stdout.match(/Battery Power/);
        const percentMatch = stdout.match(/(\d+)%/);
        
        if (acMatch) {
          power.source = 'AC';
        } else if (batteryMatch) {
          power.source = 'battery';
        }

        if (percentMatch) {
          power.battery = {
            level: parseInt(percentMatch[1]),
            status: acMatch ? 'charging' : 'discharging',
          };
        }
      } catch {
        // Ignore
      }
    }

    return power;
  }

  async thermalZones(): Promise<ThermalZone[]> {
    const zones: ThermalZone[] = [];

    if (this._isLinux) {
      try {
        // Read thermal zones from /sys/class/thermal
        const { stdout } = await execPromise('find /sys/class/thermal -name "thermal_zone*" -type d 2>/dev/null');
        const zonePaths = stdout.trim().split('\n').filter(Boolean);

        for (const zonePath of zonePaths) {
          try {
            const { stdout: type } = await execPromise(`cat ${zonePath}/type 2>/dev/null || echo "unknown"`);
            const { stdout: temp } = await execPromise(`cat ${zonePath}/temp 2>/dev/null || echo "0"`);

            const temperature = parseInt(temp.trim()) / 1000; // Convert millidegrees to degrees
            const zoneName = path.basename(zonePath);
            const zoneType = type.trim();

            let status: ThermalZone['status'] = 'normal';
            if (temperature > this.thresholds.thermal.critical) {
              status = 'critical';
            } else if (temperature > this.thresholds.thermal.warning) {
              status = 'warm';
            } else if (temperature > 40) {
              status = 'hot';
            }

            zones.push({
              zone: zoneName,
              temperature,
              type: zoneType,
              status,
            });
          } catch {
            // Skip this zone
          }
        }
      } catch {
        // Thermal monitoring not available
      }

      // Also try hwmon
      if (zones.length === 0) {
        try {
          const { stdout } = await execPromise('find /sys/class/hwmon -name "hwmon*" -type d 2>/dev/null');
          const hwmonPaths = stdout.trim().split('\n').filter(Boolean);

          for (const hwmonPath of hwmonPaths) {
            try {
              const { stdout: name } = await execPromise(`cat ${hwmonPath}/name 2>/dev/null || echo "unknown"`);
              
              // Find temperature inputs
              const { stdout: tempFiles } = await execPromise(`find ${hwmonPath} -name "temp*_input" 2>/dev/null`);
              
              for (const tempFile of tempFiles.trim().split('\n').filter(Boolean)) {
                const { stdout: temp } = await execPromise(`cat ${tempFile} 2>/dev/null || echo "0"`);
                const temperature = parseInt(temp.trim()) / 1000;

                const labelFile = tempFile.replace('_input', '_label');
                let label = path.basename(tempFile);
                try {
                  const { stdout: labelText } = await execPromise(`cat ${labelFile} 2>/dev/null || echo ""`);
                  if (labelText.trim()) label = labelText.trim();
                } catch {
                  // Ignore
                }

                let status: ThermalZone['status'] = 'normal';
                if (temperature > this.thresholds.thermal.critical) {
                  status = 'critical';
                } else if (temperature > this.thresholds.thermal.warning) {
                  status = 'warm';
                }

                zones.push({
                  zone: `${name.trim()}_${label}`,
                  temperature,
                  type: name.trim(),
                  status,
                });
              }
            } catch {
              // Skip this hwmon
            }
          }
        } catch {
          // Ignore
        }
      }
    } else if (this._isMacOS) {
      // macOS thermal monitoring is limited without additional tools
      try {
        const { stdout } = await execPromise('osx-cpu-temp 2>/dev/null || true');
        const temp = parseFloat(stdout.trim());
        if (!isNaN(temp)) {
          zones.push({
            zone: 'cpu',
            temperature: temp,
            type: 'CPU',
            status: temp > this.thresholds.thermal.critical ? 'critical' : 
                    temp > this.thresholds.thermal.warning ? 'warm' : 'normal',
          });
        }
      } catch {
        // Ignore
      }
    }

    return zones;
  }

  async fanSpeed(): Promise<FanInfo[]> {
    const fans: FanInfo[] = [];

    if (this._isLinux) {
      try {
        const { stdout } = await execPromise('find /sys/class/hwmon -name "hwmon*" -type d 2>/dev/null');
        const hwmonPaths = stdout.trim().split('\n').filter(Boolean);

        for (const hwmonPath of hwmonPaths) {
          try {
            // Find fan inputs
            const { stdout: fanFiles } = await execPromise(`find ${hwmonPath} -name "fan*_input" 2>/dev/null`);
            
            for (const fanFile of fanFiles.trim().split('\n').filter(Boolean)) {
              const { stdout: rpm } = await execPromise(`cat ${fanFile} 2>/dev/null || echo "0"`);
              const speed = parseInt(rpm.trim());

              const labelFile = fanFile.replace('_input', '_label');
              let name = path.basename(fanFile);
              try {
                const { stdout: labelText } = await execPromise(`cat ${labelFile} 2>/dev/null || echo ""`);
                if (labelText.trim()) name = labelText.trim();
              } catch {
                // Ignore
              }

              let status: FanInfo['status'] = 'ok';
              if (speed === 0) {
                status = 'warning';
              }

              fans.push({
                name,
                rpm: speed > 0 ? speed : undefined,
                status,
              });
            }
          } catch {
            // Skip this hwmon
          }
        }
      } catch {
        // Fan monitoring not available
      }
    } else if (this._isMacOS) {
      try {
        const { stdout } = await execPromise('sudo powermetrics --samplers smc -n 1 2>/dev/null | grep Fan || true');
        // Parse fan speed from powermetrics
      } catch {
        // Ignore
      }
    }

    return fans;
  }

  // ===========================================================================
  // SYSTEM INFO
  // ===========================================================================

  systemUptime(): number {
    return os.uptime();
  }

  bootTime(): Date {
    return new Date(Date.now() - os.uptime() * 1000);
  }

  hostname(): string {
    return os.hostname();
  }

  platform(): string {
    return os.platform();
  }

  release(): string {
    return os.release();
  }

  arch(): string {
    return os.arch();
  }

  // ===========================================================================
  // ALERTS
  // ===========================================================================

  async getAlerts(metrics?: HardwareMetrics): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const data = metrics || await this.collectAll();

    // CPU alerts
    if (data.cpu.usage.average > this.thresholds.cpu.critical) {
      alerts.push({
        type: 'cpu',
        severity: 'critical',
        message: `CPU usage is critical: ${data.cpu.usage.average}%`,
        value: data.cpu.usage.average,
        threshold: this.thresholds.cpu.critical,
        timestamp: new Date(),
      });
    } else if (data.cpu.usage.average > this.thresholds.cpu.warning) {
      alerts.push({
        type: 'cpu',
        severity: 'warning',
        message: `CPU usage is high: ${data.cpu.usage.average}%`,
        value: data.cpu.usage.average,
        threshold: this.thresholds.cpu.warning,
        timestamp: new Date(),
      });
    }

    if (data.cpu.temperature?.main && data.cpu.temperature.main > this.thresholds.cpu.temperatureCritical) {
      alerts.push({
        type: 'cpu',
        severity: 'critical',
        message: `CPU temperature is critical: ${data.cpu.temperature.main}°C`,
        value: data.cpu.temperature.main,
        threshold: this.thresholds.cpu.temperatureCritical,
        timestamp: new Date(),
      });
    } else if (data.cpu.temperature?.main && data.cpu.temperature.main > this.thresholds.cpu.temperatureWarning) {
      alerts.push({
        type: 'cpu',
        severity: 'warning',
        message: `CPU temperature is high: ${data.cpu.temperature.main}°C`,
        value: data.cpu.temperature.main,
        threshold: this.thresholds.cpu.temperatureWarning,
        timestamp: new Date(),
      });
    }

    // Memory alerts
    if (data.memory.usage.percentage > this.thresholds.memory.critical) {
      alerts.push({
        type: 'memory',
        severity: 'critical',
        message: `Memory usage is critical: ${data.memory.usage.percentage}%`,
        value: data.memory.usage.percentage,
        threshold: this.thresholds.memory.critical,
        timestamp: new Date(),
      });
    } else if (data.memory.usage.percentage > this.thresholds.memory.warning) {
      alerts.push({
        type: 'memory',
        severity: 'warning',
        message: `Memory usage is high: ${data.memory.usage.percentage}%`,
        value: data.memory.usage.percentage,
        threshold: this.thresholds.memory.warning,
        timestamp: new Date(),
      });
    }

    // Disk alerts
    for (const mount of data.disks.mounts) {
      if (mount.percentage > this.thresholds.disk.critical) {
        alerts.push({
          type: 'disk',
          severity: 'critical',
          message: `Disk usage on ${mount.mountpoint} is critical: ${mount.percentage}%`,
          value: mount.percentage,
          threshold: this.thresholds.disk.critical,
          timestamp: new Date(),
        });
      } else if (mount.percentage > this.thresholds.disk.warning) {
        alerts.push({
          type: 'disk',
          severity: 'warning',
          message: `Disk usage on ${mount.mountpoint} is high: ${mount.percentage}%`,
          value: mount.percentage,
          threshold: this.thresholds.disk.warning,
          timestamp: new Date(),
        });
      }
    }

    // Network alerts
    if (data.network.latency?.internet?.packetLoss && 
        data.network.latency.internet.packetLoss > this.thresholds.network.packetLossCritical) {
      alerts.push({
        type: 'network',
        severity: 'critical',
        message: `Critical packet loss: ${data.network.latency.internet.packetLoss}%`,
        value: data.network.latency.internet.packetLoss,
        threshold: this.thresholds.network.packetLossCritical,
        timestamp: new Date(),
      });
    }

    // GPU alerts
    if (data.gpu?.usage) {
      for (const gpu of data.gpu.usage) {
        if (gpu.temperature && gpu.temperature > this.thresholds.gpu.temperatureCritical) {
          alerts.push({
            type: 'gpu',
            severity: 'critical',
            message: `GPU ${gpu.index} temperature is critical: ${gpu.temperature}°C`,
            value: gpu.temperature,
            threshold: this.thresholds.gpu.temperatureCritical,
            timestamp: new Date(),
          });
        } else if (gpu.temperature && gpu.temperature > this.thresholds.gpu.temperatureWarning) {
          alerts.push({
            type: 'gpu',
            severity: 'warning',
            message: `GPU ${gpu.index} temperature is high: ${gpu.temperature}°C`,
            value: gpu.temperature,
            threshold: this.thresholds.gpu.temperatureWarning,
            timestamp: new Date(),
          });
        }
      }
    }

    // Thermal alerts
    for (const zone of data.thermal) {
      if (zone.temperature > this.thresholds.thermal.critical) {
        alerts.push({
          type: 'thermal',
          severity: 'critical',
          message: `Thermal zone ${zone.zone} is critical: ${zone.temperature}°C`,
          value: zone.temperature,
          threshold: this.thresholds.thermal.critical,
          timestamp: new Date(),
        });
      }
    }

    return alerts;
  }

  // ===========================================================================
  // COLLECTION & WATCHING
  // ===========================================================================

  async collectAll(): Promise<HardwareMetrics> {
    const timestamp = new Date();

    // Run independent operations in parallel
    const [
      cpuInfo,
      cpuUsage,
      cpuLoad,
      cpuTemp,
      cpuFreq,
      memUsage,
      memInfo,
      swapUsage,
      memPressure,
      diskMounts,
      diskIO,
      diskHealth,
      diskInfo,
      netInterfaces,
      netUsage,
      netSpeed,
      netLatency,
      gpuInfo,
      gpuUsage,
      power,
      thermal,
      fans,
    ] = await Promise.all([
      this.cpuInfo(),
      this.cpuUsage(),
      this.cpuLoad(),
      this.cpuTemperature().catch(() => undefined),
      this.cpuFrequency().catch(() => undefined),
      this.memoryUsage(),
      this.memoryInfo().catch(() => undefined),
      this.swapUsage(),
      this.memoryPressure(),
      this.diskUsage(),
      this.diskIO(),
      this.diskHealth().catch(() => []),
      this.diskInfo(),
      this.networkInterfaces(),
      this.networkUsage(),
      this.networkSpeed(),
      this.networkLatency().catch(() => undefined),
      this.gpuInfo().catch(() => undefined),
      this.gpuUsage().catch(() => undefined),
      this.powerUsage(),
      this.thermalZones(),
      this.fanSpeed(),
    ]);

    const metrics: HardwareMetrics = {
      timestamp,
      system: {
        hostname: this.hostname(),
        platform: this.platform(),
        release: this.release(),
        arch: this.arch(),
        uptime: this.systemUptime(),
        bootTime: this.bootTime(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      cpu: {
        info: cpuInfo,
        usage: cpuUsage,
        temperature: cpuTemp,
        frequency: cpuFreq,
        load: cpuLoad,
      },
      memory: {
        usage: memUsage,
        info: memInfo,
        swap: swapUsage,
        pressure: memPressure,
      },
      disks: {
        mounts: diskMounts,
        io: diskIO,
        health: diskHealth,
        info: diskInfo,
      },
      network: {
        interfaces: netInterfaces,
        stats: netUsage,
        speed: netSpeed,
        latency: netLatency,
      },
      gpu: gpuInfo && gpuUsage ? {
        info: gpuInfo,
        usage: gpuUsage,
      } : undefined,
      power,
      thermal,
      fans,
      alerts: [], // Will be populated below
    };

    // Generate alerts
    metrics.alerts = await this.getAlerts(metrics);

    return metrics;
  }

  watch(options: WatchOptions): () => void {
    const stop = () => {
      if (this.watchInterval) {
        clearInterval(this.watchInterval);
        this.watchInterval = undefined;
      }
    };

    stop(); // Clear any existing watch

    this.watchInterval = setInterval(async () => {
      try {
        let metrics = await this.collectAll();

        // Filter metrics if specified
        if (options.include || options.exclude) {
          metrics = this.filterMetrics(metrics, options.include, options.exclude);
        }

        if (options.callback) {
          options.callback(metrics);
        }

        if (options.alertCallback && metrics.alerts.length > 0) {
          options.alertCallback(metrics.alerts);
        }
      } catch (error) {
        console.error('Hardware monitoring error:', error);
      }
    }, options.interval);

    return stop;
  }

  private filterMetrics(
    metrics: HardwareMetrics,
    include?: (keyof HardwareMetrics)[],
    exclude?: (keyof HardwareMetrics)[]
  ): HardwareMetrics {
    const filtered = { ...metrics } as Partial<HardwareMetrics>;

    if (include) {
      const keys = Object.keys(metrics) as (keyof HardwareMetrics)[];
      for (const key of keys) {
        if (!include.includes(key)) {
          delete filtered[key];
        }
      }
    }

    if (exclude) {
      for (const key of exclude) {
        delete filtered[key];
      }
    }

    // Always keep timestamp and system
    filtered.timestamp = metrics.timestamp;
    filtered.system = metrics.system;
    filtered.alerts = metrics.alerts;

    return filtered as HardwareMetrics;
  }

  // ===========================================================================
  // REPORTING
  // ===========================================================================

  async generateReport(format: 'json' | 'markdown' | 'html' = 'json'): Promise<string> {
    const metrics = await this.collectAll();

    switch (format) {
      case 'json':
        return JSON.stringify(metrics, null, 2);

      case 'markdown':
        return this.generateMarkdownReport(metrics);

      case 'html':
        return this.generateHtmlReport(metrics);

      default:
        return JSON.stringify(metrics, null, 2);
    }
  }

  private generateMarkdownReport(metrics: HardwareMetrics): string {
    const report = [
      '# Hardware Monitoring Report',
      `\nGenerated: ${metrics.timestamp.toISOString()}`,
      `\n## System Information`,
      `- **Hostname:** ${metrics.system.hostname}`,
      `- **Platform:** ${metrics.system.platform} ${metrics.system.release}`,
      `- **Architecture:** ${metrics.system.arch}`,
      `- **Uptime:** ${this.formatDuration(metrics.system.uptime)}`,
      `- **Boot Time:** ${metrics.system.bootTime.toISOString()}`,

      `\n## CPU`,
      `- **Model:** ${metrics.cpu.info.model}`,
      `- **Cores:** ${metrics.cpu.info.physicalCores} physical / ${metrics.cpu.info.cores} logical`,
      `- **Usage:** ${metrics.cpu.usage.average}% average`,
      `- **Load:** ${metrics.cpu.load['1min']} (1m) / ${metrics.cpu.load['5min']} (5m) / ${metrics.cpu.load['15min']} (15m)`,
    ];

    if (metrics.cpu.temperature) {
      report.push(`- **Temperature:** ${metrics.cpu.temperature.main}°C (max: ${metrics.cpu.temperature.max}°C)`);
    }

    report.push(
      `\n## Memory`,
      `- **Total:** ${metrics.memory.usage.total} GB`,
      `- **Used:** ${metrics.memory.usage.used} GB (${metrics.memory.usage.percentage}%)`,
      `- **Available:** ${metrics.memory.usage.available} GB`,
      `- **Swap:** ${metrics.memory.swap.used} GB / ${metrics.memory.swap.total} GB`,
      `- **Pressure:** ${metrics.memory.pressure.level} (${metrics.memory.pressure.details})`
    );

    report.push(`\n## Disk`);
    for (const mount of metrics.disks.mounts) {
      report.push(`- **${mount.mountpoint}:** ${mount.used} GB / ${mount.total} GB (${mount.percentage}%)`);
    }

    report.push(`\n## Network`);
    for (const iface of metrics.network.interfaces.filter(i => i.type !== 'loopback')) {
      const stats = metrics.network.stats.find(s => s.interface === iface.name);
      if (stats) {
        report.push(`- **${iface.name}:** RX: ${this.formatBytes(stats.rxBytes)}, TX: ${this.formatBytes(stats.txBytes)}`);
      }
    }

    if (metrics.network.latency?.internet) {
      report.push(`- **Internet Latency:** ${metrics.network.latency.internet.latency}ms`);
    }

    if (metrics.gpu) {
      report.push(`\n## GPU`);
      for (const gpu of metrics.gpu.info) {
        const usage = metrics.gpu.usage.find(u => u.index === gpu.index);
        report.push(`- **${gpu.model}:** ${usage?.utilization || 0}% utilization`);
      }
    }

    if (metrics.alerts.length > 0) {
      report.push(`\n## Alerts`,
        ...metrics.alerts.map(a => `- **[${a.severity.toUpperCase()}]** ${a.message}`)
      );
    }

    return report.join('\n');
  }

  private generateHtmlReport(metrics: HardwareMetrics): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>Hardware Monitoring Report</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
    h1, h2 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    .critical { color: #dc3545; }
    .warning { color: #ffc107; }
    .ok { color: #28a745; }
  </style>
</head>
<body>
  <h1>Hardware Monitoring Report</h1>
  <p>Generated: ${metrics.timestamp.toISOString()}</p>
  
  <h2>System</h2>
  <table>
    <tr><td>Hostname</td><td>${metrics.system.hostname}</td></tr>
    <tr><td>Platform</td><td>${metrics.system.platform} ${metrics.system.release}</td></tr>
    <tr><td>Architecture</td><td>${metrics.system.arch}</td></tr>
    <tr><td>Uptime</td><td>${this.formatDuration(metrics.system.uptime)}</td></tr>
  </table>

  <h2>CPU</h2>
  <table>
    <tr><td>Model</td><td>${metrics.cpu.info.model}</td></tr>
    <tr><td>Usage</td><td>${metrics.cpu.usage.average}%</td></tr>
    <tr><td>Load</td><td>${metrics.cpu.load['1min']} / ${metrics.cpu.load['5min']} / ${metrics.cpu.load['15min']}</td></tr>
    ${metrics.cpu.temperature ? `<tr><td>Temperature</td><td>${metrics.cpu.temperature.main}°C</td></tr>` : ''}
  </table>

  <h2>Memory</h2>
  <table>
    <tr><td>Total</td><td>${metrics.memory.usage.total} GB</td></tr>
    <tr><td>Used</td><td class="${metrics.memory.usage.percentage > 80 ? 'warning' : 'ok'}">${metrics.memory.usage.used} GB (${metrics.memory.usage.percentage}%)</td></tr>
    <tr><td>Swap</td><td>${metrics.memory.swap.used} GB / ${metrics.memory.swap.total} GB</td></tr>
  </table>

  ${metrics.alerts.length > 0 ? `
  <h2>Alerts</h2>
  <ul>
    ${metrics.alerts.map(a => `<li class="${a.severity}"><strong>${a.severity.toUpperCase()}:</strong> ${a.message}</li>`).join('')}
  </ul>
  ` : ''}
</body>
</html>`;
  }

  // ===========================================================================
  // PROMETHEUS EXPORT
  // ===========================================================================

  async exportMetrics(): Promise<string> {
    const metrics = await this.collectAll();
    const lines: string[] = [];

    // Helper to add metric
    const addMetric = (name: string, value: number | string, labels: Record<string, string> = {}, help?: string, type?: string) => {
      if (help) lines.push(`# HELP ${name} ${help}`);
      if (type) lines.push(`# TYPE ${name} ${type}`);
      const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',');
      lines.push(`${name}${labelStr ? `{${labelStr}}` : ''} ${value}`);
    };

    // CPU metrics
    addMetric('node_cpu_info', 1, {
      model: metrics.cpu.info.model,
      cores: String(metrics.cpu.info.cores),
      architecture: metrics.cpu.info.architecture,
    }, 'CPU information', 'gauge');

    addMetric('node_cpu_usage_percent', metrics.cpu.usage.average, {}, 'Average CPU usage percentage', 'gauge');
    
    for (const core of metrics.cpu.usage.cores) {
      addMetric('node_cpu_core_usage_percent', core.usage, { core: String(core.core) }, undefined, 'gauge');
    }

    addMetric('node_load1', metrics.cpu.load['1min'], {}, '1 minute load average', 'gauge');
    addMetric('node_load5', metrics.cpu.load['5min'], {}, '5 minute load average', 'gauge');
    addMetric('node_load15', metrics.cpu.load['15min'], {}, '15 minute load average', 'gauge');

    if (metrics.cpu.temperature?.main) {
      addMetric('node_cpu_temperature_celsius', metrics.cpu.temperature.main, {}, 'CPU temperature in Celsius', 'gauge');
    }

    // Memory metrics
    addMetric('node_memory_total_bytes', Math.round(metrics.memory.usage.total * 1024 * 1024 * 1024), {}, 'Total memory in bytes', 'gauge');
    addMetric('node_memory_used_bytes', Math.round(metrics.memory.usage.used * 1024 * 1024 * 1024), {}, 'Used memory in bytes', 'gauge');
    addMetric('node_memory_free_bytes', Math.round(metrics.memory.usage.free * 1024 * 1024 * 1024), {}, 'Free memory in bytes', 'gauge');
    addMetric('node_memory_available_bytes', Math.round(metrics.memory.usage.available * 1024 * 1024 * 1024), {}, 'Available memory in bytes', 'gauge');
    addMetric('node_memory_buffers_bytes', Math.round(metrics.memory.usage.buffers * 1024 * 1024 * 1024), {}, 'Buffer cache in bytes', 'gauge');
    addMetric('node_memory_cached_bytes', Math.round(metrics.memory.usage.cached * 1024 * 1024 * 1024), {}, 'Cached memory in bytes', 'gauge');
    addMetric('node_memory_swap_total_bytes', Math.round(metrics.memory.swap.total * 1024 * 1024 * 1024), {}, 'Total swap in bytes', 'gauge');
    addMetric('node_memory_swap_used_bytes', Math.round(metrics.memory.swap.used * 1024 * 1024 * 1024), {}, 'Used swap in bytes', 'gauge');

    // Disk metrics
    for (const mount of metrics.disks.mounts) {
      const labels = { mountpoint: mount.mountpoint, filesystem: mount.filesystem };
      addMetric('node_filesystem_size_bytes', Math.round(mount.total * 1024 * 1024 * 1024), labels, 'Filesystem size in bytes', 'gauge');
      addMetric('node_filesystem_used_bytes', Math.round(mount.used * 1024 * 1024 * 1024), labels, 'Filesystem used bytes', 'gauge');
      addMetric('node_filesystem_free_bytes', Math.round(mount.free * 1024 * 1024 * 1024), labels, 'Filesystem free bytes', 'gauge');
      addMetric('node_filesystem_usage_percent', mount.percentage, labels, 'Filesystem usage percentage', 'gauge');
    }

    for (const io of metrics.disks.io) {
      const labels = { device: io.device };
      addMetric('node_disk_read_bytes_total', io.readBytes, labels, 'Total disk read bytes', 'counter');
      addMetric('node_disk_written_bytes_total', io.writeBytes, labels, 'Total disk written bytes', 'counter');
      addMetric('node_disk_io_read_ops', io.readOps, labels, 'Total disk read operations', 'counter');
      addMetric('node_disk_io_write_ops', io.writeOps, labels, 'Total disk write operations', 'counter');
    }

    // Network metrics
    for (const iface of metrics.network.interfaces) {
      const labels = { interface: iface.name, type: iface.type };
      addMetric('node_network_info', 1, { ...labels, mac: iface.mac || 'unknown' }, 'Network interface information', 'gauge');
      addMetric('node_network_up', iface.status === 'up' ? 1 : 0, labels, 'Network interface up status', 'gauge');
    }

    for (const stat of metrics.network.stats) {
      const labels = { interface: stat.interface };
      addMetric('node_network_receive_bytes_total', stat.rxBytes, labels, 'Total received bytes', 'counter');
      addMetric('node_network_transmit_bytes_total', stat.txBytes, labels, 'Total transmitted bytes', 'counter');
      addMetric('node_network_receive_packets_total', stat.rxPackets, labels, 'Total received packets', 'counter');
      addMetric('node_network_transmit_packets_total', stat.txPackets, labels, 'Total transmitted packets', 'counter');
      addMetric('node_network_receive_errors_total', stat.rxErrors, labels, 'Total receive errors', 'counter');
      addMetric('node_network_transmit_errors_total', stat.txErrors, labels, 'Total transmit errors', 'counter');
    }

    // GPU metrics
    if (metrics.gpu?.usage) {
      for (const gpu of metrics.gpu.usage) {
        const labels = { gpu: String(gpu.index) };
        const info = metrics.gpu.info.find(i => i.index === gpu.index);
        if (info) {
          addMetric('node_gpu_info', 1, { ...labels, model: info.model, vendor: info.vendor }, 'GPU information', 'gauge');
        }
        addMetric('node_gpu_usage_percent', gpu.utilization, labels, 'GPU utilization percentage', 'gauge');
        addMetric('node_gpu_memory_used_bytes', Math.round(gpu.memoryUsed * 1024 * 1024), labels, 'GPU memory used in bytes', 'gauge');
        addMetric('node_gpu_memory_total_bytes', Math.round(gpu.memoryTotal * 1024 * 1024), labels, 'GPU memory total in bytes', 'gauge');
        if (gpu.temperature) {
          addMetric('node_gpu_temperature_celsius', gpu.temperature, labels, 'GPU temperature in Celsius', 'gauge');
        }
      }
    }

    // Power metrics
    if (metrics.power.battery) {
      addMetric('node_battery_level_percent', metrics.power.battery.level, {}, 'Battery level percentage', 'gauge');
      addMetric('node_battery_status', metrics.power.battery.status === 'charging' ? 1 : 0, {}, 'Battery charging status', 'gauge');
    }

    // Thermal metrics
    for (const zone of metrics.thermal) {
      addMetric('node_thermal_zone_temp_celsius', zone.temperature, { zone: zone.zone, type: zone.type || 'unknown' }, 'Thermal zone temperature', 'gauge');
    }

    // Fan metrics
    for (const fan of metrics.fans) {
      addMetric('node_fan_rpm', fan.rpm || 0, { name: fan.name }, 'Fan speed in RPM', 'gauge');
    }

    // Uptime
    addMetric('node_time_seconds', Math.floor(Date.now() / 1000), {}, 'System time in seconds since epoch', 'gauge');
    addMetric('node_boot_time_seconds', Math.floor(metrics.system.bootTime.getTime() / 1000), {}, 'System boot time in seconds since epoch', 'gauge');
    addMetric('node_uptime_seconds', metrics.system.uptime, {}, 'System uptime in seconds', 'gauge');

    return lines.join('\n');
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  private formatDuration(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);

    return parts.join(' ') || '< 1m';
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let value = bytes;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    return `${Math.round(value * 100) / 100} ${units[i]}`;
  }

  // ===========================================================================
  // THRESHOLD MANAGEMENT
  // ===========================================================================

  setThresholds(thresholds: Partial<Thresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  getThresholds(): Thresholds {
    return { ...this.thresholds };
  }

  resetThresholds(): void {
    this.thresholds = { ...DEFAULT_THRESHOLDS };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const hardwareMonitor = new HardwareMonitor();

// =============================================================================
// TYPE EXPORTS
// =============================================================================

// NetworkInfo is an alias combining interfaces and stats
export type NetworkInfo = {
  interfaces: NetworkInterface[];
  stats: NetworkStats[];
};
