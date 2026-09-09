/**
 * `eve brain providers` — manage AI provider configs stored on the pod.
 *
 * The pod backend is the source of truth; every mutating call triggers a
 * server-side sync to the active IS (Intelligence Service) so providers
 * hot-reload without restarting anything.
 *
 * Auth: uses the `eve` agent's Hub Protocol API key, same as `eve intent`.
 * tRPC calls use the batch HTTP protocol over the pod's `/trpc` endpoint.
 */

import type { Command } from 'commander';
import Table from 'cli-table3';
import {
  readEveSecrets,
  resolveSynapUrlOnHost,
  readAgentKeyOrLegacy,
  upsertPodProvider,
  setPodProviderEnabled,
  describePodProviderResult,
} from '@eve/dna';

// ── Hub Protocol REST helpers ─────────────────────────────────────────────────

async function hubGet<T>(podUrl: string, apiKey: string, path: string): Promise<T> {
  const res = await fetch(`${podUrl.replace(/\/$/, '')}/api/hub/${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Pod responded ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function hubPost<T>(podUrl: string, apiKey: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${podUrl.replace(/\/$/, '')}/api/hub/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Pod responded ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function hubDelete<T>(podUrl: string, apiKey: string, path: string): Promise<T> {
  const res = await fetch(`${podUrl.replace(/\/$/, '')}/api/hub/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Pod responded ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Auth resolution ──────────────────────────────────────────────────────────

async function resolveAuth(cwd: string): Promise<{ podUrl: string; apiKey: string }> {
  const secrets = await readEveSecrets(cwd);
  // ON-HOST resolver. `resolveSynapUrl` is the pure/off-host derivation whose
  // own docblock directs CLI runtime here: it returns the public
  // `https://pod.<domain>` (or a STALE stored `synap.apiUrl`, which is how this
  // command ended up POSTing to a host from a previous deployment and getting a
  // 404). `resolveSynapUrlOnHost` probes the loopback Eve publishes first.
  //
  // `||`, not `??`: resolveSynapUrl returns '' — not null — when nothing is
  // configured, and `'' ?? x` is `''`, so the env fallback could never fire.
  const podUrl = (await resolveSynapUrlOnHost(secrets)) || process.env.SYNAP_POD_URL;
  if (!podUrl) throw new Error('Pod URL not configured. Run `eve setup` first.');

  // Resolution order: per-agent key → legacy synap.apiKey → SYNAP_HUB_API_KEY env var
  const apiKey = (await readAgentKeyOrLegacy('eve', cwd)) || process.env.SYNAP_HUB_API_KEY || '';
  if (!apiKey) throw new Error('Eve agent API key not configured. Run `eve setup` or `eve auth` first, or set SYNAP_HUB_API_KEY.');

  return { podUrl, apiKey };
}

// ── Provider row type (list response) ────────────────────────────────────────

interface ProviderRow {
  id: string;
  providerId: string;
  name: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  hasApiKey: boolean;
  enabled: boolean;
  priority: number;
  tags: string[];
  models: Array<{ id: string; tier?: string }>;
  createdAt: string;
  updatedAt: string;
}

// ── Command registration ─────────────────────────────────────────────────────

export function providersCommand(brain: Command): void {
  const providers = brain
    .command('providers')
    .description('Manage AI provider configs on the pod (synced to IS on change)');

  // ── list ──────────────────────────────────────────────────────────────────

  providers
    .command('list')
    .description('List all providers registered on the pod')
    .option('--json', 'Output raw JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const { podUrl, apiKey } = await resolveAuth(process.env.EVE_HOME ?? process.cwd());
        const { providers: rows } = await hubGet<{ providers: ProviderRow[] }>(podUrl, apiKey, 'ai-providers');

        if (opts.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }

        if (rows.length === 0) {
          console.log('No providers configured. Use `eve brain providers add` to register one.');
          return;
        }

        const table = new Table({
          head: ['ID', 'Name', 'Base URL', 'Priority', 'Enabled', 'Key', 'Models'],
          style: { head: ['cyan'] },
        });

        for (const p of rows.sort((a, b) => a.priority - b.priority)) {
          table.push([
            p.providerId,
            p.name,
            p.baseUrl.replace(/^https?:\/\//, ''),
            String(p.priority),
            p.enabled ? '✓' : '—',
            p.hasApiKey ? '●' : '○',
            p.models.length > 0
              ? p.models.slice(0, 3).map(m => m.id).join(', ') + (p.models.length > 3 ? '…' : '')
              : '—',
          ]);
        }

        console.log(table.toString());
        console.log(`\n● = API key stored  ○ = no key (uses env var ${rows[0]?.apiKeyEnvVar ?? ''})`);
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });

  // ── add / update (upsert) ─────────────────────────────────────────────────

  // Well-known provider defaults so `eve brain providers add openrouter --key X` works.
  const KNOWN_PROVIDERS: Record<string, {
    name: string; url: string; envVar: string; priority: number;
    models: Array<{ id: string; tier: string; contextWindow?: number }>;
  }> = {
    openrouter: {
      name: 'OpenRouter', url: 'https://openrouter.ai/api/v1',
      envVar: 'OPENROUTER_API_KEY', priority: 10,
      models: [
        { id: 'deepseek/deepseek-v4-flash:free', tier: 'balanced', contextWindow: 1_000_000 },
        { id: 'deepseek/deepseek-v4-flash:free', tier: 'free', contextWindow: 1_000_000 },
        { id: 'nvidia/nemotron-3-super-120b-a12b:free', tier: 'advanced', contextWindow: 1_000_000 },
        { id: 'openai/gpt-oss-20b:free', tier: 'complex', contextWindow: 131_072 },
      ],
    },
    groq: {
      name: 'Groq', url: 'https://api.groq.com/openai/v1',
      envVar: 'GROQ_API_KEY', priority: 20,
      models: [{ id: 'llama-3.3-70b-versatile', tier: 'balanced' }],
    },
    cerebras: {
      name: 'Cerebras', url: 'https://api.cerebras.ai/v1',
      envVar: 'CEREBRAS_API_KEY', priority: 30,
      models: [{ id: 'llama3.1-70b', tier: 'balanced' }],
    },
    anthropic: {
      name: 'Anthropic', url: 'https://api.anthropic.com/v1',
      envVar: 'ANTHROPIC_API_KEY', priority: 40,
      models: [
        { id: 'claude-sonnet-4-6', tier: 'balanced' },
        { id: 'claude-opus-4-8', tier: 'advanced' },
      ],
    },
  };

  providers
    .command('add [providerId]')
    .description('Add or update a provider on the pod. Known providers (openrouter, groq, cerebras, anthropic) have sensible defaults.')
    .option('--id <providerId>', 'Provider ID (overrides positional arg)')
    .option('--name <name>', 'Display name (defaults filled for known providers)')
    .option('--url <baseUrl>', 'OpenAI-compatible base URL (defaults filled for known providers)')
    .option('--env-var <apiKeyEnvVar>', 'Env var name for the API key on the IS')
    .option('--key <apiKey>', 'API key (alias for --api-key)')
    .option('--api-key <apiKey>', 'API key (encrypted and stored on pod, sent inline to IS)')
    .option('--priority <n>', 'Routing priority (lower = higher)')
    .option('--disable', 'Add in disabled state')
    .action(async (positionalId: string | undefined, opts: {
      id?: string;
      name?: string;
      url?: string;
      envVar?: string;
      key?: string;
      apiKey?: string;
      priority?: string;
      disable?: boolean;
    }) => {
      try {
        const id = opts.id ?? positionalId;
        if (!id) {
          console.error('Error: provider ID required — pass as positional arg or --id');
          console.error('Example: eve brain providers add openrouter --key <api-key>');
          process.exit(1);
        }

        const defaults = KNOWN_PROVIDERS[id];
        const name = opts.name ?? defaults?.name ?? id;
        const url = opts.url ?? defaults?.url;
        if (!url) {
          console.error(`Error: --url required for unknown provider "${id}"`);
          process.exit(1);
        }

        const { podUrl, apiKey } = await resolveAuth(process.env.EVE_HOME ?? process.cwd());

        // Via the shared client, NOT a raw hubPost: a governed write returns
        // 202 `{status:"proposed"}` with nothing written, and the old code
        // printed "saved and synced to IS" for it — a confident lie about a
        // provider the pod does not yet have.
        const result = await upsertPodProvider(podUrl, apiKey, {
          providerId: id,
          name,
          baseUrl: url,
          apiKeyEnvVar: opts.envVar ?? defaults?.envVar ?? 'PROVIDER_API_KEY',
          ...(opts.key || opts.apiKey ? { apiKey: opts.key ?? opts.apiKey } : {}),
          priority: opts.priority ? parseInt(opts.priority, 10) : (defaults?.priority ?? 10),
          enabled: !opts.disable,
          ...(defaults?.models ? { models: defaults.models as never } : {}),
        });

        console.log(describePodProviderResult(result));
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });

  // ── enable / disable ──────────────────────────────────────────────────────

  providers
    .command('enable <providerId>')
    .description('Enable a provider and sync to IS')
    .action(async (providerId: string) => {
      try {
        const { podUrl, apiKey } = await resolveAuth(process.env.EVE_HOME ?? process.cwd());
        console.log(
          describePodProviderResult(
            await setPodProviderEnabled(podUrl, apiKey, providerId, true)
          )
        );
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });

  providers
    .command('disable <providerId>')
    .description('Disable a provider and sync to IS')
    .action(async (providerId: string) => {
      try {
        const { podUrl, apiKey } = await resolveAuth(process.env.EVE_HOME ?? process.cwd());
        console.log(
          describePodProviderResult(
            await setPodProviderEnabled(podUrl, apiKey, providerId, false)
          )
        );
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });

  // ── remove ────────────────────────────────────────────────────────────────

  providers
    .command('remove <providerId>')
    .description('Remove a provider from the pod and sync to IS')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (providerId: string, opts: { yes?: boolean }) => {
      try {
        if (!opts.yes) {
          const readline = await import('node:readline');
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const confirmed = await new Promise<boolean>((resolve) => {
            rl.question(`Remove provider "${providerId}"? (y/N) `, (answer) => {
              rl.close();
              resolve(answer.toLowerCase() === 'y');
            });
          });
          if (!confirmed) { console.log('Aborted.'); return; }
        }

        const { podUrl, apiKey } = await resolveAuth(process.env.EVE_HOME ?? process.cwd());
        await hubDelete(podUrl, apiKey, `ai-providers/${providerId}`);
        console.log(`✓ Provider "${providerId}" removed.`);
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });

  // ── test (probe) ──────────────────────────────────────────────────────────

  providers
    .command('test <providerId>')
    .description('Probe a provider via the IS (live connectivity test)')
    .action(async (providerId: string) => {
      try {
        const { podUrl, apiKey } = await resolveAuth(process.env.EVE_HOME ?? process.cwd());
        console.log(`Probing "${providerId}" via IS…`);

        const result = await hubPost<{
          ok: boolean;
          models: string[];
          latencyMs: number;
          error?: string;
        }>(podUrl, apiKey, `ai-providers/${providerId}/probe`);

        if (result.ok) {
          console.log(`✓ Reachable (${result.latencyMs}ms) — ${result.models.length} models`);
          if (result.models.length > 0) {
            console.log('  ' + result.models.slice(0, 10).join('\n  '));
            if (result.models.length > 10) console.log(`  … and ${result.models.length - 10} more`);
          }
        } else {
          console.error(`✗ Probe failed: ${result.error ?? 'unknown error'}`);
          process.exit(1);
        }
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });

  // ── sync (re-push all providers to IS) ────────────────────────────────────

  providers
    .command('sync')
    .description('Re-push all providers from the pod to the IS (safe after IS redeploy)')
    .action(async () => {
      try {
        const { podUrl, apiKey } = await resolveAuth(process.env.EVE_HOME ?? process.cwd());
        const result = await hubPost<{ ok: boolean; count: number }>(podUrl, apiKey, 'ai-providers/sync');
        console.log(`✓ Synced ${result.count} provider(s) to IS.`);
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });
}
