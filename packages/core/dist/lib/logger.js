/**
 * Logger utilities for Hestia CLI
 * Provides consistent, colored output with support for verbose and quiet modes
 */
import chalk from 'chalk';
class Logger {
    level;
    prefix;
    timestamps;
    rl = null;
    levelPriority = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
        silent: 4,
    };
    constructor(options = {}) {
        this.level = options.level || 'info';
        this.prefix = options.prefix || '';
        this.timestamps = options.timestamps ?? false;
    }
    shouldLog(level) {
        return this.levelPriority[level] >= this.levelPriority[this.level];
    }
    formatMessage(message, level) {
        const parts = [];
        if (this.timestamps) {
            parts.push(chalk.gray(`[${new Date().toISOString()}]`));
        }
        if (this.prefix) {
            parts.push(chalk.cyan(`[${this.prefix}]`));
        }
        const levelColors = {
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
    debug(message, ...args) {
        if (this.shouldLog('debug')) {
            console.log(this.formatMessage(message, 'debug'), ...args);
        }
    }
    info(message, ...args) {
        if (this.shouldLog('info')) {
            console.log(this.formatMessage(message, 'info'), ...args);
        }
    }
    success(message, ...args) {
        if (this.shouldLog('info')) {
            console.log(chalk.green(`✓ ${message}`), ...args);
        }
    }
    warn(message, ...args) {
        if (this.shouldLog('warn')) {
            console.warn(chalk.yellow(`⚠ ${message}`), ...args);
        }
    }
    error(message, ...args) {
        if (this.shouldLog('error')) {
            console.error(chalk.red(`✗ ${message}`), ...args);
        }
    }
    header(title) {
        if (this.shouldLog('info')) {
            const line = '─'.repeat(Math.max(title.length + 4, 40));
            console.log(chalk.cyan(`┌${line}┐`));
            console.log(chalk.cyan(`│  ${chalk.bold.white(title)}${' '.repeat(Math.max(line.length - title.length - 3, 0))}│`));
            console.log(chalk.cyan(`└${line}┘`));
        }
    }
    section(title) {
        if (this.shouldLog('info')) {
            console.log(chalk.cyan(`\n${chalk.bold('▸')} ${chalk.bold.white(title)}`));
            console.log(chalk.gray('─'.repeat(40)));
        }
    }
    newline() {
        if (this.shouldLog('info')) {
            console.log();
        }
    }
    object(obj, indent = 2) {
        if (this.shouldLog('debug')) {
            console.log(JSON.stringify(obj, null, indent));
        }
    }
    table(data) {
        if (!this.shouldLog('info') || data.length === 0)
            return;
        const keys = Object.keys(data[0]);
        const widths = {};
        keys.forEach((key) => {
            widths[key] = Math.max(key.length, ...data.map((row) => String(row[key] ?? '-').length));
        });
        const row = (cells) => cells.map((cell, i) => cell.padEnd(widths[keys[i]])).join('  ');
        console.log(chalk.cyan(row(keys.map((k) => k.toUpperCase()))));
        console.log(chalk.gray(row(keys.map(() => '─'.repeat(20)))));
        data.forEach((item) => {
            const values = keys.map((key) => String(item[key] ?? '-'));
            console.log(row(values));
        });
    }
    progress(current, total, label) {
        if (!this.shouldLog('info'))
            return;
        const percentage = Math.round((current / total) * 100);
        const filled = Math.round((current / total) * 20);
        const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(20 - filled));
        const prefix = label ? `${label} ` : '';
        process.stdout.write(`\r${prefix}${bar} ${percentage}% (${current}/${total})`);
        if (current === total) {
            process.stdout.write('\n');
        }
    }
    withPrefix(prefix) {
        return new Logger({
            level: this.level,
            prefix: `${this.prefix}${this.prefix ? '/' : ''}${prefix}`,
            timestamps: this.timestamps,
        });
    }
    setLevel(level) {
        this.level = level;
    }
    getLevel() {
        return this.level;
    }
    isVerbose() {
        return this.level === 'debug';
    }
    isQuiet() {
        return this.level === 'silent';
    }
}
export const logger = new Logger();
export function createLogger(prefix) {
    return new Logger({ prefix });
}
export function table(data) {
    logger.table(data);
}
export function header(title) {
    logger.header(title);
}
export function section(title) {
    logger.section(title);
}
//# sourceMappingURL=logger.js.map