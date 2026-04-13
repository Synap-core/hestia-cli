/**
 * CLI Progress Reporter
 * 
 * Creates a ProgressReporter implementation for CLI use cases.
 * Bridges the application layer (pure logic) with CLI UI (spinner/logger).
 */

import { ProgressReporter } from '../../application/types.js';
import { spinner } from './spinner.js';
import { logger } from './logger.js';

export interface CLIProgressOptions {
  /** Spinner ID for updates */
  spinnerId?: string;
  /** Whether to show detailed progress */
  verbose?: boolean;
  /** Total steps for progress calculation */
  totalSteps?: number;
}

/**
 * Create a CLI progress reporter
 * 
 * @param options - Progress options
 * @returns ProgressReporter instance
 */
export function createCLIProgressReporter(options: CLIProgressOptions = {}): ProgressReporter {
  const { spinnerId = `progress-${Date.now()}`, verbose = false } = options;
  let lastPercent = 0;

  // Start spinner
  spinner.start(spinnerId, 'Initializing...');

  return {
    report(message: string): void {
      if (verbose) {
        logger.info(message);
      }
      spinner.update(spinnerId, message);
    },

    onProgress(percent: number): void {
      // Clamp to 0-100
      const clamped = Math.max(0, Math.min(100, Math.round(percent)));
      
      // Only update if changed
      if (clamped !== lastPercent) {
        lastPercent = clamped;
        const currentText = spinner['spinners']?.get(spinnerId)?.text || 'Working...';
        spinner.update(spinnerId, `${currentText.split(' (')[0]} (${clamped}%)`);
      }
    },
  };
}

/**
 * Create a simple progress reporter (no spinner)
 * 
 * @param options - Progress options
 * @returns ProgressReporter instance
 */
export function createSimpleProgressReporter(options: { verbose?: boolean } = {}): ProgressReporter {
  const { verbose = false } = options;

  return {
    report(message: string): void {
      if (verbose) {
        logger.info(message);
      }
    },

    onProgress(percent: number): void {
      if (verbose && percent % 10 === 0) {
        logger.info(`Progress: ${percent}%`);
      }
    },
  };
}

/**
 * Complete a progress reporter with success
 * 
 * @param spinnerId - Spinner ID
 * @param message - Success message
 */
export function completeProgress(spinnerId: string, message: string): void {
  spinner.succeed(spinnerId, message);
}

/**
 * Fail a progress reporter
 * 
 * @param spinnerId - Spinner ID
 * @param message - Error message
 */
export function failProgress(spinnerId: string, message: string): void {
  spinner.fail(spinnerId, message);
}
