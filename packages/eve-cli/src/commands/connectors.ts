/**
 * `eve connectors setup [provider]` — guide the user through registering REAL
 * OAuth apps for Nango integrations (their own Google/GitHub/Notion/… client
 * credentials), not stubs.
 *
 * Why this exists: a fresh `eve add nango` brings up the Nango server and creates
 * the admin account, but Nango ships with NO integrations configured. Until a
 * provider has a real OAuth client_id/secret, `synap connect <provider>` fails
 * with "Integration does not exist". This command closes that gap with a
 * copy-paste-friendly walkthrough and writes the integration straight into Nango
 * via its REST API (reached through `docker exec`, same transport as signup).
 *
 * The integration is created in the same Nango environment the pod backend
 * queries, because we authenticate with the stored `connectors.nango.secretKey`
 * (the NANGO_SECRET_KEY the pod also uses).
 */

import type { Command } from 'commander';
import { execFile } from 'node:child_process';
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

/**
 * A provider the user can set up. A single OAuth app may back several Nango
 * integrations (e.g. one Google Cloud project powers Calendar, Gmail, Drive,
 * and Contacts), so `uniqueKeys` is a list — we create/patch one integration
 * per key with the same credentials.
 */
interface ProviderSpec {
  /** Menu key the user types: `eve connectors setup google`. */
  key: string;
  label: string;
  /** Nango integration unique_keys this OAuth app should back. */
  uniqueKeys: string[];
  /** Nango auth mode — all current providers are OAUTH2. */
  authMode: 'OAUTH2';
  /** Where the user creates the OAuth app. */
  consoleUrl: string;
  /** Human steps to register the app (printed verbatim). */
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

/** Read the Nango bearer secret the pod backend uses (NANGO_SECRET_KEY). */
async function readNangoSecretKey(): Promise<string | null> {
  const secrets = await readEveSecrets(process.cwd()).catch(() => null);
  return secrets?.connectors?.nango?.secretKey ?? null;
}

/** True if the Nango container is running locally (this host). */
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

/** The OAuth redirect URI providers must whitelist — Nango's callback. */
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

/**
 * Create or update a single Nango integration with real OAuth credentials.
 * Runs inside the container against 127.0.0.1:3003 (IPv4 — Nango doesn't bind
 * ::1), the same transport `eve add nango` uses for signup.
 *
 * Returns { ok, action } where action is 'created' | 'updated', or an error msg.
 */
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

  // Try POST (create); on "already exists" fall back to PATCH (update).
  const script = `
    const base = 'http://127.0.0.1:3003';
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ${JSON.stringify(secretKey)} };
    const post = await fetch(base + '/integrations', { method: 'POST', headers, body: ${JSON.stringify(payload)} })
      .then(async r => ({ status: r.status, body: await r.text() })).catch(e => ({ status: 0, body: String(e) }));
    if (post.status >= 200 && post.status < 300) { process.stdout.write('created'); process.exit(0); }
    // Already exists (or other 400) → try updating credentials in place.
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
    if (out === 'created' || out === 'updated') return { ok: true, action: out };
    return { ok: false, error: out || 'unknown error' };
  } catch (err) {
    const e = err as { stdout?: string; message?: string };
    return { ok: false, error: (e.stdout?.trim() || e.message || 'exec failed') };
  }
}

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
    printError('No Nango secret key found in secrets.json (connectors.nango.secretKey).');
    printInfo('  Run `eve add nango` first — it generates and stores the key.');
    process.exit(1);
  }

  // Resolve which provider to configure.
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

  // Walkthrough.
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
    printWarning('    Could not read NANGO_SERVER_URL — set a domain (`eve domain ...`) and re-run `eve add nango`.');
  }
  console.log();

  // Collect credentials.
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

  // Create/update one integration per unique_key backed by this OAuth app.
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

  // Persist a record of which OAuth apps are configured (no secret stored).
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

export function connectorsCommand(program: Command): void {
  const connectors = program
    .command('connectors')
    .description('Configure external service OAuth apps (Nango integrations)');

  connectors
    .command('setup')
    .description('Register a real OAuth app for a provider (Google, GitHub, Notion, Slack, Linear)')
    .argument('[provider]', 'Provider key: google | github | notion | slack | linear')
    .action(async (provider: string | undefined) => {
      await runConnectorsSetup(provider);
    });

  // `eve connectors` with no subcommand → run the interactive setup picker.
  connectors.action(async () => {
    await runConnectorsSetup(undefined);
  });
}
