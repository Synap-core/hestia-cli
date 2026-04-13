/**
 * Logger utilities for Hestia CLI
 * Provides consistent, colored output with support for verbose and quiet modes
 */

import chalk from 'chalk';
import { createInterface, Interface } from 'readline';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  timestamps?: boolean;
}

export class Logger {
  private level: LogLevel;
  private prefix: string;
  private timestamps: boolean;
  private rl: Interface | null = null;

  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4,
  };

  constructor(options: LoggerOptions = {}) {
    this.level = options.level || 'info';
    this.prefix = options.prefix || '';
    this.timestamps = options.timestamps ?? false;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.level];
  }

  private formatMessage(message: string, level: LogLevel): string {
    const parts: string[] = [];

    if (this.timestamps) {
      parts.push(chalk.gray(`[${new Date().toISOString()}]`));
    }

    if (this.prefix) {
      parts.push(chalk.cyan(`[${this.prefix}]`));
    }

    const levelColors: Record<LogLevel, (msg: string) => string> = {
      debug: chalk.gray,
      info: chalk.blue,
      warn: chalk.yellow,
      error: chalk.red,
      silent: (msg) => msg,
    };

    if (level !== 'silent') {
      parts.push(levelColors[level](`[${level.toUpperCase()}]`));
    }

    return parts.join(' ') + ' ' + message;
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage(message, 'debug'), ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage(message, 'info'), ...args);
    }
  }

  success(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.log(chalk.green(`✓ ${message}`), ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(chalk.yellow(`⚠ ${message}`), ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(chalk.red(`✗ ${message}`), ...args);
    }
  }

  header(title: string): void {
    if (this.shouldLog('info')) {
      const line = '─'.repeat(Math.max(title.length + 4, 40));
      console.log(chalk.cyan(`┌${line}┐`));
      console.log(chalk.cyan(`│  ${chalk.bold.white(title)}${' '.repeat(Math.max(line.length - title.length - 3, 0))}│`));
      console.log(chalk.cyan(`└${line}┘`));
    }
  }

  section(title: string): void {
    if (this.shouldLog('info')) {
      console.log(chalk.cyan(`\n${chalk.bold('▸')} ${chalk.bold.white(title)}`));
      console.log(chalk.gray('─'.repeat(40)));
    }
  }

  newline(): void {
    if (this.shouldLog('info')) {
      console.log();
    }
  }

  object(obj: any, indent = 2): void {
    if (this.shouldLog('debug')) {
      console.log(JSON.stringify(obj, null, indent));
    }
  }

  table(data: Array<Record<string, any>>): void {
    if (!this.shouldLog('info') || data.length === 0) return;

    const keys = Object.keys(data[0]);
    const widths: Record<string, number> = {};

    keys.forEach((key) => {
      widths[key] = Math.max(
        key.length,
        ...data.map((row) => String(row[key] ?? '-').length)
      );
    });

    const row = (cells: string[]) =>
      cells.map((cell, i) => cell.padEnd(widths[keys[i]])).join('  ');

    console.log(chalk.cyan(row(keys.map((k) => k.toUpperCase()))));
    console.log(chalk.gray(row(keys.map(() => '─'.repeat(20)))));

    data.forEach((item) => {
      const values = keys.map((key) => String(item[key] ?? '-'));
      console.log(row(values));
    });
  }

  progress(current: number, total: number, label?: string): void {
    if (!this.shouldLog('info')) return;

    const percentage = Math.round((current / total) * 100);
    const filled = Math.round((current / total) * 20);
    const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(20 - filled));

    const prefix = label ? `${label} ` : '';
    process.stdout.write(`\r${prefix}${bar} ${percentage}% (${current}/${total})`);

    if (current === total) {
      process.stdout.write('\n');
    }
  }

  withPrefix(prefix: string): Logger {
    return new Logger({
      level: this.level,
      prefix: `${this.prefix}${this.prefix ? '/' : ''}${prefix}`,
      timestamps: this.timestamps,
    });
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  isVerbose(): boolean {
    return this.level === 'debug';
  }

  isQuiet(): boolean {
    return this.level === 'silent';
  }
}

export const logger = new Logger();

export function createLogger(prefix?: string): Logger {
  return new Logger({ prefix });
}

export function table(data: Array<Record<string, any>>): void {
  logger.table(data);
}

export function header(title: string): void {
  logger.header(title);
}

export function section(title: string): void {
  logger.section(title);
}
