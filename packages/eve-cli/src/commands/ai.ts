import { Command } from 'commander';
import { execa } from 'execa';
import { OllamaService, ModelService } from '@eve/brain';
import { getGlobalCliFlags, outputJson } from '@eve/cli-kit';
import {
  readEveSecrets,
  writeEveSecrets,
  entityStateManager,
  wireAllInstalledComponents,
  resolveHubBaseUrl,
  AI_CONSUMERS_NEEDING_RECREATE,
  type WireAiResult,
} from '@eve/dna';
import { runActionToCompletion } from '@eve/lifecycle';
import { colors, printError, printInfo, printSuccess, printWarning } from '../lib/ui.js';

type ProviderId = 'ollama' | 'openrouter' | 'anthropic' | 'openai';

function buildNonSecretProviderRouting(
  secrets: Awaited<ReturnType<typeof readEveSecrets>>,
): {
  mode?: 'local' | 'provider' | 'hybrid';
  defaultProvider?: string;
  fallbackProvider?: string;
  providers?: Array<{ id: string; enabled?: boolean; baseUrl?: string; defaultModel?: string; models?: string[] }>;
} {
  const providers = (secrets?.ai?.providers ?? []).map((p) => ({
    id: p.id,
    enabled: p.enabled,
    baseUrl: p.baseUrl,
    defaultModel: p.defaultModel,
    models: p.models,
  }));
  return {
    mode: secrets?.ai?.mode,
    defaultProvider: secrets?.ai?.defaultProvider,
    fallbackProvider: secrets?.ai?.fallbackProvider,
    providers,
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

  // For components whose env is set at `docker run` time (openclaw),
  // wire-only restart leaves the env stale. Recreate via lifecycle so
  // the new DEFAULT_MODEL etc. actually land. Mirrors the dashboard's
  // /api/ai/apply route — same single source of truth.
  for (const id of AI_CONSUMERS_NEEDING_RECREATE) {
    if (!installed.includes(id)) continue;
    const r = await runActionToCompletion(id, 'recreate');
    const recreated: WireAiResult = {
      id,
      outcome: r.ok ? 'ok' : 'failed',
      summary: r.ok
        ? `${id} recreated · new env applied`
        : `${id} recreate failed: ${r.error ?? 'unknown'}`,
    };
    const idx = results.findIndex(x => x.id === id);
    if (idx >= 0) results[idx] = recreated;
    else results.push(recreated);
  }

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
      const modelService = new ModelService();
      try {
        const secrets = await readEveSecrets(process.cwd());
        const providers = secrets?.ai?.providers ?? [];

        // Quick status for each component
        const ollamaRunning = await modelService.isOllamaRunning();
        const hermesRunning = await modelService.isHermesRunning();
        const ollamaModels = ollamaRunning ? await modelService.listOllamaModels() : [];
        const hermesModels = hermesRunning ? await modelService.listHermesModels() : [];

        const out = {
          ai: secrets?.ai ?? null,
          ollama: { running: ollamaRunning, modelsInstalled: ollamaModels },
          hermes: { running: hermesRunning, models: hermesModels },
          cloudProviders: providers.filter(p => p.apiKey).map(p => ({
            id: p.id,
            hasKey: true,
            models: p.models ?? [],
          })),
        };
        if (getGlobalCliFlags().json) {
          outputJson(out);
          return;
        }

        console.log(colors.primary.bold('AI Foundation'));
        console.log(`  Mode: ${secrets?.ai?.mode ?? '(unset)'}`);
        console.log(`  Default provider: ${secrets?.ai?.defaultProvider ?? '(unset)'}`);
        console.log(`  Fallback provider: ${secrets?.ai?.fallbackProvider ?? '(unset)'}`);
        if (providers.length) {
          console.log('  Providers:');
          for (const p of providers) {
            console.log(`    - ${p.id} enabled=${p.enabled ?? true} model=${p.defaultModel ?? '(unset)'}${p.models?.length ? ` models=${p.models.length} discovered` : ''}`);
          }
        }

        console.log();
        console.log(colors.primary.bold('Local Models'));
        console.log(`  Ollama: ${ollamaRunning ? 'running' : 'stopped'}${ollamaModels.length ? ' · ' + ollamaModels.join(', ') : ''}`);
        console.log(`  Hermes: ${hermesRunning ? 'running' : 'stopped'}${hermesModels.length ? ' · ' + hermesModels.join(', ') : ''}`);

        const cloudProviders = providers.filter(p => p.apiKey);
        if (cloudProviders.length) {
          console.log();
          console.log(colors.primary.bold('Cloud Providers'));
          for (const p of cloudProviders) {
            console.log(`    - ${p.id} (${p.baseUrl ?? 'default url'})${p.models?.length ? ` · ${p.models.length} models cached` : ' · (run \`eve ai models\` to discover)'}`);
          }
        }
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

  // Sensible model defaults so flag-only `eve ai providers add anthropic --api-key X` still works.
  const DEFAULT_MODELS: Record<ProviderId, string> = {
    anthropic: 'claude-sonnet-4-7',
    openai: 'gpt-5',
    openrouter: 'anthropic/claude-sonnet-4-7', // OpenRouter requires a model — this is just a starter
    ollama: 'llama3.1:8b',
  };

  providers
    .command('add <id>')
    .description('Add or update provider credentials/model — auto-wires every installed component')
    .option('--api-key <key>', 'Provider API key (required for cloud providers)')
    .option('--base-url <url>', 'Custom provider base URL')
    .option('--model <name>', 'Default model (required for openrouter; defaults to the latest for other providers)')
    .option('--disable', 'Set enabled=false')
    .option('--no-rewire', "Don't auto-rewire installed components after save")
    .action(async (id: string, opts: { apiKey?: string; baseUrl?: string; model?: string; disable?: boolean; rewire?: boolean }) => {
      try {
        const pid = parseProviderId(id);
        const secrets = await readEveSecrets(process.cwd());
        const list = [...(secrets?.ai?.providers ?? [])];
        const idx = list.findIndex((p) => p.id === pid);

        // Resolve final model: explicit --model wins, then existing, then sensible default
        const resolvedModel = opts.model ?? list[idx]?.defaultModel ?? DEFAULT_MODELS[pid];

        // OpenRouter without an explicit model is rarely what the user wants — warn
        if (pid === 'openrouter' && !opts.model && !list[idx]?.defaultModel) {
          printWarning(`OpenRouter has no useful default — using "${resolvedModel}" as a starter.`);
          printInfo('  Override with: --model <provider>/<model> (e.g. --model openai/gpt-5)');
        }

        const next = {
          id: pid,
          enabled: opts.disable ? false : true,
          apiKey: opts.apiKey ?? list[idx]?.apiKey,
          baseUrl: opts.baseUrl ?? list[idx]?.baseUrl,
          defaultModel: resolvedModel,
        };
        if (idx >= 0) list[idx] = next;
        else list.push(next);
        await writeEveSecrets({ ai: { providers: list } }, process.cwd());
        printSuccess(`Provider ${pid} saved (model: ${resolvedModel}).`);

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
    .description('Set default provider (auto-applies to installed components)')
    .option('--no-rewire', 'Skip auto-applying to installed components')
    .action(async (id: string, opts: { rewire?: boolean }) => {
      try {
        const pid = parseProviderId(id);
        await writeEveSecrets({ ai: { defaultProvider: pid } }, process.cwd());
        printInfo(`Default provider set to ${pid}`);
        if (opts.rewire !== false) {
          await applyAiWiring();
        }
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  providers
    .command('set-fallback <id>')
    .description('Set fallback provider (auto-applies to installed components)')
    .option('--no-rewire', 'Skip auto-applying to installed components')
    .action(async (id: string, opts: { rewire?: boolean }) => {
      try {
        const pid = parseProviderId(id);
        await writeEveSecrets({ ai: { fallbackProvider: pid } }, process.cwd());
        printInfo(`Fallback provider set to ${pid}`);
        if (opts.rewire !== false) {
          await applyAiWiring();
        }
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  providers
    .command('set-service <componentId> <providerId>')
    .description('Override which provider a specific service uses (e.g. set-service openclaw anthropic). Pass "default" to clear.')
    .option('--no-rewire', 'Skip auto-applying to installed components')
    .action(async (componentId: string, providerId: string, opts: { rewire?: boolean }) => {
      try {
        const secrets = await readEveSecrets(process.cwd());
        const current = secrets?.ai?.serviceProviders ?? {};
        const next = { ...current };

        if (providerId === 'default' || providerId === 'clear') {
          delete next[componentId];
          printInfo(`Cleared service override for ${componentId} (now uses global default)`);
        } else {
          const pid = parseProviderId(providerId);
          next[componentId] = pid;
          printInfo(`${componentId} now routes via ${pid}`);
        }

        await writeEveSecrets(
          { ai: { serviceProviders: next } },
          process.cwd(),
        );
        if (opts.rewire !== false) {
          await applyAiWiring();
        }
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
        const hubBaseUrl = resolveHubBaseUrl(secrets ?? null);
        // `eve ai sync` writes workspace settings on the pod — admin-style
        // call. Use the eve agent's key (Doctor's identity) so the audit
        // trail attributes back to Eve, not to a specific consumer agent.
        const apiKey =
          secrets?.agents?.eve?.hubApiKey?.trim() ??
          secrets?.synap?.apiKey?.trim();
        if (!hubBaseUrl) {
          throw new Error('Cannot resolve Synap pod URL — set domain.primary or synap.apiUrl in .eve/secrets/secrets.json');
        }
        if (!apiKey) {
          throw new Error('Missing eve agent key — run `eve auth provision`');
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
    .description('List models from all providers (Ollama, Hermes, cloud)')
    .action(async () => {
      const modelService = new ModelService();
      const secrets = await readEveSecrets(process.cwd());
      const providers = secrets?.ai?.providers ?? [];
      const hermesApiKey = secrets?.builder?.hermes?.apiServerKey;
      const discovered = await modelService.discoverAll(
        providers.map(p => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          defaultModel: p.defaultModel,
          models: p.models,
        })),
        hermesApiKey,
      );

      if (getGlobalCliFlags().json) {
        outputJson({ providers: discovered });
        return;
      }

      if (discovered.length === 0) {
        printInfo('No models found. Run `eve brain init --with-ai` for local Ollama, or add a cloud provider with `eve ai providers add`.');
        return;
      }

      for (const group of discovered) {
        console.log();
        if (group.available) {
          console.log(colors.primary.bold(`── ${group.displayName} ──`));
        } else if (group.models.length > 0) {
          // Cached models from previous discovery (no current baseUrl/apiKey)
          console.log(colors.primary.bold(`── ${group.displayName} ──`));
          console.log(colors.muted(`  (cached) ${group.models.length} model(s) from previous discovery`));
          for (const m of group.models) {
            const marker = m.isDefault ? colors.brain(' *') : '';
            console.log(`  ${m.name}${marker}`);
          }
          continue;
        } else {
          console.log(colors.primary.bold(`── ${group.displayName} ──`));
          console.log(colors.muted(`  (unreachable)`));
          console.log(`  (no models discovered)`);
        }
      }

      console.log();
      console.log(colors.muted('  * = first model discovered (serves as default when no explicit default is set)'));
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
