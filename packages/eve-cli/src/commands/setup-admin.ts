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
// Synap CLI delegation
// ---------------------------------------------------------------------------

/**
 * `synap setup admin --status` returns "needed" / "ready" / "unknown".
 * Maps to a tri-state for callers.
 */
export async function probeAdminStatus(): Promise<'needed' | 'ready' | 'unknown'> {
  const result = runSynapCli('setup', ['admin', '--status'], { inherit: false });
  if (!result.ok && result.exitCode !== 2) {
    return 'unknown';
  }
  const out = result.stdout.trim();
  if (out === 'needed') return 'needed';
  if (out === 'ready') return 'ready';
  return 'unknown';
}

async function runPreseed(email: string, password: string): Promise<boolean> {
  const result = runSynapCli('setup', ['admin', '--email', email, '--password', password]);
  return result.ok;
}

async function runMagicLinkMint(email: string): Promise<string | null> {
  const result = runSynapCli('setup', ['admin', '--email', email, '--magic-link'], { inherit: false });
  if (!result.ok) {
    if (result.stderr) printWarning(result.stderr.trim());
    return null;
  }
  // The synap CLI prints the URL on stdout, one line.
  const url = result.stdout.trim().split('\n').pop()?.trim() ?? '';
  return url || null;
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

  // Gather email + password as needed, then delegate.
  const email = opts.email?.trim() || (await prompt('Email: '));
  if (!email) {
    printError('Email is required.');
    process.exitCode = 1;
    return;
  }

  if (mode === 'terminal') {
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

  // magic-link mode
  console.log();
  printInfo('Minting one-hour setup URL via synap CLI…');
  const url = await runMagicLinkMint(email);
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
