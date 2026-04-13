// @ts-nocheck
/**
 * Task list utilities using Listr2
 * Provides structured multi-step task execution with progress tracking
 */

import { Listr, ListrTask, ListrRendererOptions } from 'listr2';
import { logger } from '../../../utils/index.js';

export interface TaskContext {
  [key: string]: any;
}

export interface TaskDef {
  title: string;
  task: (ctx: TaskContext) => void | Promise<void>;
  skip?: (ctx: TaskContext) => boolean | string | Promise<boolean | string>;
  enabled?: (ctx: TaskContext) => boolean | Promise<boolean>;
}

export interface TaskListOptions {
  concurrent?: boolean;
  exitOnError?: boolean;
  renderer?: 'default' | 'verbose' | 'silent';
}

class TaskRunner {
  async run(
    tasks: TaskDef[],
    options: TaskListOptions = {},
    initialContext: TaskContext = {}
  ): Promise<TaskContext> {
    if (logger.isQuiet() || options.renderer === 'silent') {
      return this.runSilent(tasks, initialContext);
    }

    const listrTasks: ListrTask<TaskContext>[] = tasks.map((task) => ({
      title: task.title,
      task: async (ctx) => {
        await task.task(ctx);
      },
      skip: task.skip ? async (ctx) => await task.skip!(ctx) : undefined,
      enabled: task.enabled ? async (ctx) => await task.enabled!(ctx) : undefined,
    }));

    const listr = new Listr(listrTasks, {
      concurrent: options.concurrent ?? false,
      exitOnError: options.exitOnError ?? true,
      rendererOptions: {
        collapseErrors: false,
        collapseSubtasks: false,
      } as ListrRendererOptions,
    });

    return await listr.run(initialContext);
  }

  private async runSilent(
    tasks: TaskDef[],
    context: TaskContext
  ): Promise<TaskContext> {
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

  create(tasks: TaskDef[], options: TaskListOptions = {}): Listr<TaskContext> {
    const listrTasks: ListrTask<TaskContext>[] = tasks.map((task) => ({
      title: task.title,
      task: async (ctx) => {
        await task.task(ctx);
      },
      skip: task.skip ? async (ctx) => await task.skip!(ctx) : undefined,
      enabled: task.enabled ? async (ctx) => await task.enabled!(ctx) : undefined,
    }));

    return new Listr(listrTasks, {
      concurrent: options.concurrent ?? false,
      exitOnError: options.exitOnError ?? true,
    });
  }
}

export const taskRunner = new TaskRunner();

export async function runTasks(
  tasks: TaskDef[],
  options: TaskListOptions = {},
  context: TaskContext = {}
): Promise<TaskContext> {
  return taskRunner.run(tasks, options, context);
}

export function createTaskList(tasks: TaskDef[], options: TaskListOptions = {}): Listr<TaskContext> {
  return taskRunner.create(tasks, options);
}

export function sequential(tasks: TaskDef[]): TaskDef[] {
  return tasks;
}

export function parallel(tasks: TaskDef[]): { tasks: TaskDef[]; concurrent: true } {
  return { tasks, concurrent: true } as any;
}
