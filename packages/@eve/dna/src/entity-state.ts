/**
 * Entity State Manager
 * 
 * Manages the state of the Hestia entity, including organ health,
 * installation status, and completeness tracking.
 * State is stored as JSON in ~/.local/share/hestia/state.json
 */

import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { homedir, hostname } from 'os';
import { z } from 'zod';
import type { 
  EntityState, 
  Organ, 
  OrganState, 
  OrganStatus, 
  AIModel, 
  DNAError 
} from './types.js';

const StateSchema = z.object({
  version: z.string(),
  initializedAt: z.string(),
  aiModel: z.enum(['ollama', 'none']),
  organs: z.record(
    z.enum(['brain', 'arms', 'builder', 'eyes', 'legs']),
    z.object({
      state: z.enum(['missing', 'installing', 'ready', 'error', 'stopped']),
      installedAt: z.string().optional(),
      version: z.string().optional(),
      lastChecked: z.string().optional(),
      errorMessage: z.string().optional(),
    })
  ),
  metadata: z.object({
    lastBootTime: z.string().optional(),
    hostname: z.string().optional(),
    platform: z.string().optional(),
    arch: z.string().optional(),
  }),
});

const ORGANS: Organ[] = ['brain', 'arms', 'builder', 'eyes', 'legs'];

const DEFAULT_STATE: EntityState = {
  version: '0.1.0',
  initializedAt: new Date().toISOString(),
  aiModel: 'none',
  organs: {
    brain: { state: 'missing' },
    arms: { state: 'missing' },
    builder: { state: 'missing' },
    eyes: { state: 'missing' },
    legs: { state: 'missing' },
  },
  metadata: {},
};

export class EntityStateManager {
  private state: EntityState | null = null;
  private statePath: string | null = null;

  private getStatePath(): string {
    if (this.statePath) {
      return this.statePath;
    }
    return join(homedir(), '.local', 'share', 'hestia', 'state.json');
  }

  async getState(): Promise<EntityState> {
    if (this.state) {
      return this.state;
    }

    const statePath = this.getStatePath();

    try {
      await access(statePath);
      const content = await readFile(statePath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;
      
      const validated = StateSchema.parse(parsed);
      
      const mergedState: EntityState = {
        ...validated,
        organs: {
          ...DEFAULT_STATE.organs,
          ...validated.organs,
        },
      };
      
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
    const stateDir = join(homedir(), '.local', 'share', 'hestia');

    try {
      await mkdir(stateDir, { recursive: true });
      
      StateSchema.parse(state);
      
      const json = JSON.stringify(state, null, 2);
      await writeFile(statePath, json, 'utf-8');
      this.state = state;
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
    await this.saveState(state);
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
      steps.push('Configure AI model (run: hestia ai setup)');
    }

    for (const organ of ORGANS) {
      const organStatus = state.organs[organ];
      
      switch (organStatus.state) {
        case 'missing':
          steps.push(`Install ${organ} (run: hestia install ${organ})`);
          break;
        case 'error':
          steps.push(`Fix ${organ} error: ${organStatus.errorMessage || 'Unknown error'}`);
          break;
        case 'stopped':
          steps.push(`Start ${organ} (run: hestia start ${organ})`);
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
      ...DEFAULT_STATE,
      metadata: {
        platform: process.platform,
        arch: process.arch,
        hostname: hostname(),
      },
    };
  }
}

export const entityStateManager = new EntityStateManager();
