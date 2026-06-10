/**
 * `eve connectors` — manage the Nango integration platform.
 *
 * Subcommands:
 *   setup  [provider]           Register a real OAuth app (already built).
 *   admin                       Show admin email + password (re-derived from secrets).
 *   admin  --reset-password     Change the admin password via the Nango API.
 *   dashboard                   Open the Nango dashboard in the browser.
 *
 * Why this exists: a fresh `eve add nango` brings up the server and creates an
 * admin account, but until a provider has real OAuth credentials `synap connect`
 * fails with "Integration does not exist".  And once credentials scroll past,
 * the user has no way to recover them or change the password.  This command
 * fills both gaps.
 */

import type { Command } from 'commander';
import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { text, password, select, isCancel, cancel } from '@clack/prompts';
import { readEveSecrets, writeEveSecrets } from '@eve/dna';
import {
  colors,
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printWarning,
} from '../lib/ui.js';

const execFileAsync = promisify(execFile);
const NANGO_CONTAINER = 'eve-arms-nango';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Derive the admin password from the secret key (deterministic, recoverable). */
function deriveAdminPassword(secretKey: string): string {
  return `Nango_${secretKey.slice(0, 12)}`;
}

/** Derive the admin email the same way addNango() does. */
async function deriveAdminEmail(): Promise<string> {
  const secrets = await readEveSecrets(process.cwd()).catch(() => null);
  return secrets?.synap?.userSession?.email
    ?? secrets?.builder?.openwebui?.adminEmail
    ?? 'admin@eve.local';
}

/** Read the Nango bearer secret the pod backend uses. */
async function readNangoSecretKey(): Promise<string | null> {
  const secrets = await readEveSecrets(process.cwd()).catch(() => null);
  return secrets?.connectors?.nango?.secretKey ?? null;
}

/** True if the Nango container is running on this host. */
async function isNangoRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'docker', ['ps', '--filter', `name=^${NANGO_CONTAINER}$`, '--format', '{{.Names}}'],
      { timeout: 4000 },
    );
    return stdout.trim() === NANGO_CONTAINER;
  } catch {
    return false;
  }
}

/** The Nango server URL the admin should open (NANGO_SERVER_URL from container). */
async function readNangoHost(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['inspect', NANGO_CONTAINER, '--format',
        '{{range .Config.Env}}{{println .}}{{end}}'],
      { timeout: 4000 },
    );
    const line = stdout.split('\n').find((l) => l.startsWith('NANGO_SERVER_URL='));
    return line?.slice('NANGO_SERVER_URL='.length).trim() || null;
  } catch {
    return null;
  }
}

/** Find the synap-backend postgres container for direct DB operations. */
async function findSynapPostgresContainer(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['ps', '--filter', 'label=com.docker.compose.project=synap-backend',
        '--filter', 'label=com.docker.compose.service=postgres',
        '--format', '{{.Names}}'],
      { timeout: 4000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Open a URL in the default browser (platform-aware). */
function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;
  if (platform === 'darwin') cmd = `open "${url}"`;
  else if (platform === 'win32') cmd = `start "" "${url}"`;
  else cmd = `xdg-open "${url}"`;
  exec(cmd, () => {/* fire-and-forget */});
}

// ---------------------------------------------------------------------------
// Provider catalog (for `setup`)
// ---------------------------------------------------------------------------

interface ProviderSpec {
  key: string;
  label: string;
  uniqueKeys: string[];
  authMode: 'OAUTH2';
  consoleUrl: string;
  steps: string[];
}

const PROVIDERS: ProviderSpec[] = [
  {
    key: 'google',
    label: 'Google (Calendar, Gmail, Drive, Contacts)',
    uniqueKeys: ['google-calendar', 'google-mail', 'google-drive', 'google-contacts'],
    authMode: 'OAUTH2',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    steps: [
      'Create (or select) a project at https://console.cloud.google.com',
      'APIs & Services → Enable APIs: Google Calendar, Gmail, Drive, People (Contacts)',
      'APIs & Services → OAuth consent screen → External → add yourself as a Test user',
      'APIs & Services → Credentials → Create credentials → OAuth client ID → Web application',
      'Add the Authorized redirect URI shown below, then copy the Client ID + Secret',
    ],
  },
  {
    key: 'github',
    label: 'GitHub (repos, issues)',
    uniqueKeys: ['github'],
    authMode: 'OAUTH2',
    consoleUrl: 'https://github.com/settings/developers',
    steps: [
      'Go to https://github.com/settings/developers → OAuth Apps → New OAuth App',
      'Set the Authorization callback URL to the redirect URI shown below',
      'Register, then copy the Client ID and generate a Client Secret',
    ],
  },
  {
    key: 'notion',
    label: 'Notion (pages, databases)',
    uniqueKeys: ['notion'],
    authMode: 'OAUTH2',
    consoleUrl: 'https://www.notion.so/my-integrations',
    steps: [
      'Go to https://www.notion.so/my-integrations → New integration → type "Public"',
      'Add the Redirect URI shown below under OAuth Domain & URIs',
      'Copy the OAuth client ID and client secret',
    ],
  },
  {
    key: 'slack',
    label: 'Slack (messages, channels)',
    uniqueKeys: ['slack'],
    authMode: 'OAUTH2',
    consoleUrl: 'https://api.slack.com/apps',
    steps: [
      'Go to https://api.slack.com/apps → Create New App → From scratch',
      'OAuth & Permissions → Redirect URLs → add the redirect URI shown below',
      'Copy the Client ID and Client Secret from Basic Information → App Credentials',
    ],
  },
  {
    key: 'linear',
    label: 'Linear (issues, projects)',
    uniqueKeys: ['linear'],
    authMode: 'OAUTH2',
    consoleUrl: 'https://linear.app/settings/api',
    steps: [
      'Go to https://linear.app/settings/api → OAuth applications → Create new',
      'Set the Callback URL to the redirect URI shown below',
      'Copy the Client ID and Client Secret',
    ],
  },
];

async function readNangoCallbackUrl(): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['inspect', NANGO_CONTAINER, '--format',
        '{{range .Config.Env}}{{println .}}{{end}}'],
      { timeout: 4000 },
    );
    const line = stdout.split('\n').find((l) => l.startsWith('NANGO_SERVER_URL='));
    const base = line?.slice('NANGO_SERVER_URL='.length).trim();
    if (base) return `${base.replace(/\/$/, '')}/oauth/callback`;
  } catch { /* fall through */ }
  return 'https://nango.<your-domain>/oauth/callback';
}

async function upsertIntegration(
  secretKey: string,
  uniqueKey: string,
  provider: string,
  authMode: string,
  clientId: string,
  clientSecret: string,
): Promise<{ ok: true; action: 'created' | 'updated' } | { ok: false; error: string }> {
  const payload = JSON.stringify({
    provider,
    unique_key: uniqueKey,
    credentials: { type: authMode, client_id: clientId, client_secret: clientSecret },
  });
  const patchPayload = JSON.stringify({
    credentials: { type: authMode, client_id: clientId, client_secret: clientSecret },
  });

  const script = `
    const base = 'http://127.0.0.1:3003';
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ${JSON.stringify(secretKey)} };
    const post = await fetch(base + '/integrations', { method: 'POST', headers, body: ${JSON.stringify(payload)} })
      .then(async r => ({ status: r.status, body: await r.text() })).catch(e => ({ status: 0, body: String(e) }));
    if (post.status >= 200 && post.status < 300) { process.stdout.write('created'); process.exit(0); }
    const patch = await fetch(base + '/integrations/' + encodeURIComponent(${JSON.stringify(uniqueKey)}), { method: 'PATCH', headers, body: ${JSON.stringify(patchPayload)} })
      .then(async r => ({ status: r.status, body: await r.text() })).catch(e => ({ status: 0, body: String(e) }));
    if (patch.status >= 200 && patch.status < 300) { process.stdout.write('updated'); process.exit(0); }
    process.stdout.write('ERR ' + post.status + ' ' + post.body + ' | PATCH ' + patch.status + ' ' + patch.body);
    process.exit(1);
  `;
  try {
    const { stdout } = await execFileAsync(
      'docker', ['exec', NANGO_CONTAINER, 'node', '--input-type=module', '-e', script],
      { timeout: 20_000 },
    );
    const out = stdout.trim();
    if (out === 'created' || out === 'updated') return { ok: true, action: out as 'created' | 'updated' };
    return { ok: false, error: out || 'unknown error' };
  } catch (err) {
    const e = err as { stdout?: string; message?: string };
    return { ok: false, error: (e.stdout?.trim() || e.message || 'exec failed') };
  }
}

// ---------------------------------------------------------------------------
// Subcommand: setup [provider]
// ---------------------------------------------------------------------------

async function runConnectorsSetup(providerKey?: string): Promise<void> {
  console.log();
  printHeader('Eve — Connector Setup', '🔌');
  console.log();

  if (!await isNangoRunning()) {
    printError(`Nango container (${NANGO_CONTAINER}) is not running on this host.`);
    printInfo('  Install it first:  eve add nango');
    printInfo('  Run this command on the pod host (where Docker runs).');
    process.exit(1);
  }

  const secretKey = await readNangoSecretKey();
  if (!secretKey) {
    printError('No Nango secret key found — run `eve add nango` first.');
    process.exit(1);
  }

  let spec = providerKey
    ? PROVIDERS.find((p) => p.key === providerKey.toLowerCase())
    : undefined;

  if (providerKey && !spec) {
    printError(`Unknown provider "${providerKey}".`);
    printInfo(`  Available: ${PROVIDERS.map((p) => p.key).join(', ')}`);
    process.exit(1);
  }

  if (!spec) {
    const choice = await select({
      message: 'Which service do you want to connect?',
      options: PROVIDERS.map((p) => ({ value: p.key, label: p.label })),
    });
    if (isCancel(choice)) { cancel('Cancelled.'); process.exit(0); }
    spec = PROVIDERS.find((p) => p.key === choice)!;
  }

  const callbackUrl = await readNangoCallbackUrl();
  console.log();
  printInfo(colors.primary.bold(`Set up ${spec.label}`));
  console.log();
  printInfo(`  Console:  ${colors.info(spec.consoleUrl)}`);
  console.log();
  printInfo('  Steps:');
  for (const [i, step] of spec.steps.entries()) {
    printInfo(`    ${i + 1}. ${step}`);
  }
  console.log();
  printInfo('  Authorized redirect URI (whitelist this exact value):');
  printInfo(`    ${colors.info(callbackUrl)}`);
  if (callbackUrl.includes('<your-domain>')) {
    printWarning('    Could not read NANGO_SERVER_URL — set a domain and re-run `eve add nango`.');
  }
  console.log();

  const clientId = await text({
    message: `${spec.label} — OAuth Client ID`,
    validate: (v) => (v && v.trim().length > 0 ? undefined : 'Required'),
  });
  if (isCancel(clientId)) { cancel('Cancelled.'); process.exit(0); }

  const clientSecret = await password({
    message: `${spec.label} — OAuth Client Secret`,
    validate: (v) => (v && v.trim().length > 0 ? undefined : 'Required'),
  });
  if (isCancel(clientSecret)) { cancel('Cancelled.'); process.exit(0); }

  console.log();
  const results: Array<{ uniqueKey: string; ok: boolean; action?: string; error?: string }> = [];
  for (const uniqueKey of spec.uniqueKeys) {
    const res = await upsertIntegration(
      secretKey, uniqueKey, uniqueKey, spec.authMode,
      String(clientId).trim(), String(clientSecret).trim(),
    );
    if (res.ok) {
      printSuccess(`  ${res.action === 'created' ? 'Created' : 'Updated'} integration: ${uniqueKey}`);
      results.push({ uniqueKey, ok: true, action: res.action });
    } else {
      printError(`  Failed: ${uniqueKey} — ${res.error}`);
      results.push({ uniqueKey, ok: false, error: res.error });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  if (okCount === 0) {
    printError('No integrations were configured.');
    process.exit(1);
  }

  const secrets = await readEveSecrets(process.cwd()).catch(() => null);
  const oauthApps = { ...(secrets?.connectors?.nango?.oauthApps ?? {}) };
  oauthApps[spec.key] = {
    clientId: String(clientId).trim(),
    configuredAt: new Date().toISOString(),
  };
  await writeEveSecrets({
    ...(secrets ?? {}),
    connectors: {
      ...(secrets?.connectors ?? {}),
      nango: {
        ...(secrets?.connectors?.nango ?? {}),
        secretKey,
        oauthApps,
      },
    },
  }, process.cwd());

  console.log();
  printSuccess(`${spec.label} configured (${okCount}/${spec.uniqueKeys.length} integrations).`);
  printInfo('  Connect your account now with:');
  for (const uniqueKey of spec.uniqueKeys) {
    printInfo(`    synap connect ${uniqueKey}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Subcommand: admin
// ---------------------------------------------------------------------------

async function runConnectorsAdmin(resetPassword: boolean): Promise<void> {
  console.log();
  printHeader('Eve — Nango Admin', '👤');
  console.log();

  if (!await isNangoRunning()) {
    printError(`Nango container (${NANGO_CONTAINER}) is not running on this host.`);
    printInfo('  Run this command on the pod host (where Docker runs).');
    process.exit(1);
  }

  const secretKey = await readNangoSecretKey();
  if (!secretKey) {
    printError('No Nango secret key found — run `eve add nango` first.');
    process.exit(1);
  }

  if (resetPassword) {
    // ── Password reset ──────────────────────────────────────────────────────
    const email = await text({
      message: 'Admin email',
      initialValue: await deriveAdminEmail(),
      validate: (v) => (v && v.includes('@') ? undefined : 'Enter a valid email'),
    });
    if (isCancel(email)) { cancel('Cancelled.'); process.exit(0); }

    const oldPassword = await password({
      message: 'Current password',
      validate: (v) => (v && v.length > 0 ? undefined : 'Required'),
    });
    if (isCancel(oldPassword)) { cancel('Cancelled.'); process.exit(0); }

    const newPassword = await password({
      message: 'New password (min 8 chars, 1 upper, 1 lower, 1 number, 1 special)',
      validate: (v) => {
        if (!v || v.length < 8) return 'At least 8 characters';
        if (!/[A-Z]/.test(v)) return 'Needs an uppercase letter';
        if (!/[a-z]/.test(v)) return 'Needs a lowercase letter';
        if (!/[0-9]/.test(v)) return 'Needs a number';
        if (!/[^A-Za-z0-9]/.test(v)) return 'Needs a special character';
        return undefined;
      },
    });
    if (isCancel(newPassword)) { cancel('Cancelled.'); process.exit(0); }

    // Nango's PUT /user/password requires a session cookie, but Nango sets
    // it with `secure: true` when NANGO_SERVER_URL starts with https, so
    // internal HTTP calls inside the container can never capture it.
    //
    // Instead, we verify the old password by calling signin (200 = correct),
    // then compute the new PBKDF2 hash inside the container (same params
    // Nango uses) and update the _nango_users table directly via psql.
    const script = `
      import crypto from 'node:crypto';
      import util from 'node:util';
      const pbkdf2Async = util.promisify(crypto.pbkdf2);

      const base = 'http://127.0.0.1:3003';
      const email = ${JSON.stringify(String(email).trim())};
      const oldPw = ${JSON.stringify(String(oldPassword))};
      const newPw = ${JSON.stringify(String(newPassword))};

      // Step 1: verify old password by attempting signin
      const signin = await fetch(base + '/api/v1/account/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: oldPw }),
      });
      const body = await signin.json().catch(() => ({}));
      if (signin.status !== 200 || !body.user) {
        process.stdout.write('SIGNIN_FAIL ' + signin.status + ' ' + JSON.stringify(body).slice(0, 200));
        process.exit(1);
      }

      // Step 2: compute new salt + hash (same params Nango uses)
      const newSalt = crypto.randomBytes(16).toString('base64');
      const newHash = (await pbkdf2Async(newPw, newSalt, 310000, 32, 'sha256')).toString('base64');
      process.stdout.write('OK:' + newSalt + ':' + newHash);
    `;

    printInfo('Verifying current password and computing new credentials...');
    let newSalt: string, newHash: string;
    try {
      const { stdout } = await execFileAsync(
        'docker', ['exec', NANGO_CONTAINER, 'node', '--input-type=module', '-e', script],
        { timeout: 20_000 },
      );
      const out = stdout.trim();
      if (out.startsWith('OK:')) {
        [, newSalt, newHash] = out.split(':');
      } else if (out.startsWith('SIGNIN_FAIL')) {
        printError(`Current password is incorrect.`);
        printInfo('  Check with: eve connectors admin');
        process.exit(1);
      } else {
        printError(`Unexpected: ${out}`);
        process.exit(1);
      }
    } catch (err) {
      printError(`Password change failed: ${(err as Error).message}`);
      process.exit(1);
    }

    // Step 3: update the DB directly
    const pgContainer = await findSynapPostgresContainer();
    if (!pgContainer) {
      printError('Could not find postgres container to update password.');
      printInfo('  Make sure synap-backend is running on this host.');
      process.exit(1);
    }

    const safeEmail = String(email).trim().replace(/'/g, "''");
    try {
      await execFileAsync('docker', [
        'exec', pgContainer,
        'psql', '-U', 'synap', '-d', 'nango',
        '-c', `UPDATE nango._nango_users SET salt = '${newSalt}', hashed_password = '${newHash}' WHERE email = '${safeEmail}';`,
      ], { timeout: 10_000 });
    } catch (err) {
      printError(`Database update failed: ${(err as Error).message}`);
      process.exit(1);
    }

    console.log();
    printSuccess('Password changed successfully.');
    printInfo('  Use the new password to sign in at the Nango dashboard.');
  } else {
    // ── Show credentials ────────────────────────────────────────────────────
    const email = await deriveAdminEmail();
    const password = deriveAdminPassword(secretKey);
    const nangoHost = await readNangoHost();

    printInfo(`  Admin email:    ${colors.primary.bold(email)}`);
    printInfo(`  Admin password: ${colors.primary.bold(password)}`);
    if (email === 'admin@eve.local') {
      printWarning('  Using default stub email — set a real one and re-run `eve add nango`.');
    }
    console.log();
    if (nangoHost) {
      printInfo(`  Dashboard: ${colors.info(nangoHost)}`);
      printInfo('  Open it:   eve connectors dashboard');
    }
    console.log();
    printInfo('  Change password:  eve connectors admin --reset-password');
    printInfo('  Set up a provider: eve connectors setup <provider>');
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Subcommand: dashboard
// ---------------------------------------------------------------------------

async function runDashboard(): Promise<void> {
  console.log();
  printHeader('Eve — Nango Dashboard', '🌐');
  console.log();

  if (!await isNangoRunning()) {
    printError(`Nango container (${NANGO_CONTAINER}) is not running on this host.`);
    printInfo('  Run this command on the pod host (where Docker runs).');
    process.exit(1);
  }

  const nangoHost = await readNangoHost();
  if (!nangoHost) {
    printError('Could not determine Nango dashboard URL.');
    printInfo('  Check that the container has NANGO_SERVER_URL set.');
    process.exit(1);
  }

  printInfo(`  Opening ${colors.info(nangoHost)} ...`);
  openBrowser(nangoHost);
  console.log();
  printInfo('  If the browser didn\'t open, paste this URL:');
  printInfo(`    ${colors.info(nangoHost)}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function connectorsCommand(program: Command): void {
  const connectors = program
    .command('connectors')
    .description('Manage Nango — admin account, OAuth apps, dashboard');

  // `eve connectors setup [provider]`
  connectors
    .command('setup')
    .description('Register a real OAuth app for a provider (Google, GitHub, Notion, Slack, Linear)')
    .argument('[provider]', 'Provider key: google | github | notion | slack | linear')
    .action(async (provider: string | undefined) => {
      await runConnectorsSetup(provider);
    });

  // `eve connectors admin`
  connectors
    .command('admin')
    .description('Show Nango admin credentials (email + password)')
    .option('--reset-password', 'Change the admin password')
    .action(async (opts: { resetPassword?: boolean }) => {
      await runConnectorsAdmin(opts.resetPassword ?? false);
    });

  // `eve connectors dashboard`
  connectors
    .command('dashboard')
    .description('Open the Nango dashboard in your browser')
    .action(async () => {
      await runDashboard();
    });

  // `eve connectors` with no subcommand → show help.
  connectors.action(() => {
    console.log();
    printHeader('Eve — Connectors', '🔌');
    console.log();
    printInfo('Usage: eve connectors <command>');
    console.log();
    printInfo('  setup [provider]      Register a real OAuth app for a provider');
    printInfo('  admin                 Show admin email + password');
    printInfo('  admin --reset-password  Change the admin password');
    printInfo('  dashboard             Open the Nango dashboard in your browser');
    console.log();
    printInfo('Examples:');
    printInfo('  eve connectors setup google');
    printInfo('  eve connectors admin');
    printInfo('  eve connectors admin --reset-password');
    printInfo('  eve connectors dashboard');
    console.log();
  });
}
