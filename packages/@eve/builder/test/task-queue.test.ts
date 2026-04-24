import { describe, it, expect } from 'vitest';
import { TaskQueue } from '../src/lib/task-queue.js';
import type { Task } from '@eve/dna';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: `test-${Math.random().toString(36).slice(2, 8)}`,
  profileSlug: 'task',
  name: 'test task',
  type: 'code',
  status: 'pending',
  priority: 'medium',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('TaskQueue', () => {
  it('starts empty', () => {
    const q = new TaskQueue();
    expect(q.isEmpty).toBe(true);
    expect(q.size).toBe(0);
    expect(q.isFull).toBe(false);
  });

  it('enqueues and dequeues tasks', () => {
    const q = new TaskQueue();
    const t = makeTask();
    expect(q.enqueue(t)).toBe(true);
    expect(q.size).toBe(1);
    expect(q.isEmpty).toBe(false);

    const got = q.dequeue();
    expect(got?.id).toBe(t.id);
    expect(q.size).toBe(0);
    expect(q.isEmpty).toBe(true);
  });

  it('returns undefined when dequeuing empty queue', () => {
    const q = new TaskQueue();
    expect(q.dequeue()).toBeUndefined();
  });

  it('peeks without removing', () => {
    const q = new TaskQueue();
    const t = makeTask();
    q.enqueue(t);
    expect(q.peek()?.id).toBe(t.id);
    expect(q.peek()?.id).toBe(t.id);
    expect(q.size).toBe(1);
  });

  it('orders by priority: critical > high > medium > low', () => {
    const q = new TaskQueue();
    q.enqueue(makeTask({ priority: 'low' }));
    q.enqueue(makeTask({ priority: 'critical' }));
    q.enqueue(makeTask({ priority: 'medium' }));
    q.enqueue(makeTask({ priority: 'high' }));

    expect(q.dequeue()?.priority).toBe('critical');
    expect(q.dequeue()?.priority).toBe('high');
    expect(q.dequeue()?.priority).toBe('medium');
    expect(q.dequeue()?.priority).toBe('low');
  });

  it('rejects when queue is full', () => {
    const q = new TaskQueue(3);
    expect(q.enqueue(makeTask())).toBe(true);
    expect(q.enqueue(makeTask())).toBe(true);
    expect(q.enqueue(makeTask())).toBe(true);
    expect(q.isFull).toBe(true);
    expect(q.enqueue(makeTask())).toBe(false);
    expect(q.size).toBe(3);
  });

  it('clears all tasks', () => {
    const q = new TaskQueue();
    q.enqueue(makeTask());
    q.enqueue(makeTask());
    q.clear();
    expect(q.size).toBe(0);
    expect(q.isEmpty).toBe(true);
    expect(q.peek()).toBeUndefined();
  });

  it('toArray returns a copy', () => {
    const q = new TaskQueue();
    const t1 = makeTask();
    const t2 = makeTask({ priority: 'high' });
    q.enqueue(t1);
    q.enqueue(t2);

    const copy = q.toArray();
    expect(copy).toHaveLength(2);
    expect(copy[0]?.priority).toBe('high'); // high priority first
    expect(copy[0]?.id).not.toBe(t1.id); // copy, not reference

    q.clear();
    expect(copy).toHaveLength(2); // original array unchanged
  });
});
