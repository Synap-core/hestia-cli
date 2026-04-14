/**
 * Spinner utilities for eve CLI
 * Provides loading indicators for long-running operations
 */
import { Ora } from 'ora';
export interface SpinnerOptions {
    text?: string;
    color?: 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray';
    spinner?: string;
}
declare class SpinnerManager {
    private spinners;
    private active;
    create(id: string, options?: SpinnerOptions): Ora;
    start(id: string, text?: string): Ora;
    succeed(id: string, text?: string): void;
    fail(id: string, text?: string): void;
    warn(id: string, text?: string): void;
    info(id: string, text?: string): void;
    update(id: string, text: string): void;
    stop(id: string): void;
    stopAll(): void;
    private updateActive;
    isActive(): boolean;
}
export declare const spinner: SpinnerManager;
export declare function createSpinner(text?: string): Ora;
export declare function withSpinner<T>(text: string, fn: () => Promise<T>, successText?: string): Promise<T>;
export {};
//# sourceMappingURL=spinner.d.ts.map