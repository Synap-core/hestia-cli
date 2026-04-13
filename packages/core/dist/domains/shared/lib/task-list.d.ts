/**
 * Task list utilities using Listr2
 * Provides structured multi-step task execution with progress tracking
 */
import { Listr } from 'listr2';
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
declare class TaskRunner {
    run(tasks: TaskDef[], options?: TaskListOptions, initialContext?: TaskContext): Promise<TaskContext>;
    private runSilent;
    create(tasks: TaskDef[], options?: TaskListOptions): Listr<TaskContext>;
}
export declare const taskRunner: TaskRunner;
export declare function runTasks(tasks: TaskDef[], options?: TaskListOptions, context?: TaskContext): Promise<TaskContext>;
export declare function createTaskList(tasks: TaskDef[], options?: TaskListOptions): Listr<TaskContext>;
export declare function sequential(tasks: TaskDef[]): TaskDef[];
export declare function parallel(tasks: TaskDef[]): {
    tasks: TaskDef[];
    concurrent: true;
};
export {};
//# sourceMappingURL=task-list.d.ts.map