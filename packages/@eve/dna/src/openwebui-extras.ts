/**
 * Post-admin-upsert OpenWebUI extras: push Synap SKILL.md → Prompts,
 * knowledge entries → Knowledge collection, Hub Protocol OpenAPI →
 * external tool server. Runs after `registerOpenwebuiAdminApi` succeeds.
 *
 * Best-effort, mirrors the existing fire-and-forget pattern in
 * `wireOpenwebui`. Per-surface failures are captured in the result, never
 * thrown, so a flaky knowledge sync does not derail the skills push.
 *
 * Hub URL selection: the loopback (`http://127.0.0.1:14000`) is preferred
 * when on-host because Node.js fetch strips the Authorization header on
 * HTTP→HTTPS redirects (cross-origin per the Fetch spec). The public URL
 * goes through Caddy which redirects :80→HTTPS — the Authorization header
 * is silently dropped and the Hub returns 401 for every key, no matter how
 * fresh. The loopback bypasses Caddy/Traefik entirely, so no redirect occurs.
 */

import { resolveHubBaseUrl, DEFAULT_HUB_PATH } from './builder-hub-wiring.js';
import { resolveSynapUrlOnHost } from './loopback-probe.js';
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

/**
 * Resolve the Hub base URL for on-host extras sync.
 *
 * Prefers the loopback URL (http://127.0.0.1:14000) to avoid the
 * Caddy HTTP→HTTPS redirect that silently strips Authorization headers.
 * Falls back to the public URL when loopback is unavailable (off-host CLI).
 */
async function resolveHubBaseUrlOnHost(secrets: EveSecrets): Promise<string | undefined> {
  const synapBase = await resolveSynapUrlOnHost(secrets);
  if (!synapBase) return resolveHubBaseUrl(secrets);

  // Force HTTPS for non-loopback URLs — Caddy redirects HTTP→HTTPS via permanent
  // 301, and the Fetch spec strips Authorization on cross-origin redirects
  // (different scheme = different origin). Loopback bypasses Caddy entirely.
  const isLoopback = synapBase.startsWith('http://127.') || synapBase.startsWith('http://localhost');
  const base = isLoopback ? synapBase : synapBase.replace(/^http:\/\//, 'https://');
  return `${base.replace(/\/$/, '')}${DEFAULT_HUB_PATH}`;
}

export async function syncOpenwebuiExtras(
  cwd: string,
  secrets: EveSecrets | null,
  opts?: SyncOpenwebuiExtrasOptions,
): Promise<OpenwebuiExtrasResult> {
  if (!secrets) return { skipped: true };

  const hubBaseUrl = await resolveHubBaseUrlOnHost(secrets);
  if (!hubBaseUrl) return { skipped: true };

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
