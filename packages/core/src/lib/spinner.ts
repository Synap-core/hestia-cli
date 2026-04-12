/**
 * Spinner utilities for Hestia CLI
 * Provides loading indicators for long-running operations
 */

import ora, { Ora, Options as OraOptions } from 'ora';
import { logger } from './logger.js';

export interface SpinnerOptions {
  text?: string;
  color?: 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray';
  spinner?: string;
}

class SpinnerManager {
  private spinners: Map<string, Ora> = new Map();
  private active = false;

  create(id: string, options: SpinnerOptions = {}): Ora {
    if (logger.isQuiet()) {
      return {
        start: () => ({} as any),
        stop: () => ({} as any),
        succeed: () => ({} as any),
        fail: () => ({} as any),
        warn: () => ({} as any),
        info: () => ({} as any),
        clear: () => ({} as any),
        render: () => ({} as any),
        frame: () => '',
        text: '',
        prefixText: '',
        color: 'cyan',
        spinner: {} as any,
        indent: 0,
        isSpinning: false,
        isEnabled: false,
      } as Ora;
    }

    const oraOptions: OraOptions = {
      text: options.text || 'Loading...',
      color: options.color || 'cyan',
      spinner: (options.spinner as any) || 'dots',
    };

    const spinner = ora(oraOptions);
    this.spinners.set(id, spinner);
    return spinner;
  }

  start(id: string, text?: string): Ora {
    if (logger.isQuiet()) return this.create(id);

    let spinner = this.spinners.get(id);
    if (!spinner) {
      spinner = this.create(id, { text });
    }

    if (text) {
      spinner.text = text;
    }

    spinner.start();
    this.active = true;
    return spinner;
  }

  succeed(id: string, text?: string): void {
    if (logger.isQuiet()) return;

    const spinner = this.spinners.get(id);
    if (spinner) {
      spinner.succeed(text);
      this.spinners.delete(id);
      this.updateActive();
    }
  }

  fail(id: string, text?: string): void {
    if (logger.isQuiet()) return;

    const spinner = this.spinners.get(id);
    if (spinner) {
      spinner.fail(text);
      this.spinners.delete(id);
      this.updateActive();
    }
  }

  warn(id: string, text?: string): void {
    if (logger.isQuiet()) return;

    const spinner = this.spinners.get(id);
    if (spinner) {
      spinner.warn(text);
      this.spinners.delete(id);
      this.updateActive();
    }
  }

  info(id: string, text?: string): void {
    if (logger.isQuiet()) return;

    const spinner = this.spinners.get(id);
    if (spinner) {
      spinner.info(text);
      this.spinners.delete(id);
      this.updateActive();
    }
  }

  update(id: string, text: string): void {
    if (logger.isQuiet()) return;

    const spinner = this.spinners.get(id);
    if (spinner) {
      spinner.text = text;
    }
  }

  stop(id: string): void {
    if (logger.isQuiet()) return;

    const spinner = this.spinners.get(id);
    if (spinner) {
      spinner.stop();
      this.spinners.delete(id);
      this.updateActive();
    }
  }

  stopAll(): void {
    this.spinners.forEach((spinner) => spinner.stop());
    this.spinners.clear();
    this.active = false;
  }

  private updateActive(): void {
    this.active = this.spinners.size > 0;
  }

  isActive(): boolean {
    return this.active;
  }
}

export const spinner = new SpinnerManager();

export function createSpinner(text?: string): Ora {
  return spinner.start(`spinner-${Date.now()}`, text);
}

export async function withSpinner<T>(
  text: string,
  fn: () => Promise<T>,
  successText?: string
): Promise<T> {
  const spin = createSpinner(text);
  try {
    const result = await fn();
    spin.succeed(successText || text);
    return result;
  } catch (error) {
    spin.fail(`Failed: ${text}`);
    throw error;
  }
}
