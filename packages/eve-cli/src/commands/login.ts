/**
 * `eve login` — store GHCR PAT and/or Coolify tokens locally.
 *
 * Usage:
 *   eve login --ghcr <token>        Store GitHub PAT for GHCR
 *   eve login --coolify-staging     Store Coolify staging token
 *   eve login --coolify-prod        Store Coolify production token
 *   eve login (no args)             Show stored status
 *   eve login --clear               Remove all stored credentials
 */

import { Command } from 'commander';
import {
  colors,
  emojis,
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printWarning,
} from '../lib/ui.js';

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CRED_DIR = join(homedir(), '.config', 'eve');
const CRED_FILE = join(CRED_DIR, 'deploy-creds.json');

interface DeployCreds {
  ghcr?: string | null;
  coolifyStaging?: string | null;
  coolifyProd?: string | null;
}

function loadCreds(): DeployCreds {
  if (existsSync(CRED_FILE)) {
    try {
      return JSON.parse(readFileSync(CRED_FILE, 'utf-8')) as DeployCreds;
    } catch {
      return {};
    }
  }
  return {};
}

function saveCreds(creds: DeployCreds): void {
  mkdirSync(CRED_DIR, { recursive: true });
  writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return token.slice(0, 4) + '…' + token.slice(-4);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function loginCommand(program: Command): void {
  program
    .command('login')
    .description(`${emojis.arms} Store auth tokens for deploy/push operations`)
    .option('--ghcr <token>', 'GitHub PAT for GHCR push')
    .option('--coolify-staging <token>', 'Coolify staging API token')
    .option('--coolify-prod <token>', 'Coolify production API token')
    .option('--clear', 'Remove all stored credentials')
    .action(async (opts: {
      ghr?: string;
      coolifyStaging?: string;
      coolifyProd?: string;
      clear?: boolean;
    }) => {
      try {
        await runLogin(opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

async function runLogin(opts: {
  ghr?: string;
  coolifyStaging?: string;
  coolifyProd?: string;
  clear?: boolean;
}): Promise<void> {
  console.log();
  printHeader('eve login');

  // --clear
  if (opts.clear) {
    saveCreds({});
    printSuccess('All stored credentials removed');
    return;
  }

  // No args — show status
  if (!opts.ghr && !opts.coolifyStaging && !opts.coolifyProd) {
    const creds = loadCreds();
    const entries: string[] = [];
    if (creds.ghcr) {
      entries.push(`GHCR:        ${colors.success('configured')}  (${maskToken(creds.ghcr)})`);
    } else {
      entries.push('GHCR:        ' + colors.warning('not configured'));
    }
    if (creds.coolifyStaging) {
      entries.push(`Coolify Stg: ${colors.success('configured')}  (${maskToken(creds.coolifyStaging)})`);
    } else {
      const hasEnv = !!process.env.COOLIFY_STAGING_TOKEN;
      const label = hasEnv ? colors.info('env var only') : '—';
      entries.push(`Coolify Stg: ${label}`);
    }
    if (creds.coolifyProd) {
      entries.push(`Coolify Prod:${colors.success(' configured')}  (${maskToken(creds.coolifyProd)})`);
    } else {
      const hasEnv = !!process.env.COOLIFY_PROD_TOKEN;
      const label = hasEnv ? colors.info('env var only') : '—';
      entries.push(`Coolify Prod:${label}`);
    }
    console.log();
    for (const line of entries) {
      console.log(`  ${line}`);
    }
    console.log();
    printInfo('Run with flags to store: --ghcr <pat>, --coolify-staging <token>');
    return;
  }

  // Store values
  const creds = loadCreds();

  if (opts.ghr) {
    creds.ghcr = opts.ghr;
    printSuccess('GHCR token stored');
  }
  if (opts.coolifyStaging) {
    creds.coolifyStaging = opts.coolifyStaging;
    printSuccess('Coolify staging token stored');
  }
  if (opts.coolifyProd) {
    creds.coolifyProd = opts.coolifyProd;
    printSuccess('Coolify production token stored');
  }

  saveCreds(creds);
}
