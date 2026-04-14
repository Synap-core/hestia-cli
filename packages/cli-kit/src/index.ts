import chalk from 'chalk';
import ora, { type Ora } from 'ora';

export type JsonRecord = Record<string, unknown>;

export const theme = {
  primary: chalk.hex('#6366f1'),
  success: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
  muted: chalk.gray,
};

export interface GlobalCliFlags {
  json?: boolean;
  nonInteractive?: boolean;
  verbose?: boolean;
}

let globalFlags: GlobalCliFlags = {};

export function setGlobalCliFlags(flags: GlobalCliFlags): void {
  globalFlags = { ...flags };
}

export function getGlobalCliFlags(): GlobalCliFlags {
  return { ...globalFlags };
}

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function outputLine(message: string, kind: 'info' | 'success' | 'warn' | 'error' | 'muted' = 'info'): void {
  if (globalFlags.json) return;
  const fn = theme[kind] ?? theme.info;
  console.log(fn(message));
}

/**
 * Run an async step with an ora spinner; on failure rethrows after stop().
 */
export async function runStep<T>(label: string, fn: () => Promise<T>, verbose?: boolean): Promise<T> {
  if (globalFlags.json) {
    return fn();
  }
  const spinner: Ora = ora(label).start();
  try {
    const result = await fn();
    spinner.succeed(label);
    return result;
  } catch (e) {
    spinner.fail(label);
    const msg = e instanceof Error ? e.message : String(e);
    if (verbose || globalFlags.verbose) {
      console.error(e);
    } else {
      console.error(theme.error(msg));
    }
    throw e;
  }
}
