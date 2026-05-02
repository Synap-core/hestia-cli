import { Command } from 'commander';
import { execa } from 'execa';
import { OllamaService } from '@eve/brain';
import { getGlobalCliFlags, outputJson } from '@eve/cli-kit';
import {
  readEveSecrets,
  writeEveSecrets,
  entityStateManager,
  wireAllInstalledComponents,
  type WireAiResult,
} from '@eve/dna';
import { colors, printError, printInfo, printSuccess, printWarning } from '../lib/ui.js';

type ProviderId = 'ollama' | 'openrouter' | 'anthropic' | 'openai';

function resolveHubBaseUrlFromSecrets(secrets: Awaited<ReturnType<typeof readEveSecrets>>): string | null {
  const explicit = secrets?.synap?.hubBaseUrl?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const api = secrets?.synap?.apiUrl?.trim();
  if (!api) return null;
  return `${api.replace(/\/$/, '')}/api/hub`;
}

function buildNonSecretProviderRouting(
  secrets: Awaited<ReturnType<typeof readEveSecrets>>,
): {
  mode?: 'local' | 'provider' | 'hybrid';
  defaultProvider?: ProviderId;
  fallbackProvider?: ProviderId;
  providers?: Array<{ id: ProviderId; enabled?: boolean; baseUrl?: string; defaultModel?: string }>;
  syncToSynap?: boolean;
} {
  const providers = (secrets?.ai?.providers ?? []).map((p) => ({
    id: p.id,
    enabled: p.enabled,
    baseUrl: p.baseUrl,
    defaultModel: p.defaultModel,
  }));
  return {
    mode: secrets?.ai?.mode,
    defaultProvider: secrets?.ai?.defaultProvider,
    fallbackProvider: secrets?.ai?.fallbackProvider,
    providers,
    syncToSynap: secrets?.ai?.syncToSynap,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function parseProviderId(s: string): ProviderId {
  const v = s.trim().toLowerCase();
  if (v === 'ollama' || v === 'openrouter' || v === 'anthropic' || v === 'openai') return v;
  throw new Error('Provider must be one of: ollama, openrouter, anthropic, openai');
}

/**
 * Re-wire every installed AI-consuming component from current secrets.
 * Used by `eve ai apply` and as a default after `eve ai providers add`.
 */
async function applyAiWiring(): Promise<WireAiResult[]> {
  const secrets = await readEveSecrets(process.cwd());
  let installed: string[] = [];
  try {
    installed = await entityStateManager.getInstalledComponents();
  } catch { /* state not initialized */ }

  if (installed.length === 0) {
    printWarning('No installed components — nothing to wire.');
    return [];
  }

  console.log();
  console.log(colors.primary.bold('Wiring AI provider into installed components:'));
  const results = wireAllInstalledComponents(secrets, installed);
  for (const r of results) {
    if (r.outcome === 'ok') {
      console.log(`  ${colors.success('✓')} ${r.id.padEnd(12)} ${colors.muted(r.summary)}`);
    } else if (r.outcome === 'skipped') {
      console.log(`  ${colors.muted('-')} ${r.id.padEnd(12)} ${colors.muted(r.summary)}`);
    } else {
      console.log(`  ${colors.error('✗')} ${r.id.padEnd(12)} ${colors.error(r.summary)}`);
      if (r.detail) console.log(`    ${colors.muted(r.detail)}`);
    }
  }
  return results;
}

export function aiCommandGroup(program: Command): void {
  const ai = program.command('ai').description('AI foundation helpers (local Ollama + provider routing)');

  ai
    .command('status')
    .description('Show AI foundation mode, provider routing, and Ollama status')
    .action(async () => {
      const ollama = new OllamaService();
      try {
        const s = await ollama.getStatus();
        const secrets = await readEveSecrets(process.cwd());
        const out = {
          ai: secrets?.ai ?? null,
          ollama: s,
        };
        if (getGlobalCliFlags().json) {
          outputJson(out);
          return;
        }
        console.log(colors.primary.bold('AI Foundation'));
        console.log(`  Mode: ${secrets?.ai?.mode ?? '(unset)'}`);
        console.log(`  Default provider: ${secrets?.ai?.defaultProvider ?? '(unset)'}`);
        console.log(`  Fallback provider: ${secrets?.ai?.fallbackProvider ?? '(unset)'}`);
        const providers = secrets?.ai?.providers ?? [];
        if (providers.length) {
          console.log('  Providers:');
          for (const p of providers) {
            console.log(`    - ${p.id} enabled=${p.enabled ?? true} model=${p.defaultModel ?? '(unset)'}`);
          }
        }
        console.log('');
        console.log(colors.primary.bold('Ollama'));
        console.log(`  Running: ${s.running ? 'yes' : 'no'}`);
        console.log(`  Models: ${s.modelsInstalled.length ? s.modelsInstalled.join(', ') : '(none)'}`);
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  const providers = ai.command('providers').description('Manage cloud/local provider entries in .eve/secrets/secrets.json');

  providers
    .command('list')
    .description('List configured providers')
    .action(async () => {
      const secrets = await readEveSecrets(process.cwd());
      const list = secrets?.ai?.providers ?? [];
      if (getGlobalCliFlags().json) {
        outputJson({ mode: secrets?.ai?.mode, defaultProvider: secrets?.ai?.defaultProvider, fallbackProvider: secrets?.ai?.fallbackProvider, providers: list });
        return;
      }
      if (!list.length) {
        console.log('No providers configured. Run `eve setup` or `eve ai providers add <id>`');
        return;
      }
      for (const p of list) {
        console.log(`${p.id}\tenabled=${p.enabled ?? true}\tmodel=${p.defaultModel ?? '(unset)'}`);
      }
    });

  providers
    .command('add <id>')
    .description('Add or update provider credentials/model — auto-wires every installed component')
    .option('--api-key <key>', 'Provider API key')
    .option('--base-url <url>', 'Custom provider base URL')
    .option('--model <name>', 'Default model name')
    .option('--disable', 'Set enabled=false')
    .option('--no-rewire', "Don't auto-rewire installed components after save")
    .action(async (id: string, opts: { apiKey?: string; baseUrl?: string; model?: string; disable?: boolean; rewire?: boolean }) => {
      try {
        const pid = parseProviderId(id);
        const secrets = await readEveSecrets(process.cwd());
        const list = [...(secrets?.ai?.providers ?? [])];
        const idx = list.findIndex((p) => p.id === pid);
        const next = {
          id: pid,
          enabled: opts.disable ? false : true,
          apiKey: opts.apiKey ?? list[idx]?.apiKey,
          baseUrl: opts.baseUrl ?? list[idx]?.baseUrl,
          defaultModel: opts.model ?? list[idx]?.defaultModel,
        };
        if (idx >= 0) list[idx] = next;
        else list.push(next);
        await writeEveSecrets({ ai: { providers: list } }, process.cwd());
        printSuccess(`Provider ${pid} saved.`);

        // Auto-rewire every installed component (default behavior)
        if (opts.rewire !== false) {
          await applyAiWiring();
        } else {
          printInfo('Run `eve ai apply` to push the new key to installed components.');
        }
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  providers
    .command('set-default <id>')
    .description('Set default provider')
    .action(async (id: string) => {
      try {
        const pid = parseProviderId(id);
        await writeEveSecrets({ ai: { defaultProvider: pid } }, process.cwd());
        printInfo(`Default provider set to ${pid}`);
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  providers
    .command('set-fallback <id>')
    .description('Set fallback provider')
    .action(async (id: string) => {
      try {
        const pid = parseProviderId(id);
        await writeEveSecrets({ ai: { fallbackProvider: pid } }, process.cwd());
        printInfo(`Fallback provider set to ${pid}`);
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  ai
    .command('apply')
    .description('Re-wire every installed component to use the current AI provider config')
    .action(async () => {
      try {
        await applyAiWiring();
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  ai
    .command('sync')
    .description('Explicitly sync Eve provider routing policy to Synap workspace settings')
    .requiredOption('--workspace <id>', 'Workspace UUID to update')
    .option('--check', 'Only compare local policy vs workspace policy; do not write')
    .action(async (opts: { workspace: string; check?: boolean }) => {
      try {
        const secrets = await readEveSecrets(process.cwd());
        const hubBaseUrl = resolveHubBaseUrlFromSecrets(secrets);
        const apiKey = secrets?.synap?.apiKey?.trim();
        if (!hubBaseUrl) {
          throw new Error('Missing synap.apiUrl/synap.hubBaseUrl in .eve/secrets/secrets.json');
        }
        if (!apiKey) {
          throw new Error('Missing synap.apiKey in .eve/secrets/secrets.json');
        }

        const payload = buildNonSecretProviderRouting(secrets);
        if (opts.check) {
          const getRes = await fetch(
            `${hubBaseUrl}/workspaces/${encodeURIComponent(opts.workspace)}/eve-provider-routing`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${apiKey}`,
              },
            },
          );
          const getData = (await getRes.json().catch(() => ({}))) as Record<string, unknown>;
          if (!getRes.ok) {
            throw new Error(String(getData.error ?? `Check failed with HTTP ${getRes.status}`));
          }
          const remote = (getData.eveProviderRouting ?? null) as unknown;
          const same = stableJson(remote) === stableJson(payload);
          if (getGlobalCliFlags().json) {
            outputJson({ ok: true, workspaceId: opts.workspace, same, local: payload, remote });
            return;
          }
          if (same) {
            printInfo(`Provider routing already in sync for workspace ${opts.workspace}`);
          } else {
            printInfo(`Provider routing differs for workspace ${opts.workspace}`);
          }
          return;
        }

        const res = await fetch(
          `${hubBaseUrl}/workspaces/${encodeURIComponent(opts.workspace)}/eve-provider-routing`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          },
        );
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          throw new Error(String(data.error ?? `Sync failed with HTTP ${res.status}`));
        }
        if (getGlobalCliFlags().json) {
          outputJson({ ok: true, workspaceId: opts.workspace, synced: payload });
          return;
        }
        printInfo(`Provider routing synced to workspace ${opts.workspace}`);
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  ai
    .command('models')
    .description('List models (docker exec ollama list)')
    .action(async () => {
      const ollama = new OllamaService();
      const models = await ollama.listModels();
      if (getGlobalCliFlags().json) {
        outputJson({ models });
        return;
      }
      for (const m of models) {
        console.log(`  ${m}`);
      }
      if (models.length === 0) {
        printInfo('No models or Ollama not running. Try: eve brain init --with-ai');
      }
    });

  ai
    .command('pull')
    .description('Pull a model into Ollama')
    .argument('<model>', 'Model tag e.g. llama3.1:8b')
    .action(async (model: string) => {
      const ollama = new OllamaService();
      try {
        await ollama.pullModel(model);
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  ai
    .command('chat')
    .description('Send a one-shot prompt to ollama run (requires container eve-brain-ollama)')
    .argument('<prompt>', 'Prompt text')
    .option('--model <m>', 'Model name', 'llama3.1:8b')
    .action(async (prompt: string, opts: { model?: string }) => {
      try {
        await execa(
          'docker',
          ['exec', '-i', 'eve-brain-ollama', 'ollama', 'run', opts.model ?? 'llama3.1:8b', prompt],
          { stdio: 'inherit' }
        );
      } catch (e) {
        printError(
          e instanceof Error
            ? e.message
            : 'Failed. Ensure container eve-brain-ollama is running (eve brain init --with-ai).'
        );
        process.exit(1);
      }
    });
}
