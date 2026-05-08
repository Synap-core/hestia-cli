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
  detectCoolifyTargets,
} from '@eve/dna';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface LsOptions {
  staging?: boolean;
  production?: boolean;
  json?: boolean;
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

interface DeployedApp {
  name: string;
  env: string;
  url: string;
  status: string;
  image: string;
}

async function runLs(opts: LsOptions): Promise<void> {
  console.log();
  printHeader('eve ls');

  const envVars = getCoolifyTargetsFromEnv();
  const envOverrides: NonNullable<Parameters<typeof detectCoolifyTargets>[0]> = {};

  if (opts.production || (!opts.staging && !opts.production)) envOverrides.COOLIFY_PROD_URL = process.env.COOLIFY_PROD_URL;
  if (opts.production || (!opts.staging && !opts.production)) envOverrides.COOLIFY_PROD_TOKEN = process.env.COOLIFY_PROD_TOKEN;
  if (opts.staging || (!opts.staging && !opts.production)) envOverrides.COOLIFY_STAGING_URL = process.env.COOLIFY_STAGING_URL;
  if (opts.staging || (!opts.staging && !opts.production)) envOverrides.COOLIFY_STAGING_TOKEN = process.env.COOLIFY_STAGING_TOKEN;

  const targets = detectCoolifyTargets(envOverrides);
  const entries: Array<{ env: string; label: string; apps: Record<string, unknown>[] }> = [];

  if (!!targets.staging || opts.staging || (!opts.staging && !opts.production)) {
    if (envVars.staging) {
      try {
        const apps = await listCoolifyApps(envVars.staging);
        entries.push({ env: 'staging', label: 'Staging (CT 104)', apps });
      } catch {
        entries.push({ env: 'staging', label: 'Staging (CT 104)', apps: [] });
      }
    }
  }

  if (!!targets.production || opts.production || (!opts.staging && !opts.production)) {
    if (envVars.production) {
      try {
        const apps = await listCoolifyApps(envVars.production);
        entries.push({ env: 'production', label: 'Production (CT 103)', apps });
      } catch {
        entries.push({ env: 'production', label: 'Production (CT 103)', apps: [] });
      }
    }
  }

  if (entries.length === 0) {
    printInfo('No Coolify targets configured.');
    printInfo('Set env vars: COOLIFY_STAGING_URL + COOLIFY_STAGING_TOKEN, COOLIFY_PROD_URL + COOLIFY_PROD_TOKEN');
    return;
  }

  const allApps: DeployedApp[] = [];

  for (const entry of entries) {
    console.log(`\n  ${colors.primary.bold(entry.label)} (${entry.env}):`);

    if (entry.apps.length === 0) {
      console.log(`    ${colors.muted('  No apps deployed')}`);
      continue;
    }

    for (const app of entry.apps as unknown as Record<string, string>[]) {
      const name = app.name || '<unnamed>';
      const url = app.url || '';
      const status = app.status || 'unknown';
      allApps.push({ name, env: entry.env, url, status, image: '' });
      console.log(`    ${colors.info('•')} ${colors.muted(name.padEnd(30))} ${status}`);
      if (url) {
        console.log(`                           ${url}`);
      }
    }
  }

  console.log();
}
