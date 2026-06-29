/**
 * `eve capabilities` — apply CAPABILITY TEMPLATES headlessly through the
 * backend's Hub door (`POST /api/hub/capabilities/apply`).
 *
 * A capability template is "a connector/workspace config, applied like a view":
 * a config descriptor that instantiates a set of {vault secrets · tools · skills}
 * in ONE governed call. The backend interpolates `{{param}}` placeholders, then
 * creates the vault secrets → tools → skills through the GOVERNED routers
 * (proposal-gated) and returns what it created + the proposal ids.
 *
 * This is the generic, provider-agnostic seed path. OAuth-via-Nango connectors
 * keep their dedicated declare flow in `eve connectors setup`; THIS command is
 * for api_key / passkey / mcp / basic connector types (and any inline template).
 *
 * Subcommands:
 *   eve capabilities list
 *       List the known backend seed templates.
 *
 *   eve capabilities apply <template>
 *       <template> is EITHER a backend template key (e.g. "generic-apikey",
 *       resolved server-side) OR a path to a local `*.json` CapabilityDefinition
 *       file (sent inline as `definition`). Prompts for the template's declared
 *       required params, then POSTs to /capabilities/apply.
 *
 *       Flags:
 *         --template <key>   Force backend-resolved template-key mode.
 *         --param k=v        Provide a param non-interactively (repeatable).
 *         --workspace <id>   Scope the capability to a workspace (omit = pod-wide).
 *         --agent <slug>     Hub identity to act as (default: eve).
 */

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { text, isCancel, cancel } from '@clack/prompts';
import {
  readEveSecrets,
  readAgentKeyOrLegacy,
  resolveSynapUrlOnHost,
} from '@eve/dna';
import {
  colors,
  emojis,
  printHeader,
  printSuccess,
  printError,
  printInfo,
  createSpinner,
} from '../lib/ui.js';
import {
  CAPABILITY_TEMPLATES,
  findCapabilityTemplate,
} from './capability-catalog.js';
import { CAPABILITY_DEFINITIONS } from './capability-definitions.js';

// ---------------------------------------------------------------------------
// Capability-definition shapes (mirror @synap/playbooks `CapabilityDefinition`)
// Kept local so eve-cli has no backend/playbooks dependency — the field names
// match the backend contract VERBATIM.
// ---------------------------------------------------------------------------

export interface CapabilityParamSpec {
  name: string;
  label?: string;
  type?: 'text' | 'number' | 'entity' | 'choice' | 'boolean';
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface CapabilityDefinition {
  key: string;
  name: string;
  description?: string;
  params?: CapabilityParamSpec[];
  vault?: unknown[];
  tools: unknown[];
  skills: unknown[];
}

/** Response shape from POST /api/hub/capabilities/apply. */
interface ApplyCapabilityResponse {
  capabilityKey: string;
  created: {
    vault: Record<string, unknown>[];
    tools: Record<string, unknown>[];
    skills: Record<string, unknown>[];
  };
  proposals: string[];
}

// ---------------------------------------------------------------------------
// Pod connection (reuses eve's existing pod-connection auth — no new auth)
// ---------------------------------------------------------------------------

interface PodConnection {
  synapUrl: string;
  apiKey: string;
}

/**
 * Resolve the pod base URL + the agent's Hub API key from eve's existing
 * secrets. Mirrors the resolution `eve auth` uses: loopback-on-host URL +
 * per-agent Hub key (legacy `synap.apiKey` fallback for the eve agent).
 */
async function resolvePodConnection(agentType: string): Promise<PodConnection | null> {
  const secrets = await readEveSecrets(process.cwd());
  const synapUrl = await resolveSynapUrlOnHost(secrets);
  if (!synapUrl) return null;
  const apiKey = (await readAgentKeyOrLegacy(agentType, process.cwd())).trim();
  if (!apiKey) return null;
  return { synapUrl, apiKey };
}

// ---------------------------------------------------------------------------
// Param parsing + prompting
// ---------------------------------------------------------------------------

/** Parse repeatable `--param k=v` flags into a record. */
function parseParamFlags(raw: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of raw ?? []) {
    const eq = entry.indexOf('=');
    if (eq <= 0) {
      throw new Error(`Invalid --param "${entry}" — expected key=value.`);
    }
    out[entry.slice(0, eq).trim()] = entry.slice(eq + 1);
  }
  return out;
}

/**
 * Prompt for any DECLARED params not already supplied via --param.
 * Required params with no value and no default must be answered; optional ones
 * may be skipped (Enter accepts the default / empty).
 */
async function collectParams(
  declared: CapabilityParamSpec[],
  provided: Record<string, string>,
): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = { ...provided };

  for (const spec of declared) {
    if (spec.name in params) continue; // already provided via --param
    const label = spec.label ?? spec.name;
    const hint = spec.description ? ` ${colors.muted(`(${spec.description})`)}` : '';
    const defaultHint =
      spec.default !== undefined ? String(spec.default) : undefined;

    const answer = await text({
      message: `${label}${spec.required ? colors.error(' *') : ''}${hint}`,
      placeholder: defaultHint,
      initialValue: defaultHint,
      validate: (v) => {
        if (spec.required && (!v || v.trim().length === 0)) return 'Required';
        return undefined;
      },
    });
    if (isCancel(answer)) {
      cancel('Cancelled.');
      process.exit(0);
    }
    const value = String(answer).trim();
    // Only send non-empty values; the backend fills defaults from the template.
    if (value.length > 0) params[spec.name] = value;
    else if (spec.default !== undefined) params[spec.name] = spec.default;
  }

  return params;
}

// ---------------------------------------------------------------------------
// Template resolution: backend key OR local file
// ---------------------------------------------------------------------------

interface ResolvedTemplate {
  /** Pass-through backend template key (mode A). */
  templateKey?: string;
  /** Inline definition loaded from a local file (mode B). */
  definition?: CapabilityDefinition;
  /** The declared params to prompt for, from whichever source. */
  declaredParams: CapabilityParamSpec[];
  /** Display label. */
  label: string;
}

/**
 * Decide whether `<template>` is a local file path or a backend template key.
 *
 *   - If `--template` is set, force backend-key mode.
 *   - Else if `<template>` exists on disk (or ends in .json), load it as a
 *     local CapabilityDefinition sent inline as `definition`.
 *   - Else treat it as a backend template key passed straight through.
 */
async function resolveTemplate(
  arg: string | undefined,
  forcedTemplateKey: string | undefined,
): Promise<ResolvedTemplate> {
  // Mode A — explicit backend template key.
  if (forcedTemplateKey) {
    const entry = findCapabilityTemplate(forcedTemplateKey);
    return {
      templateKey: forcedTemplateKey,
      declaredParams: [], // backend owns the params; we prompt only what we know
      label: entry?.label ?? forcedTemplateKey,
    };
  }

  if (!arg) {
    throw new Error('Provide a template key or a path to a *.json definition file.');
  }

  // Mode B — local definition file (path exists, or looks like a json file).
  const looksLikeFile = arg.endsWith('.json') || arg.includes('/') || existsSync(arg);
  if (looksLikeFile) {
    const path = resolvePath(process.cwd(), arg);
    if (!existsSync(path)) {
      throw new Error(`Definition file not found: ${path}`);
    }
    let definition: CapabilityDefinition;
    try {
      definition = JSON.parse(await readFile(path, 'utf-8')) as CapabilityDefinition;
    } catch (err) {
      throw new Error(
        `Could not parse ${path} as JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!definition.key || !Array.isArray(definition.tools) || !Array.isArray(definition.skills)) {
      throw new Error(
        `${path} is not a valid CapabilityDefinition (needs key, tools[], skills[]).`,
      );
    }
    return {
      definition,
      declaredParams: definition.params ?? [],
      label: definition.name ?? definition.key,
    };
  }

  // Mode A (implicit) — a known backend template key.
  const entry = findCapabilityTemplate(arg);
  return {
    templateKey: arg,
    declaredParams: [], // backend resolves + owns params for keyed templates
    label: entry?.label ?? arg,
  };
}

// ---------------------------------------------------------------------------
// HTTP call
// ---------------------------------------------------------------------------

/**
 * Authed JSON POST to a Hub path. Shared by `apply` and `sync` (kills the
 * copy-paste fetch+error-unwrap). `label` names the operation in error messages.
 */
async function postJson<T>(
  conn: PodConnection,
  path: string,
  body: unknown,
  label: string,
): Promise<T> {
  const url = `${conn.synapUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${conn.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const rawText = await res.text();
  if (!res.ok) {
    let detail = rawText;
    try {
      const parsed = JSON.parse(rawText) as { error?: string };
      if (parsed.error) detail = parsed.error;
    } catch {
      /* keep raw text */
    }
    throw new Error(`${label} failed (HTTP ${res.status}): ${detail}`);
  }
  return JSON.parse(rawText) as T;
}

async function postApply(
  conn: PodConnection,
  body: {
    templateKey?: string;
    definition?: CapabilityDefinition;
    params: Record<string, unknown>;
    workspaceId?: string;
  },
): Promise<ApplyCapabilityResponse> {
  return postJson<ApplyCapabilityResponse>(
    conn,
    '/api/hub/capabilities/apply',
    body,
    'apply',
  );
}

// ---------------------------------------------------------------------------
// `eve capabilities apply <template>`
// ---------------------------------------------------------------------------

interface ApplyOptions {
  template?: string;
  param?: string[];
  workspace?: string;
  agent?: string;
}

async function runApply(templateArg: string | undefined, opts: ApplyOptions): Promise<void> {
  console.log();
  printHeader('Eve — Apply Capability Template', '🧩');
  console.log();

  const agentType = opts.agent ?? 'eve';
  const conn = await resolvePodConnection(agentType);
  if (!conn) {
    printError('Could not resolve a pod URL + Hub API key.');
    printInfo('  Fix: run `eve auth provision` (mints the agent key), or set domain.primary in secrets.json.');
    process.exitCode = 1;
    return;
  }

  let resolved: ResolvedTemplate;
  let providedParams: Record<string, string>;
  try {
    resolved = await resolveTemplate(templateArg, opts.template);
    providedParams = parseParamFlags(opts.param);
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  printInfo(`Pod:       ${colors.info(conn.synapUrl)}`);
  printInfo(`Template:  ${colors.primary.bold(resolved.label)}`);
  printInfo(
    `Mode:      ${resolved.definition ? 'inline definition (local file)' : 'backend template key'}`,
  );
  if (opts.workspace) printInfo(`Workspace: ${opts.workspace}`);
  console.log();

  // Prompt for declared params we know about (local-file mode) or any
  // --param-provided values (backend-key mode passes them straight through).
  const params = await collectParams(resolved.declaredParams, providedParams);

  const spinner = createSpinner('Calling POST /api/hub/capabilities/apply…');
  spinner.start();
  let result: ApplyCapabilityResponse;
  try {
    result = await postApply(conn, {
      templateKey: resolved.templateKey,
      definition: resolved.definition,
      params,
      workspaceId: opts.workspace,
    });
  } catch (err) {
    spinner.fail('Apply failed');
    printError(err instanceof Error ? err.message : String(err));
    console.log();
    printInfo('Common causes:');
    printInfo('  • Hub key lacks hub-protocol.write scope → `eve auth renew --agent ' + agentType + '`');
    printInfo('  • Unknown template key → `eve capabilities list`');
    printInfo('  • Backend unreachable → `eve doctor`');
    process.exitCode = 1;
    return;
  }
  spinner.succeed('Capability applied');

  // Summary.
  console.log();
  printSuccess(`Applied capability: ${colors.primary.bold(result.capabilityKey)}`);
  const v = result.created.vault.length;
  const t = result.created.tools.length;
  const s = result.created.skills.length;
  printInfo(`  Created: ${v} vault secret${v === 1 ? '' : 's'}, ${t} tool${t === 1 ? '' : 's'}, ${s} skill${s === 1 ? '' : 's'}`);
  if (result.proposals.length > 0) {
    printInfo(`  Proposals (pending review): ${result.proposals.length}`);
    for (const id of result.proposals) {
      printInfo(`    ${colors.muted('•')} ${id}`);
    }
    console.log();
    printInfo('Review and approve them in Synap (proposals are reviewable + reversible).');
  } else {
    printInfo('  No proposals — resources were auto-approved.');
  }
  console.log();
}

// ---------------------------------------------------------------------------
// `eve capabilities list`
// ---------------------------------------------------------------------------

function runList(): void {
  console.log();
  printHeader('Eve — Capability Templates', '🧩');
  console.log();
  printInfo('Backend seed templates (apply with `eve capabilities apply <key>`):');
  console.log();
  for (const t of CAPABILITY_TEMPLATES) {
    console.log(
      `  ${colors.primary.bold(t.key.padEnd(20))} ${colors.muted(`[${t.authMode}]`)} ${t.description}`,
    );
  }
  console.log();
  printInfo('Or apply a local file:  eve capabilities apply ./my-connector.capability.json');
  console.log();
}

// ---------------------------------------------------------------------------
// `eve capabilities sync` — push the vendored seed definitions into the pod DB
// ---------------------------------------------------------------------------

/** Response shape from POST /api/hub/capabilities/templates. */
interface UpsertTemplateResponse {
  id: string;
  key: string;
  version: number;
  status?: 'created' | 'updated';
}

interface SyncOptions {
  workspace?: string;
  agent?: string;
  key?: string;
}

async function runSync(opts: SyncOptions): Promise<void> {
  console.log();
  printHeader('Eve — Sync Capability Templates', '🧩');
  console.log();

  const agentType = opts.agent ?? 'eve';
  const conn = await resolvePodConnection(agentType);
  if (!conn) {
    printError('Could not resolve a pod URL + Hub API key.');
    printInfo('  Fix: run `eve auth provision` (mints the agent key), or set domain.primary in secrets.json.');
    process.exitCode = 1;
    return;
  }

  // Filter to a single key if --key was given.
  const entries = Object.entries(CAPABILITY_DEFINITIONS).filter(
    ([key]) => !opts.key || key === opts.key,
  );
  if (entries.length === 0) {
    printError(`No vendored definition matches --key "${opts.key}".`);
    printInfo(`  Known keys: ${Object.keys(CAPABILITY_DEFINITIONS).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  printInfo(`Pod:       ${colors.info(conn.synapUrl)}`);
  if (opts.workspace) printInfo(`Workspace: ${opts.workspace}`);
  printInfo(`Templates: ${entries.length}`);
  console.log();

  let failed = 0;
  for (const [key, def] of entries) {
    const spinner = createSpinner(`Syncing ${colors.primary.bold(key)}…`);
    spinner.start();
    try {
      const result = await postJson<UpsertTemplateResponse>(
        conn,
        '/api/hub/capabilities/templates',
        {
          key,
          name: def.name,
          description: def.description,
          definition: def,
          workspaceId: opts.workspace,
          source: 'eve-sync',
        },
        'sync',
      );
      const verb = result.status ?? 'synced';
      spinner.succeed(`${key} ${verb} (v${result.version})`);
    } catch (err) {
      failed += 1;
      spinner.fail(`${key} failed`);
      printError(err instanceof Error ? err.message : String(err));
    }
  }

  console.log();
  if (failed === 0) {
    printSuccess(`Synced ${entries.length} template${entries.length === 1 ? '' : 's'} to the pod DB.`);
    printInfo('Apply one with `eve capabilities apply <key>` — it now resolves DB-first.');
  } else {
    printError(`${failed} of ${entries.length} templates failed to sync.`);
    printInfo('  • Hub key lacks hub-protocol.write scope → `eve auth renew --agent ' + agentType + '`');
    printInfo('  • Backend unreachable → `eve doctor`');
    process.exitCode = 1;
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function capabilitiesCommand(program: Command): void {
  const capabilities = program
    .command('capabilities')
    .description(`${emojis.sparkles} Apply capability templates (vault + tools + skills) through the Hub`);

  capabilities
    .command('apply')
    .description(
      'Seed a connector/capability headlessly via POST /api/hub/capabilities/apply. ' +
        '<template> is a backend template key (e.g. generic-apikey) or a path to a ' +
        'local *.json CapabilityDefinition.',
    )
    .argument('[template]', 'Backend template key or path to a *.json definition file')
    .option('--template <key>', 'Force backend-resolved template-key mode')
    .option('--param <key=value>', 'Provide a param non-interactively (repeatable)', (val: string, prev: string[]) => [...(prev ?? []), val], [] as string[])
    .option('--workspace <id>', 'Scope to a workspace (omit for pod-wide)')
    .option('--agent <slug>', 'Hub identity to act as. Defaults to "eve".')
    .action(async (template: string | undefined, opts: ApplyOptions) => {
      try {
        await runApply(template, opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  capabilities
    .command('list')
    .description('List the known backend capability seed templates.')
    .action(() => {
      try {
        runList();
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  capabilities
    .command('sync')
    .description(
      'Push the vendored seed CapabilityDefinitions into the pod DB ' +
        '(POST /api/hub/capabilities/templates) so a `templateKey` apply resolves ' +
        'DB-first on a deployed pod.',
    )
    .option('--workspace <id>', 'Scope the templates to a workspace (omit for pod-wide)')
    .option('--agent <slug>', 'Hub identity to act as. Defaults to "eve".')
    .option('--key <k>', 'Sync only this one template key')
    .action(async (opts: SyncOptions) => {
      try {
        await runSync(opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  // Bare `eve capabilities` → help.
  capabilities.action(() => {
    console.log();
    printHeader('Eve — Capabilities', '🧩');
    console.log();
    printInfo('Usage: eve capabilities <command>');
    console.log();
    printInfo('  apply <template>   Seed vault + tools + skills from a template (key or local file)');
    printInfo('  list               List known backend seed templates');
    printInfo('  sync               Push the vendored seed templates into the pod DB (templates-as-data)');
    console.log();
    printInfo('Examples:');
    printInfo('  eve capabilities apply generic-apikey --param apiKey=sk-… --param baseUrl=https://api.x.com/v1');
    printInfo('  eve capabilities apply ./my-connector.capability.json');
    printInfo('  eve capabilities sync');
    printInfo('  eve capabilities list');
    console.log();
  });
}
