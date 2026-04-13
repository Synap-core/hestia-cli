// @ts-nocheck
/**
 * Spinner utilities for Hestia CLI
 * Provides loading indicators for long-running operations
 */
import ora from 'ora';
import { logger } from './logger.js';
class SpinnerManager {
    spinners = new Map();
    active = false;
    create(id, options = {}) {
        if (logger.isQuiet()) {
            return {
                start: () => ({}),
                stop: () => ({}),
                succeed: () => ({}),
                fail: () => ({}),
                warn: () => ({}),
                info: () => ({}),
                clear: () => ({}),
                render: () => ({}),
                frame: () => '',
                text: '',
                prefixText: '',
                color: 'cyan',
                spinner: {},
                indent: 0,
                isSpinning: false,
                isEnabled: false,
            };
        }
        const oraOptions = {
            text: options.text || 'Loading...',
            color: options.color || 'cyan',
            spinner: options.spinner || 'dots',
        };
        const spinner = ora(oraOptions);
        this.spinners.set(id, spinner);
        return spinner;
    }
    start(id, text) {
        if (logger.isQuiet())
            return this.create(id);
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
    succeed(id, text) {
        if (logger.isQuiet())
            return;
        const spinner = this.spinners.get(id);
        if (spinner) {
            spinner.succeed(text);
            this.spinners.delete(id);
            this.updateActive();
        }
    }
    fail(id, text) {
        if (logger.isQuiet())
            return;
        const spinner = this.spinners.get(id);
        if (spinner) {
            spinner.fail(text);
            this.spinners.delete(id);
            this.updateActive();
        }
    }
    warn(id, text) {
        if (logger.isQuiet())
            return;
        const spinner = this.spinners.get(id);
        if (spinner) {
            spinner.warn(text);
            this.spinners.delete(id);
            this.updateActive();
        }
    }
    info(id, text) {
        if (logger.isQuiet())
            return;
        const spinner = this.spinners.get(id);
        if (spinner) {
            spinner.info(text);
            this.spinners.delete(id);
            this.updateActive();
        }
    }
    update(id, text) {
        if (logger.isQuiet())
            return;
        const spinner = this.spinners.get(id);
        if (spinner) {
            spinner.text = text;
        }
    }
    stop(id) {
        if (logger.isQuiet())
            return;
        const spinner = this.spinners.get(id);
        if (spinner) {
            spinner.stop();
            this.spinners.delete(id);
            this.updateActive();
        }
    }
    stopAll() {
        this.spinners.forEach((spinner) => spinner.stop());
        this.spinners.clear();
        this.active = false;
    }
    updateActive() {
        this.active = this.spinners.size > 0;
    }
    isActive() {
        return this.active;
    }
}
export const spinner = new SpinnerManager();
export function createSpinner(text) {
    return spinner.start(`spinner-${Date.now()}`, text);
}
export async function withSpinner(text, fn, successText) {
    const spin = createSpinner(text);
    try {
        const result = await fn();
        spin.succeed(successText || text);
        return result;
    }
    catch (error) {
        spin.fail(`Failed: ${text}`);
        throw error;
    }
}
//# sourceMappingURL=spinner.js.map