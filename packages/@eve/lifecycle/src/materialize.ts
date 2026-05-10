import {
  AI_CONSUMERS,
  appendOperationalEvent,
  findPodDeployDir,
  readEveSecrets,
  resolveSynapUrl,
  wireAllInstalledComponents,
  writeHermesEnvFile,
  type EveSecrets,
  type MaterializerTarget,
} from '@eve/dna';
import { refreshTraefikRoutes } from '@eve/legs';
import { writeEnvVar } from './env-files.js';

export interface MaterializeOptions {
  cwd?: string;
  components?: string[];
  dryRun?: boolean;
}

export interface MaterializeResult {
  target: MaterializerTarget;
  ok: boolean;
  changed: boolean;
  summary: string;
  error?: string;
  details?: Record<string, unknown>;
}

function uniqueTargets(targets: MaterializerTarget[]): MaterializerTarget[] {
  return Array.from(new Set(targets));
}

async function record(
  type: 'materialize.started' | 'materialize.succeeded' | 'materialize.failed',
  target: MaterializerTarget,
  data: Partial<MaterializeResult> = {},
): Promise<void> {
  await appendOperationalEvent({
    type,
    target,
    ok: data.ok,
    summary: data.summary,
    error: data.error,
    details: data.details,
  }).catch(() => {});
}

export async function materializeTargets(
  secrets: EveSecrets | null,
  targets: MaterializerTarget[],
  options: MaterializeOptions = {},
): Promise<MaterializeResult[]> {
  const out: MaterializeResult[] = [];
  const resolvedSecrets = secrets ?? await readEveSecrets(options.cwd ?? process.cwd());

  for (const target of uniqueTargets(targets)) {
    await record('materialize.started', target, { summary: `Materializing ${target}` });

    try {
      if (options.dryRun) {
        const result = { target, ok: true, changed: false, summary: `Dry run: ${target}` };
        out.push(result);
        await record('materialize.succeeded', target, result);
        continue;
      }

      let result: MaterializeResult;
      switch (target) {
        case 'backend-env': {
          const deployDir = findPodDeployDir();
          if (!deployDir) {
            result = { target, ok: false, changed: false, summary: 'Synap deploy dir not found', error: 'deploy-dir-missing' };
            break;
          }
          const domain = resolvedSecrets?.domain?.primary?.trim();
          const publicUrl = resolveSynapUrl(resolvedSecrets);
          const domainResult = domain ? writeEnvVar(deployDir, 'DOMAIN', domain) : { changed: false, previous: null };
          const publicUrlResult = publicUrl ? writeEnvVar(deployDir, 'PUBLIC_URL', publicUrl) : { changed: false, previous: null };
          result = {
            target,
            ok: true,
            changed: domainResult.changed || publicUrlResult.changed,
            summary: 'Backend env synchronized',
            details: { deployDir, domainChanged: domainResult.changed, publicUrlChanged: publicUrlResult.changed },
          };
          break;
        }

        case 'traefik-routes': {
          const refresh = await refreshTraefikRoutes(options.cwd);
          const ok = refresh.refreshed || refresh.reason === 'no domain configured';
          result = {
            target,
            ok,
            changed: refresh.refreshed,
            summary: refresh.refreshed
              ? `Traefik routes refreshed for ${refresh.domain}`
              : refresh.reason ?? 'Traefik routes unchanged',
            error: ok ? undefined : refresh.reason,
            details: { domain: refresh.domain },
          };
          break;
        }

        case 'hermes-env': {
          const path = await writeHermesEnvFile(options.cwd ?? process.cwd());
          result = { target, ok: true, changed: true, summary: 'Hermes env file written', details: { path } };
          break;
        }

        case 'openclaw-config': {
          const results = await wireAllInstalledComponents(resolvedSecrets, ['openclaw']);
          const failed = results.filter((r) => r.outcome === 'failed');
          result = {
            target,
            ok: failed.length === 0,
            changed: true,
            summary: failed.length === 0 ? 'OpenClaw config wired' : failed.map((r) => r.summary).join('; '),
            error: failed.length === 0 ? undefined : 'openclaw-config-failed',
            details: { results },
          };
          break;
        }

        case 'openwebui-config': {
          const components = ['openwebui'];
          const results = await wireAllInstalledComponents(resolvedSecrets, components);
          const failed = results.filter((r) => r.outcome === 'failed');
          result = {
            target,
            ok: failed.length === 0,
            changed: true,
            summary: failed.length === 0 ? 'Open WebUI config wired' : failed.map((r) => r.summary).join('; '),
            error: failed.length === 0 ? undefined : 'openwebui-config-failed',
            details: { results },
          };
          break;
        }

        case 'ai-wiring': {
          const components = options.components ?? Array.from(AI_CONSUMERS);
          const results = await wireAllInstalledComponents(resolvedSecrets, components);
          const failed = results.filter((r) => r.outcome === 'failed');
          result = {
            target,
            ok: failed.length === 0,
            changed: true,
            summary: failed.length === 0 ? 'AI wiring applied' : failed.map((r) => r.summary).join('; '),
            error: failed.length === 0 ? undefined : 'ai-wiring-failed',
            details: { results },
          };
          break;
        }
      }

      out.push(result);
      await record(result.ok ? 'materialize.succeeded' : 'materialize.failed', target, result);
    } catch (error) {
      const result: MaterializeResult = {
        target,
        ok: false,
        changed: false,
        summary: `${target} failed`,
        error: error instanceof Error ? error.message : String(error),
      };
      out.push(result);
      await record('materialize.failed', target, result);
    }
  }

  return out;
}
