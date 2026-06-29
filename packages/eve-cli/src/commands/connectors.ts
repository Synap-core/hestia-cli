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
import {
  readEveSecrets,
  writeEveSecrets,
  readAgentKeyOrLegacy,
  resolveSynapUrlOnHost,
} from '@eve/dna';
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

/**
 * Read the actual Nango admin email from the `_nango_users` table.
 * Falls back to the legacy derivation from secrets if the DB is unreachable.
 */
async function readNangoAdminEmail(): Promise<string> {
  const pg = await findSynapPostgresContainer();
  if (pg) {
    try {
      const { stdout } = await execFileAsync('docker', [
        'exec', pg, 'psql', '-U', 'synap', '-d', 'nango',
        '-t', '-c',
        "SELECT email FROM nango._nango_users WHERE role = 'administrator' AND email NOT LIKE 'unknown@%' ORDER BY id LIMIT 1;",
      ], { timeout: 10_000 });
      const email = stdout.trim();
      if (email && email.includes('@')) return email;
    } catch { /* DB query failed — fall through to fallback */ }
  }
  // Legacy fallback: derive from unrelated secrets (fragile, but better than nothing)
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

/**
 * Check whether the given email's password hash matches the derived password.
 * Returns true if it's the default, false if it was changed, null on error.
 */
async function checkIsDefaultPassword(email: string, derivedPw: string, pgContainer: string): Promise<boolean | null> {
  try {
    const safeEmail = email.replace(/'/g, "''");
    const { stdout: dbOut } = await execFileAsync('docker', [
      'exec', pgContainer, 'psql', '-U', 'synap', '-d', 'nango',
      '-t', '-c',
      `SELECT salt, hashed_password FROM nango._nango_users WHERE email = '${safeEmail}';`,
    ], { timeout: 10_000 });
    const parts = dbOut.trim().split('|').map(s => s.trim());
    if (parts.length < 2) return null;
    const [dbSalt, dbHash] = parts;

    const hashScript = `
      import crypto from 'node:crypto';
      import util from 'node:util';
      const pbkdf2Async = util.promisify(crypto.pbkdf2);
      const hash = (await pbkdf2Async(${JSON.stringify(derivedPw)}, ${JSON.stringify(dbSalt)}, 310000, 32, 'sha256')).toString('base64');
      process.stdout.write(hash);
    `;
    const { stdout: computedHash } = await execFileAsync(
      'docker', ['exec', NANGO_CONTAINER, 'node', '--input-type=module', '-e', hashScript],
      { timeout: 10_000 },
    );
    return computedHash.trim() === dbHash;
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

/**
 * Auth mechanism a connector uses. Generalized from the former `'OAUTH2'`
 * literal so the catalog can describe non-Nango connector types (api_key,
 * passkey, mcp, basic) alongside the existing OAuth-via-Nango entries.
 *
 * The two paths are complementary, not exclusive. The OAuth *connection* for an
 * `oauth2` connector is declared through the Nango integration path
 * (`eve connectors setup`). The tool *row* — including for an `oauth2` catalog
 * entry such as `nango-gmail` (whose `credentialRef` is `nango://gmail`) — is
 * seeded headlessly through the backend's `/api/hub/capabilities/apply` door
 * (`eve capabilities apply`), the same door the non-oauth (`api_key`, `passkey`,
 * `mcp`, `basic`) types use. So an `oauth2` entry typically needs BOTH: the
 * connection from `eve connectors setup` and the tool row from `capabilities apply`.
 */
export type ConnectorAuthMode = 'oauth2' | 'api_key' | 'passkey' | 'mcp' | 'basic';

interface ProviderSpec {
  key: string;
  label: string;
  uniqueKeys: string[];
  authMode: ConnectorAuthMode;
  consoleUrl: string;
  steps: string[];
}

const PROVIDERS: ProviderSpec[] = [
  {
    key: 'google',
    label: 'Google (Calendar, Gmail, Drive, Contacts)',
    uniqueKeys: ['google-calendar', 'google-mail', 'google-drive', 'google-contacts'],
    authMode: 'oauth2',
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
    authMode: 'oauth2',
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
    authMode: 'oauth2',
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
    authMode: 'oauth2',
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
    authMode: 'oauth2',
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
  // Nango's REST API expects the credential `type` in its own uppercase wire
  // form (e.g. "OAUTH2"). The catalog now carries lowercase ConnectorAuthMode
  // values, so normalise here at the Nango boundary.
  const nangoType = authMode.toUpperCase();
  const payload = JSON.stringify({
    provider,
    unique_key: uniqueKey,
    credentials: { type: nangoType, client_id: clientId, client_secret: clientSecret },
  });
  const patchPayload = JSON.stringify({
    credentials: { type: nangoType, client_id: clientId, client_secret: clientSecret },
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
// Backend tool-row seeding (capability-substrate `tools` table)
// ---------------------------------------------------------------------------

/**
 * Resolve eve's existing pod connection (loopback URL on the host + the `eve`
 * agent's Hub Protocol key). Reuses the same auth `eve capabilities` uses — no
 * new credentials are introduced.
 */
async function resolvePodToolsConnection(): Promise<{ synapUrl: string; apiKey: string } | null> {
  const secrets = await readEveSecrets(process.cwd()).catch(() => null);
  const synapUrl = await resolveSynapUrlOnHost(secrets).catch(() => null);
  if (!synapUrl) return null;
  const apiKey = (await readAgentKeyOrLegacy('eve', process.cwd()).catch(() => '')).trim();
  if (!apiKey) return null;
  return { synapUrl, apiKey };
}

/**
 * Seed a backend `tools` row for a Nango OAuth provider through the Hub door,
 * so the capability substrate sees the connector immediately after `setup`
 * (instead of waiting for the frontend's `syncToolRows`). Mirrors how the
 * `nango-gmail` capability template defines its provider tool:
 *   { name, kind: 'provider', credentialRef: 'nango://<provider>',
 *     config: { providerConfigKey: '<provider>' } }.
 *
 * Additive and fail-soft: a failure here NEVER fails the OAuth declare flow —
 * it only warns, since the frontend `syncToolRows` still backfills the row.
 */
async function seedToolRow(
  conn: { synapUrl: string; apiKey: string },
  provider: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = `${conn.synapUrl.replace(/\/$/, '')}/api/hub/tools`;
  const body = JSON.stringify({
    name: provider,
    kind: 'provider',
    credentialRef: `nango://${provider}`,
    config: { providerConfigKey: provider },
  });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${conn.apiKey}`,
      },
      body,
    });
    const rawText = await res.text();
    if (!res.ok) {
      let detail = rawText;
      try {
        const parsed = JSON.parse(rawText) as { error?: string };
        if (parsed.error) detail = parsed.error;
      } catch { /* keep raw text */ }
      return { ok: false, error: `HTTP ${res.status}: ${detail}`.slice(0, 200) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'request failed' };
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

  // Seed the backend `tools` row(s) headlessly so the capability substrate sees
  // each provider immediately — reusing eve's existing pod connection. Additive
  // and fail-soft: the frontend `syncToolRows` still backfills if this fails.
  const toolsConn = await resolvePodToolsConnection();
  if (toolsConn) {
    for (const r of results) {
      if (!r.ok) continue;
      const seed = await seedToolRow(toolsConn, r.uniqueKey);
      if (seed.ok) {
        printSuccess(`  Seeded backend tool row: ${r.uniqueKey}`);
      } else {
        printWarning(`  Could not seed tool row for ${r.uniqueKey} (${seed.error}) — the frontend will backfill it.`);
      }
    }
  } else {
    printWarning('  Skipped backend tool-row seeding (no pod connection) — the frontend will backfill it.');
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

async function runConnectorsAdmin(opts: { resetPassword?: boolean; setEmail?: string; force?: boolean }): Promise<void> {
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

  const pgContainer = await findSynapPostgresContainer();
  if (!pgContainer) {
    printError('Could not find the synap-backend postgres container.');
    printInfo('  Make sure synap-backend is running on this host.');
    process.exit(1);
  }

  // ── --set-email ──────────────────────────────────────────────────────────
  if (opts.setEmail) {
    const newEmail = opts.setEmail.trim();
    if (!newEmail.includes('@')) {
      printError(`Invalid email: ${newEmail}`);
      process.exit(1);
    }

    // Verify there's an admin user to update
    const { stdout: current } = await execFileAsync('docker', [
      'exec', pgContainer, 'psql', '-U', 'synap', '-d', 'nango',
      '-t', '-c',
      "SELECT email FROM nango._nango_users WHERE role = 'administrator' AND email NOT LIKE 'unknown@%' ORDER BY id LIMIT 1;",
    ], { timeout: 10_000 }).catch(() => ({ stdout: '' }));
    const currentEmail = current.trim();

    const safeNew = newEmail.replace(/'/g, "''");
    await execFileAsync('docker', [
      'exec', pgContainer, 'psql', '-U', 'synap', '-d', 'nango',
      '-c', `UPDATE nango._nango_users SET email = '${safeNew}' WHERE email = '${currentEmail.replace(/'/g, "''")}';`,
    ], { timeout: 10_000 });

    console.log();
    printSuccess(`Admin email updated: ${currentEmail} → ${colors.primary.bold(newEmail)}`);
    printInfo('  Use this email to sign in at the Nango dashboard.');
    console.log();
    return;
  }

  // ── --reset-password ─────────────────────────────────────────────────────
  if (opts.resetPassword) {
    const currentEmail = await readNangoAdminEmail();
    const email = await text({
      message: 'Admin email',
      initialValue: currentEmail,
      validate: (v) => (v && v.includes('@') ? undefined : 'Enter a valid email'),
    });
    if (isCancel(email)) { cancel('Cancelled.'); process.exit(0); }

    let oldPassword = '';
    if (!opts.force) {
      oldPassword = await password({
        message: 'Current password',
        validate: (v) => (v && v.length > 0 ? undefined : 'Required'),
      }) as string;
      if (isCancel(oldPassword)) { cancel('Cancelled.'); process.exit(0); }
    }

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
    }) as string;
    if (isCancel(newPassword)) { cancel('Cancelled.'); process.exit(0); }

    const safeEmail = String(email).trim().replace(/'/g, "''");
    let newSalt: string, newHash: string;

    if (opts.force) {
      printInfo('Skipping old-password check (--force)...');
      const hashScript = `
        import crypto from 'node:crypto';
        import util from 'node:util';
        const pbkdf2Async = util.promisify(crypto.pbkdf2);
        const newPw = ${JSON.stringify(String(newPassword))};
        const newSalt = crypto.randomBytes(16).toString('base64');
        const newHash = (await pbkdf2Async(newPw, newSalt, 310000, 32, 'sha256')).toString('base64');
        process.stdout.write(newSalt + ':' + newHash);
      `;
      try {
        const { stdout } = await execFileAsync(
          'docker', ['exec', NANGO_CONTAINER, 'node', '--input-type=module', '-e', hashScript],
          { timeout: 15_000 },
        );
        [newSalt, newHash] = stdout.trim().split(':');
      } catch (err) {
        printError(`Failed to compute password hash: ${(err as Error).message}`);
        process.exit(1);
      }
    } else {
      const verifyScript = `
        import crypto from 'node:crypto';
        import util from 'node:util';
        const pbkdf2Async = util.promisify(crypto.pbkdf2);
        const base = 'http://127.0.0.1:3003';
        const signin = await fetch(base + '/api/v1/account/signin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: ${JSON.stringify(String(email).trim())}, password: ${JSON.stringify(String(oldPassword))} }),
        });
        const body = await signin.json().catch(() => ({}));
        if (signin.status !== 200 || !body.user) {
          process.stdout.write('SIGNIN_FAIL ' + signin.status + ' ' + JSON.stringify(body).slice(0, 200));
          process.exit(1);
        }
        const newPw = ${JSON.stringify(String(newPassword))};
        const newSalt = crypto.randomBytes(16).toString('base64');
        const newHash = (await pbkdf2Async(newPw, newSalt, 310000, 32, 'sha256')).toString('base64');
        process.stdout.write(newSalt + ':' + newHash);
      `;

      printInfo('Verifying current password...');
      try {
        const { stdout } = await execFileAsync(
          'docker', ['exec', NANGO_CONTAINER, 'node', '--input-type=module', '-e', verifyScript],
          { timeout: 20_000 },
        );
        const out = stdout.trim();
        if (out.startsWith('SIGNIN_FAIL')) {
          printError('Current password is incorrect.');
          printInfo('  The password shown by `eve connectors admin` is derived from the secret');
          printInfo('  key — if the account was set up manually, use the password you chose.');
          printInfo('  Or force-reset without knowing the old password:');
          printInfo('    eve connectors admin --reset-password --force');
          process.exit(1);
        }
        [newSalt, newHash] = out.split(':');
      } catch (err) {
        printError(`Could not verify password: ${(err as Error).message}`);
        printInfo('  Try with --force to skip verification:');
        printInfo('    eve connectors admin --reset-password --force');
        process.exit(1);
      }
    }

    await execFileAsync('docker', [
      'exec', pgContainer, 'psql', '-U', 'synap', '-d', 'nango',
      '-c', `UPDATE nango._nango_users SET salt = '${newSalt}', hashed_password = '${newHash}' WHERE email = '${safeEmail}';`,
    ], { timeout: 10_000 });

    console.log();
    printSuccess('Password changed successfully.');
    console.log();
    return;
  }
  // ── Show credentials (default) ───────────────────────────────────────────
  const email = await readNangoAdminEmail();
  const adminPw = deriveAdminPassword(secretKey);
  const nangoHost = await readNangoHost();

  printInfo(`  Admin email:    ${colors.primary.bold(email)}`);

  // Check whether the password is still the default derived one.
  const pwStatus = await checkIsDefaultPassword(email, adminPw, pgContainer);
  if (pwStatus === true) {
    printInfo(`  Admin password: ${colors.primary.bold(adminPw)} (default from secret key)`);
  } else if (pwStatus === false) {
    printInfo(`  Admin password: ${colors.warning('(custom — was changed via --reset-password)')}`);
  } else {
    printInfo(`  Admin password: ${colors.primary.bold(adminPw)} (derived — could not verify)`);
  }
  if (email === 'admin@eve.local') {
    printWarning('  Still using the stub email — update it:');
    printInfo('    eve connectors admin --set-email you@example.com');
  }
  console.log();
  if (nangoHost) {
    printInfo(`  Dashboard: ${colors.info(nangoHost)}`);
  }
  console.log();
  printInfo('  Change email:     eve connectors admin --set-email <email>');
  printInfo('  Change password:  eve connectors admin --reset-password');
  printInfo('  Force-reset pw:   eve connectors admin --reset-password --force');
  printInfo('  Set up providers: eve connectors setup <provider>');
  console.log();
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
    .option('--force', 'Skip old-password verification (for --reset-password)')
    .option('--set-email <email>', 'Update the admin email')
    .action(async (opts: { resetPassword?: boolean; setEmail?: string; force?: boolean }) => {
      await runConnectorsAdmin({ resetPassword: opts.resetPassword, setEmail: opts.setEmail, force: opts.force });
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
