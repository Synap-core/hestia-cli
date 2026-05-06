/**
 * `eve setup admin` — create the first human admin on a fresh Synap pod.
 *
 * Two modes:
 *   1) Enter credentials here (email + password) — prompt mode.
 *   2) Open magic link in browser — generates a one-hour JWT, prints the
 *      URL, then polls until the user completes setup in their browser.
 */

import * as readline from 'node:readline';
import { Command } from 'commander';
import {
  checkNeedsAdmin,
  createFirstAdmin,
  resolveProvisioningToken,
} from '@eve/lifecycle';
import {
  readEveSecrets,
  resolveSynapUrlOnHost,
} from '@eve/dna';
import {
  colors,
  emojis,
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
// Core flow
// ---------------------------------------------------------------------------

interface SetupAdminOptions {
  email?: string;
  magicLink?: boolean;
}

export interface SetupAdminInlineOptions {
  synapUrl: string;
  provisioningToken: string;
  mode: 'prompt' | 'magic-link';
  email?: string;
  /** Public-facing URL for magic-link display (e.g. https://pod.example.com). */
  publicUrl?: string;
}

/**
 * Inline variant used by `eve auth provision` when it detects a first-admin
 * is still needed. Takes already-resolved synapUrl + provisioningToken so it
 * doesn't redo the lookup.
 */
export async function runSetupAdminInline(opts: SetupAdminInlineOptions): Promise<void> {
  if (opts.mode === 'prompt') {
    const email = opts.email?.trim() || '';
    if (!email) {
      printError('Email required for prompt mode. Pass --email <addr>.');
      process.exitCode = 1;
      return;
    }

    const defaultName = email.split('@')[0] ?? '';
    const nameInput = await prompt(`Name [${defaultName}]: `);
    const name = nameInput.trim() || defaultName;
    const password = await promptPassword('Password: ');
    if (!password) {
      printError('Password is required.');
      process.exitCode = 1;
      return;
    }
    const confirm = await promptPassword('Confirm password: ');
    if (password !== confirm) {
      printError('Passwords do not match.');
      process.exitCode = 1;
      return;
    }

    const s = createSpinner('Creating admin account…');
    s.start();
    const result = await createFirstAdmin({
      synapUrl: opts.synapUrl,
      provisioningToken: opts.provisioningToken,
      mode: 'prompt',
      email,
      password,
      name,
    });
    if (!result) {
      s.fail('Failed to create admin account.');
      process.exitCode = 1;
      return;
    }
    s.succeed('Admin account created.');
    printSuccess(`Admin created: ${email}`);
  } else {
    // magic-link
    printInfo('Generating magic-link setup URL…');
    const pollSpinner = createSpinner('Waiting for you to complete setup in browser…');
    const result = await createFirstAdmin({
      synapUrl: opts.synapUrl,
      provisioningToken: opts.provisioningToken,
      mode: 'magic-link',
      publicUrl: opts.publicUrl,
    });
    pollSpinner.start();
    if (!result) {
      pollSpinner.fail('Setup timed out or failed.');
      printWarning('Run `eve setup admin --magic-link` to generate a new link.');
      process.exitCode = 1;
      return;
    }
    pollSpinner.succeed('Admin account created via browser.');
  }
}

async function runSetupAdmin(opts: SetupAdminOptions): Promise<void> {
  console.log();
  printHeader('Synap — First Admin Setup');
  console.log();

  const secrets = await readEveSecrets(process.cwd());
  const synapUrl = await resolveSynapUrlOnHost(secrets);
  const domain = secrets?.domain?.primary;
  const publicUrl = domain ? `https://${domain}` : undefined;

  if (!synapUrl) {
    printError('Pod URL not configured. Run `eve install` first.');
    process.exitCode = 1;
    return;
  }

  // Resolve provisioning token — checks env vars, /opt/synap-backend/.env,
  // /opt/synap-backend/deploy/.env, and docker inspect (in that order).
  const provisioningToken = resolveProvisioningToken() ?? '';

  if (!provisioningToken) {
    printError('PROVISIONING_TOKEN not found.');
    printInfo(
      '  Checked: EVE_PROVISIONING_TOKEN / PROVISIONING_TOKEN env vars,\n' +
        '           /opt/synap-backend/.env, /opt/synap-backend/deploy/.env,\n' +
        '           and docker inspect on the running backend container.\n' +
        '  Fix: set EVE_PROVISIONING_TOKEN=<token>, or ensure the pod .env is readable.',
    );
    process.exitCode = 1;
    return;
  }

  // Check if admin already exists
  const spinner = createSpinner('Checking pod status…');
  spinner.start();
  const needsSetup = await checkNeedsAdmin(synapUrl);
  if (!needsSetup) {
    spinner.succeed('Pod already has an admin account.');
    printInfo('  Nothing to do — log in at your pod URL.');
    return;
  }
  spinner.succeed(`Pod at ${synapUrl} has no admin yet.`);
  console.log();

  // Determine mode
  let mode: 'prompt' | 'magic-link';

  if (opts.magicLink) {
    mode = 'magic-link';
  } else if (opts.email) {
    mode = 'prompt';
  } else if (!process.stdin.isTTY) {
    // Non-interactive: default to magic-link
    mode = 'magic-link';
  } else {
    // Interactive: ask
    console.log(
      `${colors.muted('How would you like to create the first admin account?')}\n` +
        `  ${colors.primary('1')} Enter credentials here (email + password)\n` +
        `  ${colors.primary('2')} Open magic link in browser\n`,
    );
    const choice = await prompt('Choice [1]: ');
    mode = choice === '2' ? 'magic-link' : 'prompt';
  }

  if (mode === 'prompt') {
    // Gather credentials
    const email =
      opts.email?.trim() ||
      (await prompt('Email: '));

    if (!email) {
      printError('Email is required.');
      process.exitCode = 1;
      return;
    }

    const defaultName = email.split('@')[0] ?? '';
    const nameInput = await prompt(`Name [${defaultName}]: `);
    const name = nameInput.trim() || defaultName;

    const password = await promptPassword('Password: ');
    if (!password) {
      printError('Password is required.');
      process.exitCode = 1;
      return;
    }

    const confirm = await promptPassword('Confirm password: ');
    if (password !== confirm) {
      printError('Passwords do not match.');
      process.exitCode = 1;
      return;
    }

    console.log();
    const createSpinnerInst = createSpinner('Creating admin account…');
    createSpinnerInst.start();

    const result = await createFirstAdmin({
      synapUrl,
      provisioningToken,
      mode: 'prompt',
      email,
      password,
      name,
    });

    if (!result) {
      createSpinnerInst.fail('Failed to create admin account.');
      printError('Check the pod logs for details.');
      process.exitCode = 1;
      return;
    }

    createSpinnerInst.succeed('Admin account created.');
    console.log();
    printSuccess(`Admin created: ${email}`);
    printInfo(`  User ID:      ${result.userId}`);
    printInfo(`  Workspace ID: ${result.workspaceId}`);
    printInfo(`  Log in at:    ${synapUrl}`);
    console.log();
  } else {
    // Magic-link mode
    console.log();
    printInfo(`Generating a one-hour setup link for ${synapUrl}…`);
    console.log();

    const pollSpinner = createSpinner('Waiting for you to complete setup in your browser…');

    const result = await createFirstAdmin({
      synapUrl,
      provisioningToken,
      mode: 'magic-link',
      publicUrl,
    });

    // createFirstAdmin prints the URL before it starts polling
    pollSpinner.start();

    if (!result) {
      pollSpinner.fail('Setup timed out (5 min) or failed.');
      printWarning('Generate a new link by running `eve setup admin` again.');
      process.exitCode = 1;
      return;
    }

    pollSpinner.succeed('Admin account created via browser setup.');
    console.log();
    printSuccess('Pod is now ready. Run `eve auth provision` to mint agent keys.');
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function setupAdminCommand(setupParent: Command): void {
  setupParent
    .command('admin')
    .description('Create the first admin account on a fresh Synap pod')
    .option('--email <email>', 'Admin email (skips the interactive prompt)')
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
