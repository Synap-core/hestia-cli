/**
 * Logger utilities for Hestia CLI
 * Provides consistent, colored output with support for verbose and quiet modes
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export interface LoggerOptions {
    level?: LogLevel;
    prefix?: string;
    timestamps?: boolean;
}
export declare class Logger {
    private level;
    private prefix;
    private timestamps;
    private rl;
    private levelPriority;
    constructor(options?: LoggerOptions);
    private shouldLog;
    private formatMessage;
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    success(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
    header(title: string): void;
    section(title: string): void;
    newline(): void;
    object(obj: any, indent?: number): void;
    table(data: Array<Record<string, any>>): void;
    progress(current: number, total: number, label?: string): void;
    withPrefix(prefix: string): Logger;
    setLevel(level: LogLevel): void;
    getLevel(): LogLevel;
    isVerbose(): boolean;
    isQuiet(): boolean;
}
export declare const logger: Logger;
export declare function createLogger(prefix?: string): Logger;
export declare function table(data: Array<Record<string, any>>): void;
export declare function header(title: string): void;
export declare function section(title: string): void;
//# sourceMappingURL=logger.d.ts.map