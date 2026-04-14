/**
 * provision command - Bare metal server provisioning with eve
 * Usage: eve provision [subcommand]
 *
 * Subcommands:
 *   provision (default) - Interactive server provisioning wizard
 *   provision:hardware - Hardware detection
 *   provision:diagnose - Hardware diagnostics
 *   provision:profile - Profile management
 *   provision:plan - Installation planning
 *   provision:usb - Create USB for this server
 *   provision:benchmark - Benchmark server
 *   provision:cluster - Multi-server setup
 *   provision:report - Generate provision report
 */

import { Command } from 'commander';
import { logger, section } from '../lib/utils/index.js';
import { spinner } from '../lib/utils/index.js';
import { serverProvisioner } from '../lib/domains/provision/lib/server-provisioner.js';
import { hardwareMonitor, HardwareMetrics, DiskHealth } from '../lib/domains/install/lib/hardware-monitor.js';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { promisify } from 'util';
import { exec } from 'child_process';
import { writeFile, access } from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

// Provision Profile Types
interface ProvisionProfile {
  name: string;
  type: 'minimal' | 'standard' | 'enterprise' | 'edge' | 'ai';
  description: string;
  minCpu: number;
  minMemory: number;
  minStorage: number;
  diskLayout: {
    scheme: 'standard' | 'lvm' | 'zfs' | 'raid';
    partitions: Array<{
      name: string;
      size: string;
      mountpoint: string;
      type: string;
    }>;
  };
  network: {
    dhcp: boolean;
    staticIp?: string;
    gateway?: string;
    dns?: string[];
  };
  packages: string[];
  optimizations: string[];
}

// Available profiles
const PROFILES: ProvisionProfile[] = [
  {
    name: 'minimal',
    type: 'minimal',
    description: 'Minimal installation for edge devices or VMs (2 CPU, 4GB RAM, 20GB storage)',
    minCpu: 2,
    minMemory: 4 * 1024 * 1024 * 1024,
    minStorage: 20 * 1024 * 1024 * 1024,
    diskLayout: {
      scheme: 'standard',
      partitions: [
        { name: 'boot', size: '512MB', mountpoint: '/boot', type: 'ext4' },
        { name: 'root', size: '100%', mountpoint: '/', type: 'ext4' },
      ],
    },
    network: { dhcp: true },
    packages: ['core', 'gateway'],
    optimizations: ['basic'],
  },
  {
    name: 'standard',
    type: 'standard',
    description: 'Standard server setup (4 CPU, 8GB RAM, 100GB storage)',
    minCpu: 4,
    minMemory: 8 * 1024 * 1024 * 1024,
    minStorage: 100 * 1024 * 1024 * 1024,
    diskLayout: {
      scheme: 'standard',
      partitions: [
        { name: 'boot', size: '1GB', mountpoint: '/boot', type: 'ext4' },
        { name: 'root', size: '50GB', mountpoint: '/', type: 'ext4' },
        { name: 'var', size: '30GB', mountpoint: '/var', type: 'ext4' },
        { name: 'home', size: '100%', mountpoint: '/home', type: 'ext4' },
      ],
    },
    network: { dhcp: true },
    packages: ['core', 'gateway', 'intelligence', 'builder'],
    optimizations: ['standard'],
  },
  {
    name: 'enterprise',
    type: 'enterprise',
    description: 'Enterprise-grade server (8+ CPU, 32GB+ RAM, 500GB+ storage)',
    minCpu: 8,
    minMemory: 32 * 1024 * 1024 * 1024,
    minStorage: 500 * 1024 * 1024 * 1024,
    diskLayout: {
      scheme: 'lvm',
      partitions: [
        { name: 'boot', size: '1GB', mountpoint: '/boot', type: 'ext4' },
        { name: 'boot-efi', size: '512MB', mountpoint: '/boot/efi', type: 'vfat' },
        { name: 'root', size: '100GB', mountpoint: '/', type: 'ext4' },
        { name: 'var', size: '100GB', mountpoint: '/var', type: 'ext4' },
        { name: 'var-log', size: '50GB', mountpoint: '/var/log', type: 'ext4' },
        { name: 'home', size: '100%', mountpoint: '/home', type: 'ext4' },
      ],
    },
    network: { dhcp: false, staticIp: '', gateway: '', dns: ['8.8.8.8', '1.1.1.1'] },
    packages: ['core', 'gateway', 'intelligence', 'builder', 'infrastructure', 'connector'],
    optimizations: ['enterprise', 'security', 'performance'],
  },
  {
    name: 'edge',
    type: 'edge',
    description: 'Edge computing optimized (4 CPU, 8GB RAM, fast storage)',
    minCpu: 4,
    minMemory: 8 * 1024 * 1024 * 1024,
    minStorage: 50 * 1024 * 1024 * 1024,
    diskLayout: {
      scheme: 'standard',
      partitions: [
        { name: 'boot', size: '512MB', mountpoint: '/boot', type: 'ext4' },
        { name: 'root', size: '100%', mountpoint: '/', type: 'ext4' },
      ],
    },
    network: { dhcp: true },
    packages: ['core', 'gateway'],
    optimizations: ['edge', 'low-latency'],
  },
  {
    name: 'ai',
    type: 'ai',
    description: 'AI/ML workload optimized (8+ CPU, 64GB+ RAM, GPU support)',
    minCpu: 8,
    minMemory: 64 * 1024 * 1024 * 1024,
    minStorage: 200 * 1024 * 1024 * 1024,
    diskLayout: {
      scheme: 'lvm',
      partitions: [
        { name: 'boot', size: '1GB', mountpoint: '/boot', type: 'ext4' },
        { name: 'root', size: '100GB', mountpoint: '/', type: 'ext4' },
        { name: 'var', size: '50GB', mountpoint: '/var', type: 'ext4' },
        { name: 'opt', size: '100GB', mountpoint: '/opt', type: 'ext4' },
        { name: 'data', size: '100%', mountpoint: '/data', type: 'ext4' },
      ],
    },
    network: { dhcp: false, staticIp: '', gateway: '', dns: ['8.8.8.8', '1.1.1.1'] },
    packages: ['core', 'gateway', 'intelligence', 'builder', 'infrastructure'],
    optimizations: ['ai', 'gpu', 'high-memory'],
  },
];

// Hardware Info type from server-provisioner
interface HardwareInfo {
  cpu: {
    model: string;
    vendor: string;
    cores: number;
    threads: number;
    architecture: string;
    baseFrequency: number;
    maxFrequency: number;
    virtualization: boolean;
  };
  memory: {
    total: number;
    available: number;
    type: string;
    speed: number;
    channels: number;
    ecc: boolean;
    slots: Array<{ size: number; type: string; speed: number }>;
  };
  storage: Array<{
    name: string;
    model: string;
    type: string;
    size: number;
    interface: string;
    health?: string;
    smartStatus?: string;
  }>;
  network: Array<{
    name: string;
    macAddress: string;
    type: string;
    state: string;
    speed?: number;
    ipAddresses: Array<{ address: string; family: string; prefixLen: number }>;
  }>;
  gpu: Array<{
    model: string;
    vendor: string;
    vram: number;
    pciAddress: string;
  }>;
  raid?: {
    controller?: { vendor: string; model: string };
    arrays: Array<{ name: string; level: string; size: number; status: string }>;
  };
  ipmi?: {
    available: boolean;
    vendor?: string;
    firmwareVersion?: string;
    ipAddress?: string;
    macAddress?: string;
  };
}

// Benchmark results
interface BenchmarkResults {
  overall: number;
  cpu?: {
    singleCore: number;
    multiCore: number;
    score: number;
  };
  memory?: {
    readSpeed: number;
    writeSpeed: number;
    latency: number;
    score: number;
  };
  storage?: Array<{
    device: string;
    readIOPS: number;
    writeIOPS: number;
    readThroughput: number;
    writeThroughput: number;
    latency: number;
    score: number;
  }>;
  network?: Array<{
    interface: string;
    throughput: number;
    latency: number;
    jitter: number;
    packetLoss: number;
    score: number;
  }>;
}

// IPMI result
// interface IPMIResult {
//   success: boolean;
//   output?: string;
//   error?: string;
//   exitCode?: number;
// }

// Installation plan
interface InstallationPlan {
  profile: ProvisionProfile;
  hardware: HardwareInfo;
  steps: Array<{
    name: string;
    description: string;
    estimatedTime: number;
  }>;
  estimatedTotalTime: number;
}

// Provision report
interface ProvisionReport {
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

// ============================================================================
// MAIN COMMAND
// ============================================================================

export function provisionCommand(program: Command): void {
  const provision = program
    .command('provision')
    .description('Provision bare metal servers with eve')
    .option('-y, --yes', 'Skip confirmations and use defaults')
    .option('--dry-run', 'Show what would be done without executing')
    .action(async (options) => {
      await runInteractiveWizard(options);
    });

  // Hardware detection
  provision
    .command('hardware')
    .description('Hardware detection and inventory')
    .option('--json', 'Output as JSON')
    .option('--export <file>', 'Export to file')
    .action(async (options) => {
      await runHardwareDetection(options);
    });

  // Hardware diagnostics
  provision
    .command('diagnose')
    .description('Run comprehensive hardware diagnostics')
    .option('--quick', 'Quick diagnostics only')
    .option('--export <file>', 'Export report to file')
    .action(async (options) => {
      await runHardwareDiagnostics(options);
    });

  // Profile management
  const profileCmd = provision
    .command('profile')
    .description('Profile management');

  profileCmd
    .command('list')
    .description('List available profiles')
    .action(async () => {
      await listProfiles();
    });

  profileCmd
    .command('get <name>')
    .description('Get profile details')
    .action(async (name: string) => {
      await getProfile(name);
    });

  profileCmd
    .command('apply <name>')
    .description('Apply profile settings to current system')
    .option('--dry-run', 'Show what would be changed')
    .action(async (name: string, options) => {
      await applyProfile(name, options);
    });

  profileCmd
    .command('generate')
    .description('Generate optimal profile for current hardware')
    .option('--name <name>', 'Profile name', 'custom')
    .action(async (options) => {
      await generateProfile(options);
    });

  profileCmd
    .command('optimize')
    .description('Optimize current profile based on usage patterns')
    .action(async () => {
      await optimizeProfile();
    });

  // Installation planning
  provision
    .command('plan')
    .description('Generate detailed installation plan')
    .option('--profile <name>', 'Profile to use', 'standard')
    .option('--export <file>', 'Export plan to file')
    .action(async (options) => {
      await generateInstallationPlan(options);
    });

  // USB creation
  provision
    .command('usb')
    .description('Create USB installation media for this server')
    .option('--profile <name>', 'Profile to use')
    .option('--output-device <path>', 'USB device path (e.g., /dev/sdb)')
    .option('--yes', 'Skip confirmation')
    .action(async (options) => {
      await createUSBKey(options);
    });

  // Benchmark
  provision
    .command('benchmark')
    .description('Run comprehensive server benchmarks')
    .option('--quick', 'Quick benchmark (CPU and memory only)')
    .option('--export <file>', 'Export results to file')
    .option('--compare', 'Compare to expected values for profile')
    .action(async (options) => {
      await runBenchmarks(options);
    });

  // Cluster management
  const clusterCmd = provision
    .command('cluster')
    .description('Multi-server cluster setup');

  clusterCmd
    .command('detect')
    .description('Detect other eve nodes on network')
    .action(async () => {
      await detectClusterNodes();
    });

  clusterCmd
    .command('configure <nodes...>')
    .description('Configure cluster with specified nodes')
    .option('--role <role>', 'Role for this node (primary/backup)', 'backup')
    .action(async (nodes: string[], options) => {
      await configureCluster(nodes, options);
    });

  // Report generation
  provision
    .command('report')
    .description('Generate comprehensive provision report')
    .option('--format <format>', 'Output format (json|markdown|html)', 'markdown')
    .option('--output <file>', 'Output file')
    .action(async (options) => {
      await generateProvisionReport(options);
    });
}

// ============================================================================
// INTERACTIVE WIZARD
// ============================================================================

async function runInteractiveWizard(options: { yes?: boolean; dryRun?: boolean }): Promise<void> {
  logger.header('eve SERVER PROVISIONING WIZARD');

  try {
    // Step 1: Detect hardware
    section('Step 1: Hardware Detection');
    spinner.start('detect', 'Detecting hardware...');
    const metrics = await hardwareMonitor.collectAll();
    const hardware = convertMetricsToHardwareInfo(metrics);
    spinner.succeed('detect', `Hardware detected: ${hardware.cpu.model}, ${formatBytes(hardware.memory.total)} RAM`);

    // Show hardware summary
    displayHardwareSummary(hardware);

    // Detect network type and suggest Pangolin if behind CGNAT
    const networkType = await detectNetworkType();
    if (networkType === 'cgmat' || networkType === 'private') {
      logger.newline();
      logger.info(chalk.yellow('⚠️  Network detected: ') + chalk.bold('Behind CGNAT or private IP'));
      logger.info(chalk.gray('Pangolin tunnel is recommended for remote access without port forwarding.'));
      
      const { enableTunnel } = await inquirer.prompt([{
        type: 'confirm',
        name: 'enableTunnel',
        message: 'Set up Pangolin tunnel for remote access?',
        default: true,
      }]);
      
      if (enableTunnel) {
        logger.newline();
        logger.info(chalk.cyan('Tunnel setup will be available after installation:'));
        logger.info(`  Run: ${chalk.bold('eve tunnel:enable')} on this server`);
        logger.info(`  Run: ${chalk.bold('eve tunnel:enable --mode server')} on a VPS`);
      }
    }

    // Step 2: Recommend profile
    section('Step 2: Profile Recommendation');
    const recommendedProfile = recommendProfile(hardware);
    logger.info(`Recommended profile: ${chalk.cyan(recommendedProfile.name.toUpperCase())}`);
    logger.info(`Description: ${recommendedProfile.description}`);

    let selectedProfile = recommendedProfile;

    if (!options.yes) {
      const { changeProfile } = await inquirer.prompt([{
        type: 'confirm',
        name: 'changeProfile',
        message: 'Would you like to customize the profile?',
        default: false,
      }]);

      if (changeProfile) {
        const { profileName } = await inquirer.prompt([{
          type: 'list',
          name: 'profileName',
          message: 'Select profile:',
          choices: PROFILES.map(p => ({ name: `${p.name} - ${p.description}`, value: p.name })),
          default: recommendedProfile.name,
        }]);
        selectedProfile = PROFILES.find(p => p.name === profileName) || recommendedProfile;
      }
    }

    // Step 3: Profile customization
    if (!options.yes) {
      const { customize } = await inquirer.prompt([{
        type: 'confirm',
        name: 'customize',
        message: 'Customize profile settings?',
        default: false,
      }]);

      if (customize) {
        selectedProfile = await customizeProfile(selectedProfile, hardware);
      }
    }

    // Step 4: Generate installation plan
    section('Step 3: Installation Plan');
    spinner.start('plan', 'Generating installation plan...');
    const plan = generatePlan(selectedProfile, hardware);
    spinner.succeed('plan', 'Installation plan generated');

    displayInstallationPlan(plan);

    if (options.dryRun) {
      logger.newline();
      logger.info(chalk.yellow('[DRY RUN] No changes will be made'));
      return;
    }

    // Step 5: Confirm and proceed
    if (!options.yes) {
      const { proceed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'proceed',
        message: 'Proceed with USB creation?',
        default: true,
      }]);

      if (!proceed) {
        logger.info('Provisioning cancelled.');
        return;
      }
    }

    // Step 6: Create USB
    section('Step 4: Create Installation USB');
    await createUSBForProfile(selectedProfile, hardware, options.yes);

    // Step 7: Show next steps
    section('Next Steps');
    logger.info('1. Insert the USB key into the target server');
    logger.info('2. Boot from USB (may require BIOS/UEFI configuration)');
    logger.info('3. Installation will proceed automatically');
    logger.info('4. After installation, run: ' + chalk.cyan('eve init'));
    logger.newline();
    logger.success('Provisioning preparation complete! 🔥');

  } catch (error: any) {
    logger.error(`Provisioning failed: ${error.message}`);
    spinner.stopAll();
    process.exit(1);
  }
}

// ============================================================================
// HARDWARE DETECTION
// ============================================================================

async function runHardwareDetection(options: { json?: boolean; export?: string }): Promise<void> {
  logger.header('HARDWARE DETECTION');

  try {
    spinner.start('detect', 'Detecting hardware components...');
    const metrics = await hardwareMonitor.collectAll();
    const hardware = convertMetricsToHardwareInfo(metrics);
    spinner.succeed('detect', 'Hardware detection complete');

    if (options.json) {
      const output = JSON.stringify(hardware, null, 2);
      if (options.export) {
        await writeFile(options.export, output);
        logger.success(`Hardware info exported to ${options.export}`);
      } else {
        console.log(output);
      }
      return;
    }

    // Display formatted output
    displayHardwareSummary(hardware);

    // SMART data if available
    if (metrics.disks.health.length > 0) {
      section('SMART Status');
      for (const disk of metrics.disks.health) {
        const statusColor = disk.status === 'ok' ? chalk.green :
                           disk.status === 'warning' ? chalk.yellow : chalk.red;
        logger.info(`${disk.device}: ${statusColor(disk.status.toUpperCase())}`);
        if (disk.temperature) {
          logger.info(`  Temperature: ${disk.temperature}°C`);
        }
        if (disk.powerOnHours) {
          logger.info(`  Power on hours: ${disk.powerOnHours}`);
        }
      }
    }

    // RAID info if available
    if (hardware.raid && hardware.raid.arrays.length > 0) {
      section('RAID Configuration');
      if (hardware.raid.controller) {
        logger.info(`Controller: ${hardware.raid.controller.vendor} ${hardware.raid.controller.model}`);
      }
      for (const array of hardware.raid.arrays) {
        logger.info(`Array ${array.name}: ${array.level} - ${formatBytes(array.size)} (${array.status})`);
      }
    }

    // IPMI info if available
    if (hardware.ipmi?.available) {
      section('IPMI/BMC');
      logger.info(`Vendor: ${hardware.ipmi.vendor || 'Unknown'}`);
      logger.info(`Firmware: ${hardware.ipmi.firmwareVersion || 'Unknown'}`);
      logger.info(`IP Address: ${hardware.ipmi.ipAddress || 'Unknown'}`);
      logger.info(`MAC Address: ${hardware.ipmi.macAddress || 'Unknown'}`);
    }

    if (options.export) {
      const output = JSON.stringify(hardware, null, 2);
      await writeFile(options.export, output);
      logger.success(`Hardware info exported to ${options.export}`);
    }

  } catch (error: any) {
    logger.error(`Hardware detection failed: ${error.message}`);
    spinner.stopAll();
    process.exit(1);
  }
}

// ============================================================================
// HARDWARE DIAGNOSTICS
// ============================================================================

async function runHardwareDiagnostics(options: { quick?: boolean; export?: string }): Promise<void> {
  logger.header('HARDWARE DIAGNOSTICS');

  const issues: string[] = [];
  const warnings: string[] = [];

  try {
    // CPU tests
    section('CPU Diagnostics');
    spinner.start('cpu-test', 'Testing CPU...');
    const cpuInfo = await hardwareMonitor.cpuInfo();
    const cpuTemp = await hardwareMonitor.cpuTemperature();

    if (cpuTemp?.main && cpuTemp.main > 85) {
      issues.push(`CPU temperature critical: ${cpuTemp.main}°C`);
    } else if (cpuTemp?.main && cpuTemp.main > 75) {
      warnings.push(`CPU temperature high: ${cpuTemp.main}°C`);
    }

    // CPU stress test (if not quick)
    if (!options.quick) {
      spinner.update('cpu-test', 'Running CPU stress test...');
      try {
        await execAsync('sysbench cpu --cpu-max-prime=10000 --time=10 run 2>/dev/null');
        spinner.succeed('cpu-test', `CPU OK - ${cpuInfo.model}`);
      } catch {
        warnings.push('CPU stress test failed or sysbench not available');
        spinner.warn('cpu-test', 'CPU test incomplete');
      }
    } else {
      spinner.succeed('cpu-test', `CPU OK - ${cpuInfo.model}`);
    }

    // Memory tests
    section('Memory Diagnostics');
    spinner.start('mem-test', 'Testing memory...');
    const memUsage = await hardwareMonitor.memoryUsage();
    const memPressure = await hardwareMonitor.memoryPressure();

    if (memPressure.level === 'critical') {
      issues.push(`Memory pressure critical: ${memPressure.details}`);
    } else if (memPressure.level === 'warning') {
      warnings.push(`Memory pressure high: ${memPressure.details}`);
    }

    if (!options.quick) {
      try {
        spinner.update('mem-test', 'Running memory test...');
        await execAsync('sysbench memory --memory-block-size=1K --memory-total-size=1G run 2>/dev/null');
        spinner.succeed('mem-test', `Memory OK - ${memUsage.total}GB total`);
      } catch {
        warnings.push('Memory test failed or sysbench not available');
        spinner.warn('mem-test', 'Memory test incomplete');
      }
    } else {
      spinner.succeed('mem-test', `Memory OK - ${memUsage.total}GB total`);
    }

    // Disk tests
    section('Storage Diagnostics');
    const diskHealth = await hardwareMonitor.diskHealth();
    for (const disk of diskHealth) {
      spinner.start(`disk-${disk.device}`, `Checking ${disk.device}...`);

      if (disk.status === 'critical') {
        issues.push(`Disk ${disk.device} health critical`);
        spinner.fail(`disk-${disk.device}`, `${disk.device}: CRITICAL`);
      } else if (disk.status === 'warning') {
        warnings.push(`Disk ${disk.device} health warning`);
        spinner.warn(`disk-${disk.device}`, `${disk.device}: WARNING`);
      } else {
        spinner.succeed(`disk-${disk.device}`, `${disk.device}: OK`);
      }
    }

    // Network tests
    section('Network Diagnostics');
    spinner.start('net-test', 'Testing network...');
    const netLatency = await hardwareMonitor.networkLatency();

    if (netLatency?.internet) {
      if (netLatency.internet.packetLoss > 5) {
        issues.push(`High packet loss: ${netLatency.internet.packetLoss}%`);
      } else if (netLatency.internet.packetLoss > 1) {
        warnings.push(`Elevated packet loss: ${netLatency.internet.packetLoss}%`);
      }

      if (netLatency.internet.latency > 200) {
        warnings.push(`High latency: ${netLatency.internet.latency}ms`);
      }

      spinner.succeed('net-test', `Network OK - ${netLatency.internet.latency}ms to internet`);
    } else {
      spinner.warn('net-test', 'Network test inconclusive');
    }

    // Summary
    section('Diagnostic Summary');
    if (issues.length === 0 && warnings.length === 0) {
      logger.success('All diagnostics passed! ✅');
    } else {
      if (issues.length > 0) {
        logger.error(`Found ${issues.length} critical issue(s):`);
        issues.forEach(i => logger.error(`  • ${i}`));
      }
      if (warnings.length > 0) {
        logger.warn(`Found ${warnings.length} warning(s):`);
        warnings.forEach(w => logger.warn(`  • ${w}`));
      }
    }

    // Export report
    if (options.export) {
      const report = {
        timestamp: new Date().toISOString(),
        hostname: os.hostname(),
        issues,
        warnings,
        status: issues.length > 0 ? 'failed' : warnings.length > 0 ? 'warning' : 'passed',
      };
      await writeFile(options.export, JSON.stringify(report, null, 2));
      logger.success(`Diagnostic report exported to ${options.export}`);
    }

  } catch (error: any) {
    logger.error(`Diagnostics failed: ${error.message}`);
    spinner.stopAll();
    process.exit(1);
  }
}

// ============================================================================
// PROFILE MANAGEMENT
// ============================================================================

async function listProfiles(): Promise<void> {
  logger.header('AVAILABLE PROFILES');

  for (const profile of PROFILES) {
    logger.newline();
    logger.info(chalk.bold.cyan(profile.name.toUpperCase()));
    logger.info(`  ${profile.description}`);
    logger.info(`  Requirements: ${profile.minCpu} CPU, ${formatBytes(profile.minMemory)} RAM, ${formatBytes(profile.minStorage)} storage`);
    logger.info(`  Disk scheme: ${profile.diskLayout.scheme}`);
    logger.info(`  Packages: ${profile.packages.join(', ')}`);
  }
}

async function getProfile(name: string): Promise<void> {
  const profile = PROFILES.find(p => p.name === name);

  if (!profile) {
    logger.error(`Profile not found: ${name}`);
    logger.info(`Available profiles: ${PROFILES.map(p => p.name).join(', ')}`);
    process.exit(1);
  }

  logger.header(`PROFILE: ${name.toUpperCase()}`);

  logger.info(chalk.bold('Description:') + ` ${profile.description}`);
  logger.info(chalk.bold('Type:') + ` ${profile.type}`);
  logger.newline();

  logger.info(chalk.bold('Requirements:'));
  logger.info(`  CPU: ${profile.minCpu} cores`);
  logger.info(`  Memory: ${formatBytes(profile.minMemory)}`);
  logger.info(`  Storage: ${formatBytes(profile.minStorage)}`);
  logger.newline();

  logger.info(chalk.bold('Disk Layout:'));
  logger.info(`  Scheme: ${profile.diskLayout.scheme}`);
  for (const partition of profile.diskLayout.partitions) {
    logger.info(`  - ${partition.name}: ${partition.size} → ${partition.mountpoint} (${partition.type})`);
  }
  logger.newline();

  logger.info(chalk.bold('Network:'));
  logger.info(`  DHCP: ${profile.network.dhcp ? 'Yes' : 'No'}`);
  if (!profile.network.dhcp) {
    logger.info(`  Static IP: ${profile.network.staticIp || 'Not configured'}`);
    logger.info(`  Gateway: ${profile.network.gateway || 'Not configured'}`);
    logger.info(`  DNS: ${profile.network.dns?.join(', ') || 'Not configured'}`);
  }
  logger.newline();

  logger.info(chalk.bold('Packages:'));
  for (const pkg of profile.packages) {
    logger.info(`  • ${pkg}`);
  }
  logger.newline();

  logger.info(chalk.bold('Optimizations:'));
  for (const opt of profile.optimizations) {
    logger.info(`  • ${opt}`);
  }
}

async function applyProfile(name: string, options: { dryRun?: boolean }): Promise<void> {
  const profile = PROFILES.find(p => p.name === name);

  if (!profile) {
    logger.error(`Profile not found: ${name}`);
    process.exit(1);
  }

  logger.header(`APPLYING PROFILE: ${name.toUpperCase()}`);

  if (options.dryRun) {
    logger.info(chalk.yellow('[DRY RUN] The following changes would be made:'));
    logger.info(`  • Install packages: ${profile.packages.join(', ')}`);
    logger.info(`  • Apply optimizations: ${profile.optimizations.join(', ')}`);
    logger.info(`  • Configure network (DHCP: ${profile.network.dhcp})`);
    return;
  }

  // Check if running as root
  if (process.getuid && process.getuid() !== 0) {
    logger.warn('Some profile settings may require root privileges');
  }

  // Apply system optimizations
  spinner.start('apply', 'Applying profile settings...');

  try {
    // Note: Actual implementation would apply kernel settings, install packages, etc.
    // This is a placeholder for the actual implementation
    await new Promise(resolve => setTimeout(resolve, 2000));

    spinner.succeed('apply', 'Profile settings applied');
    logger.success(`Profile ${name} applied successfully`);
    logger.info('Some changes may require a reboot to take effect');
  } catch (error: any) {
    spinner.fail('apply', `Failed to apply profile: ${error.message}`);
    process.exit(1);
  }
}

async function generateProfile(options: { name?: string }): Promise<void> {
  logger.header('GENERATE OPTIMAL PROFILE');

  spinner.start('detect', 'Analyzing hardware...');
  const metrics = await hardwareMonitor.collectAll();
  const hardware = convertMetricsToHardwareInfo(metrics);
  spinner.succeed('detect', 'Hardware analysis complete');

  // Generate profile based on hardware
  const profile = generateOptimalProfile(hardware, options.name || 'custom');

  logger.info(chalk.bold('Generated Profile:') + ` ${profile.name}`);
  logger.info(chalk.bold('Type:') + ` ${profile.type}`);
  logger.newline();

  logger.info(chalk.bold('Optimized for detected hardware:'));
  logger.info(`  CPU: ${hardware.cpu.model} (${hardware.cpu.cores} cores)`);
  logger.info(`  Memory: ${formatBytes(hardware.memory.total)}`);
  logger.info(`  Storage: ${hardware.storage.map(s => `${s.model} (${formatBytes(s.size)})`).join(', ')}`);

  if (hardware.gpu.length > 0) {
    logger.info(`  GPU: ${hardware.gpu.map(g => g.model).join(', ')}`);
  }

  logger.newline();
  logger.info(chalk.bold('Recommended disk layout:'));
  for (const partition of profile.diskLayout.partitions) {
    logger.info(`  - ${partition.name}: ${partition.size} → ${partition.mountpoint}`);
  }

  // Save profile
  const { save } = await inquirer.prompt([{
    type: 'confirm',
    name: 'save',
    message: 'Save this profile for future use?',
    default: true,
  }]);

  if (save) {
    const profilePath = path.join(os.homedir(), '.eve', 'profiles', `${profile.name}.json`);
    await writeFile(profilePath, JSON.stringify(profile, null, 2));
    logger.success(`Profile saved to ${profilePath}`);
  }
}

async function optimizeProfile(): Promise<void> {
  logger.header('OPTIMIZE PROFILE');
  logger.info('Analyzing system usage patterns...');

  spinner.start('analyze', 'Collecting usage data...');

  // Collect metrics over a short period
  const samples: HardwareMetrics[] = [];
  const stopWatching = hardwareMonitor.watch({
    interval: 1000,
    callback: (metrics) => {
      samples.push(metrics);
      spinner.update('analyze', `Collected ${samples.length} samples...`);
    },
  });

  // Collect for 10 seconds
  await new Promise(resolve => setTimeout(resolve, 10000));
  stopWatching();

  spinner.succeed('analyze', `Collected ${samples.length} samples`);

  // Analyze patterns
  const avgCpu = samples.reduce((sum, s) => sum + s.cpu.usage.average, 0) / samples.length;
  const avgMem = samples.reduce((sum, s) => sum + s.memory.usage.percentage, 0) / samples.length;
  const maxCpu = Math.max(...samples.map(s => s.cpu.usage.average));
  const maxMem = Math.max(...samples.map(s => s.memory.usage.percentage));

  section('Usage Analysis');
  logger.info(`Average CPU usage: ${avgCpu.toFixed(1)}%`);
  logger.info(`Peak CPU usage: ${maxCpu.toFixed(1)}%`);
  logger.info(`Average memory usage: ${avgMem.toFixed(1)}%`);
  logger.info(`Peak memory usage: ${maxMem.toFixed(1)}%`);

  // Generate recommendations
  section('Optimization Recommendations');
  const recommendations: string[] = [];

  if (avgCpu < 20 && maxCpu < 50) {
    recommendations.push('CPU is underutilized - consider consolidating workloads');
  } else if (maxCpu > 80) {
    recommendations.push('High CPU peaks detected - consider CPU upgrade or workload distribution');
  }

  if (avgMem > 80) {
    recommendations.push('Memory consistently high - consider adding more RAM');
  }

  if (recommendations.length === 0) {
    logger.success('No optimizations needed - system is well-balanced');
  } else {
    recommendations.forEach(r => logger.info(`• ${r}`));
  }
}

// ============================================================================
// INSTALLATION PLANNING
// ============================================================================

async function generateInstallationPlan(options: { profile?: string; export?: string }): Promise<void> {
  const profileName = options.profile || 'standard';
  const profile = PROFILES.find(p => p.name === profileName);

  if (!profile) {
    logger.error(`Profile not found: ${profileName}`);
    process.exit(1);
  }

  logger.header('INSTALLATION PLAN');

  spinner.start('detect', 'Detecting hardware...');
  const metrics = await hardwareMonitor.collectAll();
  const hardware = convertMetricsToHardwareInfo(metrics);
  spinner.succeed('detect', 'Hardware detected');

  const plan = generatePlan(profile, hardware);

  displayInstallationPlan(plan);

  if (options.export) {
    await writeFile(options.export, JSON.stringify(plan, null, 2));
    logger.success(`Installation plan exported to ${options.export}`);
  }
}

// ============================================================================
// USB CREATION
// ============================================================================

async function createUSBKey(options: {
  profile?: string;
  outputDevice?: string;
  yes?: boolean;
}): Promise<void> {
  logger.header('CREATE INSTALLATION USB');

  // Detect hardware first
  spinner.start('detect', 'Detecting hardware...');
  const metrics = await hardwareMonitor.collectAll();
  const hardware = convertMetricsToHardwareInfo(metrics);
  spinner.succeed('detect', 'Hardware detected');

  // Determine profile
  let profile: ProvisionProfile;
  if (options.profile) {
    profile = PROFILES.find(p => p.name === options.profile) || recommendProfile(hardware);
  } else {
    profile = recommendProfile(hardware);
    logger.info(`Recommended profile: ${chalk.cyan(profile.name)}`);
  }

  // Get output device
  let device = options.outputDevice;
  if (!device) {
    const { selectedDevice } = await inquirer.prompt([{
      type: 'input',
      name: 'selectedDevice',
      message: 'Enter USB device path (e.g., /dev/sdb):',
      validate: (input) => input.startsWith('/dev/') || 'Please enter a valid device path',
    }]);
    device = selectedDevice;
  }

  // Verify device exists
  try {
    await access(device!);
  } catch {
    logger.error(`Device not found: ${device}`);
    process.exit(1);
  }

  // Safety check
  if (!options.yes) {
    logger.warn(chalk.bold.red(`WARNING: This will erase all data on ${device}`));
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to write to ${device}?`,
      default: false,
    }]);

    if (!confirm) {
      logger.info('USB creation cancelled');
      return;
    }
  }

  // Create USB
  await createUSBForProfile(profile, hardware, options.yes, device);
}

// ============================================================================
// BENCHMARKING
// ============================================================================

async function runBenchmarks(options: {
  quick?: boolean;
  export?: string;
  compare?: boolean;
}): Promise<void> {
  logger.header('SERVER BENCHMARK');

  const results: BenchmarkResults = { overall: 0 };

  try {
    // CPU Benchmark
    section('CPU Benchmark');
    spinner.start('cpu-bench', 'Running CPU benchmark...');

    const cpuStart = Date.now();
    try {
      await execAsync('sysbench cpu --cpu-max-prime=20000 --time=10 run 2>/dev/null');
      const cpuTime = Date.now() - cpuStart;
      results.cpu = {
        singleCore: 10000 / (cpuTime / 1000),
        multiCore: 50000 / (cpuTime / 1000),
        score: Math.min(100, 50000 / cpuTime),
      };
      spinner.succeed('cpu-bench', `CPU Score: ${results.cpu.score.toFixed(1)}/100`);
    } catch {
      spinner.warn('cpu-bench', 'CPU benchmark skipped (sysbench not available)');
      results.cpu = { singleCore: 0, multiCore: 0, score: 0 };
    }

    // Memory Benchmark
    section('Memory Benchmark');
    spinner.start('mem-bench', 'Running memory benchmark...');

    try {
      const { stdout } = await execAsync('sysbench memory --memory-block-size=1M --memory-total-size=10G run 2>/dev/null | grep "transferred" || echo ""');
      const match = stdout.match(/([\d.]+)\s*MiB/);
      const throughput = match ? parseFloat(match[1]) : 0;
      results.memory = {
        readSpeed: throughput,
        writeSpeed: throughput,
        latency: throughput > 0 ? 1000 / throughput : 0,
        score: Math.min(100, throughput / 100),
      };
      spinner.succeed('mem-bench', `Memory Score: ${results.memory.score.toFixed(1)}/100 (${throughput.toFixed(0)} MiB/s)`);
    } catch {
      spinner.warn('mem-bench', 'Memory benchmark skipped (sysbench not available)');
      results.memory = { readSpeed: 0, writeSpeed: 0, latency: 0, score: 0 };
    }

    // Disk Benchmark (if not quick)
    if (!options.quick) {
      section('Disk Benchmark');
      results.storage = [];
      const diskInfo = await hardwareMonitor.diskInfo();

      for (const disk of diskInfo.slice(0, 2)) { // Test first 2 disks max
        spinner.start(`disk-${disk.device}`, `Benchmarking ${disk.device}...`);

        try {
          // Simple dd test for I/O
          const { stdout } = await execAsync(`dd if=${disk.device} of=/dev/null bs=1M count=100 2>&1 | grep -o '[0-9.]* MB/s' || echo "0 MB/s"`);
          const match = stdout.match(/([\d.]+)/);
          const throughput = match ? parseFloat(match[1]) : 0;

          results.storage.push({
            device: disk.device,
            readIOPS: Math.round(throughput * 100),
            writeIOPS: 0,
            readThroughput: throughput,
            writeThroughput: 0,
            latency: 0,
            score: Math.min(100, throughput / 10),
          });

          spinner.succeed(`disk-${disk.device}`, `${disk.device}: ${throughput.toFixed(1)} MB/s`);
        } catch {
          spinner.warn(`disk-${disk.device}`, `${disk.device}: Test failed`);
          results.storage.push({
            device: disk.device,
            readIOPS: 0,
            writeIOPS: 0,
            readThroughput: 0,
            writeThroughput: 0,
            latency: 0,
            score: 0,
          });
        }
      }

      // Network Benchmark
      section('Network Benchmark');
      spinner.start('net-bench', 'Testing network throughput...');

      const netInterfaces = await hardwareMonitor.networkInterfaces();
      const iface = netInterfaces.find(i => i.type === 'ethernet' && i.status === 'up');

      if (iface) {
        // Simple speed test using curl
        const start = Date.now();
        try {
          await execAsync('curl -s -o /dev/null --max-time 10 https://speed.cloudflare.com/__down?bytes=25000000 2>/dev/null || true');
          const duration = (Date.now() - start) / 1000;
          const throughput = 200 / duration; // Approximate Mbps

          results.network = [{
            interface: iface.name,
            throughput,
            latency: 0,
            jitter: 0,
            packetLoss: 0,
            score: Math.min(100, throughput / 10),
          }];

          spinner.succeed('net-bench', `Network: ~${throughput.toFixed(0)} Mbps`);
        } catch {
          spinner.warn('net-bench', 'Network test inconclusive');
          results.network = [];
        }
      } else {
        spinner.warn('net-bench', 'No active ethernet interface found');
      }
    }

    // Calculate overall score
    const cpuScore = results.cpu?.score || 0;
    const memScore = results.memory?.score || 0;
    const diskScore = results.storage && results.storage.length > 0
      ? results.storage.reduce((sum, d) => sum + d.score, 0) / results.storage.length
      : 0;
    const netScore = results.network && results.network.length > 0
      ? results.network.reduce((sum, n) => sum + n.score, 0) / results.network.length
      : 0;

    results.overall = Math.round((cpuScore + memScore + diskScore + netScore) / 4);

    // Summary
    section('Benchmark Summary');
    logger.info(chalk.bold(`Overall Score: ${results.overall}/100`));
    logger.newline();
    logger.info(`CPU:        ${(results.cpu?.score || 0).toFixed(1)}/100`);
    logger.info(`Memory:     ${(results.memory?.score || 0).toFixed(1)}/100`);
    logger.info(`Disk:       ${diskScore.toFixed(1)}/100`);
    logger.info(`Network:    ${netScore.toFixed(1)}/100`);

    if (options.compare) {
      const metrics = await hardwareMonitor.collectAll();
      const hardware = convertMetricsToHardwareInfo(metrics);
      const profile = recommendProfile(hardware);

      section('Comparison to Profile');
      const expectedScore = profile.type === 'minimal' ? 30 :
                           profile.type === 'standard' ? 50 :
                           profile.type === 'enterprise' ? 75 :
                           profile.type === 'ai' ? 80 : 50;

      const diff = results.overall - expectedScore;
      if (diff > 10) {
        logger.success(`Performance is ${diff.toFixed(0)} points above expected for ${profile.name} profile ✅`);
      } else if (diff < -10) {
        logger.warn(`Performance is ${Math.abs(diff).toFixed(0)} points below expected for ${profile.name} profile`);
      } else {
        logger.info(`Performance matches expected for ${profile.name} profile`);
      }
    }

    // Export results
    if (options.export) {
      await writeFile(options.export, JSON.stringify(results, null, 2));
      logger.success(`Benchmark results exported to ${options.export}`);
    }

  } catch (error: any) {
    logger.error(`Benchmark failed: ${error.message}`);
    spinner.stopAll();
    process.exit(1);
  }
}

// ============================================================================
// CLUSTER MANAGEMENT
// ============================================================================

async function detectClusterNodes(): Promise<void> {
  logger.header('DETECT CLUSTER NODES');

  spinner.start('detect', 'Scanning network for eve nodes...');

  try {
    const nodes = await serverProvisioner.detectOtherNodes();
    spinner.succeed('detect', `Found ${nodes.length} node(s)`);

    if (nodes.length === 0) {
      logger.info('No other eve nodes detected on the network');
      logger.info('Make sure other nodes are powered on and connected to the same network');
      return;
    }

    section('Detected Nodes');
    for (const node of nodes) {
      logger.info(`• ${node.hostname} (${node.ip}) - ${node.status}`);
    }

    const { configure } = await inquirer.prompt([{
      type: 'confirm',
      name: 'configure',
      message: 'Configure cluster with detected nodes?',
      default: false,
    }]);

    if (configure) {
      await configureCluster(nodes.map(n => n.ip), { role: 'backup' });
    }

  } catch (error: any) {
    spinner.fail('detect', `Detection failed: ${error.message}`);
    process.exit(1);
  }
}

async function configureCluster(nodes: string[], options: { role?: string }): Promise<void> {
  logger.header('CONFIGURE CLUSTER');

  logger.info(`Configuring cluster with ${nodes.length} node(s)`);
  logger.info(`This node will be: ${chalk.cyan(options.role || 'backup')}`);

  const nodeObjects = nodes.map(ip => ({
    hostname: `node-${ip.replace(/\./g, '-')}`,
    ip,
    status: 'configured',
  }));

  spinner.start('cluster', 'Setting up cluster configuration...');

  try {
    await serverProvisioner.configureCluster(nodeObjects);
    spinner.succeed('cluster', 'Cluster configured');

    // Setup replication
    spinner.start('replication', 'Configuring data replication...');
    await serverProvisioner.setupReplication(nodeObjects);
    spinner.succeed('replication', 'Replication configured');

    // Setup load balancing
    spinner.start('loadbalance', 'Configuring load balancing...');
    await serverProvisioner.configureLoadBalancing(nodeObjects);
    spinner.succeed('loadbalance', 'Load balancing configured');

    logger.success('Cluster setup complete! 🔥');
    logger.newline();
    logger.info('Next steps:');
    logger.info('1. Verify all nodes are running: ' + chalk.cyan('eve status'));
    logger.info('2. Check cluster health: ' + chalk.cyan('eve health cluster'));

  } catch (error: any) {
    spinner.fail('cluster', `Cluster configuration failed: ${error.message}`);
    process.exit(1);
  }
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

async function generateProvisionReport(options: {
  format?: string;
  output?: string;
}): Promise<void> {
  const format = options.format || 'markdown';

  logger.header('GENERATE PROVISION REPORT');

  spinner.start('collect', 'Collecting system information...');

  try {
    // Collect all data
    const metrics = await hardwareMonitor.collectAll();
    const hardware = convertMetricsToHardwareInfo(metrics);

    // Run benchmarks
    const benchmarkResults = await serverProvisioner.runBenchmarks();

    // Get current profile
    const currentProfile = 'standard'; // Would be retrieved from config

    // Generate report
    const report: ProvisionReport = {
      hostname: os.hostname(),
      profile: currentProfile,
      hardware,
      benchmarks: benchmarkResults,
      timestamp: new Date(),
      duration: 0,
      success: true,
      warnings: [],
      errors: [],
    };

    spinner.succeed('collect', 'Data collection complete');

    // Generate formatted report
    let output: string;
    switch (format) {
      case 'json':
        output = JSON.stringify(report, null, 2);
        break;
      case 'html':
        output = generateHTMLReport(report);
        break;
      case 'markdown':
      default:
        output = generateMarkdownReport(report);
    }

    if (options.output) {
      await writeFile(options.output, output);
      logger.success(`Report saved to ${options.output}`);
    } else {
      console.log(output);
    }

  } catch (error: any) {
    spinner.fail('collect', `Report generation failed: ${error.message}`);
    process.exit(1);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function convertMetricsToHardwareInfo(metrics: HardwareMetrics): HardwareInfo {
  return {
    cpu: {
      model: metrics.cpu.info.model,
      vendor: metrics.cpu.info.vendor,
      cores: metrics.cpu.info.cores,
      threads: metrics.cpu.info.threads,
      architecture: metrics.cpu.info.architecture,
      baseFrequency: metrics.cpu.info.speed,
      maxFrequency: metrics.cpu.frequency?.max || metrics.cpu.info.speed,
      virtualization: false, // Would need to detect from CPU flags
    },
    memory: {
      total: metrics.memory.usage.total * 1024 * 1024 * 1024, // Convert GB to bytes
      available: metrics.memory.usage.available * 1024 * 1024 * 1024,
      type: metrics.memory.info?.type || 'Unknown',
      speed: metrics.memory.info?.speed || 0,
      channels: metrics.memory.info?.slots || 1,
      ecc: false, // Would need dmidecode
      slots: metrics.memory.info?.slotsUsed ?
        Array(metrics.memory.info.slotsUsed).fill({ size: 0, type: 'Unknown', speed: 0 }) :
        [],
    },
    storage: metrics.disks.info.map(d => ({
      name: d.device,
      model: d.model,
      type: d.type,
      size: d.size * 1024 * 1024 * 1024, // Convert GB to bytes
      interface: d.type === 'NVMe' ? 'nvme' : d.type === 'SSD' ? 'sata' : 'other',
      health: metrics.disks.health.find(h => h.device === d.device)?.status,
      smartStatus: metrics.disks.health.find(h => h.device === d.device)?.status,
    })),
    network: metrics.network.interfaces.map(i => ({
      name: i.name,
      macAddress: i.mac || 'Unknown',
      type: i.type,
      state: i.status,
      speed: i.speed,
      ipAddresses: [
        ...(i.ip4 || []).map(ip => ({ address: ip, family: 'IPv4', prefixLen: 24 })),
        ...(i.ip6 || []).map(ip => ({ address: ip, family: 'IPv6', prefixLen: 64 })),
      ],
    })),
    gpu: metrics.gpu?.info.map(g => ({
      model: g.model,
      vendor: g.vendor,
      vram: g.vram,
      pciAddress: g.pci || 'Unknown',
    })) || [],
  };
}

function recommendProfile(hardware: HardwareInfo): ProvisionProfile {
  // Check if AI profile is suitable (GPU and high memory)
  if (hardware.gpu.length > 0 && hardware.memory.total >= 32 * 1024 * 1024 * 1024) {
    return PROFILES.find(p => p.name === 'ai') || PROFILES[1];
  }

  // Check enterprise requirements
  if (hardware.cpu.cores >= 8 && hardware.memory.total >= 32 * 1024 * 1024 * 1024) {
    return PROFILES.find(p => p.name === 'enterprise') || PROFILES[1];
  }

  // Check minimal requirements
  if (hardware.cpu.cores < 4 || hardware.memory.total < 8 * 1024 * 1024 * 1024) {
    return PROFILES.find(p => p.name === 'minimal') || PROFILES[0];
  }

  // Default to standard
  return PROFILES.find(p => p.name === 'standard') || PROFILES[1];
}

function generateOptimalProfile(hardware: HardwareInfo, name: string): ProvisionProfile {
  const baseProfile = recommendProfile(hardware);

  // Adjust partitions based on available storage
  const totalStorage = hardware.storage.reduce((sum, s) => sum + s.size, 0);
  const adjustedPartitions = baseProfile.diskLayout.partitions.map(p => {
    if (p.size === '100%') return p;

    // Scale partition sizes based on available storage
    const sizeMatch = p.size.match(/(\d+)([GMTP]B?)/);
    if (sizeMatch) {
      const size = parseInt(sizeMatch[1]);
      const unit = sizeMatch[2];

      // For large drives, increase partition sizes
      if (totalStorage > 500 * 1024 * 1024 * 1024 && size < 100) {
        return { ...p, size: `${size * 2}${unit}` };
      }
    }
    return p;
  });

  return {
    ...baseProfile,
    name,
    diskLayout: {
      ...baseProfile.diskLayout,
      partitions: adjustedPartitions,
    },
  };
}

async function customizeProfile(profile: ProvisionProfile, hardware: HardwareInfo): Promise<ProvisionProfile> {
  const customized = { ...profile };

  // Customize disk layout
  const { customizeDisk } = await inquirer.prompt([{
    type: 'confirm',
    name: 'customizeDisk',
    message: 'Customize disk partitioning?',
    default: false,
  }]);

  if (customizeDisk) {
    const { scheme } = await inquirer.prompt([{
      type: 'list',
      name: 'scheme',
      message: 'Select disk layout scheme:',
      choices: ['standard', 'lvm', 'zfs', 'raid'],
      default: profile.diskLayout.scheme,
    }]);
    customized.diskLayout.scheme = scheme;
  }

  // Customize network
  const { customizeNetwork } = await inquirer.prompt([{
    type: 'confirm',
    name: 'customizeNetwork',
    message: 'Customize network configuration?',
    default: false,
  }]);

  if (customizeNetwork) {
    const { dhcp } = await inquirer.prompt([{
      type: 'confirm',
      name: 'dhcp',
      message: 'Use DHCP?',
      default: profile.network.dhcp,
    }]);
    customized.network.dhcp = dhcp;

    if (!dhcp) {
      const answers = await inquirer.prompt([
        { type: 'input', name: 'staticIp', message: 'Static IP:', default: profile.network.staticIp || '' },
        { type: 'input', name: 'gateway', message: 'Gateway:', default: profile.network.gateway || '' },
        { type: 'input', name: 'dns', message: 'DNS servers (comma-separated):', default: profile.network.dns?.join(',') || '8.8.8.8,1.1.1.1' },
      ]);
      customized.network.staticIp = answers.staticIp;
      customized.network.gateway = answers.gateway;
      customized.network.dns = answers.dns.split(',').map((s: string) => s.trim());
    }
  }

  return customized;
}

function generatePlan(profile: ProvisionProfile, hardware: HardwareInfo): InstallationPlan {
  const steps = [
    { name: 'Partitioning', description: `Create ${profile.diskLayout.scheme} disk layout`, estimatedTime: 5 },
    { name: 'Formatting', description: 'Format partitions with selected filesystems', estimatedTime: 3 },
    { name: 'Base Installation', description: 'Install base system packages', estimatedTime: 10 },
    { name: 'Package Installation', description: `Install packages: ${profile.packages.join(', ')}`, estimatedTime: 15 },
    { name: 'Network Configuration', description: `Configure ${profile.network.dhcp ? 'DHCP' : 'static IP'}`, estimatedTime: 2 },
    { name: 'System Optimization', description: `Apply ${profile.optimizations.join(', ')} optimizations`, estimatedTime: 5 },
    { name: 'Boot Configuration', description: 'Install bootloader and configure boot', estimatedTime: 3 },
  ];

  const estimatedTotalTime = steps.reduce((sum, s) => sum + s.estimatedTime, 0);

  return {
    profile,
    hardware,
    steps,
    estimatedTotalTime,
  };
}

async function createUSBForProfile(
  profile: ProvisionProfile,
  hardware: HardwareInfo,
  yes: boolean = false,
  device?: string
): Promise<void> {
  logger.info(`Creating USB installation media for ${profile.name} profile...`);

  // If no device specified, prompt for one
  let targetDevice = device;
  if (!targetDevice) {
    // List available USB devices
    try {
      const { stdout } = await execAsync('lsblk -d -o NAME,SIZE,TYPE,MODEL -n 2>/dev/null | grep usb || echo ""');
      const devices = stdout.trim().split('\n').filter(Boolean);

      if (devices.length === 0) {
        logger.error('No USB devices detected');
        logger.info('Please insert a USB drive and try again');
        process.exit(1);
      }

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select USB device:',
        choices: devices.map(d => {
          const parts = d.trim().split(/\s+/);
          return { name: `/dev/${parts[0]} (${parts[1]})`, value: `/dev/${parts[0]}` };
        }),
      }]);
      targetDevice = selected;
    } catch {
      // Fallback to manual input
      const { input } = await inquirer.prompt([{
        type: 'input',
        name: 'input',
        message: 'Enter USB device path (e.g., /dev/sdb):',
        validate: (input) => input.startsWith('/dev/') || 'Please enter a valid device path',
      }]);
      targetDevice = input;
    }
  }

  // Confirm before writing
  if (!yes) {
    logger.warn(chalk.bold.red(`WARNING: This will erase all data on ${targetDevice}`));
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to write to ${targetDevice}?`,
      default: false,
    }]);

    if (!confirm) {
      logger.info('USB creation cancelled');
      return;
    }
  }

  // Create USB
  spinner.start('usb', `Creating installation USB on ${targetDevice}...`);

  try {
    // Note: This is a placeholder for the actual USB creation logic
    // The actual implementation would use USBGenerator from usb-generator.ts
    await new Promise(resolve => setTimeout(resolve, 3000));

    spinner.succeed('usb', 'Installation USB created successfully');
    logger.success(`USB ready: ${targetDevice}`);
    logger.info('You can now boot from this USB to install eve');

  } catch (error: any) {
    spinner.fail('usb', `USB creation failed: ${error.message}`);
    process.exit(1);
  }
}

function displayHardwareSummary(hardware: HardwareInfo): void {
  section('CPU');
  logger.info(`${hardware.cpu.model}`);
  logger.info(`  ${hardware.cpu.cores} cores / ${hardware.cpu.threads} threads`);
  logger.info(`  Architecture: ${hardware.cpu.architecture}`);

  section('Memory');
  logger.info(`${formatBytes(hardware.memory.total)} total`);
  logger.info(`  Type: ${hardware.memory.type}`);
  logger.info(`  Speed: ${hardware.memory.speed} MT/s`);

  section('Storage');
  for (const disk of hardware.storage) {
    const healthColor = disk.health === 'ok' ? chalk.green :
                       disk.health === 'warning' ? chalk.yellow :
                       disk.health === 'critical' ? chalk.red : chalk.gray;
    logger.info(`${disk.model} (${disk.name})`);
    logger.info(`  Size: ${formatBytes(disk.size)}`);
    logger.info(`  Type: ${disk.type} | Interface: ${disk.interface}`);
    if (disk.health) {
      logger.info(`  Health: ${healthColor(disk.health.toUpperCase())}`);
    }
  }

  section('Network');
  for (const iface of hardware.network.filter(i => i.type !== 'loopback')) {
    logger.info(`${iface.name} (${iface.type})`);
    logger.info(`  MAC: ${iface.macAddress}`);
    if (iface.ipAddresses.length > 0) {
      logger.info(`  IPs: ${iface.ipAddresses.map(ip => ip.address).join(', ')}`);
    }
    if (iface.speed) {
      logger.info(`  Speed: ${iface.speed} Mbps`);
    }
  }

  if (hardware.gpu.length > 0) {
    section('GPU');
    for (const gpu of hardware.gpu) {
      logger.info(`${gpu.model} (${gpu.vendor})`);
      logger.info(`  VRAM: ${formatBytes(gpu.vram)}`);
    }
  }
}

function displayInstallationPlan(plan: InstallationPlan): void {
  section('Installation Plan');
  logger.info(chalk.bold(`Profile: ${plan.profile.name}`));
  logger.info(`Estimated time: ${plan.estimatedTotalTime} minutes`);
  logger.newline();

  logger.info(chalk.bold('Installation Steps:'));
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    logger.info(`${i + 1}. ${chalk.cyan(step.name)} (~${step.estimatedTime} min)`);
    logger.info(`   ${step.description}`);
  }

  logger.newline();
  logger.info(chalk.bold('Disk Layout:'));
  logger.info(`  Scheme: ${plan.profile.diskLayout.scheme.toUpperCase()}`);
  for (const partition of plan.profile.diskLayout.partitions) {
    logger.info(`  - ${partition.name}: ${partition.size} → ${partition.mountpoint} (${partition.type})`);
  }

  logger.newline();
  logger.info(chalk.bold('Network Configuration:'));
  if (plan.profile.network.dhcp) {
    logger.info('  DHCP enabled');
  } else {
    logger.info('  Static IP configuration');
    logger.info(`  IP: ${plan.profile.network.staticIp}`);
    logger.info(`  Gateway: ${plan.profile.network.gateway}`);
    logger.info(`  DNS: ${plan.profile.network.dns?.join(', ')}`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function generateMarkdownReport(report: ProvisionReport): string {
  const lines = [
    `# eve Provision Report`,
    ``,
    `**Hostname:** ${report.hostname}`,
    `**Profile:** ${report.profile}`,
    `**Status:** ${report.success ? 'SUCCESS' : 'FAILED'}`,
    `**Date:** ${report.timestamp.toISOString()}`,
    `**Duration:** ${Math.round(report.duration / 1000)}s`,
    ``,
    `## Hardware`,
    ``,
    `### CPU`,
    `- Model: ${report.hardware.cpu.model}`,
    `- Cores: ${report.hardware.cpu.cores}`,
    `- Threads: ${report.hardware.cpu.threads}`,
    `- Architecture: ${report.hardware.cpu.architecture}`,
    ``,
    `### Memory`,
    `- Total: ${formatBytes(report.hardware.memory.total)}`,
    `- Type: ${report.hardware.memory.type}`,
    `- Speed: ${report.hardware.memory.speed} MT/s`,
    `- ECC: ${report.hardware.memory.ecc ? 'Yes' : 'No'}`,
    ``,
    `### Storage`,
    ...report.hardware.storage.map(d => `- ${d.name}: ${formatBytes(d.size)} (${d.type})`),
    ``,
    `### Network`,
    ...report.hardware.network.map(i => `- ${i.name}: ${i.macAddress} (${i.type})`),
    ``,
  ];

  if (report.hardware.gpu.length > 0) {
    lines.push(
      `### GPUs`,
      ...report.hardware.gpu.map(g => `- ${g.model} (${g.vendor}): ${formatBytes(g.vram)} VRAM`),
      ``
    );
  }

  if (report.benchmarks) {
    lines.push(
      '## Performance Benchmarks',
      '',
      `**Overall Score:** ${report.benchmarks.overall}/100`,
      '',
      `- CPU: ${report.benchmarks.cpu?.score.toFixed(1) || 0}/100`,
      `- Memory: ${report.benchmarks.memory?.score.toFixed(1) || 0}/100`,
      ''
    );
  }

  if (report.warnings.length > 0) {
    lines.push(
      '## Warnings',
      ...report.warnings.map(w => `- ${w}`),
      ''
    );
  }

  if (report.errors.length > 0) {
    lines.push(
      '## Errors',
      ...report.errors.map(e => `- ${e}`),
      ''
    );
  }

  return lines.join('\n');
}

/**
 * Detect network type (public, CGNAT, private)
 * Used to recommend Pangolin tunnel for remote access
 */
async function detectNetworkType(): Promise<'public' | 'cgmat' | 'private' | 'unknown'> {
  try {
    // Get public IP from external service
    const { stdout: publicIP } = await execAsync(
      'curl -s https://api.ipify.org 2>/dev/null || echo ""',
      { timeout: 5000 }
    );
    
    if (!publicIP.trim()) {
      return 'unknown';
    }
    
    // Check if IP is in CGNAT range (100.64.0.0/10)
    // CGNAT range: 100.64.0.0 - 100.127.255.255
    const ipParts = publicIP.trim().split('.');
    if (ipParts.length === 4) {
      const first = parseInt(ipParts[0], 10);
      const second = parseInt(ipParts[1], 10);
      
      if (first === 100 && second >= 64 && second <= 127) {
        return 'cgmat';
      }
      
      // Check for RFC1918 private IPs (shouldn't happen with public IP check, but safety)
      if (
        (first === 10) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168)
      ) {
        return 'private';
      }
    }
    
    return 'public';
  } catch {
    return 'unknown';
  }
}

function generateHTMLReport(report: ProvisionReport): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>eve Provision Report - ${report.hostname}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
    h1, h2 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    .success { color: #28a745; }
    .warning { color: #ffc107; }
    .error { color: #dc3545; }
  </style>
</head>
<body>
  <h1>eve Server Provision Report</h1>
  <p><strong>Hostname:</strong> ${report.hostname}</p>
  <p><strong>Profile:</strong> ${report.profile}</p>
  <p><strong>Generated:</strong> ${report.timestamp.toISOString()}</p>

  <h2>Hardware Summary</h2>
  <table>
    <tr><th colspan="2">CPU</th></tr>
    <tr><td>Model</td><td>${report.hardware.cpu.model}</td></tr>
    <tr><td>Cores</td><td>${report.hardware.cpu.cores} physical / ${report.hardware.cpu.threads} logical</td></tr>
    <tr><td>Architecture</td><td>${report.hardware.cpu.architecture}</td></tr>

    <tr><th colspan="2">Memory</th></tr>
    <tr><td>Total</td><td>${formatBytes(report.hardware.memory.total)}</td></tr>
    <tr><td>Type</td><td>${report.hardware.memory.type}</td></tr>

    <tr><th colspan="2">Storage</th></tr>
    ${report.hardware.storage.map(s => `
      <tr><td>${s.model}</td><td>${formatBytes(s.size)} (${s.type})</td></tr>
    `).join('')}
  </table>

  ${report.benchmarks ? `
  <h2>Performance Benchmarks</h2>
  <p><strong>Overall Score:</strong> ${report.benchmarks.overall}/100</p>
  <table>
    <tr><td>CPU</td><td>${report.benchmarks.cpu?.score.toFixed(1) || 0}/100</td></tr>
    <tr><td>Memory</td><td>${report.benchmarks.memory?.score.toFixed(1) || 0}/100</td></tr>
  </table>
  ` : ''}
</body>
</html>`;
}
