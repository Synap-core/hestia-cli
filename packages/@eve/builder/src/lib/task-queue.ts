import type { Task } from '@eve/dna';

/** Priority ordering: critical > high > medium > low */
const PRIORITY_ORDER: Record<Task['priority'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** In-memory FIFO task queue with priority support. */
export class TaskQueue {
  private queue: Task[] = [];
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  /** Add a task to the queue. Returns false if queue is full. */
  enqueue(task: Task): boolean {
    if (this.queue.length >= this.maxSize) {
      return false;
    }
    // Insert in priority order (higher priority first)
    const index = this.queue.findIndex(
      (t) => PRIORITY_ORDER[t.priority] < PRIORITY_ORDER[task.priority],
    );
    if (index === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(index, 0, task);
    }
    return true;
  }

  /** Remove and return the highest-priority task. */
  dequeue(): Task | undefined {
    return this.queue.shift();
  }

  /** Peek at the next task without removing it. */
  peek(): Task | undefined {
    return this.queue[0];
  }

  /** Number of tasks in the queue. */
  get size(): number {
    return this.queue.length;
  }

  /** Whether the queue is empty. */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /** Whether the queue is full. */
  get isFull(): boolean {
    return this.queue.length >= this.maxSize;
  }

  /** Clear all tasks from the queue. */
  clear(): void {
    this.queue = [];
  }

  /** Return a copy of all tasks ordered by priority. */
  toArray(): Task[] {
    return [...this.queue];
  }
}
