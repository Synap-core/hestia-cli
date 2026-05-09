/**
 * `eve setup admin` — create the first human admin on a fresh Synap pod.
 *
 * Delegates to the canonical synap CLI's `synap setup admin` subcommand.
 * Three modes:
 *   1. --terminal (default if interactive): prompt for email + password,
 *      then `synap setup admin --email e --password p` (preseed via
 *      container exec).
 *   2. --magic-link: `synap setup admin --email e --magic-link` mints
 *      a one-hour browser URL, eve polls `synap setup admin --status`
 *      until the operator finishes in their browser.
 *   3. --password (fully scripted): `synap setup admin --email e --password p`.
 */

import * as readline from 'node:readline';
import { Command } from 'commander';
import { runSynapCli } from '@eve/brain';
import { readEveSecrets, resolveSynapUrlOnHost } from '@eve/dna';
import { resolveProvisioningToken } from '@eve/lifecycle';
import {
  colors,
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printWarning,
  createSpinner,
} from '../lib/ui.js';

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt for a password. Input is hidden (no echo). Falls back to visible
 * input if the terminal doesn't support raw mode.
 */
function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    // Use readline with a muted output stream so keypresses aren't echoed.
    // The `*` masking trick requires raw mode which isn't always available
    // (e.g. piped stdin). We detect that and fall back gracefully.
    if (!process.stdin.isTTY) {
      // Non-interactive — read as plain text
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    process.stdout.write(question);
    const chars: string[] = [];

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    function onData(data: string) {
      const ch = data as string;
      if (ch === '\r' || ch === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(chars.join(''));
      } else if (ch === '') {
        // Ctrl-C
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        process.exit(1);
      } else if (ch === '' || ch === '\b') {
        // Backspace
        if (chars.length > 0) {
          chars.pop();
          process.stdout.write('\b \b');
        }
      } else {
        chars.push(ch);
        process.stdout.write('*');
      }
    }

    process.stdin.on('data', onData);
  });
}

// ---------------------------------------------------------------------------
// Pod transport
// ---------------------------------------------------------------------------
//
// Status probe and magic-link mint are HTTP calls — same path
// `eve auth provision` uses. URL resolved via `resolveSynapUrlOnHost(secrets)`
// (loopback :14000 first, public domain fallback). Auth token is the pod's
// PROVISIONING_TOKEN — what the backend's `/api/hub/setup/magic-link` route
// validates against. Preseed (`--password` mode) still delegates to the bash
// CLI because it needs `docker compose exec` against the backend container.

interface PodTransport {
  podUrl: string;
  token?: string;
}

async function resolvePodTransport(): Promise<PodTransport | { error: string }> {
  const cwd = process.env.EVE_HOME ?? process.cwd();
  const secrets = await readEveSecrets(cwd);
  const podUrl = (await resolveSynapUrlOnHost(secrets)).trim();
  if (!podUrl) {
    return {
      error: secrets
        ? 'synap pod URL unresolved — set domain.primary or synap.apiUrl in ~/.eve/secrets.json'
        : '~/.eve/secrets.json not found — run `eve install synap` first',
    };
  }
  const token = (await resolveProvisioningToken())?.trim() || undefined;
  return { podUrl, token };
}

/**
 * GET `${podUrl}/api/hub/setup/status` → `{ needsSetup: boolean }`.
 * Returns 'unknown' for any network error or unparseable response.
 */
export async function probeAdminStatus(): Promise<'needed' | 'ready' | 'unknown'> {
  const t = await resolvePodTransport();
  if ('error' in t) return 'unknown';
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (t.token) headers.Authorization = `Bearer ${t.token}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`${t.podUrl}/api/hub/setup/status`, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return 'unknown';
    const body = await res.json() as { needsSetup?: boolean };
    if (body.needsSetup === true) return 'needed';
    if (body.needsSetup === false) return 'ready';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

async function runPreseed(email: string, password: string): Promise<boolean> {
  // Preseed runs `docker compose exec backend node setup-admin.js …`. Stays
  // inside the bash CLI because it needs container access, not HTTP.
  const result = runSynapCli('setup', ['admin', '--email', email, '--password', password]);
  return result.ok;
}

async function runMagicLinkMint(): Promise<string | null> {
  const t = await resolvePodTransport();
  if ('error' in t) {
    printWarning(t.error);
    return null;
  }
  if (!t.token) {
    printWarning('PROVISIONING_TOKEN not found — check synap deploy/.env or run `eve install synap`.');
    return null;
  }
  try {
    const res = await fetch(`${t.podUrl}/api/hub/setup/magic-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${t.token}`,
      },
    });
    if (res.status === 409) {
      printWarning('Pod already has an admin (409).');
      return null;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      printWarning(`Pod returned ${res.status} — ${detail.slice(0, 200)}`);
      return null;
    }
    const body = await res.json() as { url?: string };
    return body.url?.trim() || null;
  } catch (err) {
    printWarning(`Failed to reach pod: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function pollUntilReady(timeoutMs = 5 * 60 * 1000, intervalMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs));
    const status = await probeAdminStatus();
    if (status === 'ready') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Core flow
// ---------------------------------------------------------------------------

interface SetupAdminOptions {
  email?: string;
  password?: string;
  magicLink?: boolean;
  terminal?: boolean;
}


async function runSetupAdmin(opts: SetupAdminOptions): Promise<void> {
  console.log();
  printHeader('Synap — First Admin Setup');
  console.log();

  // Single source of truth for "is admin needed" — the synap CLI probe.
  const spinner = createSpinner('Checking pod status…');
  spinner.start();
  const status = await probeAdminStatus();
  if (status === 'unknown') {
    spinner.fail('Could not reach the synap pod. Is it installed and running?');
    printInfo('  Try: eve status, eve doctor, or eve install synap.');
    process.exitCode = 1;
    return;
  }
  if (status === 'ready') {
    spinner.succeed('Pod already has an admin account.');
    printInfo('  Nothing to do — log in at your pod URL.');
    return;
  }
  spinner.succeed('Pod has no admin yet — proceeding.');
  console.log();

  // Resolve mode from flags. Precedence: --magic-link > --password > --terminal
  // > interactive picker (TTY) > magic-link (non-TTY default).
  let mode: 'terminal' | 'magic-link';
  if (opts.magicLink) {
    mode = 'magic-link';
  } else if (opts.password || opts.terminal) {
    mode = 'terminal';
  } else if (!process.stdin.isTTY) {
    mode = 'magic-link';
  } else {
    console.log(
      `${colors.muted('How would you like to create the first admin account?')}\n` +
        `  ${colors.primary('1')} Enter credentials here (email + password) — terminal\n` +
        `  ${colors.primary('2')} Open magic link in browser\n`,
    );
    const choice = await prompt('Choice [1]: ');
    mode = choice === '2' ? 'magic-link' : 'terminal';
  }

  if (mode === 'terminal') {
    // Preseed needs both email + password baked in.
    const email = opts.email?.trim() || (await prompt('Email: '));
    if (!email) {
      printError('Email is required.');
      process.exitCode = 1;
      return;
    }
    const password = opts.password?.trim() ?? await promptPassword('Password: ');
    if (!password) {
      printError('Password is required.');
      process.exitCode = 1;
      return;
    }
    if (!opts.password) {
      const confirm = await promptPassword('Confirm password: ');
      if (password !== confirm) {
        printError('Passwords do not match.');
        process.exitCode = 1;
        return;
      }
    }
    console.log();
    const s = createSpinner('Creating admin via synap CLI…');
    s.start();
    const ok = await runPreseed(email, password);
    if (!ok) {
      s.fail('synap setup admin failed — see preceding output.');
      process.exitCode = 1;
      return;
    }
    s.succeed('Admin account created.');
    console.log();
    printSuccess(`Admin created: ${email}`);
    return;
  }

  // magic-link mode — the URL is purpose-only ("first_admin_setup"), email
  // and password are entered in the browser at /setup?token=...
  console.log();
  printInfo('Minting one-hour setup URL…');
  const url = await runMagicLinkMint();
  if (!url) {
    printError('Could not mint magic link.');
    process.exitCode = 1;
    return;
  }
  console.log(`\n  Open this link in your browser to complete setup:\n  ${url}\n  Link expires in 1 hour.\n`);
  const pollSpinner = createSpinner('Waiting for you to complete setup in browser…');
  pollSpinner.start();
  const ok = await pollUntilReady();
  if (!ok) {
    pollSpinner.fail('Setup timed out (5 min) or failed.');
    printWarning('Generate a new link by running `eve setup admin --magic-link` again.');
    process.exitCode = 1;
    return;
  }
  pollSpinner.succeed('Admin account created via browser setup.');
  console.log();
  printSuccess('Pod is now ready. Run `eve auth provision` to mint agent keys.');
  console.log();
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function setupAdminCommand(setupParent: Command): void {
  setupParent
    .command('admin')
    .description('Create the first admin account on a fresh Synap pod')
    .option('--email <email>', 'Admin email (skips the interactive prompt)')
    .option('--password <secret>', 'Admin password (fully scripted — implies --terminal)')
    .option('--terminal', 'Force terminal-mode entry (default in interactive sessions)')
    .option('--magic-link', 'Generate a browser setup link instead of entering credentials here')
    .action(async (opts: SetupAdminOptions) => {
      try {
        await runSetupAdmin(opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}
