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
import { synapConfigSet, toPodFqdn } from '@eve/brain';

export interface MaterializeOptions {
  cwd?: string;
  components?: string[];
  dryRun?: boolean;
  /** `traefik-routes`: the caller is changing the primary domain on purpose (see RefreshOptions). */
  allowDomainChange?: boolean;
  /** `traefik-routes`: never change which hostnames are public — an update (see RefreshOptions). */
  keepPublicHosts?: boolean;
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
  // Let readEveSecrets apply its own default (EVE_HOME || cwd) — see the note
  // in refresh-routes.ts. Hardcoding process.cwd() here made every materializer
  // silently no-op when eve was invoked from outside the Eve home.
  const resolvedSecrets = secrets ?? await readEveSecrets(options.cwd);

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
          const entries: Record<string, string> = {};
          // DOMAIN is the pod FQDN (pod.<root>) — the same value the synap
          // delegate heals to. Writing the bare root here made the two eve
          // writers overwrite each other on every run.
          if (domain) entries.DOMAIN = toPodFqdn(domain);
          if (publicUrl) entries.PUBLIC_URL = publicUrl;
          // HERMES_TRIGGER_URL / HERMES_TRIGGER_KEY are no longer written: no
          // container sees them (synap-backend's docker-compose.yml does not
          // pass them, and compose passes only the keys it names) and no
          // backend code reads them. The pod's validated config door refuses
          // keys nothing consumes.
          // T3 Code executor — used by the DevPlane pipeline for code phases.
          const t3codeUrl = resolvedSecrets?.builder?.t3code?.url;
          const t3codeApiKey = resolvedSecrets?.builder?.t3code?.apiKey;
          if (t3codeUrl) entries.T3CODE_URL = t3codeUrl;
          if (t3codeApiKey) entries.T3CODE_API_KEY = t3codeApiKey;
          // Through the pod's ONE .env writer (validated, atomic, backed up).
          const written = synapConfigSet(entries, { deployDir });
          result = written.ok
            ? {
                target,
                ok: true,
                changed: written.changed.length > 0,
                summary: 'Backend env synchronized',
                details: { deployDir, changedKeys: written.changed },
              }
            : {
                target,
                ok: false,
                changed: false,
                summary: 'synap config refused the backend env',
                error: (written.stderr || written.stdout).trim(),
              };
          break;
        }

        case 'traefik-routes': {
          const refresh = await refreshTraefikRoutes(options.cwd, {
            allowDomainChange: options.allowDomainChange,
            keepPublicHosts: options.keepPublicHosts,
          });
          const notExposed = refresh.notExposed?.length
            ? `; not exposed: ${refresh.notExposed.join(', ')} — run \`eve domain apply\` to publish them`
            : '';
          // "no domain configured" is NOT a success. It is the single most
          // likely reason a freshly added component is unreachable by URL, and
          // reporting ok+unchanged made it invisible: the caller prints nothing
          // for `!changed && ok`, so the component silently never got a route.
          // Distinguishing "nothing to do" from "did nothing" is the whole point.
          const ok = refresh.refreshed;
          result = {
            target,
            ok,
            changed: refresh.refreshed,
            summary: refresh.refreshed
              ? refresh.changed === false
                ? `Traefik routes already current for ${refresh.domain}${notExposed}`
                : `Traefik routes refreshed for ${refresh.domain}${notExposed}`
              : refresh.reason ?? 'Traefik routes unchanged',
            error: ok ? undefined : refresh.reason,
            details: {
              domain: refresh.domain,
              routesChanged: refresh.changed ?? false,
              refusal: refresh.refusal,
              notExposed: refresh.notExposed,
            },
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

/**
 * Regenerate the Traefik routes after a component update — the one step every
 * update door runs (`runAction(_, 'update')`, which the dashboard's update
 * button and `eve update <component>` both reach, and the `eve update` targets
 * that do not go through it). It is the same `traefik-routes` materializer
 * `eve domain set|apply|repair` and `eve add|remove` use: the INSTALLED
 * components and the saved domain, SSL and proxy settings. So a route an Eve
 * release adds (e.g. /synap-storage) reaches the pod on its next update, with
 * no `eve domain apply` by hand.
 *
 * An update never changes which hostnames are public (`keepPublicHosts`): an
 * installed component the current routes do not serve stays unrouted, and the
 * line names it. Publishing it is `eve domain apply` / `eve add`.
 *
 * Never throws and never fails the update: the component did update. Returns
 * the one line to show the operator, which says when routes were NOT
 * regenerated and why.
 */
export async function refreshRoutesAfterUpdate(): Promise<string> {
  let refresh: MaterializeResult;
  try {
    [refresh] = await materializeTargets(null, ['traefik-routes'], { keepPublicHosts: true });
  } catch (err) {
    return `⚠ Traefik routes NOT regenerated: ${err instanceof Error ? err.message : String(err)} — run: eve domain apply`;
  }
  if (refresh.ok) return refresh.summary;
  if (refresh.details && refresh.details.domain === null) {
    return 'Traefik routes not regenerated: no domain configured (`eve domain set <domain>` routes components by URL)';
  }
  // A refusal carries its own instructions; `eve domain apply` would refuse too.
  const hint = refresh.details?.refusal ? '' : ' — run: eve domain apply';
  return `⚠ Traefik routes NOT regenerated: ${refresh.error ?? refresh.summary}${hint}`;
}
