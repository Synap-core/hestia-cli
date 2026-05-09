import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getEveEventsPath } from './state-paths.js';

export type MaterializerTarget =
  | 'backend-env'
  | 'traefik-routes'
  | 'hermes-env'
  | 'openclaw-config'
  | 'openwebui-config'
  | 'ai-wiring';

export type ComponentHealth =
  | { kind: 'http'; path?: string; timeoutMs?: number }
  | { kind: 'docker'; timeoutMs?: number }
  | { kind: 'custom'; timeoutMs?: number };

export interface ComponentLifecycle {
  restartStrategy: 'restart' | 'recreate' | 'compose-up' | 'none';
  envBound?: boolean;
}

export interface ComponentDoctorMetadata {
  critical: boolean;
  integrationId?: 'synap' | 'hermes-synap' | 'openclaw-synap' | 'openwebui-synap' | 'openwebui-pipelines' | 'openwebui-coherence';
}

export type DoctorGroup = 'platform' | 'containers' | 'network' | 'ai' | 'wiring' | 'integrations' | 'config';
export type DoctorStatus = 'pass' | 'fail' | 'warn' | 'skip';

export type RepairKind =
  | 'create-eve-network'
  | 'start-component'
  | 'restart-component'
  | 'recreate-component'
  | 'materialize-target'
  | 'repair-domain-routing'
  | 'repair-pod-url'
  | 'rewire-ai'
  | 'start-container'
  | 'rewire-openclaw';

export interface DoctorCheck {
  group: DoctorGroup;
  name: string;
  status: DoctorStatus;
  message: string;
  fix?: string;
  componentId?: string;
  integrationId?: ComponentDoctorMetadata['integrationId'];
  repair?: { kind: RepairKind; label: string };
}

export interface RepairRequest {
  kind: RepairKind;
  componentId?: string;
  target?: MaterializerTarget;
}

export interface RepairResult {
  ok: boolean;
  summary: string;
  logs?: string[];
  error?: string;
  recheck?: { doctorGroup?: DoctorGroup; componentId?: string; target?: MaterializerTarget };
}

export type ConfigSource = 'env' | 'secrets' | 'discovery' | 'derived' | 'default';
export type ConfigConfidence = 'canonical' | 'fallback' | 'stale' | 'conflict';

export interface ExplainableValue<T = unknown> {
  value: T;
  source: ConfigSource;
  confidence: ConfigConfidence;
  detail?: string;
}

export type OperationalEventType =
  | 'config.changed'
  | 'state.changed'
  | 'materialize.started'
  | 'materialize.succeeded'
  | 'materialize.failed'
  | 'repair.started'
  | 'repair.succeeded'
  | 'repair.failed'
  | 'doctor.issue.detected';

export interface OperationalEvent {
  id: string;
  type: OperationalEventType;
  timestamp: string;
  target?: string;
  componentId?: string;
  ok?: boolean;
  summary?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export type NewOperationalEvent = Omit<OperationalEvent, 'id' | 'timestamp'> & {
  id?: string;
  timestamp?: string;
};

export async function appendOperationalEvent(
  event: NewOperationalEvent,
  stateHome?: string,
): Promise<OperationalEvent> {
  const path = stateHome ? `${stateHome.replace(/\/$/, '')}/events.jsonl` : getEveEventsPath();
  const record: OperationalEvent = {
    id: event.id ?? randomUUID(),
    timestamp: event.timestamp ?? new Date().toISOString(),
    ...event,
  };

  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, 'utf-8');
  return record;
}

export async function readOperationalEvents(options: {
  limit?: number;
  stateHome?: string;
} = {}): Promise<OperationalEvent[]> {
  const path = options.stateHome ? `${options.stateHome.replace(/\/$/, '')}/events.jsonl` : getEveEventsPath();
  if (!existsSync(path)) return [];

  const raw = await readFile(path, 'utf-8');
  const events = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as OperationalEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is OperationalEvent => event !== null);

  return typeof options.limit === 'number' && options.limit > 0
    ? events.slice(-options.limit)
    : events;
}
