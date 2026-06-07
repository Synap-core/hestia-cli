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
import { readEveSecrets, resolveSynapUrl, readAgentKeyOrLegacy } from '@eve/dna';

// ── tRPC batch HTTP helpers ──────────────────────────────────────────────────

interface TrpcBatchResult<T> {
  result: { data: { json: T } };
}

async function trpcQuery<T>(
  podUrl: string,
  apiKey: string,
  path: string,
  input?: unknown,
): Promise<T> {
  const base = podUrl.replace(/\/$/, '');
  const inputParam = input !== undefined
    ? encodeURIComponent(JSON.stringify({ '0': { json: input } }))
    : encodeURIComponent(JSON.stringify({ '0': { json: null } }));
  const url = `${base}/trpc/${path}?batch=1&input=${inputParam}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Pod responded ${res.status}: ${text}`);
  }

  const data: TrpcBatchResult<T>[] = await res.json();
  return data[0].result.data.json;
}

async function trpcMutation<T>(
  podUrl: string,
  apiKey: string,
  path: string,
  input?: unknown,
): Promise<T> {
  const base = podUrl.replace(/\/$/, '');
  const url = `${base}/trpc/${path}?batch=1`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ '0': { json: input ?? null } }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Pod responded ${res.status}: ${text}`);
  }

  const data: TrpcBatchResult<T>[] = await res.json();
  return data[0].result.data.json;
}

// ── Auth resolution ──────────────────────────────────────────────────────────

async function resolveAuth(cwd: string): Promise<{ podUrl: string; apiKey: string }> {
  const secrets = await readEveSecrets(cwd);
  const podUrl = resolveSynapUrl(secrets);
  if (!podUrl) throw new Error('Pod URL not configured. Run `eve setup` first.');

  const apiKey = await readAgentKeyOrLegacy('eve', cwd);
  if (!apiKey) throw new Error('Eve agent API key not configured. Run `eve setup` or `eve auth` first.');

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
        const rows = await trpcQuery<ProviderRow[]>(podUrl, apiKey, 'aiProviders.list');

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

  providers
    .command('add')
    .description('Add or update a provider on the pod (upsert by --id)')
    .requiredOption('--id <providerId>', 'Provider ID (e.g. "openrouter", "qwen-local")')
    .requiredOption('--name <name>', 'Display name')
    .requiredOption('--url <baseUrl>', 'OpenAI-compatible base URL')
    .option('--env-var <apiKeyEnvVar>', 'Env var name for the API key on the IS', 'PROVIDER_API_KEY')
    .option('--api-key <apiKey>', 'API key (encrypted and stored on pod, sent inline to IS)')
    .option('--priority <n>', 'Routing priority (lower = higher)', '10')
    .option('--disable', 'Add in disabled state')
    .action(async (opts: {
      id: string;
      name: string;
      url: string;
      envVar: string;
      apiKey?: string;
      priority: string;
      disable?: boolean;
    }) => {
      try {
        const { podUrl, apiKey } = await resolveAuth(process.env.EVE_HOME ?? process.cwd());

        const result = await trpcMutation<ProviderRow>(podUrl, apiKey, 'aiProviders.upsert', {
          providerId: opts.id,
          name: opts.name,
          baseUrl: opts.url,
          apiKeyEnvVar: opts.envVar,
          ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
          priority: parseInt(opts.priority, 10),
          enabled: !opts.disable,
        });

        console.log(`✓ Provider "${result.providerId}" saved and synced to IS.`);
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
        await trpcMutation(podUrl, apiKey, 'aiProviders.enable', { providerId });
        console.log(`✓ Provider "${providerId}" enabled.`);
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
        await trpcMutation(podUrl, apiKey, 'aiProviders.disable', { providerId });
        console.log(`✓ Provider "${providerId}" disabled.`);
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
        await trpcMutation(podUrl, apiKey, 'aiProviders.remove', { providerId });
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

        const result = await trpcMutation<{
          ok: boolean;
          models: string[];
          latencyMs: number;
          error?: string;
        }>(podUrl, apiKey, 'aiProviders.probe', { providerId });

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
        const result = await trpcMutation<{ ok: boolean; count: number }>(
          podUrl, apiKey, 'aiProviders.sync',
        );
        console.log(`✓ Synced ${result.count} provider(s) to IS.`);
      } catch (err) {
        console.error('Error:', String(err));
        process.exit(1);
      }
    });
}
