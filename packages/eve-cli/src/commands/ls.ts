/**
 * `eve ls` — list deployed apps across Coolify targets.
 *
 * Usage:
 *   eve ls                       List staging + production apps
 *   eve ls --staging             Only staging
 *   eve ls --production          Only production
 *   eve ls --json                Machine-readable output
 */

import { Command } from 'commander';
import {
  colors,
  emojis,
  printHeader,
  printError,
  printInfo,
} from '../lib/ui.js';
import {
  listCoolifyApps,
  getCoolifyTargetsFromEnv,
  type CoolifyTarget,
  type CoolifyApp,
} from '@eve/dna';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveTargets(
  opts: { staging?: boolean; production?: boolean },
): { env: string; label: string; target: CoolifyTarget }[] {
  const envVars = getCoolifyTargetsFromEnv();
  const results: { env: string; label: string; target: CoolifyTarget }[] = [];

  if (!opts.staging && envVars.staging) {
    results.push({ env: 'staging', label: 'Staging (CT 104)', target: envVars.staging });
  }
  if (!opts.production && envVars.staging && opts.staging) {
    results.push({ env: 'staging', label: 'Staging (CT 104)', target: envVars.staging });
  }
  if (!opts.staging && envVars.production) {
    results.push({ env: 'production', label: 'Production (CT 103)', target: envVars.production });
  }
  if (!opts.production && envVars.production && opts.production) {
    results.push({ env: 'production', label: 'Production (CT 103)', target: envVars.production });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface LsOptions {
  staging?: boolean;
  production?: boolean;
  json?: boolean;
}

interface LsApp {
  name: string;
  env: string;
  url: string;
  status: string;
}

export function lsCommand(program: Command): void {
  program
    .command('ls')
    .description(`${emojis.info} List deployed apps in Coolify`)
    .option('--staging', 'Only show staging apps')
    .option('--production', 'Only show production apps')
    .option('--json', 'Output as JSON')
    .action(async (opts: LsOptions) => {
      try {
        await runLs(opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

async function runLs(opts: LsOptions): Promise<void> {
  console.log();

  const targets = resolveTargets(opts);

  const allApps: LsApp[] = [];

  if (targets.length === 0) {
    printHeader('eve ls');
    printInfo('No Coolify targets configured.');
    printInfo('Set env vars: COOLIFY_STAGING_URL + COOLIFY_STAGING_TOKEN, COOLIFY_PROD_URL + COOLIFY_PROD_TOKEN');
    return;
  }

  if (!opts.json) {
    printHeader('eve ls');
  }

  for (const target of targets) {
    try {
      const apps = await listCoolifyApps(target.target);

      if (opts.json) {
        for (const app of apps) {
          allApps.push({
            name: app.name || '<unnamed>',
            env: target.env,
            url: app.url || '',
            status: app.status || 'unknown',
          });
        }
        continue;
      }

      console.log(`\n  ${colors.primary.bold(target.label)} (${target.env}):`);

      if (apps.length === 0) {
        console.log(`    ${colors.muted('  No apps deployed')}`);
        continue;
      }

      for (const app of apps) {
        const name = app.name || '<unnamed>';
        const url = app.url || '';
        const status = app.status || 'unknown';
        allApps.push({ name, env: target.env, url, status });
        console.log(`    ${colors.info('•')} ${colors.muted(name.padEnd(30))} ${status}`);
        if (url) {
          console.log(`                           ${url}`);
        }
      }
    } catch {
      if (!opts.json) {
        console.log(`\n  ${colors.primary.bold(target.label)} (${target.env}):`);
        console.log(`    ${colors.warning('  Failed to connect')}`);
      }
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(allApps, null, 2));
  } else {
    console.log();
  }
}
