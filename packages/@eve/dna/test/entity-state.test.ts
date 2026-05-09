import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_ENTITY_STATE,
  ORGANS,
  SERVICE_REGISTRY,
  SERVICE_TO_ORGAN,
  ORGAN_INFO,
} from '../src/types.js';
import { EntityStateManager, getEveStatePath } from '../src/entity-state.js';
import { hostname, tmpdir } from 'os';
import { rmSync, mkdirSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';

const ORIGINAL_EVE_STATE_HOME = process.env.EVE_STATE_HOME;

describe('constants', () => {
  it('has all five organs', () => {
    expect(ORGANS).toEqual(['brain', 'arms', 'builder', 'eyes', 'legs']);
  });

  it('maps every service to an organ', () => {
    const services = Object.keys(SERVICE_REGISTRY) as (keyof typeof SERVICE_REGISTRY)[];
    for (const svc of services) {
      expect(SERVICE_TO_ORGAN[svc]).toBeDefined();
      expect(ORGANS).toContain(SERVICE_TO_ORGAN[svc]);
    }
  });

  it('all service configs have network set', () => {
    for (const [name, cfg] of Object.entries(SERVICE_REGISTRY)) {
      expect(cfg.network).toBe('eve-network');
    }
  });
});

describe('EntityStateManager', () => {
  it('returns correct completeness for all-ready state', () => {
    const state = {
      ...DEFAULT_ENTITY_STATE,
      organs: {
        brain: { state: 'ready' as const },
        arms: { state: 'ready' as const },
        builder: { state: 'ready' as const },
        eyes: { state: 'ready' as const },
        legs: { state: 'ready' as const },
      },
    };
    const mgr = new EntityStateManager();
    expect(mgr.calculateCompleteness(state)).toBe(100);
  });

  it('returns 0 for all-missing state', () => {
    const mgr = new EntityStateManager();
    expect(mgr.calculateCompleteness(DEFAULT_ENTITY_STATE)).toBe(0);
  });

  it('returns 60 for 3/5 ready', () => {
    const state = {
      ...DEFAULT_ENTITY_STATE,
      organs: {
        brain: { state: 'ready' as const },
        arms: { state: 'ready' as const },
        builder: { state: 'ready' as const },
        eyes: { state: 'missing' as const },
        legs: { state: 'missing' as const },
      },
    };
    const mgr = new EntityStateManager();
    expect(mgr.calculateCompleteness(state)).toBe(60);
  });

  it('organ info has emoji for each organ', () => {
    for (const organ of ORGANS) {
      expect(ORGAN_INFO[organ].emoji.length).toBeGreaterThan(0);
    }
  });

  it('legs organ uses cybernetic leg emoji 🦿', () => {
    expect(ORGAN_INFO.legs.emoji).toBe('🦿');
  });

  it('brain organ uses brain emoji 🧠', () => {
    expect(ORGAN_INFO.brain.emoji).toBe('🧠');
  });
});

// =============================================================================
// V2 Component-centric state tests
// =============================================================================

describe('v2 component state', () => {
  let stateHome: string;

  beforeEach(() => {
    stateHome = mkdtempSync(join(tmpdir(), 'eve-state-'));
    process.env.EVE_STATE_HOME = stateHome;
  });

  afterEach(() => {
    if (ORIGINAL_EVE_STATE_HOME === undefined) {
      delete process.env.EVE_STATE_HOME;
    } else {
      process.env.EVE_STATE_HOME = ORIGINAL_EVE_STATE_HOME;
    }
    rmSync(stateHome, { recursive: true, force: true });
  });

  function resetStateFile(): void {
    const state = {
      version: '0.1.0',
      initializedAt: new Date().toISOString(),
      aiModel: 'none' as const,
      organs: {
        brain: { state: 'missing' },
        arms: { state: 'missing' },
        builder: { state: 'missing' },
        eyes: { state: 'missing' },
        legs: { state: 'missing' },
      },
      metadata: { platform: process.platform, arch: process.arch, hostname: hostname() },
    };
    mkdirSync(stateHome, { recursive: true });
    writeFileSync(getEveStatePath(), JSON.stringify(state, null, 2));
  }

  it('updateComponentEntry creates a new entry', async () => {
    resetStateFile();
    const mgr = new EntityStateManager();
    await mgr.updateComponentEntry('synap', {
      state: 'ready',
      version: '0.5.0',
      managedBy: 'eve',
    });
    const entry = await mgr.getComponentEntry('synap');
    expect(entry).not.toBeNull();
    expect(entry!.state).toBe('ready');
    expect(entry!.version).toBe('0.5.0');
    expect(entry!.managedBy).toBe('eve');
  });

  it('updateComponentEntry merges with existing entry', async () => {
    resetStateFile();
    const mgr = new EntityStateManager();
    await mgr.updateComponentEntry('test-merge', {
      state: 'ready',
      version: '1.0.0',
      managedBy: 'eve',
      config: { key: 'val' },
    });
    // Merge a partial update — version should be preserved
    await mgr.updateComponentEntry('test-merge', {
      state: 'starting',
    });
    const entry = await mgr.getComponentEntry('test-merge');
    expect(entry!.state).toBe('starting');
    expect(entry!.version).toBe('1.0.0');
    expect(entry!.managedBy).toBe('eve');
  });

  it('updateComponentEntry with organ syncs back to organs', async () => {
    resetStateFile();
    const mgr = new EntityStateManager();
    await mgr.updateComponentEntry('synap', {
      organ: 'brain',
      state: 'ready',
      version: '0.5.0',
    });
    const state = await mgr.getState();
    // v2 entry exists
    const comp = await mgr.getComponentEntry('synap');
    expect(comp!.state).toBe('ready');
    // organ state synced
    expect(state.organs.brain.state).toBe('ready');
  });

  it('updateOrgan with managedBy updates v2 entry', async () => {
    resetStateFile();
    const mgr = new EntityStateManager();
    await mgr.updateOrgan('brain', 'ready', { version: '0.5.0', managedBy: 'eve' });
    const comp = await mgr.getComponentEntry('synap');
    expect(comp!.managedBy).toBe('eve');
    expect(comp!.version).toBe('0.5.0');
  });

  it('updateOrgan preserves managedBy when not overridden', async () => {
    resetStateFile();
    const mgr = new EntityStateManager();
    // First set managedBy
    await mgr.updateOrgan('brain', 'ready', { managedBy: 'eve' });
    // Then update state without managedBy — should preserve
    await mgr.updateOrgan('brain', 'starting');
    const comp = await mgr.getComponentEntry('synap');
    expect(comp!.managedBy).toBe('eve');
  });

  it('v2 installed map is empty by default', async () => {
    resetStateFile();
    const mgr = new EntityStateManager();
    const state = await mgr.getState();
    // No writes were made — installed should be undefined
    expect(state.installed).toBeUndefined();
  });
});

// =============================================================================
// V1 → V2 migration assertion test
// =============================================================================

describe('V1 → V2 state migration', () => {
  let stateHome: string;

  beforeEach(() => {
    stateHome = mkdtempSync(join(tmpdir(), 'eve-state-v1-'));
    process.env.EVE_STATE_HOME = stateHome;
  });

  afterEach(() => {
    if (ORIGINAL_EVE_STATE_HOME === undefined) {
      delete process.env.EVE_STATE_HOME;
    } else {
      process.env.EVE_STATE_HOME = ORIGINAL_EVE_STATE_HOME;
    }
    rmSync(stateHome, { recursive: true, force: true });
  });

  function writeV1State(organs: Record<string, { state: string; version?: string }>): void {
    const v1: Record<string, unknown> = {
      version: '0.1.0',
      initializedAt: '2024-01-01T00:00:00.000Z',
      aiModel: 'none',
      organs,
      metadata: { platform: 'linux', arch: 'x64', hostname: 'test-host' },
    };
    mkdirSync(stateHome, { recursive: true });
    writeFileSync(getEveStatePath(), JSON.stringify(v1, null, 2));
  }

  it('migrates V1 state to V2 shape with installed map populated', async () => {
    writeV1State({
      brain: { state: 'ready', version: '1.0.0' },
      arms: { state: 'missing' },
      builder: { state: 'error' },
      eyes: { state: 'stopped' },
      legs: { state: 'ready', version: '2.0.0' },
    });

    const mgr = new EntityStateManager();
    const state = await mgr.getState();

    // Must report v2
    expect(state.version).toBe('0.2.0');

    // installed map must exist after migration
    expect(state.installed).toBeDefined();

    // brain → synap
    expect(state.installed?.['synap']?.organ).toBe('brain');
    expect(state.installed?.['synap']?.state).toBe('ready');
    expect(state.installed?.['synap']?.version).toBe('1.0.0');

    // legs → traefik
    expect(state.installed?.['traefik']?.organ).toBe('legs');
    expect(state.installed?.['traefik']?.state).toBe('ready');
    expect(state.installed?.['traefik']?.version).toBe('2.0.0');

    // arms → openclaw
    expect(state.installed?.['openclaw']?.organ).toBe('arms');
    expect(state.installed?.['openclaw']?.state).toBe('missing');

    // organs map still populated (backward compat)
    expect(state.organs.brain.state).toBe('ready');
    expect(state.organs.legs.state).toBe('ready');
  });

  it('saves migrated state back to disk (idempotent upgrade)', async () => {
    writeV1State({
      brain: { state: 'ready' },
      arms: { state: 'missing' },
      builder: { state: 'missing' },
      eyes: { state: 'missing' },
      legs: { state: 'missing' },
    });

    const mgr1 = new EntityStateManager();
    await mgr1.getState();

    // Second manager reads the already-migrated file — must parse as v2 without error
    const mgr2 = new EntityStateManager();
    const state2 = await mgr2.getState();
    expect(state2.version).toBe('0.2.0');
    expect(state2.installed).toBeDefined();
  });

  it('V1 state without setupProfile results in undefined setupProfile after migration', async () => {
    writeV1State({ brain: { state: 'missing' }, arms: { state: 'missing' }, builder: { state: 'missing' }, eyes: { state: 'missing' }, legs: { state: 'missing' } });

    const mgr = new EntityStateManager();
    const state = await mgr.getState();
    expect(state.setupProfile).toBeUndefined();
  });
});
