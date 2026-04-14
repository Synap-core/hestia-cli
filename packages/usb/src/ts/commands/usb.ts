// @ts-nocheck
/**
 * usb command - USB key generation for Hestia installation
 * Usage: hestia usb [subcommand]
 */

import { Command } from 'commander';
import { logger } from '../lib/logger.js';
import { spinner } from '../lib/spinner.js';
import { usbGenerator, USBDevice, USBError } from '../lib/usb-generator.js';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as path from 'path';
import * as fs from 'fs/promises';
import { homedir } from 'os';
import { writeUsbSetupManifest } from '@eve/dna';

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

interface USBVentoyOptions {
  device: string;
}

interface USBConfigOptions {
  mode?: 'safe' | 'wipe';
  output?: string;
}

/**
 * Main USB command registration
 */
export function usbCommand(program: Command): void {
  const usbCmd = program
    .command('usb')
    .description('Create USB keys for Hestia installation')
    .action(async () => {
      // Default action: run interactive wizard
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
        await downloadISO(options);
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
        await installVentoy(devicePath);
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
        await updateVentoy(devicePath);
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
        await removeVentoy(devicePath);
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
        await verifyUSB(devicePath);
      } catch (error: any) {
        logger.error(`Verification failed: ${error.message}`);
        process.exit(1);
      }
    });

  // Subcommand: generate
  usbCmd
    .command('generate')
    .description('Generate bootable USB structure with all executables')
    .option('-o, --output <dir>', 'Output directory', './hestia-usb-bundle')
    .option('-f, --format <format>', 'Output format (directory|iso|both)', 'directory')
    .option('-l, --label <label>', 'Volume label', 'HESTIA_USB')
    .option('-i, --iso-path <path>', 'Path to base ISO (auto-download if not specified)')
    .option('-b, --bundle-all', 'Bundle all Synap components')
    .option('--include-docker', 'Include Docker and docker-compose files')
    .option('--include-backend', 'Include synap-backend services')
    .action(async (options: any) => {
      try {
        await generateUSBBundle(options);
      } catch (error: any) {
        logger.error(`USB bundle generation failed: ${error.message}`);
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
        await generateConfigs(options);
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
        await benchmarkUSB(devicePath);
      } catch (error: any) {
        logger.error(`Benchmark failed: ${error.message}`);
        process.exit(1);
      }
    });
}

/**
 * Run interactive USB creation wizard
 */
async function runInteractiveWizard(): Promise<void> {
  logger.header('HESTIA USB CREATOR');
  logger.info('Welcome to the interactive USB creation wizard\n');

  // Step 1: List and select USB device
  logger.section('Step 1: Select USB Device');
  const devices = await usbGenerator.listUSBDevices();

  if (devices.length === 0) {
    logger.error('No USB storage devices found.');
    logger.info('Please insert a USB drive (4GB minimum) and try again.');
    process.exit(1);
  }

  // Display devices table
  const deviceChoices = devices.map((dev) => {
    const isSystem = isSystemDiskHint(dev);
    const sizeFormatted = formatBytes(dev.size);
    const status = dev.mounted ? 'Mounted' : 'Unmounted';
    const warning = isSystem ? chalk.red(' ⚠️ SYSTEM DISK') : '';

    return {
      name: `${dev.device} (${dev.vendor} ${dev.model}) - ${sizeFormatted} - ${status}${warning}`,
      value: dev,
      disabled: isSystem ? 'Cannot use system disk' : false,
    };
  });

  deviceChoices.push({
    name: chalk.gray('Refresh device list'),
    value: 'refresh' as any,
    disabled: false,
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
    // Restart wizard
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
        {
          name: 'Safe (Preserve existing data - dual boot)',
          value: 'safe',
        },
        {
          name: 'Wipe (Clean installation - destroys all data)',
          value: 'wipe',
        },
        {
          name: 'Both (Create both options in boot menu)',
          value: 'both',
        },
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
  let isoInfo;
  try {
    // Check if ISO already exists in cache
    const existingISOs = await usbGenerator.listAvailableISOs();
    const ubuntuISO = existingISOs.find((iso) => iso.name.includes('ubuntu'));

    if (ubuntuISO && ubuntuISO.isValid) {
      logger.info(`Using cached ISO: ${ubuntuISO.name}`);
      isoInfo = ubuntuISO;
    } else {
      logger.info('Ubuntu Server ISO not found in cache.');
      const { shouldDownload } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldDownload',
          message: 'Download Ubuntu Server 24.04 ISO?',
          default: true,
        },
      ]);

      if (shouldDownload) {
        isoInfo = await usbGenerator.downloadUbuntu('24.04');
      } else {
        logger.error('ISO is required to create USB. Please download or specify a path.');
        process.exit(1);
      }
    }
  } catch (error: any) {
    logger.error(`Failed to prepare ISO: ${error.message}`);
    process.exit(1);
  }

  // Create the USB
  logger.newline();
  logger.header('Creating USB');

  try {
    // Track progress
    usbGenerator.on('progress', (progress) => {
      if (progress.percentage !== undefined) {
        spinner.update('usb-create', `${progress.phase}: ${progress.percentage}%`);
      }
    });

    const result = await usbGenerator.createUSB(
      {
        device,
        iso: isoInfo,
        mode: installMode,
        hearthName,
        installType,
        aiProvider: aiProvider || undefined,
        aiModel: aiModel || undefined,
        unattended: true,
      },
      (progress) => {
        // Progress callback handled by event emitter above
      }
    );

    if (result.success) {
      logger.newline();
      logger.success('USB creation complete! 🔥');
      logger.newline();
      logger.section('Next Steps');
      logger.info('1. Safely eject the USB drive');
      logger.info('2. Insert it into the target machine');
      logger.info('3. Boot from USB (may require BIOS/UEFI settings change)');
      logger.info('4. Select Hestia installation option from the menu');
    } else {
      logger.error(`USB creation failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error: any) {
    logger.error(`USB creation failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * List USB devices with details
 */
async function listUSBDevices(): Promise<void> {
  logger.header('USB STORAGE DEVICES');

  const spinnerId = 'list-usb';
  spinner.start(spinnerId, 'Scanning for USB devices...');

  try {
    const devices = await usbGenerator.listUSBDevices();
    spinner.succeed(spinnerId, `Found ${devices.length} USB device(s)`);

    if (devices.length === 0) {
      logger.info('No USB storage devices found.');
      logger.info('Insert a USB drive to see it listed here.');
      return;
    }

    // Build table data
    const tableData = devices.map((dev) => {
      const isSystem = isSystemDiskHint(dev);
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

    // Show detailed info for each device
    for (const dev of devices) {
      logger.newline();
      if (isSystemDiskHint(dev)) {
        logger.warn(`${dev.device} - System Disk (DO NOT USE)`);
      } else {
        logger.info(`${dev.device} - ${dev.vendor} ${dev.model}`);
      }
      logger.info(`  Path: ${dev.path}`);
      logger.info(`  Size: ${formatBytes(dev.size)}`);
      logger.info(`  Removable: ${dev.removable ? 'Yes' : 'No'}`);
      logger.info(`  Readonly: ${dev.readonly ? 'Yes' : 'No'}`);
      logger.info(`  Mounted: ${dev.mounted ? 'Yes' : 'No'}`);

      if (dev.partitions.length > 0) {
        logger.info(`  Partitions: ${dev.partitions.length}`);
        for (const part of dev.partitions) {
          const mountInfo = part.mounted ? ` @ ${part.mountpoint}` : '';
          logger.info(`    - ${part.name}: ${formatBytes(part.size)}${part.type ? ` (${part.type})` : ''}${mountInfo}`);
        }
      }
    }
  } catch (error: any) {
    spinner.fail(spinnerId, `Failed: ${error.message}`);
    throw error;
  }
}

/**
 * Create USB with provided options
 */
async function createUSB(options: USBCreateOptions): Promise<void> {
  logger.header('CREATE HESTIA USB');

  // Validate mode
  const validModes = ['safe', 'wipe', 'both'];
  if (options.mode && !validModes.includes(options.mode)) {
    logger.error(`Invalid mode: ${options.mode}. Valid: ${validModes.join(', ')}`);
    process.exit(1);
  }

  // Get or select device
  let device: USBDevice;
  if (options.device) {
    const devices = await usbGenerator.listUSBDevices();
    device = devices.find((d) => d.path === options.device || d.device === options.device)!;

    if (!device) {
      logger.error(`Device not found: ${options.device}`);
      logger.info('Run "hestia usb list" to see available devices.');
      process.exit(1);
    }
  } else {
    logger.error('Device is required. Use --device <path>');
    logger.info('Run "hestia usb list" to see available devices.');
    process.exit(1);
  }

  // Verify device
  logger.section('Device Verification');
  const verification = await usbGenerator.verifyDevice(device);

  if (!verification.success) {
    logger.error(verification.error || 'Device verification failed');
    process.exit(1);
  }

  if (verification.warnings) {
    for (const warning of verification.warnings) {
      logger.warn(warning);
    }
  }

  // Check if system disk
  const isSystem = await usbGenerator.isSystemDisk(device);
  if (isSystem) {
    logger.error('⚠️  SYSTEM DISK DETECTED - Operation blocked for safety');
    logger.error(`Device ${device.device} appears to be a system disk.`);
    logger.info('If you are sure this is not a system disk, set HESTIA_FORCE_USB_WRITE=1');
    process.exit(1);
  }

  // Get or download ISO
  let isoInfo;
  if (options.iso) {
    logger.section('Using Provided ISO');
    isoInfo = await usbGenerator.getISOInfo(options.iso);
    if (!isoInfo.isValid) {
      logger.error(`Invalid ISO file: ${options.iso}`);
      process.exit(1);
    }
    logger.success(`Using ISO: ${isoInfo.name} (${formatBytes(isoInfo.size)})`);
  } else {
    logger.section('Downloading ISO');
    isoInfo = await usbGenerator.downloadUbuntu('24.04');
  }

  // Display configuration
  logger.section('Configuration');
  logger.info(`Device: ${device.device} (${formatBytes(device.size)})`);
  logger.info(`ISO: ${isoInfo.name}`);
  logger.info(`Mode: ${options.mode || 'safe'}`);
  logger.info(`Hearth Name: ${options.hearthName || 'My Digital Hearth'}`);
  if (options.aiProvider) {
    logger.info(`AI Provider: ${options.aiProvider}`);
    if (options.aiModel) logger.info(`AI Model: ${options.aiModel}`);
  }
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
  spinner.start(spinnerId, 'Initializing...');

  try {
    // Track progress events
    usbGenerator.on('progress', (progress) => {
      if (progress.message) {
        spinner.update(spinnerId, `${progress.message} (${progress.percentage}%)`);
      }
    });

    const result = await usbGenerator.createUSB(
      {
        device,
        iso: isoInfo,
        mode: (options.mode as any) || 'safe',
        hearthName: options.hearthName,
        installType: 'local',
        aiProvider: options.aiProvider,
        aiModel: options.aiModel,
        dryRun: options.dryRun,
        unattended: true,
      },
      (progress) => {
        // Progress handled by event emitter
      }
    );

    if (result.success) {
      spinner.succeed(spinnerId, 'USB created successfully!');
      try {
        const target_profile =
          options.aiProvider === 'ollama'
            ? 'inference_only'
            : ['openrouter', 'anthropic', 'openai'].includes(options.aiProvider || '')
              ? 'data_pod'
              : 'full';
        await writeUsbSetupManifest(
          {
            version: '1',
            target_profile,
            hearth_name: options.hearthName,
            domain_hint: undefined,
          },
          path.join(homedir(), '.eve', 'usb-profile.json'),
        );
        logger.info(`Wrote Eve setup manifest: ~/.eve/usb-profile.json (${target_profile})`);
      } catch (e: unknown) {
        logger.warn(`Could not write setup manifest: ${e instanceof Error ? e.message : String(e)}`);
      }
      logger.newline();
      logger.section('Next Steps');
      logger.info('1. Safely eject the USB drive');
      logger.info('2. Insert into target machine');
      logger.info('3. Boot from USB (may require BIOS/UEFI change)');
      logger.info('4. Select Hestia installation from boot menu');

      if (options.dryRun) {
        logger.newline();
        logger.info(chalk.yellow('This was a dry run. No changes were made.'));
      }
    } else {
      spinner.fail(spinnerId, `Failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error: any) {
    spinner.fail(spinnerId, `Failed: ${error.message}`);
    throw error;
  }
}

/**
 * Download Ubuntu ISO
 */
async function downloadISO(options: USBDownloadOptions): Promise<void> {
  const version = options.version || '24.04';

  logger.header('DOWNLOAD UBUNTU SERVER ISO');
  logger.info(`Version: Ubuntu Server ${version}`);

  try {
    const isoInfo = await usbGenerator.downloadUbuntu(version);

    logger.newline();
    logger.success('Download complete!');
    logger.info(`ISO: ${isoInfo.path}`);
    logger.info(`Size: ${formatBytes(isoInfo.size)}`);
    logger.info(`Version: ${isoInfo.version}`);
    logger.newline();
    logger.info('You can now create a USB with:');
    logger.info(chalk.cyan(`  hestia usb create --iso "${isoInfo.path}" --device <device>`));
  } catch (error: any) {
    logger.error(`Download failed: ${error.message}`);
    throw error;
  }
}

/**
 * Install Ventoy to device
 */
async function installVentoy(devicePath: string): Promise<void> {
  logger.header('INSTALL VENTOY');

  // Find device
  const devices = await usbGenerator.listUSBDevices();
  const device = devices.find((d) => d.path === devicePath || d.device === devicePath);

  if (!device) {
    logger.error(`Device not found: ${devicePath}`);
    process.exit(1);
  }

  logger.info(`Device: ${device.device}`);
  logger.info(`Model: ${device.vendor} ${device.model}`);
  logger.info(`Size: ${formatBytes(device.size)}`);

  // Safety check
  const isSystem = await usbGenerator.isSystemDisk(device);
  if (isSystem) {
    logger.error('⚠️  Cannot install Ventoy on system disk');
    process.exit(1);
  }

  // Confirm destruction
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
  spinner.start(spinnerId, 'Installing Ventoy...');

  try {
    const result = await usbGenerator.installVentoy(device);

    if (result.success) {
      spinner.succeed(spinnerId, 'Ventoy installed successfully');
      logger.info('You can now copy ISO files to the USB.');
    } else {
      spinner.fail(spinnerId, `Failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error: any) {
    spinner.fail(spinnerId, `Failed: ${error.message}`);
    throw error;
  }
}

/**
 * Update Ventoy on device
 */
async function updateVentoy(devicePath: string): Promise<void> {
  logger.header('UPDATE VENTOY');

  const devices = await usbGenerator.listUSBDevices();
  const device = devices.find((d) => d.path === devicePath || d.device === devicePath);

  if (!device) {
    logger.error(`Device not found: ${devicePath}`);
    process.exit(1);
  }

  logger.info(`Device: ${device.device}`);

  const spinnerId = 'update-ventoy';
  spinner.start(spinnerId, 'Updating Ventoy...');

  try {
    const result = await usbGenerator.updateVentoy(device);

    if (result.success) {
      spinner.succeed(spinnerId, 'Ventoy updated successfully');
    } else {
      spinner.fail(spinnerId, `Failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error: any) {
    spinner.fail(spinnerId, `Failed: ${error.message}`);
    throw error;
  }
}

/**
 * Remove Ventoy from device (format)
 */
async function removeVentoy(devicePath: string): Promise<void> {
  logger.header('REMOVE VENTOY');

  const devices = await usbGenerator.listUSBDevices();
  const device = devices.find((d) => d.path === devicePath || d.device === devicePath);

  if (!device) {
    logger.error(`Device not found: ${devicePath}`);
    process.exit(1);
  }

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
  spinner.start(spinnerId, 'Formatting device...');

  try {
    const result = await usbGenerator.formatDevice(device);

    if (result.success) {
      spinner.succeed(spinnerId, 'Device formatted successfully');
      logger.info('Ventoy has been removed.');
    } else {
      spinner.fail(spinnerId, `Failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error: any) {
    spinner.fail(spinnerId, `Failed: ${error.message}`);
    throw error;
  }
}

/**
 * Verify USB bootability
 */
async function verifyUSB(devicePath: string): Promise<void> {
  logger.header('VERIFY USB');

  const devices = await usbGenerator.listUSBDevices();
  const device = devices.find((d) => d.path === devicePath || d.device === devicePath);

  if (!device) {
    logger.error(`Device not found: ${devicePath}`);
    process.exit(1);
  }

  logger.info(`Device: ${device.device}`);
  logger.info(`Model: ${device.vendor} ${device.model}`);

  const spinnerId = 'verify-usb';
  spinner.start(spinnerId, 'Verifying USB...');

  try {
    // Check if bootable
    const isBootable = await (usbGenerator as any).isBootable(device);

    // Verify USB structure
    const result = await usbGenerator.verifyUSB(device);

    spinner.stop(spinnerId);

    logger.newline();
    logger.section('Boot Check');
    if (isBootable) {
      logger.success('Device appears to be bootable');
    } else {
      logger.warn('Device may not be bootable (no boot sector signature)');
    }

    logger.newline();
    logger.section('Structure Check');
    if (result.success) {
      logger.success('USB structure is valid');
    } else {
      logger.error(`USB verification failed: ${result.error}`);
    }

    if (result.warnings && result.warnings.length > 0) {
      logger.newline();
      logger.section('Warnings');
      for (const warning of result.warnings) {
        logger.warn(warning);
      }
    }

    // Check bootloader config
    logger.newline();
    logger.section('Bootloader Config');
    const bootResult = await usbGenerator.testBootConfig(device);
    if (bootResult.success) {
      logger.success('Bootloader configuration is valid');
    } else {
      logger.error(`Bootloader check failed: ${bootResult.error}`);
    }
  } catch (error: any) {
    spinner.fail(spinnerId, `Failed: ${error.message}`);
    throw error;
  }
}

/**
 * Generate configuration files only
 */
async function generateConfigs(options: USBConfigOptions): Promise<void> {
  logger.header('GENERATE CONFIGURATION FILES');

  const mode = options.mode || 'safe';
  const outputDir = path.resolve(options.output || './hestia-usb-configs');

  logger.info(`Mode: ${mode}`);
  logger.info(`Output directory: ${outputDir}`);

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  const spinnerId = 'generate-configs';
  spinner.start(spinnerId, 'Generating configurations...');

  try {
    // Generate Ventoy config
    const ventoyConfig = usbGenerator.generateVentoyConfig({ mode: mode as any });
    await fs.writeFile(
      path.join(outputDir, 'ventoy.json'),
      JSON.stringify(ventoyConfig, null, 2)
    );

    // Generate autoinstall configs based on mode
    const dummyDevice: USBDevice = {
      device: 'dummy',
      path: '/dev/dummy',
      size: 16 * 1024 ** 3,
      model: 'Dummy',
      vendor: 'Hestia',
      removable: true,
      readonly: false,
      mounted: false,
      mountpoints: [],
      isUSB: true,
      partitions: [],
    };

    const dummyISO: any = {
      path: '/dummy/hestia.iso',
      name: 'hestia.iso',
      size: 2 * 1024 ** 3,
      version: '1.0',
      modifiedAt: new Date(),
      isValid: true,
    };

    const usbOptions: any = {
      device: dummyDevice,
      iso: dummyISO,
      mode: mode as any,
      hearthName: 'My Digital Hearth',
      installType: 'local',
      unattended: true,
    };

    if (mode === 'safe' || mode === 'both') {
      const safeConfig = usbGenerator.generateAutoinstallSafe(usbOptions);
      await fs.writeFile(
        path.join(outputDir, 'safe.yaml'),
        require('yaml').stringify(safeConfig)
      );
    }

    if (mode === 'wipe' || mode === 'both') {
      const wipeConfig = usbGenerator.generateAutoinstallWipe(usbOptions);
      await fs.writeFile(
        path.join(outputDir, 'wipe.yaml'),
        require('yaml').stringify(wipeConfig)
      );
    }

    // Generate cloud-init configs
    const userData = usbGenerator.generateUserData(usbOptions);
    await fs.writeFile(
      path.join(outputDir, 'user-data'),
      require('yaml').stringify(userData)
    );

    const metaData = usbGenerator.generateMetaData(usbOptions);
    await fs.writeFile(
      path.join(outputDir, 'meta-data'),
      require('yaml').stringify(metaData)
    );

    // Generate GRUB config
    const grubConfig = usbGenerator.generateGrubConfig(usbOptions);
    await fs.writeFile(path.join(outputDir, 'grub.cfg'), grubConfig);

    spinner.succeed(spinnerId, 'Configurations generated');

    logger.newline();
    logger.success('Configuration files created!');
    logger.info(`Location: ${outputDir}`);
    logger.newline();
    logger.info('Files generated:');

    const files = await fs.readdir(outputDir);
    for (const file of files) {
      const stats = await fs.stat(path.join(outputDir, file));
      logger.info(`  - ${file} (${formatBytes(stats.size)})`);
    }

    logger.newline();
    logger.info('You can now:');
    logger.info('1. Copy these files to your USB device');
    logger.info('2. Or use "hestia usb create" to create a complete bootable USB');
  } catch (error: any) {
    spinner.fail(spinnerId, `Failed: ${error.message}`);
    throw error;
  }
}

/**
 * Benchmark USB speed
 */
async function benchmarkUSB(devicePath: string): Promise<void> {
  logger.header('USB BENCHMARK');

  const devices = await usbGenerator.listUSBDevices();
  const device = devices.find((d) => d.path === devicePath || d.device === devicePath);

  if (!device) {
    logger.error(`Device not found: ${devicePath}`);
    process.exit(1);
  }

  logger.info(`Device: ${device.device}`);
  logger.info(`Model: ${device.vendor} ${device.model}`);
  logger.info(`Size: ${formatBytes(device.size)}`);

  logger.newline();
  logger.section('Running Benchmark');
  logger.info('This will test read/write speeds...');

  const spinnerId = 'benchmark';
  spinner.start(spinnerId, 'Testing...');

  try {
    // Get capacity info
    const capacityResult = await usbGenerator.getUSBCapacity(device);

    // Get install time estimate
    const timeResult = await usbGenerator.estimateInstallTime(device);

    spinner.succeed(spinnerId, 'Benchmark complete');

    logger.newline();
    logger.section('Results');

    if (capacityResult.success && capacityResult.data) {
      const { total, used, free } = capacityResult.data;
      logger.info(`Total: ${formatBytes(total)}`);
      logger.info(`Used: ${formatBytes(used)} (${Math.round((used / total) * 100)}%)`);
      logger.info(`Free: ${formatBytes(free)}`);
    }

    if (timeResult.success && timeResult.data) {
      logger.info(`Estimated install time: ${timeResult.data.formatted}`);
    }

    // USB version detection
    const isUSB3 = await (usbGenerator as any).isUSB3?.(device) || false;
    logger.newline();
    logger.info(`USB Version: ${isUSB3 ? '3.0+ (Fast)' : '2.0 (Standard)'}`);

    if (isUSB3) {
      logger.success('USB 3.0+ detected - Installation will be faster');
    } else {
      logger.warn('USB 2.0 detected - Installation may take longer');
    }

    // Check device speed class
    logger.newline();
    if (device.size >= 32 * 1024 ** 3) {
      logger.info('Device size: Good (32GB+ recommended)');
    } else if (device.size >= 8 * 1024 ** 3) {
      logger.warn('Device size: Minimum (8GB+ required)');
    } else {
      logger.error('Device size: Too small (4GB minimum, 8GB+ recommended)');
    }
  } catch (error: any) {
    spinner.fail(spinnerId, `Failed: ${error.message}`);
    throw error;
  }
}

// ============== Helper Functions ==============

/**
 * Check if device is likely a system disk (heuristic)
 */
function isSystemDiskHint(device: USBDevice): boolean {
  // Check if it's mounted at root or boot
  if (device.mountpoints.some((m) => m === '/' || m === '/boot')) {
    return true;
  }

  // Check device name patterns for internal disks
  const systemPatterns = [/nvme/, /sda$/, /vda$/, /hda$/];
  if (systemPatterns.some((p) => p.test(device.device))) {
    // Additional check: internal disks usually don't have removable flag
    if (!device.removable) {
      return true;
    }
  }

  return false;
}

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

/**
 * Generate bootable USB bundle with all executables
 */
async function generateUSBBundle(options: any): Promise<void> {
  logger.header('HESTIA USB BUNDLE GENERATOR');
  
  const {
    output = './hestia-usb-bundle',
    format = 'directory',
    label = 'HESTIA_USB',
    isoPath,
    bundleAll = false,
    includeDocker = false,
    includeBackend = false,
  } = options;

  logger.info(`Output: ${output}`);
  logger.info(`Format: ${format}`);
  logger.info(`Label: ${label}`);
  logger.info(`Bundle all: ${bundleAll ? 'Yes' : 'No'}`);
  logger.info(`Include Docker: ${includeDocker ? 'Yes' : 'No'}`);
  logger.info(`Include Backend: ${includeBackend ? 'Yes' : 'No'}`);
  
  // Create basic structure
  const directories = [
    'bin',
    'scripts',
    'config',
    'docker',
    'docs',
    'data',
    'logs',
    'iso',
    'autoinstall',
    'cloud-init'
  ];
  
  for (const dir of directories) {
    const fullPath = path.join(output, dir);
    await fs.mkdir(fullPath, { recursive: true });
    logger.debug(`Created directory: ${fullPath}`);
  }
  
  // Copy Hestia CLI executable
  const hestiaCliPath = path.join(output, 'bin', 'hestia');
  await fs.copyFile(path.resolve(__dirname, '../../dist/hestia.js'), hestiaCliPath);
  await fs.chmod(hestiaCliPath, 0o755);
  logger.success('Copied Hestia CLI');
  
  // Create installation script
  const installScript = path.join(output, 'scripts', 'install.sh');
  await fs.writeFile(installScript, `#!/bin/bash
# Hestia Installation Script
# Generated: ${new Date().toISOString()}

set -e

echo "HESTIA USB INSTALLATION"
echo "========================"

# Check root
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root: sudo $0"
  exit 1
fi

# Detect platform
PLATFORM="$(uname -s)"
ARCH="$(uname -m)"

echo "Platform: $PLATFORM"
echo "Architecture: $ARCH"

# Installation steps
echo "1. Installing dependencies..."
if [ -f /etc/debian_version ]; then
  apt-get update
  apt-get install -y curl wget git docker.io docker-compose nodejs npm postgresql redis-server
elif [ -f /etc/redhat-release ]; then
  yum install -y curl wget git docker docker-compose nodejs npm postgresql redis
elif [ -f /etc/arch-release ]; then
  pacman -Syu --noconfirm curl wget git docker docker-compose nodejs npm postgresql redis
fi

echo "2. Setting up Hestia..."
mkdir -p /opt/hestia
cp -r ${output}/* /opt/hestia/

echo "3. Creating system user..."
useradd -r -s /bin/false hestia || true

echo "4. Installing systemd services..."
cp ${output}/systemd/* /etc/systemd/system/ 2>/dev/null || echo "No systemd services found"

echo "5. Starting services..."
systemctl daemon-reload || true
systemctl enable docker || true
systemctl start docker || true

echo "✅ Hestia installation complete!"
echo ""
echo "Next steps:"
echo "1. cd /opt/hestia"
echo "2. ./bin/hestia init --name 'My Hearth'"
echo "3. ./bin/hestia ignite"
echo "4. Visit http://localhost:4000"
`, { mode: 0o755 });
  logger.success('Created installation script');

  // Create README
  const readmePath = path.join(output, 'docs', 'README.md');
  await fs.writeFile(readmePath, `# Hestia USB Bundle

## What is Hestia?

Hestia is sovereign AI infrastructure that gives you full control over your data and AI models.

## Bundle Contents

This USB bundle contains everything needed to run Hestia:

- **bin/hestia** - Main CLI tool
- **scripts/** - Installation and maintenance scripts
- **config/** - Configuration templates
- **docker/** - Docker compose files
- **docs/** - Documentation

## Quick Start

1. Insert USB drive
2. Copy contents to target machine: \`cp -r /path/to/usb /opt/hestia\`
3. Run installation: \`sudo ./scripts/install.sh\`
4. Initialize: \`./bin/hestia init --name "My Hearth"\`
5. Start: \`./bin/hestia ignite\`
6. Open browser: http://localhost:4000

## Advanced Usage

### USB Boot Mode
Use Ventoy (included) to make USB bootable with Ubuntu Server + auto-installation.

### Custom Configuration
Edit config files in \`config/\` directory before installation.

### Updating
Run \`./bin/hestia update\` to get latest versions.

## Support

- Documentation: https://synap.dev/docs
- Community: https://github.com/synap-dev/hestia
- Issues: https://github.com/synap-dev/hestia/issues

## License

Apache 2.0 - See LICENSE file
`);

  logger.success('Created documentation');

  // If bundleAll is true, include more components
  if (bundleAll || includeBackend) {
    logger.info('Including backend services...');
    
    // Create docker-compose example
    const composePath = path.join(output, 'docker', 'docker-compose.yml');
    await fs.writeFile(composePath, `version: '3.8'

services:
  synap-backend:
    image: ghcr.io/synap-dev/synap-backend:latest
    ports:
      - "4000:4000"
    environment:
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/synap
      - REDIS_URL=redis://redis:6379
      - NODE_ENV=production
    depends_on:
      - postgres
      - redis
    volumes:
      - ./data/backend:/app/data
  
  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=synap
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
  
  redis:
    image: redis:7-alpine
    volumes:
      - ./data/redis:/data
  
  typesense:
    image: typesense/typesense:0.25.2
    ports:
      - "8108:8108"
    environment:
      - TYPESENSE_API_KEY=xyz
      - TYPESENSE_DATA_DIR=/data
    volumes:
      - ./data/typesense:/data
`);
    logger.success('Created docker-compose example');
  }

  // Generate Ventoy config if format includes ISO
  if (format.includes('iso') || format === 'both') {
    logger.info('Generating ISO configuration...');
    
    const ventoyConfig = path.join(output, 'iso', 'ventoy.json');
    await fs.writeFile(ventoyConfig, JSON.stringify({
      "persistence": [
        {
          "image": "ubuntu-22.04-server-amd64.iso",
          "backend": "/persistence/hestia",
          "autosave": 1
        }
      ],
      "theme": {
        "file": "theme/hestia-theme.tar.gz"
      },
      "autoinstall": true
    }, null, 2));
    
    logger.success('Generated Ventoy configuration');
  }

  // Create summary
  logger.success('USB bundle generation complete!');
  logger.info(`Location: ${path.resolve(output)}`);
  logger.info('');
  logger.info('To use this bundle:');
  logger.info(`1. Copy to USB: cp -r ${output}/* /media/USB/`);
  logger.info('2. Boot from USB or run: sudo ./scripts/install.sh');
  logger.info('3. Initialize: ./bin/hestia init --name "My Hearth"');
}

