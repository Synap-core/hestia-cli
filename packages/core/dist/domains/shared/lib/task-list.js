// @ts-nocheck
/**
 * Task list utilities using Listr2
 * Provides structured multi-step task execution with progress tracking
 */
import { Listr } from 'listr2';
import { logger } from '../../lib/utils/index';
class TaskRunner {
    async run(tasks, options = {}, initialContext = {}) {
        if (logger.isQuiet() || options.renderer === 'silent') {
            return this.runSilent(tasks, initialContext);
        }
        const listrTasks = tasks.map((task) => ({
            title: task.title,
            task: async (ctx) => {
                await task.task(ctx);
            },
            skip: task.skip ? async (ctx) => await task.skip(ctx) : undefined,
            enabled: task.enabled ? async (ctx) => await task.enabled(ctx) : undefined,
        }));
        const listr = new Listr(listrTasks, {
            concurrent: options.concurrent ?? false,
            exitOnError: options.exitOnError ?? true,
            rendererOptions: {
                collapseErrors: false,
                collapseSubtasks: false,
            },
        });
        return await listr.run(initialContext);
    }
    async runSilent(tasks, context) {
        for (const task of tasks) {
            const shouldSkip = task.skip ? await task.skip(context) : false;
            if (shouldSkip) {
                continue;
            }
            const isEnabled = task.enabled ? await task.enabled(context) : true;
            if (!isEnabled) {
                continue;
            }
            await task.task(context);
        }
        return context;
    }
    create(tasks, options = {}) {
        const listrTasks = tasks.map((task) => ({
            title: task.title,
            task: async (ctx) => {
                await task.task(ctx);
            },
            skip: task.skip ? async (ctx) => await task.skip(ctx) : undefined,
            enabled: task.enabled ? async (ctx) => await task.enabled(ctx) : undefined,
        }));
        return new Listr(listrTasks, {
            concurrent: options.concurrent ?? false,
            exitOnError: options.exitOnError ?? true,
        });
    }
}
export const taskRunner = new TaskRunner();
export async function runTasks(tasks, options = {}, context = {}) {
    return taskRunner.run(tasks, options, context);
}
export function createTaskList(tasks, options = {}) {
    return taskRunner.create(tasks, options);
}
export function sequential(tasks) {
    return tasks;
}
export function parallel(tasks) {
    return { tasks, concurrent: true };
}
//# sourceMappingURL=task-list.js.map