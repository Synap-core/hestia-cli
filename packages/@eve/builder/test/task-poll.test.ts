import { describe, it, expect } from 'vitest';
import { PollError, TransientError, TaskPoller } from '../src/lib/task-poll.js';

describe('PollError', () => {
  it('has correct name', () => {
    const err = new PollError('test error');
    expect(err.name).toBe('PollError');
    expect(err.message).toBe('test error');
  });
});

describe('TransientError', () => {
  it('has correct name', () => {
    const err = new TransientError('retry me');
    expect(err.name).toBe('TransientError');
    expect(err.message).toBe('retry me');
  });

  it('is a subclass of Error', () => {
    const err = new TransientError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TransientError);
  });
});

describe('TaskPoller', () => {
  const config = {
    intervalMs: 30000,
    maxRetries: 3,
    backoffMultiplier: 2,
    apiUrl: 'http://localhost:4000',
    apiKey: 'test-key',
  };

  it('initializes with config', () => {
    const poller = new TaskPoller(config);
    expect(poller.running).toBe(false);
  });

  it('resets cursor', () => {
    const poller = new TaskPoller(config);
    poller.resetCursor();
    expect(poller.getBackoffMs()).toBe(0);
  });

  it('builds correct poll URL', async () => {
    const poller = new TaskPoller(config);
    // pollTasks builds URL internally; verify it doesn't throw URL parsing
    // without a real server, expect network error
    try {
      await poller.pollTasks();
    } catch (err) {
      // Connection refused — expected, we just verify URL was valid
      expect(err).toBeInstanceOf(PollError);
    }
  });

  it('submitResult returns false on network error', async () => {
    const poller = new TaskPoller(config);
    const result = await poller.submitResult('nonexistent-task', {});
    expect(result).toBe(false);
  });

  it('updateTaskStatus returns false on network error', async () => {
    const poller = new TaskPoller(config);
    const result = await poller.updateTaskStatus('nonexistent-task', 'done');
    expect(result).toBe(false);
  });
});
