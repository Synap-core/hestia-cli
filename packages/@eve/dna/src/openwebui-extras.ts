/**
 * Post-admin-upsert OpenWebUI extras: push Synap SKILL.md → Prompts,
 * knowledge entries → Knowledge collection, Hub Protocol OpenAPI →
 * external tool server. Runs after `registerOpenwebuiAdminApi` succeeds.
 *
 * Best-effort, mirrors the existing fire-and-forget pattern in
 * `wireOpenwebui`. Per-surface failures are captured in the result, never
 * thrown, so a flaky knowledge sync does not derail the skills push.
 */

import { resolveHubBaseUrl } from './builder-hub-wiring.js';
import { readAgentKeyOrLegacySync } from './secrets-contract.js';
import {
  pushSynapSkillsToOpenwebuiPrompts,
  type SkillsSyncResult,
} from './openwebui-skills-sync.js';
import {
  syncSynapKnowledgeToOpenwebui,
  type KnowledgeSyncOptions,
  type KnowledgeSyncResult,
} from './openwebui-knowledge-sync.js';
import {
  registerSynapAsOpenwebuiToolServer,
  type ToolsSyncResult,
} from './openwebui-tools-sync.js';
import {
  pushSynapFunctionsToOpenwebui,
  type FunctionsSyncResult,
} from './openwebui-functions-sync.js';
import type { EveSecrets } from './secrets-contract.js';

export type ExtrasOutcome<T> =
  | { ok: true; result: T }
  | { ok: false; error: string };

export interface OpenwebuiExtrasResult {
  /** True when no hubBaseUrl could be resolved — nothing was attempted. */
  skipped: boolean;
  skills?: ExtrasOutcome<SkillsSyncResult>;
  knowledge?: ExtrasOutcome<KnowledgeSyncResult>;
  tools?: ExtrasOutcome<ToolsSyncResult>;
  functions?: ExtrasOutcome<FunctionsSyncResult>;
}

export interface SyncOpenwebuiExtrasOptions {
  knowledge?: KnowledgeSyncOptions;
}

export async function syncOpenwebuiExtras(
  cwd: string,
  secrets: EveSecrets | null,
  opts?: SyncOpenwebuiExtrasOptions,
): Promise<OpenwebuiExtrasResult> {
  const hubBaseUrl = secrets ? resolveHubBaseUrl(secrets) : undefined;
  if (!hubBaseUrl || !secrets) {
    return { skipped: true };
  }
  // Diagnostic: always surface the Hub URL and key prefixes used for this
  // sync pass so routing/key mismatches are visible in `eve update` output.
  {
    const owuiKey = readAgentKeyOrLegacySync('openwebui', secrets).slice(0, 12) || 'absent';
    const eveKey  = readAgentKeyOrLegacySync('eve', secrets).slice(0, 12) || 'absent';
    console.error(`[extras-sync] hub=${hubBaseUrl} owui-key=${owuiKey}… eve-key=${eveKey}…`);
  }


  const [skills, knowledge, tools, functions] = await Promise.allSettled([
    pushSynapSkillsToOpenwebuiPrompts(cwd, hubBaseUrl, secrets),
    syncSynapKnowledgeToOpenwebui(cwd, hubBaseUrl, secrets, opts?.knowledge),
    registerSynapAsOpenwebuiToolServer(cwd, hubBaseUrl, secrets),
    pushSynapFunctionsToOpenwebui(cwd, hubBaseUrl, secrets),
  ]);

  return {
    skipped: false,
    skills: settled(skills),
    knowledge: settled(knowledge),
    tools: settled(tools),
    functions: settled(functions),
  };
}

/** One-line summary for log output. Stable, machine-greppable. */
export function formatExtrasSummary(r: OpenwebuiExtrasResult): string {
  if (r.skipped) return 'OpenWebUI extras: skipped (no Hub URL)';
  const parts: string[] = [];
  parts.push(formatPart('skills', r.skills, (v) => `created=${v.created} updated=${v.updated} skipped=${v.skipped.length}`));
  parts.push(formatPart('knowledge', r.knowledge, (v) => `+${v.added}/~${v.updated}/-${v.removed} skipped=${v.skipped.length}`));
  parts.push(formatPart('tools', r.tools, (v) => v.registered ? `registered ${v.toolCount} ops` : 'not registered'));
  parts.push(formatPart('functions', r.functions, (v) => `synced=${v.synced.length} skipped=${v.skipped.length}`));
  return `OpenWebUI extras: ${parts.join(' | ')}`;
}

function settled<T>(p: PromiseSettledResult<T>): ExtrasOutcome<T> {
  return p.status === 'fulfilled'
    ? { ok: true, result: p.value }
    : { ok: false, error: errorMessage(p.reason) };
}

function formatPart<T>(label: string, outcome: ExtrasOutcome<T> | undefined, ok: (v: T) => string): string {
  if (!outcome) return `${label}=–`;
  return outcome.ok ? `${label}: ${ok(outcome.result)}` : `${label}: error (${outcome.error})`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
