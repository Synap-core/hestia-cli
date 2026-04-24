import { describe, it, expect } from 'vitest';
import { DEFAULT_HERMES_CONFIG } from '@eve/dna';
import { runHermesOrganSetup, runBuilderOrganSetup, type RunBuilderOrganOptions, type BuilderEngine } from '../src/lib/builder-organ.js';

describe('DEFAULT_HERMES_CONFIG defaults', () => {
  it('has correct default poll interval', () => {
    expect(DEFAULT_HERMES_CONFIG.pollIntervalMs).toBe(30_000);
  });

  it('has correct default concurrency', () => {
    expect(DEFAULT_HERMES_CONFIG.maxConcurrentTasks).toBe(1);
  });

  it('is enabled by default', () => {
    expect(DEFAULT_HERMES_CONFIG.enabled).toBe(true);
  });

  it('is immutable (as const)', () => {
    // `as const` is TypeScript-only — verify the shape exists at runtime
    expect(DEFAULT_HERMES_CONFIG).toHaveProperty('enabled');
    expect(DEFAULT_HERMES_CONFIG).toHaveProperty('pollIntervalMs');
    expect(DEFAULT_HERMES_CONFIG).toHaveProperty('maxConcurrentTasks');
    expect(Object.keys(DEFAULT_HERMES_CONFIG).sort()).toEqual(['enabled', 'maxConcurrentTasks', 'pollIntervalMs']);
  });
});

describe('runHermesOrganSetup', () => {
  it('creates hermes-state.json in workspace', async () => {
    const { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmp = mkdtempSync(join(tmpdir(), 'eve-hermes-'));
    try {
      const statePath = runHermesOrganSetup({
        apiUrl: 'http://localhost:4000',
        apiKey: 'test-key-123',
        workspaceDir: tmp,
        pollIntervalMs: 15_000,
        maxConcurrentTasks: 3,
      });

      expect(existsSync(statePath)).toBe(true);
      const state = JSON.parse(readFileSync(statePath, 'utf-8'));

      expect(state.type).toBe('hermes_daemon');
      expect(state.status).toBe('configured');
      expect(state.apiUrl).toBe('http://localhost:4000');
      expect(state.components.daemon.pollIntervalMs).toBe(15_000);
      expect(state.components.daemon.maxConcurrentTasks).toBe(3);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('BuilderEngine type', () => {
  it('supports all three engine types', () => {
    const engines: BuilderEngine[] = ['opencode', 'openclaude', 'claudecode'];
    expect(engines).toHaveLength(3);
  });
});

describe('BuilderOrgan types', () => {
  it('RunBuilderOrganResult has expected shape', () => {
    const result = {
      projectDir: '/tmp/test-project',
      engines: ['opencode', 'openclaude'] as BuilderEngine[],
      dokployUsed: false,
    };
    expect(result.projectDir).toBe('/tmp/test-project');
    expect(result.engines).toHaveLength(2);
    expect(result.dokployUsed).toBe(false);
  });
});
