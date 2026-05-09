/**
 * Entity State Manager
 *
 * Manages the state of the Eve entity, including organ health,
 * installation status, and completeness tracking.
 * State is stored as JSON in EVE_STATE_HOME/state.json when set,
 * otherwise ~/.local/share/eve/state.json.
 */

import { readFile, writeFile, mkdir, access, readdir, stat } from 'fs/promises';
import { existsSync, cpSync } from 'node:fs';
import { dirname, join } from 'path';
import { hostname } from 'os';
import { z } from 'zod';
import type {
  EntityState,
  Organ,
  OrganState,
  OrganStatus,
  AIModel,
  DNAError,
  ComponentEntry,
  ManagedBy,
  LegacySetupProfileKind,
} from './types.js';
import { DEFAULT_ENTITY_STATE } from './types.js';
import { appendOperationalEvent } from './operational.js';
import { getEveStateHome, getEveStatePath } from './state-paths.js';

export { getEveStateHome, getEveStatePath } from './state-paths.js';

const OrganStatusSchema = z.object({
  state: z.enum(['missing', 'installing', 'starting', 'ready', 'error', 'stopped']),
  installedAt: z.string().optional(),
  version: z.string().optional(),
  lastChecked: z.string().optional(),
  errorMessage: z.string().optional(),
});

const ComponentEntrySchema = z.object({
  organ: z.enum(['brain', 'arms', 'builder', 'eyes', 'legs']).optional(),
  state: z.enum(['missing', 'installing', 'starting', 'ready', 'error', 'stopped']),
  version: z.string().optional(),
  installedAt: z.string().optional(),
  lastChecked: z.string().optional(),
  errorMessage: z.string().optional(),
  managedBy: z.enum(['eve', 'synap', 'manual']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const SetupProfileV2Schema = z.object({
  version: z.literal(2),
  components: z.array(z.string()),
  installedAt: z.string(),
  migratedFromV1: z.enum(['inference_only', 'data_pod', 'full']).optional(),
});

const StateSchemaV1 = z.object({
  version: z.string(),
  initializedAt: z.string(),
  aiModel: z.enum(['ollama', 'none']),
  organs: z.record(
    z.enum(['brain', 'arms', 'builder', 'eyes', 'legs']),
    OrganStatusSchema,
  ),
  metadata: z.object({
    lastBootTime: z.string().optional(),
    hostname: z.string().optional(),
    platform: z.string().optional(),
    arch: z.string().optional(),
  }),
});

const StateSchema = z.object({
  version: z.string(),
  initializedAt: z.string(),
  aiModel: z.enum(['ollama', 'none']),
  organs: z.record(z.enum(['brain', 'arms', 'builder', 'eyes', 'legs']), OrganStatusSchema),
  installed: z.record(z.string(), ComponentEntrySchema).optional(),
  setupProfile: SetupProfileV2Schema.optional(),
  metadata: z.object({
    lastBootTime: z.string().optional(),
    hostname: z.string().optional(),
    platform: z.string().optional(),
    arch: z.string().optional(),
  }),
});

const ORGANS: Organ[] = ['brain', 'arms', 'builder', 'eyes', 'legs'];

const STATE_FILE_NAME = 'state.json';

/**
 * Migrates entity state from the legacy eve directory to the new eve directory.
 * Copies state.json and any ancillary files, then removes the old directory.
 * Returns true if a migration was performed, false if nothing to migrate.
 */
export async function migrateStateDirectory(): Promise<boolean> {
  const oldStateDir = getEveStateHome();
  const newStateDir = getEveStateHome();

  if (!existsSync(oldStateDir)) return false;

  const oldStatePath = join(oldStateDir, STATE_FILE_NAME);
  if (!existsSync(oldStatePath)) return false;

  // Already migrated? Check if new dir exists with a valid state file
  if (existsSync(newStateDir)) {
    const newStatePath = join(newStateDir, STATE_FILE_NAME);
    if (existsSync(newStatePath)) {
      // Already on new path — no-op
      return false;
    }
  }

  // Copy state to new location
  await mkdir(newStateDir, { recursive: true });
  const { cp } = await import('node:fs/promises');
  await cp(oldStatePath, join(newStateDir, STATE_FILE_NAME), { recursive: true });

  // Remove old directory entirely
  const { rm } = await import('node:fs/promises');
  await rm(oldStateDir, { recursive: true, force: true });

  return true;
}

// =============================================================================
// V1 → V2 Migration
// =============================================================================

/**
 * Organ → component ID mapping (v1 organ names → v2 component IDs).
 */
const ORGAN_TO_COMPONENT: Record<Organ, string> = {
  brain: 'synap',
  arms: 'openclaw',
  builder: 'openclaude',
  eyes: 'rsshub',
  legs: 'traefik',
};

/**
 * Map a v1 setup profile kind to the equivalent v2 component IDs.
 */
function profileKindToComponents(kind: LegacySetupProfileKind): string[] {
  switch (kind) {
    case 'inference_only':
      return ['traefik', 'ollama'];
    case 'data_pod':
      return ['traefik', 'synap'];
    case 'full':
      return ['traefik', 'synap', 'hermes', 'openclaw'];
    default:
      return ['traefik'];
  }
}

/**
 * Migrate a parsed v1 state object to v2 format by populating
 * the `installed` map from the `organs` map.
 */
function migrateStateToV2(parsed: z.infer<typeof StateSchemaV1>): EntityState {
  const installed: Record<string, ComponentEntry> = {};

  for (const [organName, organStatus] of Object.entries(parsed.organs)) {
    const organ = organName as Organ;
    const componentId = ORGAN_TO_COMPONENT[organ];
    installed[componentId] = {
      organ,
      state: organStatus.state,
      version: organStatus.version,
      installedAt: organStatus.installedAt,
      lastChecked: organStatus.lastChecked,
      errorMessage: organStatus.errorMessage,
      managedBy: 'manual' as const,
      config: {},
    };
  }

  return {
    version: '0.2.0',
    initializedAt: parsed.initializedAt,
    aiModel: parsed.aiModel,
    installed,
    setupProfile: undefined, // unknown from legacy
    organs: {
      ...DEFAULT_ENTITY_STATE.organs,
      ...parsed.organs,
    },
    metadata: parsed.metadata,
  };
}

/**
 * Upgrade a raw state object to v2 if it's v1.
 * This is idempotent — calling it on an already-v2 object is safe.
 */
function ensureV2(raw: z.infer<typeof StateSchemaV1> | z.infer<typeof StateSchema>): EntityState {
  // Already has `installed` — it's v2
  if ('installed' in raw && raw.installed) {
    // Still need to normalise organs from installed if they look stale
    return raw as EntityState;
  }
  return migrateStateToV2(raw as z.infer<typeof StateSchemaV1>);
}

export class EntityStateManager {
  private state: EntityState | null = null;
  private statePath: string | null = null;

  private getStatePath(): string {
    if (this.statePath) {
      return this.statePath;
    }
    return getEveStatePath();
  }

  async getState(): Promise<EntityState> {
    if (this.state) {
      return this.state;
    }

    const statePath = this.getStatePath();

    try {
      await access(statePath);
      const content = await readFile(statePath, 'utf-8');
      const raw = JSON.parse(content) as unknown;

      // Try v2 schema first, fall back to v1 for migration
      let validated: z.infer<typeof StateSchema>;
      try {
        validated = StateSchema.parse(raw);
      } catch {
        const v1 = StateSchemaV1.parse(raw);
        validated = ensureV2(v1) as unknown as z.infer<typeof StateSchema>;
      }

      const mergedState: EntityState = {
        ...validated,
        version: '0.2.0', // always report v2
        organs: {
          ...DEFAULT_ENTITY_STATE.organs,
          ...validated.organs,
        },
      };

      // Persist the upgrade if the file was v1
      if (!validated.installed) {
        await this.saveState(mergedState);
      }

      this.state = mergedState;
      return mergedState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const defaultState = this.createDefaultState();
        await this.saveState(defaultState);
        this.state = defaultState;
        return defaultState;
      }

      if (error instanceof z.ZodError) {
        const dnaError = new Error(`Invalid state format: ${error.message}`) as DNAError;
        dnaError.code = 'INVALID_STATE';
        dnaError.path = statePath;
        throw dnaError;
      }

      if (error instanceof SyntaxError) {
        const dnaError = new Error(`Invalid state JSON: ${error.message}`) as DNAError;
        dnaError.code = 'INVALID_STATE';
        dnaError.path = statePath;
        throw dnaError;
      }

      const dnaError = new Error(`Failed to load state: ${(error as Error).message}`) as DNAError;
      dnaError.code = 'STATE_LOAD_ERROR';
      dnaError.path = statePath;
      throw dnaError;
    }
  }

  async saveState(state: EntityState): Promise<void> {
    const statePath = this.getStatePath();
    const stateDir = dirname(statePath);

    try {
      await mkdir(stateDir, { recursive: true });
      
      StateSchema.parse(state);
      
      const json = JSON.stringify(state, null, 2);
      await writeFile(statePath, json, 'utf-8');
      this.state = state;
      await appendOperationalEvent({
        type: 'state.changed',
        target: 'entity-state',
        ok: true,
        summary: 'Entity state saved',
      }, stateDir).catch(() => {});
    } catch (error) {
      if (error instanceof z.ZodError) {
        const dnaError = new Error(`Invalid state: ${error.message}`) as DNAError;
        dnaError.code = 'INVALID_STATE';
        dnaError.path = statePath;
        throw dnaError;
      }
      
      const dnaError = new Error(`Failed to save state: ${(error as Error).message}`) as DNAError;
      dnaError.code = 'STATE_SAVE_ERROR';
      dnaError.path = statePath;
      throw dnaError;
    }
  }

  async updateOrgan(organ: Organ, organState: OrganState, options?: {
    version?: string;
    errorMessage?: string;
    managedBy?: ManagedBy;
    config?: Record<string, unknown>;
  }): Promise<void> {
    const state = await this.getState();

    const status: OrganStatus = {
      state: organState,
      lastChecked: new Date().toISOString(),
    };

    if (organState === 'ready' || organState === 'error') {
      status.installedAt = new Date().toISOString();
    }

    if (options?.version) {
      status.version = options.version;
    }

    if (options?.errorMessage && organState === 'error') {
      status.errorMessage = options.errorMessage;
    }

    state.organs[organ] = status;

    // Also sync the v2 `installed` map
    const componentId = ORGAN_TO_COMPONENT[organ];
    const installedEntry: ComponentEntry = {
      organ,
      state: organState,
      version: options?.version,
      installedAt: status.installedAt,
      lastChecked: status.lastChecked,
      errorMessage: status.errorMessage,
      managedBy: options?.managedBy ?? state.installed?.[componentId]?.managedBy ?? 'manual',
      config: options?.config ?? state.installed?.[componentId]?.config,
    };
    if (!state.installed) {
      state.installed = {};
    }
    state.installed[componentId] = installedEntry;

    await this.saveState(state);
  }

  // --- Component-centric v2 methods ---

  /** Get a component's entry from the v2 `installed` map */
  async getComponentEntry(componentId: string): Promise<ComponentEntry | null> {
    const state = await this.getState();
    return state.installed?.[componentId] ?? null;
  }

  /** Update a component entry directly */
  async updateComponentEntry(
    componentId: string,
    entry: Partial<ComponentEntry>,
  ): Promise<void> {
    const state = await this.getState();
    if (!state.installed) {
      state.installed = {};
    }
    const existing = state.installed[componentId] ?? { state: 'missing' as OrganState };
    state.installed[componentId] = {
      ...existing,
      ...entry,
      lastChecked: new Date().toISOString(),
    };

    // Sync back to organs for backward compat
    const organ = entry.organ ?? existing.organ;
    if (organ && state.installed[componentId].state !== 'missing') {
      state.organs[organ] = {
        state: state.installed[componentId].state,
        version: state.installed[componentId].version,
        installedAt: state.installed[componentId].installedAt,
        lastChecked: state.installed[componentId].lastChecked,
        errorMessage: state.installed[componentId].errorMessage,
      };
    }

    await this.saveState(state);
  }

  /** Register / deregister components in the setup profile */
  async updateSetupProfile(updates: {
    components?: string[];
    migratedFromV1?: LegacySetupProfileKind;
  }): Promise<void> {
    const state = await this.getState();
    state.setupProfile = {
      version: 2,
      components: updates.components ?? state.setupProfile?.components ?? [],
      installedAt: updates.components && !state.setupProfile?.installedAt
        ? new Date().toISOString()
        : state.setupProfile?.installedAt ?? new Date().toISOString(),
      migratedFromV1: updates.migratedFromV1 ?? state.setupProfile?.migratedFromV1,
    };
    await this.saveState(state);
  }

  /** Get the list of installed components from the setup profile */
  async getInstalledComponents(): Promise<string[]> {
    const state = await this.getState();
    return state.setupProfile?.components ?? [];
  }

  /** Check if a specific component is registered */
  async isComponentInstalled(componentId: string): Promise<boolean> {
    const components = await this.getInstalledComponents();
    return components.includes(componentId);
  }

  async setAIModel(model: AIModel): Promise<void> {
    const state = await this.getState();
    state.aiModel = model;
    await this.saveState(state);
  }

  async getOrganState(organ: Organ): Promise<OrganStatus> {
    const state = await this.getState();
    return state.organs[organ] || { state: 'missing' };
  }

  async isOrganReady(organ: Organ): Promise<boolean> {
    const status = await this.getOrganState(organ);
    return status.state === 'ready';
  }

  async getReadyOrgans(): Promise<Organ[]> {
    const state = await this.getState();
    return ORGANS.filter(organ => state.organs[organ]?.state === 'ready');
  }

  async getMissingOrgans(): Promise<Organ[]> {
    const state = await this.getState();
    return ORGANS.filter(organ => state.organs[organ]?.state === 'missing');
  }

  async getErrorOrgans(): Promise<Organ[]> {
    const state = await this.getState();
    return ORGANS.filter(organ => state.organs[organ]?.state === 'error');
  }

  calculateCompleteness(state: EntityState): number {
    const readyCount = ORGANS.filter(organ => state.organs[organ]?.state === 'ready').length;
    return Math.round((readyCount / ORGANS.length) * 100);
  }

  async getCompleteness(): Promise<number> {
    const state = await this.getState();
    return this.calculateCompleteness(state);
  }

  async getNextSteps(): Promise<string[]> {
    const state = await this.getState();
    const steps: string[] = [];

    if (state.aiModel === 'none') {
      steps.push('Configure AI model (run: eve ai setup)');
    }

    for (const organ of ORGANS) {
      const organStatus = state.organs[organ];
      
      switch (organStatus.state) {
        case 'missing':
          steps.push(`Install ${organ} (run: eve install ${organ})`);
          break;
        case 'error':
          steps.push(`Fix ${organ} error: ${organStatus.errorMessage || 'Unknown error'}`);
          break;
        case 'stopped':
          steps.push(`Start ${organ} (run: eve start ${organ})`);
          break;
        case 'installing':
          steps.push(`Wait for ${organ} installation to complete`);
          break;
      }
    }

    if (steps.length === 0) {
      steps.push('Entity is fully operational! 🎉');
    }

    return steps;
  }

  async updateMetadata(updates: Partial<EntityState['metadata']>): Promise<void> {
    const state = await this.getState();
    state.metadata = { ...state.metadata, ...updates };
    await this.saveState(state);
  }

  async recordBoot(): Promise<void> {
    await this.updateMetadata({
      lastBootTime: new Date().toISOString(),
    });
  }

  async resetState(): Promise<void> {
    const defaultState = this.createDefaultState();
    await this.saveState(defaultState);
  }

  private createDefaultState(): EntityState {
    return {
      ...DEFAULT_ENTITY_STATE,
      metadata: {
        platform: process.platform,
        arch: process.arch,
        hostname: hostname(),
      },
    };
  }
}

export const entityStateManager = new EntityStateManager();
