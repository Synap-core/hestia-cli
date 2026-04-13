#!/usr/bin/env node
// @ts-nocheck
/**
 * hardware command - Hardware monitoring and reporting
 * Usage: hestia hardware [subcommand] [options]
 */

import { Command } from 'commander';
import { hardwareMonitor, HardwareMetrics, Alert } from '../../../domains/install/lib/hardware-monitor.js';
import { logger } from '../../lib/utils/index';
import chalk from 'chalk';
import * as fs from 'fs/promises';

interface HardwareOptions {
  json?: boolean;
  watch?: boolean;
  export?: string;
  interval?: string;
  format?: string;
  output?: string;
}

// Color thresholds
const THRESHOLDS = {
  warning: 70,
  critical: 85,
};

function colorByUsage(percentage: number): string {
  if (percentage > THRESHOLDS.critical) {
    return chalk.red(`${percentage}%`);
  } else if (percentage >= THRESHOLDS.warning) {
    return chalk.yellow(`${percentage}%`);
  } else {
    return chalk.green(`${percentage}%`);
  }
}

function colorByStatus(status: string): string {
  switch (status) {
    case 'ok':
    case 'up':
    case 'healthy':
    case 'normal':
      return chalk.green(status);
    case 'warning':
    case 'degraded':
    case 'warm':
    case 'hot':
      return chalk.yellow(status);
    case 'critical':
    case 'error':
    case 'down':
    case 'unhealthy':
      return chalk.red(status);
    default:
      return chalk.gray(status);
  }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${Math.round(value * 100) / 100} ${units[i]}`;
}

function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function hardwareCommand(program: Command): void {
  // Main hardware command - Show summary
  program
    .command('hardware')
    .description('Show hardware summary (CPU, memory, disk, network)')
    .option('-j, --json', 'Output as JSON')
    .option('-w, --watch', 'Watch mode - continuously update')
    .option('-e, --export <file>', 'Export metrics to file')
    .action(async (options: HardwareOptions) => {
      try {
        if (options.watch) {
          await watchHardware(options as HardwareOptions & { interval: number });
        } else {
          await showHardwareSummary(options);
        }
      } catch (error: any) {
        logger.error(`Hardware monitoring failed: ${error.message}`);
        process.exit(1);
      }
    });

  // hardware:watch - Continuous monitoring
  program
    .command('hardware:watch')
    .description('Continuous hardware monitoring with real-time updates')
    .option('-i, --interval <seconds>', 'Update interval in seconds', '5')
    .action(async (options: HardwareOptions & { interval?: string }) => {
      try {
        const intervalMs = parseInt(options.interval || '5', 10) * 1000;
        await watchHardware({ ...options, interval: intervalMs as unknown as string });
      } catch (error: any) {
        logger.error(`Hardware watch failed: ${error.message}`);
        process.exit(1);
      }
    });

  // hardware:cpu - CPU details
  program
    .command('hardware:cpu')
    .description('Show CPU details (usage, temperature, frequency, load)')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: HardwareOptions) => {
      try {
        await showCPUDetails(options);
      } catch (error: any) {
        logger.error(`CPU monitoring failed: ${error.message}`);
        process.exit(1);
      }
    });

  // hardware:memory - Memory details
  program
    .command('hardware:memory')
    .description('Show memory details (RAM and swap usage)')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: HardwareOptions) => {
      try {
        await showMemoryDetails(options);
      } catch (error: any) {
        logger.error(`Memory monitoring failed: ${error.message}`);
        process.exit(1);
      }
    });

  // hardware:disk - Disk details
  program
    .command('hardware:disk')
    .description('Show disk details (mountpoints, I/O, SMART health)')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: HardwareOptions) => {
      try {
        await showDiskDetails(options);
      } catch (error: any) {
        logger.error(`Disk monitoring failed: ${error.message}`);
        process.exit(1);
      }
    });

  // hardware:network - Network details
  program
    .command('hardware:network')
    .description('Show network details (interfaces, rates, latency)')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: HardwareOptions) => {
      try {
        await showNetworkDetails(options);
      } catch (error: any) {
        logger.error(`Network monitoring failed: ${error.message}`);
        process.exit(1);
      }
    });

  // hardware:gpu - GPU details
  program
    .command('hardware:gpu')
    .description('Show GPU details (utilization, memory, temperature)')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: HardwareOptions) => {
      try {
        await showGPUDetails(options);
      } catch (error: any) {
        logger.error(`GPU monitoring failed: ${error.message}`);
        process.exit(1);
      }
    });

  // hardware:thermal - Thermal status
  program
    .command('hardware:thermal')
    .description('Show thermal status (thermal zones, fan speeds)')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: HardwareOptions) => {
      try {
        await showThermalDetails(options);
      } catch (error: any) {
        logger.error(`Thermal monitoring failed: ${error.message}`);
        process.exit(1);
      }
    });

  // hardware:report - Generate report
  program
    .command('hardware:report')
    .description('Generate comprehensive hardware report')
    .option('-f, --format <format>', 'Report format (json|md|html)', 'md')
    .option('-o, --output <file>', 'Output file path')
    .action(async (options: HardwareOptions) => {
      try {
        await generateReport(options);
      } catch (error: any) {
        logger.error(`Report generation failed: ${error.message}`);
        process.exit(1);
      }
    });

  // hardware:alerts - Check alerts
  program
    .command('hardware:alerts')
    .description('Check current hardware alerts and suggest actions')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: HardwareOptions) => {
      try {
        await showAlerts(options);
      } catch (error: any) {
        logger.error(`Alert check failed: ${error.message}`);
        process.exit(1);
      }
    });
}

// ============================================================================
// SUMMARY DISPLAY
// ============================================================================

async function showHardwareSummary(options: HardwareOptions): Promise<void> {
  const metrics = await hardwareMonitor.collectAll();

  if (options.json) {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  if (options.export) {
    await exportMetrics(metrics, options.export);
    return;
  }

  logger.header('HARDWARE SUMMARY');
  logger.newline();

  // System info
  logger.info(`Hostname: ${chalk.cyan(metrics.system.hostname)}`);
  logger.info(`Platform: ${chalk.cyan(metrics.system.platform)} ${metrics.system.release}`);
  logger.info(`Architecture: ${chalk.cyan(metrics.system.arch)}`);
  logger.info(`Uptime: ${chalk.cyan(formatDuration(metrics.system.uptime))}`);
  logger.newline();

  // CPU summary
  logger.section('CPU');
  logger.info(`Model: ${chalk.cyan(metrics.cpu.info.model)}`);
  logger.info(`Usage: ${colorByUsage(metrics.cpu.usage.average)}`);
  logger.info(`Cores: ${chalk.cyan(metrics.cpu.info.cores)} logical / ${chalk.cyan(metrics.cpu.info.physicalCores)} physical`);
  if (metrics.cpu.temperature?.main) {
    logger.info(`Temperature: ${chalk.cyan(metrics.cpu.temperature.main + '°C')}`);
  }
  logger.newline();

  // Memory summary
  logger.section('Memory');
  logger.info(`Total: ${chalk.cyan(metrics.memory.usage.total.toFixed(2) + ' GB')}`);
  logger.info(`Used: ${chalk.cyan(metrics.memory.usage.used.toFixed(2) + ' GB')} (${colorByUsage(metrics.memory.usage.percentage)})`);
  logger.info(`Available: ${chalk.cyan(metrics.memory.usage.available.toFixed(2) + ' GB')}`);
  if (metrics.memory.swap.total > 0) {
    logger.info(`Swap: ${chalk.cyan(metrics.memory.swap.used.toFixed(2) + ' GB')} / ${chalk.cyan(metrics.memory.swap.total.toFixed(2) + ' GB')}`);
  }
  logger.newline();

  // Disk summary
  logger.section('Disk');
  const rootMount = metrics.disks.mounts.find(m => m.mountpoint === '/');
  if (rootMount) {
    logger.info(`Root (/): ${chalk.cyan(rootMount.used.toFixed(2) + ' GB')} / ${chalk.cyan(rootMount.total.toFixed(2) + ' GB')} (${colorByUsage(rootMount.percentage)})`);
  }
  logger.info(`Mountpoints: ${chalk.cyan(metrics.disks.mounts.length)}`);
  logger.newline();

  // Network summary
  logger.section('Network');
  const activeIfaces = metrics.network.interfaces.filter(i => i.status === 'up' && i.type !== 'loopback');
  logger.info(`Active interfaces: ${chalk.cyan(activeIfaces.length)}`);
  for (const iface of activeIfaces.slice(0, 3)) {
    const speed = metrics.network.speed.find(s => s.interface === iface.name);
    if (speed) {
      logger.info(`  ${chalk.cyan(iface.name)}: RX ${formatSpeed(speed.rxSpeed)}, TX ${formatSpeed(speed.txSpeed)}`);
    } else {
      logger.info(`  ${chalk.cyan(iface.name)}: ${iface.ip4?.join(', ') || 'no IP'}`);
    }
  }
  logger.newline();

  // Alerts summary
  if (metrics.alerts.length > 0) {
    logger.section('Alerts');
    for (const alert of metrics.alerts.slice(0, 5)) {
      const color = alert.severity === 'critical' ? chalk.red : chalk.yellow;
      logger.info(color(`[${alert.severity.toUpperCase()}] ${alert.message}`));
    }
    if (metrics.alerts.length > 5) {
      logger.info(chalk.gray(`... and ${metrics.alerts.length - 5} more alerts`));
    }
    logger.newline();
  }
}

async function watchHardware(options: HardwareOptions & { interval?: number }): Promise<void> {
  const interval = typeof options.interval === 'number' ? options.interval : 5000;

  logger.info(`Starting hardware monitoring (interval: ${interval / 1000}s)`);
  logger.info('Press Ctrl+C to stop\n');

  const run = async (): Promise<void> => {
    process.stdout.write('\x1Bc');

    try {
      const metrics = await hardwareMonitor.collectAll();
      displayWatchView(metrics);
    } catch (error) {
      logger.error('Failed to collect metrics');
    }

    logger.newline();
    logger.info(chalk.gray(`Last update: ${new Date().toLocaleTimeString()} | Press Ctrl+C to stop`));
  };

  await run();
  const timer = setInterval(run, interval);

  process.on('SIGINT', () => {
    clearInterval(timer);
    logger.newline();
    logger.info('Hardware monitoring stopped');
    process.exit(0);
  });
}

function displayWatchView(metrics: HardwareMetrics): void {
  logger.header('HARDWARE MONITOR');
  logger.newline();

  // CPU
  const cpuBar = generateUsageBar(metrics.cpu.usage.average);
  logger.info(`CPU:  ${cpuBar} ${colorByUsage(metrics.cpu.usage.average)} (${metrics.cpu.info.cores} cores)`);

  // Memory
  const memBar = generateUsageBar(metrics.memory.usage.percentage);
  logger.info(`RAM:  ${memBar} ${colorByUsage(metrics.memory.usage.percentage)} (${metrics.memory.usage.used.toFixed(1)}/${metrics.memory.usage.total.toFixed(1)} GB)`);

  // Disks
  for (const mount of metrics.disks.mounts.filter(m => m.percentage > 50 || m.mountpoint === '/').slice(0, 3)) {
    const diskBar = generateUsageBar(mount.percentage);
    logger.info(`Disk: ${diskBar} ${colorByUsage(mount.percentage)} (${mount.mountpoint})`);
  }

  logger.newline();

  // Network
  for (const iface of metrics.network.interfaces.filter(i => i.status === 'up' && i.type !== 'loopback').slice(0, 3)) {
    const speed = metrics.network.speed.find(s => s.interface === iface.name);
    if (speed) {
      logger.info(`${chalk.cyan(iface.name)}: RX ${chalk.green(formatSpeed(speed.rxSpeed))} | TX ${chalk.green(formatSpeed(speed.txSpeed))}`);
    }
  }

  // Alerts
  if (metrics.alerts.length > 0) {
    logger.newline();
    logger.section('Active Alerts');
    for (const alert of metrics.alerts.slice(0, 3)) {
      const color = alert.severity === 'critical' ? chalk.red : chalk.yellow;
      logger.info(color(`⚠ ${alert.message}`));
    }
  }
}

function generateUsageBar(percentage: number): string {
  const filled = Math.round((percentage / 100) * 20);
  const empty = 20 - filled;

  if (percentage > THRESHOLDS.critical) {
    return chalk.red('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  } else if (percentage >= THRESHOLDS.warning) {
    return chalk.yellow('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  } else {
    return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  }
}

// ============================================================================
// CPU DETAILS
// ============================================================================

async function showCPUDetails(options: HardwareOptions): Promise<void> {
  const [
    cpuInfo,
    cpuUsage,
    cpuTemp,
    cpuFreq,
    cpuLoad,
  ] = await Promise.all([
    hardwareMonitor.cpuInfo(),
    hardwareMonitor.cpuUsage(),
    hardwareMonitor.cpuTemperature().catch(() => undefined),
    hardwareMonitor.cpuFrequency().catch(() => undefined),
    hardwareMonitor.cpuLoad(),
  ]);

  if (options.json) {
    console.log(JSON.stringify({
      info: cpuInfo,
      usage: cpuUsage,
      temperature: cpuTemp,
      frequency: cpuFreq,
      load: cpuLoad,
    }, null, 2));
    return;
  }

  logger.header('CPU DETAILS');
  logger.newline();

  logger.section('Information');
  logger.info(`Model: ${chalk.cyan(cpuInfo.model)}`);
  logger.info(`Vendor: ${chalk.cyan(cpuInfo.vendor)}`);
  logger.info(`Architecture: ${chalk.cyan(cpuInfo.architecture)}`);
  logger.info(`Physical Cores: ${chalk.cyan(cpuInfo.physicalCores)}`);
  logger.info(`Logical Cores: ${chalk.cyan(cpuInfo.cores)}`);
  logger.info(`Base Speed: ${chalk.cyan(cpuInfo.speed + ' MHz')}`);
  logger.newline();

  logger.section('Usage');
  logger.info(`Average: ${colorByUsage(cpuUsage.average)}`);
  logger.info(`User: ${chalk.cyan(cpuUsage.user + '%')}`);
  logger.info(`System: ${chalk.cyan(cpuUsage.system + '%')}`);
  logger.info(`Idle: ${chalk.cyan(cpuUsage.idle + '%')}`);
  logger.newline();

  logger.section('Per-Core Breakdown');
  const tableData = cpuUsage.cores.map(core => ({
    CORE: `Core ${core.core}`,
    USAGE: colorByUsage(core.usage),
    FREQUENCY: core.frequency ? `${core.frequency} MHz` : '-',
  }));
  logger.table(tableData);
  logger.newline();

  if (cpuFreq) {
    logger.section('Frequency');
    logger.info(`Current: ${chalk.cyan(cpuFreq.current + ' MHz')}`);
    logger.info(`Min: ${chalk.cyan(cpuFreq.min + ' MHz')}`);
    logger.info(`Max: ${chalk.cyan(cpuFreq.max + ' MHz')}`);
    if (cpuFreq.governor) {
      logger.info(`Governor: ${chalk.cyan(cpuFreq.governor)}`);
    }
    logger.newline();
  }

  if (cpuTemp) {
    logger.section('Temperature');
    logger.info(`Main: ${chalk.cyan(cpuTemp.main + '°C')}`);
    if (cpuTemp.max) {
      logger.info(`Max: ${chalk.cyan(cpuTemp.max + '°C')}`);
    }
    if (cpuTemp.cores.length > 0) {
      logger.info(`Cores: ${cpuTemp.cores.map(t => chalk.cyan(t + '°C')).join(', ')}`);
    }
    logger.newline();
  }

  logger.section('Load Average');
  logger.info(`1 min: ${chalk.cyan(cpuLoad['1min'].toFixed(2))}`);
  logger.info(`5 min: ${chalk.cyan(cpuLoad['5min'].toFixed(2))}`);
  logger.info(`15 min: ${chalk.cyan(cpuLoad['15min'].toFixed(2))}`);
}

// ============================================================================
// MEMORY DETAILS
// ============================================================================

async function showMemoryDetails(options: HardwareOptions): Promise<void> {
  const [
    memUsage,
    memInfo,
    swapUsage,
    memPressure,
  ] = await Promise.all([
    hardwareMonitor.memoryUsage(),
    hardwareMonitor.memoryInfo().catch(() => undefined),
    hardwareMonitor.swapUsage(),
    hardwareMonitor.memoryPressure(),
  ]);

  if (options.json) {
    console.log(JSON.stringify({
      usage: memUsage,
      info: memInfo,
      swap: swapUsage,
      pressure: memPressure,
    }, null, 2));
    return;
  }

  logger.header('MEMORY DETAILS');
  logger.newline();

  logger.section('RAM Usage');
  const memBar = generateUsageBar(memUsage.percentage);
  logger.info(`Progress: ${memBar}`);
  logger.info(`Total: ${chalk.cyan(memUsage.total.toFixed(2) + ' GB')}`);
  logger.info(`Used: ${chalk.cyan(memUsage.used.toFixed(2) + ' GB')} (${colorByUsage(memUsage.percentage)})`);
  logger.info(`Free: ${chalk.cyan(memUsage.free.toFixed(2) + ' GB')}`);
  logger.info(`Available: ${chalk.cyan(memUsage.available.toFixed(2) + ' GB')}`);
  if (memUsage.buffers > 0) {
    logger.info(`Buffers: ${chalk.cyan(memUsage.buffers.toFixed(2) + ' GB')}`);
  }
  if (memUsage.cached > 0) {
    logger.info(`Cached: ${chalk.cyan(memUsage.cached.toFixed(2) + ' GB')}`);
  }
  logger.newline();

  logger.section('Swap Usage');
  if (swapUsage.total > 0) {
    const swapBar = generateUsageBar(swapUsage.percentage);
    logger.info(`Progress: ${swapBar}`);
    logger.info(`Total: ${chalk.cyan(swapUsage.total.toFixed(2) + ' GB')}`);
    logger.info(`Used: ${chalk.cyan(swapUsage.used.toFixed(2) + ' GB')} (${colorByUsage(swapUsage.percentage)})`);
    logger.info(`Free: ${chalk.cyan(swapUsage.free.toFixed(2) + ' GB')}`);
  } else {
    logger.info(chalk.gray('No swap configured'));
  }
  logger.newline();

  logger.section('Memory Pressure');
  const pressureColor = memPressure.level === 'critical' ? chalk.red :
                        memPressure.level === 'warning' ? chalk.yellow :
                        chalk.green;
  logger.info(`Level: ${pressureColor(memPressure.level.toUpperCase())}`);
  logger.info(`Score: ${chalk.cyan(memPressure.score)}`);
  logger.info(`Details: ${chalk.gray(memPressure.details)}`);
  logger.newline();

  if (memInfo) {
    logger.section('Memory Information');
    if (memInfo.type) logger.info(`Type: ${chalk.cyan(memInfo.type)}`);
    if (memInfo.speed) logger.info(`Speed: ${chalk.cyan(memInfo.speed + ' MHz')}`);
    if (memInfo.manufacturer) logger.info(`Manufacturer: ${chalk.cyan(memInfo.manufacturer)}`);
    if (memInfo.slots) {
      logger.info(`Slots: ${chalk.cyan(memInfo.slotsUsed + '/' + memInfo.slots + ' used')}`);
    }
    if (memInfo.voltage) logger.info(`Voltage: ${chalk.cyan(memInfo.voltage + 'V')}`);
  }
}

// ============================================================================
// DISK DETAILS
// ============================================================================

async function showDiskDetails(options: HardwareOptions): Promise<void> {
  const [
    diskMounts,
    diskIO,
    diskHealth,
    diskInfo,
  ] = await Promise.all([
    hardwareMonitor.diskUsage(),
    hardwareMonitor.diskIO(),
    hardwareMonitor.diskHealth().catch(() => []),
    hardwareMonitor.diskInfo(),
  ]);

  if (options.json) {
    console.log(JSON.stringify({
      mounts: diskMounts,
      io: diskIO,
      health: diskHealth,
      info: diskInfo,
    }, null, 2));
    return;
  }

  logger.header('DISK DETAILS');
  logger.newline();

  logger.section('Mountpoints');
  const tableData = diskMounts.map(mount => ({
    MOUNT: mount.mountpoint,
    SIZE: mount.total.toFixed(2) + ' GB',
    USED: mount.used.toFixed(2) + ' GB',
    FREE: mount.free.toFixed(2) + ' GB',
    USAGE: colorByUsage(mount.percentage),
    TYPE: mount.type,
  }));
  logger.table(tableData);
  logger.newline();

  if (diskIO.length > 0) {
    logger.section('Disk I/O');
    const ioTable = diskIO.map(io => ({
      DEVICE: io.device,
      'READ/S': formatSpeed(io.readSpeed),
      'WRITE/S': formatSpeed(io.writeSpeed),
      IOPS: Math.round(io.iops).toString(),
    }));
    logger.table(ioTable);
    logger.newline();
  }

  if (diskHealth.length > 0) {
    logger.section('SMART Health');
    for (const disk of diskHealth) {
      logger.info(`Device: ${chalk.cyan(disk.device)}`);
      logger.info(`  Status: ${colorByStatus(disk.status)}`);
      if (disk.temperature) {
        logger.info(`  Temperature: ${chalk.cyan(disk.temperature + '°C')}`);
      }
      if (disk.powerOnHours) {
        logger.info(`  Power On: ${chalk.cyan(formatDuration(disk.powerOnHours * 3600))}`);
      }
      if (disk.powerCycles) {
        logger.info(`  Power Cycles: ${chalk.cyan(disk.powerCycles.toString())}`);
      }
      if (disk.errors.length > 0) {
        for (const error of disk.errors) {
          logger.error(`  Error: ${error}`);
        }
      }
      logger.newline();
    }
  }

  if (diskInfo.length > 0) {
    logger.section('Disk Information');
    const infoTable = diskInfo.map(d => ({
      DEVICE: d.device,
      MODEL: d.model,
      TYPE: d.type,
      SIZE: d.size.toFixed(2) + ' GB',
      SERIAL: d.serial || '-',
    }));
    logger.table(infoTable);
  }
}

// ============================================================================
// NETWORK DETAILS
// ============================================================================

async function showNetworkDetails(options: HardwareOptions): Promise<void> {
  const [
    interfaces,
    stats,
    speed,
    latency,
  ] = await Promise.all([
    hardwareMonitor.networkInterfaces(),
    hardwareMonitor.networkUsage(),
    hardwareMonitor.networkSpeed(),
    hardwareMonitor.networkLatency().catch(() => undefined),
  ]);

  if (options.json) {
    console.log(JSON.stringify({
      interfaces,
      stats,
      speed,
      latency,
    }, null, 2));
    return;
  }

  logger.header('NETWORK DETAILS');
  logger.newline();

  logger.section('Interfaces');
  const ifaceTable = interfaces.map(iface => {
    const stat = stats.find(s => s.interface === iface.name);
    const _speedData = speed.find(s => s.interface === iface.name);

    return {
      NAME: iface.name,
      TYPE: iface.type,
      STATUS: colorByStatus(iface.status),
      IP: iface.ip4?.[0] || '-',
      RX: stat ? formatBytes(stat.rxBytes) : '-',
      TX: stat ? formatBytes(stat.txBytes) : '-',
    };
  });
  logger.table(ifaceTable);
  logger.newline();

  logger.section('Traffic Rates');
  for (const s of speed.filter(sp => sp.rxSpeed > 0 || sp.txSpeed > 0)) {
    logger.info(`${chalk.cyan(s.interface)}:`);
    logger.info(`  RX: ${chalk.green(formatSpeed(s.rxSpeed))} (peak: ${formatSpeed(s.rxPeak)})`);
    logger.info(`  TX: ${chalk.green(formatSpeed(s.txSpeed))} (peak: ${formatSpeed(s.txPeak)})`);
  }
  logger.newline();

  if (latency) {
    logger.section('Latency Tests');
    if (latency.gateway) {
      logger.info(`Gateway (${latency.gateway.host}):`);
      logger.info(`  Latency: ${chalk.cyan(latency.gateway.latency.toFixed(1) + 'ms')}`);
      logger.info(`  Packet Loss: ${latency.gateway.packetLoss > 0 ? chalk.red(latency.gateway.packetLoss + '%') : chalk.green('0%')}`);
    }
    if (latency.internet) {
      logger.info(`Internet (8.8.8.8):`);
      logger.info(`  Latency: ${chalk.cyan(latency.internet.latency.toFixed(1) + 'ms')}`);
      logger.info(`  Packet Loss: ${latency.internet.packetLoss > 0 ? chalk.red(latency.internet.packetLoss + '%') : chalk.green('0%')}`);
    }
    if (latency.dns) {
      logger.info(`DNS (8.8.8.8):`);
      logger.info(`  Latency: ${chalk.cyan(latency.dns.latency + 'ms')}`);
    }
  }
}

// ============================================================================
// GPU DETAILS
// ============================================================================

async function showGPUDetails(options: HardwareOptions): Promise<void> {
  const [
    gpuInfo,
    gpuUsage,
  ] = await Promise.all([
    hardwareMonitor.gpuInfo().catch(() => undefined),
    hardwareMonitor.gpuUsage().catch(() => undefined),
  ]);

  if (!gpuInfo || gpuInfo.length === 0) {
    logger.info(chalk.yellow('No GPU detected or GPU monitoring not available'));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({
      info: gpuInfo,
      usage: gpuUsage,
    }, null, 2));
    return;
  }

  logger.header('GPU DETAILS');
  logger.newline();

  for (const info of gpuInfo) {
    const usage = gpuUsage?.find(u => u.index === info.index);

    logger.section(`GPU ${info.index}: ${info.model}`);
    logger.info(`Vendor: ${chalk.cyan(info.vendor)}`);
    if (info.driver) logger.info(`Driver: ${chalk.cyan(info.driver)}`);
    if (info.pci) logger.info(`PCI: ${chalk.cyan(info.pci)}`);
    logger.newline();

    if (usage) {
      logger.info(`Utilization: ${colorByUsage(usage.utilization)}`);
      logger.info(`Memory: ${chalk.cyan(usage.memoryUsed.toFixed(0) + ' MB')} / ${chalk.cyan(usage.memoryTotal.toFixed(0) + ' MB')} (${colorByUsage(usage.memoryUtilization)})`);
      if (usage.temperature) {
        logger.info(`Temperature: ${chalk.cyan(usage.temperature + '°C')}`);
      }
      if (usage.power) {
        logger.info(`Power: ${chalk.cyan(usage.power.toFixed(1) + 'W')}`);
      }
      if (usage.fanSpeed) {
        logger.info(`Fan Speed: ${chalk.cyan(usage.fanSpeed + '%')}`);
      }
      if (usage.clockGraphics) {
        logger.info(`Graphics Clock: ${chalk.cyan(usage.clockGraphics + ' MHz')}`);
      }
      if (usage.clockMemory) {
        logger.info(`Memory Clock: ${chalk.cyan(usage.clockMemory + ' MHz')}`);
      }
    }
    logger.newline();
  }
}

// ============================================================================
// THERMAL DETAILS
// ============================================================================

async function showThermalDetails(options: HardwareOptions): Promise<void> {
  const [
    thermal,
    fans,
  ] = await Promise.all([
    hardwareMonitor.thermalZones(),
    hardwareMonitor.fanSpeed(),
  ]);

  if (options.json) {
    console.log(JSON.stringify({
      thermal,
      fans,
    }, null, 2));
    return;
  }

  logger.header('THERMAL STATUS');
  logger.newline();

  if (thermal.length > 0) {
    logger.section('Thermal Zones');
    const thermalTable = thermal.map(zone => ({
      ZONE: zone.zone,
      TYPE: zone.type || '-',
      TEMP: zone.temperature.toFixed(1) + '°C',
      STATUS: colorByStatus(zone.status),
    }));
    logger.table(thermalTable);
    logger.newline();
  } else {
    logger.info(chalk.gray('No thermal zone data available'));
    logger.newline();
  }

  if (fans.length > 0) {
    logger.section('Fan Speeds');
    const fanTable = fans.map(fan => ({
      FAN: fan.name,
      RPM: fan.rpm?.toString() || '-',
      STATUS: colorByStatus(fan.status),
    }));
    logger.table(fanTable);
  } else {
    logger.info(chalk.gray('No fan data available'));
  }
}

// ============================================================================
// ALERTS
// ============================================================================

async function showAlerts(options: HardwareOptions): Promise<void> {
  const alerts = await hardwareMonitor.getAlerts();

  if (options.json) {
    console.log(JSON.stringify(alerts, null, 2));
    return;
  }

  logger.header('HARDWARE ALERTS');
  logger.newline();

  if (alerts.length === 0) {
    logger.success('✓ No active alerts - all systems normal');
    return;
  }

  logger.warn(`Found ${alerts.length} active alert(s)`);
  logger.newline();

  // Group alerts by type
  const grouped = alerts.reduce((acc, alert) => {
    if (!acc[alert.type]) acc[alert.type] = [];
    acc[alert.type].push(alert);
    return acc;
  }, {} as Record<string, Alert[]>);

  for (const [type, typeAlerts] of Object.entries(grouped)) {
    logger.section(type.toUpperCase());
    for (const alert of typeAlerts) {
      const color = alert.severity === 'critical' ? chalk.red : chalk.yellow;
      logger.info(color(`[${alert.severity.toUpperCase()}] ${alert.message}`));
      logger.info(chalk.gray(`  Value: ${alert.value} (threshold: ${alert.threshold})`));
      logger.info(chalk.gray(`  Time: ${alert.timestamp.toLocaleTimeString()}`));
      logger.newline();
    }

    // Suggest actions
    const suggestions = getActionSuggestions(type as Alert['type'], typeAlerts);
    if (suggestions.length > 0) {
      logger.info(chalk.cyan('Suggested actions:'));
      for (const suggestion of suggestions) {
        logger.info(chalk.gray(`  • ${suggestion}`));
      }
      logger.newline();
    }
  }
}

function getActionSuggestions(type: Alert['type'], alerts: Alert[]): string[] {
  const suggestions: string[] = [];

  switch (type) {
    case 'cpu':
      if (alerts.some(a => a.message.includes('usage'))) {
        suggestions.push('Check for high CPU processes: run `top` or `htop`');
        suggestions.push('Consider closing unnecessary applications');
      }
      if (alerts.some(a => a.message.includes('temperature'))) {
        suggestions.push('Check CPU cooling system');
        suggestions.push('Clean dust from fans and heatsinks');
        suggestions.push('Verify thermal paste is properly applied');
      }
      break;

    case 'memory':
      suggestions.push('Check memory usage: run `hestia hardware:memory`');
      suggestions.push('Close applications with high memory usage');
      suggestions.push('Consider adding more RAM if consistently high');
      break;

    case 'disk':
      if (alerts.some(a => a.message.includes('usage'))) {
        suggestions.push('Clean up disk space: remove old logs and temporary files');
        suggestions.push('Check large files: run `du -h / | sort -hr | head -20`');
        suggestions.push('Empty trash and clear package caches');
      }
      if (alerts.some(a => a.message.includes('temperature'))) {
        suggestions.push('Improve case ventilation');
        suggestions.push('Check disk mounting and airflow');
      }
      break;

    case 'network':
      suggestions.push('Check network cable connections');
      suggestions.push('Test with alternative DNS server');
      suggestions.push('Contact ISP if packet loss persists');
      break;

    case 'gpu':
      suggestions.push('Check GPU cooling system');
      suggestions.push('Reduce GPU workload or limit FPS');
      suggestions.push('Update GPU drivers');
      break;

    case 'thermal':
      suggestions.push('Improve system ventilation');
      suggestions.push('Check all fans are working properly');
      suggestions.push('Clean dust from system');
      break;

    case 'power':
      suggestions.push('Check power adapter/battery health');
      suggestions.push('Reduce power consumption by closing unused apps');
      break;
  }

  return suggestions;
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

async function generateReport(options: HardwareOptions): Promise<void> {
  logger.header('GENERATING HARDWARE REPORT');
  logger.newline();

  const format = (options.format || 'md').toLowerCase() as 'json' | 'md' | 'html';
  const output = options.output;

  const report = await hardwareMonitor.generateReport(format === 'md' ? 'markdown' : format);

  if (output) {
    await fs.writeFile(output, report, 'utf-8');
    logger.success(`Report saved to: ${output}`);
  } else {
    console.log(report);
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

async function exportMetrics(metrics: HardwareMetrics, filePath: string): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(metrics, null, 2), 'utf-8');
  logger.success(`Metrics exported to: ${filePath}`);
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.join(' ') || '< 1m';
}
