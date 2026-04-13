/**
 * ISO Download Use Case
 * 
 * Downloads and manages Ubuntu Server ISO files.
 * Pure business logic - no UI dependencies.
 */

import { usbGenerator } from '../../lib/domains/usb/lib/usb-generator.js';
import { ProgressReporter, OperationResult, ISOInfo } from '../types.js';

/**
 * Input for ISO download
 */
export interface DownloadISOInput {
  /** Ubuntu version to download (default: '24.04') */
  version?: string;
  /** Force re-download even if cached */
  force?: boolean;
}

/**
 * Output from ISO download
 */
export interface DownloadISOOutput {
  iso: ISOInfo;
  downloaded: boolean;
  cached: boolean;
}

/**
 * Download Ubuntu Server ISO
 * 
 * @param input - Download options
 * @param progress - Progress reporter
 * @returns Download result with ISO info
 */
export async function downloadISO(
  input: DownloadISOInput = {},
  progress: ProgressReporter
): Promise<OperationResult<DownloadISOOutput>> {
  const version = input.version || '24.04';
  
  progress.report(`Checking for Ubuntu Server ${version} ISO...`);
  progress.onProgress(0);

  try {
    // Check if ISO already exists in cache
    const existingISOs = await usbGenerator.listAvailableISOs();
    const ubuntuISO = existingISOs.find((iso) => iso.name.includes('ubuntu') && iso.isValid);

    progress.onProgress(25);

    if (ubuntuISO && !input.force) {
      progress.onProgress(100);
      progress.report('Using cached ISO');
      
      return {
        success: true,
        data: {
          iso: {
            path: ubuntuISO.path,
            name: ubuntuISO.name,
            size: ubuntuISO.size,
            version: ubuntuISO.version,
            modifiedAt: ubuntuISO.modifiedAt,
            isValid: ubuntuISO.isValid,
          },
          downloaded: false,
          cached: true,
        },
      };
    }

    // Download the ISO
    progress.report(`Downloading Ubuntu Server ${version}...`);
    progress.onProgress(30);

    const isoInfo = await usbGenerator.downloadUbuntu(version);
    
    progress.onProgress(100);
    progress.report('Download complete');

    return {
      success: true,
      data: {
        iso: {
          path: isoInfo.path,
          name: isoInfo.name,
          size: isoInfo.size,
          version: isoInfo.version,
          modifiedAt: isoInfo.modifiedAt,
          isValid: isoInfo.isValid,
        },
        downloaded: true,
        cached: false,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || `Failed to download Ubuntu Server ${version}`,
    };
  }
}

/**
 * Get information about an ISO file
 */
export async function getISOInfo(
  isoPath: string,
  progress: ProgressReporter
): Promise<OperationResult<ISOInfo>> {
  progress.report(`Validating ISO: ${isoPath}`);

  try {
    const isoInfo = await usbGenerator.getISOInfo(isoPath);

    if (!isoInfo.isValid) {
      return {
        success: false,
        error: `Invalid ISO file: ${isoPath}`,
      };
    }

    return {
      success: true,
      data: {
        path: isoInfo.path,
        name: isoInfo.name,
        size: isoInfo.size,
        version: isoInfo.version,
        modifiedAt: isoInfo.modifiedAt,
        isValid: isoInfo.isValid,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to get ISO info',
    };
  }
}

/**
 * List available cached ISOs
 */
export async function listAvailableISOs(
  progress: ProgressReporter
): Promise<OperationResult<ISOInfo[]>> {
  progress.report('Scanning for cached ISOs...');

  try {
    const isos = await usbGenerator.listAvailableISOs();
    
    return {
      success: true,
      data: isos.map((iso) => ({
        path: iso.path,
        name: iso.name,
        size: iso.size,
        version: iso.version,
        modifiedAt: iso.modifiedAt,
        isValid: iso.isValid,
      })),
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to list ISOs',
    };
  }
}
