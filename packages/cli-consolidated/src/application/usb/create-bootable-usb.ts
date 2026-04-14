/**
 * Create Bootable USB Use Case
 * 
 * Creates a bootable USB drive with eve installation.
 * Pure business logic - no UI dependencies.
 */

import { usbGenerator, USBDevice } from '../../lib/domains/usb/lib/usb-generator.js';
import { ProgressReporter, OperationResult, ISOInfo } from '../types.js';

export type InstallMode = 'safe' | 'wipe' | 'both';
export type InstallType = 'local' | 'distributed' | 'hybrid';
export type IntelligenceProvider = 'ollama' | 'openrouter' | 'anthropic' | 'openai';

/**
 * Input for creating bootable USB
 */
export interface CreateUSBInput {
  /** Target USB device */
  device: USBDevice;
  /** ISO file information */
  iso: ISOInfo;
  /** Installation mode */
  mode: InstallMode;
  /** Name for the Digital Hearth */
  hearthName: string;
  /** Installation type */
  installType?: InstallType;
  /** AI provider to pre-configure */
  aiProvider?: IntelligenceProvider;
  /** AI model to use */
  aiModel?: string;
  /** Run in dry-run mode (no actual changes) */
  dryRun?: boolean;
  /** Unattended installation (no prompts) */
  unattended?: boolean;
}

/**
 * Output from USB creation
 */
export interface CreateUSBOutput {
  device: string;
  mode: InstallMode;
  configs: string[];
}

/**
 * Progress event from usb-generator
 */
interface USBProgressEvent {
  phase?: string;
  message?: string;
  percentage?: number;
}

/**
 * Create a bootable USB drive
 * 
 * @param input - USB creation options
 * @param progress - Progress reporter
 * @returns Creation result
 */
export async function createBootableUSB(
  input: CreateUSBInput,
  progress: ProgressReporter
): Promise<OperationResult<CreateUSBOutput>> {
  progress.report('Initializing USB creation...');
  progress.onProgress(0);

  try {
    // Validate device
    progress.report('Validating device...');
    const verification = await usbGenerator.verifyDevice(input.device);
    
    if (!verification.success) {
      return {
        success: false,
        error: verification.error || 'Device verification failed',
      };
    }
    
    progress.onProgress(10);

    // Check if system disk
    const isSystem = await usbGenerator.isSystemDisk(input.device);
    if (isSystem) {
      return {
        success: false,
        error: `Device ${input.device.device} appears to be a system disk. Operation blocked for safety.`,
      };
    }

    progress.onProgress(15);
    progress.report('Device validated, preparing creation...');

    // Set up progress tracking
    let lastPercentage = 15;
    const progressHandler = (event: USBProgressEvent) => {
      if (event.percentage !== undefined) {
        const newPercent = 15 + Math.round((event.percentage / 100) * 80);
        if (newPercent > lastPercentage) {
          lastPercentage = newPercent;
          progress.onProgress(newPercent);
        }
      }
      if (event.message) {
        progress.report(event.message);
      }
    };

    // Subscribe to progress events
    usbGenerator.on('progress', progressHandler);

    try {
      // Create the USB
      const result = await usbGenerator.createUSB(
        {
          device: input.device,
          iso: input.iso,
          mode: input.mode,
          hearthName: input.hearthName,
          installType: input.installType || 'local',
          aiProvider: input.aiProvider,
          aiModel: input.aiModel,
          dryRun: input.dryRun,
          unattended: input.unattended ?? true,
        },
        () => {} // Progress handled by event emitter
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'USB creation failed',
        };
      }

      progress.onProgress(100);
      progress.report('USB creation complete');

      // Determine which configs were created
      const configs: string[] = [];
      if (input.mode === 'safe' || input.mode === 'both') configs.push('safe.yaml');
      if (input.mode === 'wipe' || input.mode === 'both') configs.push('wipe.yaml');

      return {
        success: true,
        data: {
          device: input.device.device,
          mode: input.mode,
          configs,
        },
      };
    } finally {
      // Unsubscribe from progress events
      usbGenerator.off('progress', progressHandler);
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'USB creation failed',
    };
  }
}

/**
 * Install Ventoy bootloader to device
 */
export async function installVentoy(
  device: USBDevice,
  progress: ProgressReporter
): Promise<OperationResult<void>> {
  progress.report('Installing Ventoy bootloader...');
  progress.onProgress(0);

  try {
    // Safety check
    const isSystem = await usbGenerator.isSystemDisk(device);
    if (isSystem) {
      return {
        success: false,
        error: 'Cannot install Ventoy on system disk',
      };
    }

    progress.onProgress(20);

    const result = await usbGenerator.installVentoy(device);

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Ventoy installation failed',
      };
    }

    progress.onProgress(100);
    progress.report('Ventoy installed successfully');

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to install Ventoy',
    };
  }
}

/**
 * Update Ventoy bootloader on device
 */
export async function updateVentoy(
  device: USBDevice,
  progress: ProgressReporter
): Promise<OperationResult<void>> {
  progress.report('Updating Ventoy bootloader...');
  progress.onProgress(0);

  try {
    const result = await usbGenerator.updateVentoy(device);

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Ventoy update failed',
      };
    }

    progress.onProgress(100);
    progress.report('Ventoy updated successfully');

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to update Ventoy',
    };
  }
}

/**
 * Format/remove Ventoy from device
 */
export async function formatDevice(
  device: USBDevice,
  progress: ProgressReporter
): Promise<OperationResult<void>> {
  progress.report('Formatting device...');
  progress.onProgress(0);

  try {
    const result = await usbGenerator.formatDevice(device);

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Format failed',
      };
    }

    progress.onProgress(100);
    progress.report('Device formatted successfully');

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to format device',
    };
  }
}

/**
 * Verify USB bootability
 */
export async function verifyUSB(
  device: USBDevice,
  progress: ProgressReporter
): Promise<OperationResult<{
  isBootable: boolean;
  structureValid: boolean;
  bootloaderValid: boolean;
  warnings: string[];
}>> {
  progress.report('Verifying USB...');
  progress.onProgress(0);

  try {
    progress.onProgress(20);
    
    // Check if bootable
    const isBootable = await (usbGenerator as any).isBootable?.(device) ?? false;
    progress.onProgress(40);

    // Verify USB structure
    const structureResult = await usbGenerator.verifyUSB(device);
    progress.onProgress(60);

    // Check bootloader config
    const bootResult = await usbGenerator.testBootConfig(device);
    progress.onProgress(80);

    const warnings: string[] = [];
    if (structureResult.warnings) {
      warnings.push(...structureResult.warnings);
    }

    progress.onProgress(100);
    progress.report('Verification complete');

    return {
      success: true,
      data: {
        isBootable,
        structureValid: structureResult.success,
        bootloaderValid: bootResult.success,
        warnings,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Verification failed',
    };
  }
}

/**
 * Benchmark USB device speed
 */
export async function benchmarkUSB(
  device: USBDevice,
  progress: ProgressReporter
): Promise<OperationResult<{
  capacity?: { total: number; used: number; free: number };
  installTimeEstimate?: string;
  isUSB3: boolean;
  sizeRating: 'good' | 'minimum' | 'too_small';
}>> {
  progress.report('Running USB benchmark...');
  progress.onProgress(0);

  try {
    // Get capacity info
    const capacityResult = await usbGenerator.getUSBCapacity(device);
    progress.onProgress(50);

    // Get install time estimate
    const timeResult = await usbGenerator.estimateInstallTime(device);
    progress.onProgress(75);

    // USB version detection
    const isUSB3 = await (usbGenerator as any).isUSB3?.(device) || false;
    progress.onProgress(90);

    // Check device size rating
    let sizeRating: 'good' | 'minimum' | 'too_small';
    if (device.size >= 32 * 1024 ** 3) {
      sizeRating = 'good';
    } else if (device.size >= 8 * 1024 ** 3) {
      sizeRating = 'minimum';
    } else {
      sizeRating = 'too_small';
    }

    progress.onProgress(100);
    progress.report('Benchmark complete');

    return {
      success: true,
      data: {
        capacity: capacityResult.success ? capacityResult.data : undefined,
        installTimeEstimate: timeResult.success ? timeResult.data?.formatted : undefined,
        isUSB3,
        sizeRating,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Benchmark failed',
    };
  }
}
