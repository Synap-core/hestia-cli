/**
 * Shared types for application layer use cases
 */

/**
 * Progress reporter interface for use cases to report progress
 * without depending on UI libraries
 */
export interface ProgressReporter {
  /** Report a status message */
  report(message: string): void;
  /** Report progress percentage (0-100) */
  onProgress(percent: number): void;
}

/**
 * Result type for operations that can fail
 */
export interface OperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * USB Device information (mirrored from usb-generator)
 */
export interface USBDevice {
  device: string;
  path: string;
  size: number;
  model: string;
  vendor: string;
  removable: boolean;
  readonly: boolean;
  mounted: boolean;
  mountpoints: string[];
  isUSB: boolean;
  partitions: USBPartition[];
}

export interface USBPartition {
  name: string;
  size: number;
  type?: string;
  mounted: boolean;
  mountpoint?: string;
}

/**
 * ISO file information
 */
export interface ISOInfo {
  path: string;
  name: string;
  size: number;
  version: string;
  modifiedAt: Date;
  isValid: boolean;
}
