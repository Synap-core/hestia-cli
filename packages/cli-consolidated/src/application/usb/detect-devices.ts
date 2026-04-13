/**
 * USB Device Detection Use Case
 * 
 * Detects and validates USB storage devices available on the system.
 * Pure business logic - no UI dependencies.
 */

import { usbGenerator, USBDevice } from '../../lib/domains/usb/lib/usb-generator.js';
import { ProgressReporter, OperationResult } from '../types.js';

/**
 * Input for device detection
 */
export interface DetectDevicesInput {
  /** Include system disks in results (default: false) */
  includeSystemDisks?: boolean;
}

/**
 * Output from device detection
 */
export interface DetectDevicesOutput {
  devices: USBDevice[];
  systemDisks: USBDevice[];
  totalCount: number;
  usbCount: number;
}

/**
 * Detect USB devices on the system
 * 
 * @param input - Detection options
 * @param progress - Progress reporter
 * @returns Detection results with devices categorized
 */
export async function detectDevices(
  input: DetectDevicesInput = {},
  progress: ProgressReporter
): Promise<OperationResult<DetectDevicesOutput>> {
  progress.report('Scanning for USB devices...');
  progress.onProgress(0);

  try {
    const allDevices = await usbGenerator.listUSBDevices();
    progress.onProgress(50);

    // Categorize devices
    const systemDisks: USBDevice[] = [];
    const usbDevices: USBDevice[] = [];

    for (const device of allDevices) {
      if (isSystemDiskHint(device)) {
        systemDisks.push(device);
      } else {
        usbDevices.push(device);
      }
    }

    progress.onProgress(100);
    progress.report(`Found ${usbDevices.length} USB device(s), ${systemDisks.length} system disk(s)`);

    return {
      success: true,
      data: {
        devices: input.includeSystemDisks ? [...usbDevices, ...systemDisks] : usbDevices,
        systemDisks,
        totalCount: allDevices.length,
        usbCount: usbDevices.length,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to detect USB devices',
    };
  }
}

/**
 * Check if a device is likely a system disk (heuristic)
 */
function isSystemDiskHint(device: USBDevice): boolean {
  // Check if mounted at root or boot
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
 * Get detailed information for a specific device
 */
export async function getDeviceDetails(
  devicePath: string,
  progress: ProgressReporter
): Promise<OperationResult<USBDevice>> {
  progress.report(`Looking up device: ${devicePath}`);

  try {
    const devices = await usbGenerator.listUSBDevices();
    const device = devices.find((d) => d.path === devicePath || d.device === devicePath);

    if (!device) {
      return {
        success: false,
        error: `Device not found: ${devicePath}`,
      };
    }

    return {
      success: true,
      data: device,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to get device details',
    };
  }
}

/**
 * Verify a device is safe to use (not a system disk)
 */
export async function verifyDeviceSafety(
  device: USBDevice,
  progress: ProgressReporter
): Promise<OperationResult<{ safe: boolean; warnings: string[] }>> {
  progress.report('Verifying device safety...');

  try {
    const warnings: string[] = [];

    // Check if system disk
    const isSystem = await usbGenerator.isSystemDisk(device);
    if (isSystem) {
      return {
        success: false,
        error: `Device ${device.device} appears to be a system disk. Operation blocked for safety.`,
      };
    }

    // Run verification
    const verification = await usbGenerator.verifyDevice(device);
    if (!verification.success) {
      return {
        success: false,
        error: verification.error || 'Device verification failed',
      };
    }

    if (verification.warnings) {
      warnings.push(...verification.warnings);
    }

    // Warn about partitions
    if (device.partitions.length > 0) {
      warnings.push(`Device has ${device.partitions.length} partition(s). All data will be destroyed.`);
    }

    return {
      success: true,
      data: { safe: true, warnings },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to verify device',
    };
  }
}
