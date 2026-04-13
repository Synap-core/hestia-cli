/**
 * DNA Types - Core type definitions for Hestia entity state and configuration
 */

/** Represents the health/availability state of an organ */
export type OrganState = 'missing' | 'installing' | 'ready' | 'error' | 'stopped';

/** The available organs in the Hestia ecosystem */
export type Organ = 'brain' | 'arms' | 'builder' | 'eyes' | 'legs';

/** The state of a single organ */
export interface OrganStatus {
  state: OrganState;
  installedAt?: string;
  version?: string;
  lastChecked?: string;
  errorMessage?: string;
}

/** AI model preference */
export type AIModel = 'ollama' | 'none';

/** The complete state of the Hestia entity */
export interface EntityState {
  version: string;
  initializedAt: string;
  aiModel: AIModel;
  organs: Record<Organ, OrganStatus>;
  metadata: {
    lastBootTime?: string;
    hostname?: string;
    platform?: string;
    arch?: string;
  };
}

/** Individual organ configuration */
export interface OrganConfig {
  enabled: boolean;
  autoStart: boolean;
  port?: number;
  environment?: Record<string, string>;
}

/** Complete Hestia configuration structure */
export interface HestiaConfig {
  /** The name of this Hestia entity */
  name: string;
  
  /** Entity version */
  version: string;
  
  /** AI model preference */
  aiModel: AIModel;
  
  /** Organ-specific configurations */
  organs: Record<Organ, OrganConfig>;
  
  /** Global settings */
  settings: {
    /** Log level for all organs */
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    
    /** Whether to check for updates automatically */
    autoUpdate: boolean;
    
    /** Default timeout for organ operations in ms */
    defaultTimeout: number;
  };
  
  /** Timestamps */
  createdAt: Date;
  updatedAt: Date;
}

/** Stored credentials structure */
export interface Credentials {
  /** API keys and tokens */
  [key: string]: string;
}

/** Configuration file schema (without methods) */
export interface ConfigFile {
  name: string;
  version: string;
  aiModel: AIModel;
  organs: Record<Organ, OrganConfig>;
  settings: HestiaConfig['settings'];
  createdAt: string;
  updatedAt: string;
}

/** Entity state file schema (without methods) */
export interface EntityStateFile {
  organs: Record<Organ, OrganStatus>;
  aiModel: AIModel;
  createdAt: string;
  updatedAt: string;
  version: string;
}

/** DNA package error with code */
export interface DNAError extends Error {
  code?: string;
  path?: string;
}

/** Default entity state for initialization */
export const DEFAULT_ENTITY_STATE: EntityState = {
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
