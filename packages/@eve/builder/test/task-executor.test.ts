import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';

// Mock child_process.spawn at module level before any imports
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

describe('spawn mock verification', () => {
  it('child_process.spawn is available', () => {
    expect(typeof spawn).toBe('function');
  });
});
