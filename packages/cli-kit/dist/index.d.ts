import * as chalk from 'chalk';

type JsonRecord = Record<string, unknown>;
declare const theme: {
    primary: chalk.ChalkInstance;
    success: chalk.ChalkInstance;
    warn: chalk.ChalkInstance;
    error: chalk.ChalkInstance;
    info: chalk.ChalkInstance;
    muted: chalk.ChalkInstance;
};
interface GlobalCliFlags {
    json?: boolean;
    nonInteractive?: boolean;
    verbose?: boolean;
}
declare function setGlobalCliFlags(flags: GlobalCliFlags): void;
declare function getGlobalCliFlags(): GlobalCliFlags;
declare function outputJson(data: unknown): void;
declare function outputLine(message: string, kind?: 'info' | 'success' | 'warn' | 'error' | 'muted'): void;
/**
 * Run an async step with an ora spinner; on failure rethrows after stop().
 */
declare function runStep<T>(label: string, fn: () => Promise<T>, verbose?: boolean): Promise<T>;

export { type GlobalCliFlags, type JsonRecord, getGlobalCliFlags, outputJson, outputLine, runStep, setGlobalCliFlags, theme };
