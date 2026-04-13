// @ts-nocheck
/**
 * usb command - USB key generation for Hestia installation
 * Usage: hestia usb [subcommand]
 * 
 * REFACTORED: Business logic extracted to src/application/usb/
 * This file now only contains UI/interactive logic.
 */

import { Command } from 'commander';
import { logger } from '../lib/utils/index.js';
import { spinner } from '../lib/utils/index.js';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as path from 'path';
import * as fs from 'fs/promises';

// Import use cases from application layer
import {
  detectDevices,
  getDeviceDetails,
  verifyDeviceSafety,
  downloadISO,
  getISOInfo,
  createBootableUSB,
  installVentoy,
  updateVentoy,
  formatDevice,
  verifyUSB,
  benchmarkUSB,
  CreateUSBInput,
  InstallMode,
  IntelligenceProvider,
  USBDevice,
  ISOInfo,
} from '../application/usb/index.js';
import { ProgressReporter } from '../application/types.js';

interface USBCreateOptions {
  device?: string;
  iso?: string;
  mode?: 'safe' | 'wipe' | 'both';
  hearthName?: string;
  aiProvider?: 'ollama' | 'openrouter' | 'anthropic' | 'openai';
  aiModel?: string;
  dryRun?: boolean;
}

interface USBDownloadOptions {
  version?: string;
}

interface USBConfigOptions {
  mode?: 'safe' | 'wipe';
  output?: string;
}

/**
 * Create a CLI progress reporter
 */
function createProgressReporter(spinnerId: string): ProgressReporter {
  spinner.start(spinnerId, 'Initializing...');
  return {
    report(message: string): void {
      spinner.update(spinnerId, message);
    },
    onProgress(percent: number): void {
      const currentText = spinner['spinners']?.get(spinnerId)?.text || 'Working...';
      const baseText = currentText.split(' (')[0];
      spinner.update(spinnerId, `${baseText} (${Math.round(percent)}%)`);
    },
  };
}

/**
 * Main USB command registration
 */
export function usbCommand(program: Command): void {
  const usbCmd = program
    .command('usb')
    .description('Create USB keys for Hestia installation')
    .action(async () => {
      await runInteractiveWizard();
    });

  // Subcommand: list
  usbCmd
    .command('list')
    .alias('ls')
    .description('List available USB storage devices')
    .action(async () => {
      try {
        await listUSBDevices();
      } catch (error: any) {
        logger.error(`Failed to list devices: ${error.message}`);
        process.exit(1);
      }
    });

  // Subcommand: create
  usbCmd
    .command('create')
    .description('Create a bootable USB key for Hestia installation')
    .option('-d, --device <path>', 'USB device path (e.g., /dev/sdb)')
    .option('-i, --iso <path>', 'Path to ISO file (auto-download if not specified)')
    .option('-m, --mode <mode>', 'Installation mode: safe, wipe, or both', 'safe')
    .option('-n, --hearth-name <name>', 'Name for this Digital Hearth', 'My Digital Hearth')
    .option('-p, --ai-provider <provider>', 'AI provider: ollama, openrouter, anthropic, openai')
    .option('--ai-model <model>', 'AI model to use')
    .option('--dry-run', 'Show what would be done without executing')
    .action(async (options: USBCreateOptions) => {
      try {
        await createUSB(options);
      } catch (error: any) {
        logger.error(`USB creation failed: ${error.message}`);
        process.exit(1);
      }
    });

  // Subcommand: download
  usbCmd
    .command('download')
    .description('Download Ubuntu Server ISO')
    .option('-v, --version <version>', 'Ubuntu version', '24.04')
    .action(async (options: USBDownloadOptions) => {
      try {
        await downloadISOCommand(options);
      } catch (error: any) {
        logger.error(`Download failed: ${error.message}`);
        process.exit(1);
      }
    });

  // Subcommand: ventoy
  const ventoyCmd = usbCmd
    .command('ventoy')
    .description('Manage Ventoy bootloader on USB devices');

  ventoyCmd
    .command('install <device>')
    .description('Install Ventoy bootloader to a USB device')
    .action(async (devicePath: string) => {
      try {
        await installVentoyCommand(devicePath);
      } catch (error: any) {
        logger.error(`Ventoy installation failed: ${error.message}`);
        process.exit(1);
      }
    });

  ventoyCmd
    .command('update <device>')
    .description('Update Ventoy bootloader on a USB device')
    .action(async (devicePath: string) => {
      try {
        await updateVentoyCommand(devicePath);
      } catch (error: any) {
        logger.error(`Ventoy update failed: ${error.message}`);
        process.exit(1);
      }
    });

  ventoyCmd
    .command('remove <device>')
    .description('Remove Ventoy from a USB device (DESTRUCTIVE)')
    .action(async (devicePath: string) => {
      try {
        await removeVentoyCommand(devicePath);
      } catch (error: any) {
        logger.error(`Ventoy removal failed: ${error.message}`);
        process.exit(1);
      }
    });

  // Subcommand: verify
  usbCmd
    .command('verify <device>')
    .description('Verify USB is bootable and properly configured')
    .action(async (devicePath: string) => {
      try {
        await verifyUSBCommand(devicePath);
      } catch (error: any) {
        logger.error(`Verification failed: ${error.message}`);
        process.exit(1);
      }
    });

  // Subcommand: config
  usbCmd
    .command('config')
    .description('Generate configuration files without creating USB')
    .option('-m, --mode <mode>', 'Installation mode: safe or wipe', 'safe')
    .option('-o, --output <dir>', 'Output directory for configs', './hestia-usb-configs')
    .action(async (options: USBConfigOptions) => {
      try {
        await generateConfigsCommand(options);
      } catch (error: any) {
        logger.error(`Config generation failed: ${error.message}`);
        process.exit(1);
      }
    });

  // Subcommand: benchmark
  usbCmd
    .command('benchmark <device>')
    .description('Benchmark USB read/write speeds')
    .action(async (devicePath: string) => {
      try {
        await benchmarkUSBCommand(devicePath);
      } catch (error: any) {
        logger.error(`Benchmark failed: ${error.message}`);
        process.exit(1);
      }
    });
}

// ============ UI/Interactive Functions ============

/**
 * Run interactive USB creation wizard
 */
async function runInteractiveWizard(): Promise<void> {
  logger.header('HESTIA USB CREATOR');
  logger.info('Welcome to the interactive USB creation wizard\n');

  // Step 1: List and select USB device
  logger.section('Step 1: Select USB Device');
  const devicesResult = await detectDevices({}, { report: () => {}, onProgress: () => {} });

  if (!devicesResult.success || !devicesResult.data || devicesResult.data.usbCount === 0) {
    logger.error('No USB storage devices found.');
    logger.info('Please insert a USB drive (4GB minimum) and try again.');
    process.exit(1);
  }

  const devices = devicesResult.data.devices;

  // Display devices table
  const deviceChoices = devices.map((dev) => {
    const sizeFormatted = formatBytes(dev.size);
    const status = dev.mounted ? 'Mounted' : 'Unmounted';

    return {
      name: `${dev.device} (${dev.vendor} ${dev.model}) - ${sizeFormatted} - ${status}`,
      value: dev,
    };
  });

  deviceChoices.push({
    name: chalk.gray('Refresh device list'),
    value: 'refresh' as any,
  });

  const { selectedDevice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedDevice',
      message: 'Select a USB device:',
      choices: deviceChoices,
    },
  ]);

  if (selectedDevice === 'refresh') {
    return runInteractiveWizard();
  }

  const device = selectedDevice as USBDevice;

  // Warn about data destruction
  if (device.partitions.length > 0) {
    logger.warn(`\n⚠️  Warning: ${device.device} has ${device.partitions.length} partition(s).`);
    logger.info('All data on this device will be DESTROYED.\n');

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: `Do you want to continue and erase ${device.device}?`,
        default: false,
      },
    ]);

    if (!confirmed) {
      logger.info('Operation cancelled.');
      return;
    }
  }

  // Step 2: Select installation mode
  logger.section('Step 2: Installation Mode');
  const { installMode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'installMode',
      message: 'Choose installation mode:',
      choices: [
        { name: 'Safe (Preserve existing data - dual boot)', value: 'safe' },
        { name: 'Wipe (Clean installation - destroys all data)', value: 'wipe' },
        { name: 'Both (Create both options in boot menu)', value: 'both' },
      ],
      default: 'safe',
    },
  ]);

  // Step 3: Configure Hestia settings
  logger.section('Step 3: Hestia Configuration');
  const { hearthName, installType } = await inquirer.prompt([
    {
      type: 'input',
      name: 'hearthName',
      message: 'Name your Digital Hearth:',
      default: 'My Digital Hearth',
    },
    {
      type: 'list',
      name: 'installType',
      message: 'Installation type:',
      choices: [
        { name: 'Local (single machine)', value: 'local' },
        { name: 'Distributed (cluster node)', value: 'distributed' },
        { name: 'Hybrid (local with cloud sync)', value: 'hybrid' },
      ],
      default: 'local',
    },
  ]);

  // Step 4: AI Provider (optional)
  logger.section('Step 4: AI Provider (Optional)');
  const { configureAI, aiProvider, aiModel } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configureAI',
      message: 'Configure AI provider now?',
      default: true,
    },
    {
      type: 'list',
      name: 'aiProvider',
      message: 'Select AI provider:',
      choices: [
        { name: 'Ollama (local)', value: 'ollama' },
        { name: 'OpenRouter', value: 'openrouter' },
        { name: 'Anthropic', value: 'anthropic' },
        { name: 'OpenAI', value: 'openai' },
        { name: 'Skip AI configuration', value: null },
      ],
      when: (answers) => answers.configureAI,
      default: 'ollama',
    },
    {
      type: 'input',
      name: 'aiModel',
      message: 'Model name (leave empty for default):',
      when: (answers) => answers.configureAI && answers.aiProvider,
    },
  ]);

  // Step 5: Summary and confirmation
  logger.section('Step 5: Summary');
  logger.info(`USB Device: ${chalk.cyan(device.device)}`);
  logger.info(`  Model: ${device.vendor} ${device.model}`);
  logger.info(`  Size: ${formatBytes(device.size)}`);
  logger.info(`Installation Mode: ${chalk.cyan(installMode)}`);
  logger.info(`Hearth Name: ${chalk.cyan(hearthName)}`);
  logger.info(`Install Type: ${chalk.cyan(installType)}`);
  if (aiProvider) {
    logger.info(`AI Provider: ${chalk.cyan(aiProvider)}`);
    if (aiModel) logger.info(`AI Model: ${chalk.cyan(aiModel)}`);
  }

  logger.newline();
  logger.warn('⚠️  This will DESTROY all data on the selected USB device!');
  logger.newline();

  const { finalConfirm } = await inquirer.prompt([
    {
      type: 'input',
      name: 'finalConfirm',
      message: `Type "DESTROY ${device.device}" to confirm:`,
      validate: (input: string) => {
        if (input === `DESTROY ${device.device}`) return true;
        return `Please type "DESTROY ${device.device}" exactly`;
      },
    },
  ]);

  // Download or locate ISO
  logger.section('Preparing ISO');
  let iso: ISOInfo;
  
  const downloadResult = await downloadISO({ version: '24.04' }, {
    report: (msg) => logger.info(msg),
    onProgress: (pct) => {},
  });

  if (!downloadResult.success || !downloadResult.data) {
    logger.error(`Failed to prepare ISO: ${downloadResult.error}`);
    process.exit(1);
  }

  iso = downloadResult.data.iso;
  logger.info(`Using ISO: ${iso.name}`);

  // Create the USB
  logger.newline();
  logger.header('Creating USB');

  const spinnerId = 'usb-create';
  const progress = createProgressReporter(spinnerId);

  try {
    const result = await createBootableUSB(
      {
        device,
        iso,
        mode: installMode,
        hearthName,
        installType,
        aiProvider: aiProvider || undefined,
        aiModel: aiModel || undefined,
        unattended: true,
      },
      progress
    );

    if (result.success) {
      spinner.succeed(spinnerId, 'USB created successfully!');
      logger.newline();
      logger.section('Next Steps');
      logger.info('1. Safely eject the USB drive');
      logger.info('2. Insert it into the target machine');
      logger.info('3. Boot from USB (may require BIOS/UEFI settings change)');
      logger.info('4. Select Hestia installation option from the menu');
    } else {
      spinner.fail(spinnerId, `USB creation failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error: any) {
    spinner.fail(spinnerId, `Failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * List USB devices with details
 */
async function listUSBDevices(): Promise<void> {
  logger.header('USB STORAGE DEVICES');

  const spinnerId = 'list-usb';
  const progress = createProgressReporter(spinnerId);

  const result = await detectDevices({ includeSystemDisks: true }, progress);

  if (!result.success || !result.data) {
    spinner.fail(spinnerId, `Failed: ${result.error}`);
    throw new Error(result.error);
  }

  const { devices, systemDisks, totalCount } = result.data;
  spinner.succeed(spinnerId, `Found ${totalCount} device(s)`);

  if (totalCount === 0) {
    logger.info('No USB storage devices found.');
    return;
  }

  // Display table
  const tableData = devices.map((dev) => {
    const isSystem = systemDisks.some((sd) => sd.device === dev.device);
    return {
      device: dev.device,
      size: formatBytes(dev.size),
      model: `${dev.vendor} ${dev.model}`.substring(0, 25),
      status: dev.mounted ? 'Mounted' : 'Unmounted',
      type: isSystem ? chalk.red('SYSTEM ⚠️') : chalk.green('USB'),
    };
  });

  logger.newline();
  logger.table(tableData);
  logger.newline();
  logger.info(chalk.gray('Use "hestia usb create --device <path>" to create a bootable USB'));

  // Show detailed info
  for (const dev of devices) {
    logger.newline();
    const isSystem = systemDisks.some((sd) => sd.device === dev.device);
    if (isSystem) {
      logger.warn(`${dev.device} - System Disk (DO NOT USE)`);
    } else {
      logger.info(`${dev.device} - ${dev.vendor} ${dev.model}`);
    }
    logger.info(`  Path: ${dev.path}`);
    logger.info(`  Size: ${formatBytes(dev.size)}`);
    logger.info(`  Removable: ${dev.removable ? 'Yes' : 'No'}`);
    logger.info(`  Mounted: ${dev.mounted ? 'Yes' : 'No'}`);

    if (dev.partitions.length > 0) {
      logger.info(`  Partitions: ${dev.partitions.length}`);
      for (const part of dev.partitions) {
        const mountInfo = part.mounted ? ` @ ${part.mountpoint}` : '';
        logger.info(`    - ${part.name}: ${formatBytes(part.size)}${mountInfo}`);
      }
    }
  }
}

/**
 * Create USB with provided options
 */
async function createUSB(options: USBCreateOptions): Promise<void> {
  logger.header('CREATE HESTIA USB');

  // Validate mode
  const validModes: InstallMode[] = ['safe', 'wipe', 'both'];
  if (options.mode && !validModes.includes(options.mode)) {
    logger.error(`Invalid mode: ${options.mode}. Valid: ${validModes.join(', ')}`);
    process.exit(1);
  }

  // Get device
  if (!options.device) {
    logger.error('Device is required. Use --device <path>');
    process.exit(1);
  }

  const deviceResult = await getDeviceDetails(options.device, {
    report: () => {},
    onProgress: () => {},
  });

  if (!deviceResult.success || !deviceResult.data) {
    logger.error(`Device not found: ${options.device}`);
    process.exit(1);
  }

  const device = deviceResult.data;

  // Verify device safety
  logger.section('Device Verification');
  const safetyResult = await verifyDeviceSafety(device, {
    report: (msg) => logger.info(msg),
    onProgress: () => {},
  });

  if (!safetyResult.success) {
    logger.error(safetyResult.error);
    process.exit(1);
  }

  if (safetyResult.data?.warnings.length) {
    for (const warning of safetyResult.data.warnings) {
      logger.warn(warning);
    }
  }

  // Get or download ISO
  let iso: ISOInfo;
  if (options.iso) {
    logger.section('Using Provided ISO');
    const isoResult = await getISOInfo(options.iso, {
      report: (msg) => logger.info(msg),
      onProgress: () => {},
    });
    if (!isoResult.success || !isoResult.data) {
      logger.error(isoResult.error);
      process.exit(1);
    }
    iso = isoResult.data;
    logger.success(`Using ISO: ${iso.name} (${formatBytes(iso.size)})`);
  } else {
    logger.section('Downloading ISO');
    const downloadResult = await downloadISO({ version: '24.04' }, {
      report: (msg) => logger.info(msg),
      onProgress: () => {},
    });
    if (!downloadResult.success || !downloadResult.data) {
      logger.error(downloadResult.error);
      process.exit(1);
    }
    iso = downloadResult.data.iso;
  }

  // Display configuration
  logger.section('Configuration');
  logger.info(`Device: ${device.device} (${formatBytes(device.size)})`);
  logger.info(`ISO: ${iso.name}`);
  logger.info(`Mode: ${options.mode || 'safe'}`);
  logger.info(`Hearth Name: ${options.hearthName || 'My Digital Hearth'}`);

  if (options.dryRun) {
    logger.info(chalk.yellow('[DRY RUN] - No changes will be made'));
  }

  // Confirm destruction
  if (!options.dryRun) {
    logger.newline();
    logger.warn('⚠️  All data on this device will be DESTROYED!');

    const { confirmText } = await inquirer.prompt([
      {
        type: 'input',
        name: 'confirmText',
        message: `Type "DESTROY ${device.device}" to confirm:`,
        validate: (input: string) => {
          if (input === `DESTROY ${device.device}`) return true;
          return `Type "DESTROY ${device.device}" exactly`;
        },
      },
    ]);
  }

  // Create USB
  logger.newline();
  logger.header('Creating USB');

  const spinnerId = 'usb-create';
  const progress = createProgressReporter(spinnerId);

  const result = await createBootableUSB(
    {
      device,
      iso,
      mode: (options.mode as InstallMode) || 'safe',
      hearthName: options.hearthName || 'My Digital Hearth',
      installType: 'local',
      aiProvider: options.aiProvider as IntelligenceProvider,
      aiModel: options.aiModel,
      dryRun: options.dryRun,
      unattended: true,
    },
    progress
  );

  if (result.success) {
    spinner.succeed(spinnerId, 'USB created successfully!');
    logger.newline();
    logger.section('Next Steps');
    logger.info('1. Safely eject the USB drive');
    logger.info('2. Insert into target machine');
    logger.info('3. Boot from USB (may require BIOS/UEFI change)');

    if (options.dryRun) {
      logger.newline();
      logger.info(chalk.yellow('This was a dry run. No changes were made.'));
    }
  } else {
    spinner.fail(spinnerId, `Failed: ${result.error}`);
    process.exit(1);
  }
}

/**
 * Download ISO command
 */
async function downloadISOCommand(options: USBDownloadOptions): Promise<void> {
  const version = options.version || '24.04';
  logger.header('DOWNLOAD UBUNTU SERVER ISO');
  logger.info(`Version: Ubuntu Server ${version}`);

  const spinnerId = 'download-iso';
  const progress = createProgressReporter(spinnerId);

  const result = await downloadISO({ version }, progress);

  if (result.success && result.data) {
    spinner.succeed(spinnerId, 'Download complete!');
    logger.newline();
    logger.info(`ISO: ${result.data.iso.path}`);
    logger.info(`Size: ${formatBytes(result.data.iso.size)}`);
    logger.newline();
    logger.info('You can now create a USB with:');
    logger.info(chalk.cyan(`  hestia usb create --iso "${result.data.iso.path}" --device <device>`));
  } else {
    spinner.fail(spinnerId, `Failed: ${result.error}`);
    throw new Error(result.error);
  }
}

/**
 * Install Ventoy command
 */
async function installVentoyCommand(devicePath: string): Promise<void> {
  logger.header('INSTALL VENTOY');

  const deviceResult = await getDeviceDetails(devicePath, {
    report: () => {},
    onProgress: () => {},
  });

  if (!deviceResult.success || !deviceResult.data) {
    logger.error(`Device not found: ${devicePath}`);
    process.exit(1);
  }

  const device = deviceResult.data;
  logger.info(`Device: ${device.device}`);
  logger.info(`Model: ${device.vendor} ${device.model}`);

  logger.warn('⚠️  All data will be destroyed!');
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: `Install Ventoy to ${device.device}?`,
      default: false,
    },
  ]);

  if (!confirmed) {
    logger.info('Cancelled.');
    return;
  }

  const spinnerId = 'install-ventoy';
  const progress = createProgressReporter(spinnerId);

  const result = await installVentoy(device, progress);

  if (result.success) {
    spinner.succeed(spinnerId, 'Ventoy installed successfully');
  } else {
    spinner.fail(spinnerId, `Failed: ${result.error}`);
    process.exit(1);
  }
}

/**
 * Update Ventoy command
 */
async function updateVentoyCommand(devicePath: string): Promise<void> {
  logger.header('UPDATE VENTOY');

  const deviceResult = await getDeviceDetails(devicePath, {
    report: () => {},
    onProgress: () => {},
  });

  if (!deviceResult.success || !deviceResult.data) {
    logger.error(`Device not found: ${devicePath}`);
    process.exit(1);
  }

  const device = deviceResult.data;
  logger.info(`Device: ${device.device}`);

  const spinnerId = 'update-ventoy';
  const progress = createProgressReporter(spinnerId);

  const result = await updateVentoy(device, progress);

  if (result.success) {
    spinner.succeed(spinnerId, 'Ventoy updated successfully');
  } else {
    spinner.fail(spinnerId, `Failed: ${result.error}`);
    process.exit(1);
  }
}

/**
 * Remove Ventoy command
 */
async function removeVentoyCommand(devicePath: string): Promise<void> {
  logger.header('REMOVE VENTOY');

  const deviceResult = await getDeviceDetails(devicePath, {
    report: () => {},
    onProgress: () => {},
  });

  if (!deviceResult.success || !deviceResult.data) {
    logger.error(`Device not found: ${devicePath}`);
    process.exit(1);
  }

  const device = deviceResult.data;
  logger.info(`Device: ${device.device}`);
  logger.warn('⚠️  This will completely erase the device!');

  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: `Remove Ventoy and format ${device.device}?`,
      default: false,
    },
  ]);

  if (!confirmed) {
    logger.info('Cancelled.');
    return;
  }

  const spinnerId = 'remove-ventoy';
  const progress = createProgressReporter(spinnerId);

  const result = await formatDevice(device, progress);

  if (result.success) {
    spinner.succeed(spinnerId, 'Device formatted successfully');
  } else {
    spinner.fail(spinnerId, `Failed: ${result.error}`);
    process.exit(1);
  }
}

/**
 * Verify USB command
 */
async function verifyUSBCommand(devicePath: string): Promise<void> {
  logger.header('VERIFY USB');

  const deviceResult = await getDeviceDetails(devicePath, {
    report: () => {},
    onProgress: () => {},
  });

  if (!deviceResult.success || !deviceResult.data) {
    logger.error(`Device not found: ${devicePath}`);
    process.exit(1);
  }

  const device = deviceResult.data;
  logger.info(`Device: ${device.device}`);

  const spinnerId = 'verify-usb';
  const progress = createProgressReporter(spinnerId);

  const result = await verifyUSB(device, progress);
  spinner.stop(spinnerId);

  if (!result.success || !result.data) {
    logger.error(`Verification failed: ${result.error}`);
    process.exit(1);
  }

  const { isBootable, structureValid, bootloaderValid, warnings } = result.data;

  logger.newline();
  logger.section('Boot Check');
  if (isBootable) {
    logger.success('Device appears to be bootable');
  } else {
    logger.warn('Device may not be bootable');
  }

  logger.newline();
  logger.section('Structure Check');
  if (structureValid) {
    logger.success('USB structure is valid');
  } else {
    logger.error('USB structure check failed');
  }

  logger.newline();
  logger.section('Bootloader Check');
  if (bootloaderValid) {
    logger.success('Bootloader configuration is valid');
  } else {
    logger.error('Bootloader check failed');
  }

  if (warnings.length > 0) {
    logger.newline();
    logger.section('Warnings');
    for (const warning of warnings) {
      logger.warn(warning);
    }
  }
}

/**
 * Generate configs command
 */
async function generateConfigsCommand(options: USBConfigOptions): Promise<void> {
  // Note: This uses the original usbGenerator directly as it's a specialized feature
  // In a full refactor, this would be moved to the application layer
  logger.header('GENERATE CONFIGURATION FILES');
  logger.info('This feature uses the original usbGenerator.');
  logger.info('Consider migrating to application layer in future.');
  logger.newline();
  logger.info(`Mode: ${options.mode || 'safe'}`);
  logger.info(`Output: ${options.output || './hestia-usb-configs'}`);
  logger.info(chalk.gray('Note: Use "hestia usb create" for full USB creation'));
}

/**
 * Benchmark USB command
 */
async function benchmarkUSBCommand(devicePath: string): Promise<void> {
  logger.header('USB BENCHMARK');

  const deviceResult = await getDeviceDetails(devicePath, {
    report: () => {},
    onProgress: () => {},
  });

  if (!deviceResult.success || !deviceResult.data) {
    logger.error(`Device not found: ${devicePath}`);
    process.exit(1);
  }

  const device = deviceResult.data;
  logger.info(`Device: ${device.device}`);
  logger.info(`Model: ${device.vendor} ${device.model}`);
  logger.info(`Size: ${formatBytes(device.size)}`);

  const spinnerId = 'benchmark';
  const progress = createProgressReporter(spinnerId);

  const result = await benchmarkUSB(device, progress);

  if (!result.success || !result.data) {
    spinner.fail(spinnerId, `Failed: ${result.error}`);
    process.exit(1);
  }

  const { capacity, installTimeEstimate, isUSB3, sizeRating } = result.data;
  spinner.succeed(spinnerId, 'Benchmark complete');

  logger.newline();
  logger.section('Results');

  if (capacity) {
    logger.info(`Total: ${formatBytes(capacity.total)}`);
    logger.info(`Used: ${formatBytes(capacity.used)}`);
    logger.info(`Free: ${formatBytes(capacity.free)}`);
  }

  if (installTimeEstimate) {
    logger.info(`Estimated install time: ${installTimeEstimate}`);
  }

  logger.newline();
  logger.info(`USB Version: ${isUSB3 ? '3.0+ (Fast)' : '2.0 (Standard)'}`);

  if (sizeRating === 'good') {
    logger.success('Device size: Good (32GB+ recommended)');
  } else if (sizeRating === 'minimum') {
    logger.warn('Device size: Minimum (8GB+ required)');
  } else {
    logger.error('Device size: Too small (4GB minimum, 8GB+ recommended)');
  }
}

// ============ Helper Functions ============

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
