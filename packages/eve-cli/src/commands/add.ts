/**
 * `eve add <component>` — add a component to an existing entity.
 *
 * Resolves the component from the shared registry, checks prerequisites,
 * runs the appropriate organ install, then updates state.json and setup-profile.json.
 */

import type { Command } from 'commander';
import { execa } from 'execa';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { select, text, isCancel, cancel } from '@clack/prompts';
import {
  entityStateManager,
  readEveSecrets,
  writeEveSecrets,
  ensureEveSkillsLayout,
  defaultSkillsDir,
} from '@eve/dna';

const execFileAsync = promisify(execFile);

/** True if a container with that name exists (any state). */
async function containerExists(name: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'docker', ['ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}'],
      { timeout: 4000 },
    );
    return stdout.trim() === name;
  } catch { return false; }
}

/**
 * Find a running canonical Synap compose service by labels. Eve's
 * `eve-brain-*` values are Docker network aliases, never container names.
 */
async function findSynapComposeContainer(
  service: 'backend' | 'pod-admin',
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'ps',
        '--filter', 'label=com.docker.compose.project=synap-backend',
        '--filter', `label=com.docker.compose.service=${service}`,
        '--format', '{{.Names}}',
      ],
      { timeout: 4000 },
    );
    return stdout.trim().split('\n')[0]?.trim() || null;
  } catch { return null; }
}

async function findSynapBackendContainer(): Promise<string | null> {
  return findSynapComposeContainer('backend');
}

function hasCanonicalSynapDeployment(): boolean {
  const delegate = resolveSynapDelegate();
  return Boolean(delegate && existsSync(join(delegate.deployDir, '.env')));
}

/**
 * An existing canonical Pod is recovered by its own CLI, never by rerunning
 * installation. A missing Pod Admin service must not cause Eve to replace the
 * Pod's bootstrap path or ask the operator for installation details again.
 */
async function reportExistingSynapDeployment(): Promise<boolean> {
  const delegate = resolveSynapDelegate();
  if (!delegate || !hasCanonicalSynapDeployment()) return false;

  const [backend, podAdmin] = await Promise.all([
    findSynapComposeContainer('backend'),
    findSynapComposeContainer('pod-admin'),
  ]);

  printWarning(`Synap Data Pod is already installed at ${delegate.repoRoot}.`);
  if (backend && podAdmin) {
    await entityStateManager.updateComponentEntry('synap', { state: 'ready' });
    printInfo(`  Backend (${backend}) and Pod Admin (${podAdmin}) are running.`);
  } else {
    await entityStateManager.updateComponentEntry('synap', { state: 'error' });
    const missing = [!backend && 'backend', !podAdmin && 'pod-admin']
      .filter(Boolean)
      .join(', ');
    printWarning(`  Pod service${missing.includes(',') ? 's' : ''} not running: ${missing}.`);
    printInfo('  Eve will not reinstall the Pod or replace its identity.');
    printInfo('  Recover it with: eve update synap');
  }
  return true;
}

async function findSynapPostgresContainer(): Promise<string | null> {
  try {
    // Match any compose postgres service regardless of project name
    const { stdout } = await execFileAsync(
      'docker',
      [
        'ps',
        '--filter', 'label=com.docker.compose.service=postgres',
        '--filter', 'ancestor=postgres',
        '--format', '{{.Names}}',
      ],
      { timeout: 4000 },
    );
    return stdout.trim().split('\n')[0]?.trim() || null;
  } catch { return null; }
}

/**
 * Returns true if the brain (synap) is ready.
 * Checks state.json first; if state says error/missing but the synap backend
 * container is actually running, auto-reconciles state to 'ready' so
 * manually-deployed pods don't get blocked.
 */
async function isBrainReady(): Promise<boolean> {
  const state = await entityStateManager.getState();
  if (state.organs.brain.state === 'ready') return true;

  // State is stale — check if the synap backend container is actually running
  const container = await findSynapBackendContainer();
  if (!container) return false;

  // Container is up but state is wrong — reconcile
  printInfo(`Synap container (${container}) is running — reconciling state to ready.`);
  await entityStateManager.updateOrgan('brain', 'ready');
  return true;
}
import { runBrainInit, runInferenceInit, resolveSynapDelegate } from '@eve/brain';
import { runLegsProxySetup, verifyComponent, installDashboardContainer } from '@eve/legs';
import { materializeTargets, normalizeBareDomain } from '@eve/lifecycle';
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
import {
  COMPONENTS,
  type ComponentInfo,
  resolveComponent,
  selectedIds,
  allComponentIds,
} from '../lib/components.js';

// Organ → install function mapping for add operations.
// Each add operation is lighter than a fresh install — no full setup wizard.

interface AddFn {
  label: string;
  fn: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component-specific add implementations
// ---------------------------------------------------------------------------

async function addTraefik(): Promise<void> {
  await runLegsProxySetup({ standalone: true });
}

async function addSynap(): Promise<void> {
  // Resolution chain matches `eve install` (single funnel): explicit flag
  // → SYNAP_REPO_ROOT → resolveSynapDelegate (auto-detect /opt/synap-backend
  // and friends). The previous version checked only the env var and bailed
  // even when /opt/synap-backend was right there.
  const flags = process.argv.slice(2);
  const flagRepoIdx = flags.indexOf('--synap-repo');
  const flagRepo = flagRepoIdx >= 0 ? flags[flagRepoIdx + 1] : undefined;
  const envRepo = process.env.SYNAP_REPO_ROOT;
  const delegate = resolveSynapDelegate();
  const repoRoot = flagRepo || envRepo || delegate?.repoRoot;
  if (!repoRoot || !existsSync(repoRoot)) {
    printWarning(
      'Synap installation requires a synap-backend checkout.\n' +
      `  Pass --synap-repo <path>, set SYNAP_REPO_ROOT, or clone to /opt/synap-backend.\n` +
      '  See: https://github.com/synap/synap-backend',
    );
    process.exit(1);
  }

  // Pull domain/email from secrets so an existing pod doesn't get reset to
  // localhost defaults. Mirrors what gatherInstallConfig does for `eve install`.
  // `eve` is commonly invoked from the Pod deploy directory during recovery.
  // Its own domain/contact settings live in EVE_HOME, not in that transient
  // current directory.
  const secrets = await readEveSecrets(process.env.EVE_HOME ?? process.cwd()).catch(() => null);
  const flagDomainIdx = flags.indexOf('--domain');
  const flagDomain = flagDomainIdx >= 0 ? flags[flagDomainIdx + 1] : undefined;
  const domain =
    normalizeBareDomain(flagDomain) ||
    normalizeBareDomain(secrets?.domain?.primary) ||
    'localhost';
  const email =
    process.env.LETSENCRYPT_EMAIL?.trim() ||
    secrets?.domain?.email?.trim() ||
    (domain !== 'localhost' ? `noreply@${domain}` : undefined);

  await runBrainInit({
    synapRepo: repoRoot,
    domain,
    email,
    adminBootstrapMode: 'token',
    withAi: false,
    withOpenclaw: false,
    withRsshub: false,
  });
}

async function addOllama(model?: string): Promise<void> {
  await runInferenceInit({ model, withGateway: true, internalOllamaOnly: true });
}

async function addOpenclaw(): Promise<void> {
  if (!await isBrainReady()) {
    printError('Brain is not ready. Please install Synap first: `eve add synap`');
    process.exit(1);
  }

  // Check for synap delegate (bash script path)
  const synapScript = process.env.SYNAP_SETUP_SCRIPT;
  if (synapScript && existsSync(synapScript)) {
    await execa('bash', [synapScript, 'profiles', 'enable', 'openclaw'], {
      env: { ...process.env, SYNAP_DEPLOY_DIR: process.env.SYNAP_DEPLOY_DIR || '', SYNAP_ASSUME_YES: '1' },
      stdio: 'inherit',
    });
    await execa('bash', [synapScript, 'services', 'add', 'openclaw'], {
      env: { ...process.env, SYNAP_DEPLOY_DIR: process.env.SYNAP_DEPLOY_DIR || '', SYNAP_ASSUME_YES: '1' },
      stdio: 'inherit',
    });
  } else {
    printWarning('OpenClaw add via Synap delegate not available.');
    printInfo('  Set SYNAP_SETUP_SCRIPT to point to synap-backend/setup.sh for auto-provisioning.');
    printInfo('  Otherwise install OpenClaw manually: https://github.com/danielmiessler/openclaw');
  }
}

/**
 * Patch Nango's Connect UI index.html with a setImmediate polyfill, copy the
 * patched file to the host, then recreate the container with it volume-mounted
 * read-only so the fix survives restarts and image updates.
 */
async function applyNangoConnectUiPolyfill(originalDockerRunArgs: string[]): Promise<void> {
  const hostPath = '/opt/nango/connect-ui-index.html';
  const containerPath = '/app/nango/packages/connect-ui/dist/index.html';
  const containerName = 'eve-arms-nango';
  const image = 'nangohq/nango-server:hosted';

  printInfo('Applying setImmediate polyfill to Nango Connect UI...');

  // Extract the ORIGINAL index.html from a FRESH temp container (no volume
  // mount), NOT from the running container. The running container may have
  // a stale host file mounted with outdated asset hashes from a previous
  // Nango version.
  const extractAndPatch = `
    const fs = require('fs');
    const p = '${containerPath}';
    let h = fs.readFileSync(p, 'utf8');
    if (h.includes('window.setImmediate = window.setImmediate ||')) {
      console.log('already patched'); process.exit(0);
    }
    const poly = '<script>\\n(function() {\\n' +
      '  window.setImmediate = window.setImmediate || function(fn) {\\n' +
      '    var args = Array.prototype.slice.call(arguments, 1);\\n' +
      '    var id = setTimeout(function() { fn.apply(null, args); }, 0);\\n' +
      '    return { _id: id, type: \\'Immediate\\' };\\n' +
      '  };\\n' +
      '  window.clearImmediate = window.clearImmediate || function(h) { clearTimeout(h && h._id !== undefined ? h._id : h); };\\n' +
      '})();\\n' +
      '<\\/script>';
    // Insert as first element in <head> so it runs before any module scripts
    h = h.replace('<head>', '<head>\\n' + poly);
    fs.writeFileSync(p, h);
    console.log('patched ok');
  `.trim();

  const tmpContainer = 'eve-nango-polyfill-tmp';
  try {
    await execFileAsync('docker', ['rm', '-f', tmpContainer], { timeout: 10_000 }).catch(() => {});
    await execFileAsync('docker', ['create', '--name', tmpContainer, image], { timeout: 15_000 });
    await execFileAsync('docker', ['exec', tmpContainer, 'node', '-e', extractAndPatch], { timeout: 15_000 });
    await execFileAsync('sh', ['-c', `mkdir -p "$(dirname ${hostPath})"`], { timeout: 5_000 }).catch(() => {});
    await execFileAsync('docker', ['cp', `${tmpContainer}:${containerPath}`, hostPath], { timeout: 10_000 });
    await execFileAsync('docker', ['rm', '-f', tmpContainer], { timeout: 10_000 }).catch(() => {});
  } catch (err) {
    printWarning(`  Could not patch via temp container: ${(err as Error).message}`);
    // Fallback: patch running container (works on first install before volume mount)
    try {
      await execFileAsync('docker', ['exec', containerName, 'node', '-e', extractAndPatch], { timeout: 15_000 });
      await execFileAsync('docker', ['cp', `${containerName}:${containerPath}`, hostPath], { timeout: 10_000 });
    } catch (err2) {
      printWarning(`  Fallback also failed: ${(err2 as Error).message}`);
      return;
    }
  }

  // Recreate container with the patched file mounted read-only.
  printInfo('  Recreating container with polyfill volume mount...');
  await execFileAsync('docker', ['rm', '-f', containerName], { timeout: 10_000 }).catch(() => {});
  const newArgs = [
    ...originalDockerRunArgs,
    '-v', `${hostPath}:${containerPath}:ro`,
  ];
  await execFileAsync('docker', newArgs, { timeout: 30_000 });
  printInfo('  Container recreated — polyfill is now permanent.');
}

/** Wait for Nango to accept requests then create the initial admin account (idempotent). */
/**
 * Create/verify the Nango admin account and return the environment's actual
 * secret key (the one stored in _nango_environments, NOT the UUID we generated).
 *
 * Nango's signup creates its own environment secret key — our generated UUID
 * is only used as NANGO_SECRET_KEY (server-level identifier) during container
 * startup, but API calls must use the environment key from the Nango DB.
 */
async function nangoAutoSignup(secretKey: string, ownerEmail?: string): Promise<string | null> {
  const email = ownerEmail ?? 'admin@eve.local';
  // Derived password satisfies Nango's complexity rules: uppercase + lowercase + number + special
  const pw = `Nango_${secretKey.slice(0, 12)}`;
  // Use 127.0.0.1 explicitly — inside the container `localhost` may resolve to IPv6 ::1
  // while Nango only binds on IPv4, causing ECONNREFUSED.
  const node = `
    const attempt = (n) => fetch('http://127.0.0.1:3003/api/v1/account/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin', email: ${JSON.stringify(email)}, password: ${JSON.stringify(pw)} }),
    }).then(r => r.json()).then(d => {
      const code = d?.error?.code ?? d?.error;
      if (d?.data?.uuid || code === 'account_already_exists' || code === 'email_not_verified') process.exit(0);
      if (n > 0) setTimeout(() => attempt(n - 1), 2000); else process.exit(1);
    }).catch(() => { if (n > 0) setTimeout(() => attempt(n - 1), 2000); else process.exit(1); });
    attempt(15);
  `;
  await execFileAsync('docker', ['exec', 'eve-arms-nango', 'node', '-e', node], { timeout: 40_000 }).catch(() => {/* non-fatal */});

  // Auto-verify the email directly in the DB so login works without SMTP.
  const pgContainer = await findSynapPostgresContainer();
  if (pgContainer) {
    await execFileAsync('docker', [
      'exec', pgContainer,
      'psql', '-U', 'synap', '-d', 'nango',
      '-c', `UPDATE nango._nango_users SET email_verified = true WHERE email = '${email}';`,
    ], { timeout: 10_000 }).catch(() => {/* non-fatal — table may not exist yet */});
  }

  // Fetch the actual environment secret key from Nango via signin + /api/v1/environment.
  // This is the key that must be used as Bearer token for all subsequent API calls.
  const fetchEnvKey = `
    const signin = await fetch('http://127.0.0.1:3003/api/v1/account/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(pw)} }),
    }).then(r => r.json()).catch(() => null);
    const token = signin?.data?.token;
    if (!token) { process.stdout.write(''); process.exit(0); }
    const env = await fetch('http://127.0.0.1:3003/api/v1/environment', {
      headers: { Authorization: 'Bearer ' + token },
    }).then(r => r.json()).catch(() => null);
    const key = env?.data?.secret_key ?? env?.secret_key ?? '';
    process.stdout.write(key);
  `;
  try {
    const { stdout } = await execFileAsync('docker', ['exec', 'eve-arms-nango', 'node', '--input-type=module', '-e', fetchEnvKey], { timeout: 15_000 });
    const envKey = stdout.trim();
    if (envKey && envKey.length > 10) {
      printInfo(`  Nango environment secret key retrieved: ${envKey.slice(0, 8)}...`);
      return envKey;
    }
  } catch { /* non-fatal — caller falls back to generated key */ }
  return null;
}

async function addNango(): Promise<void> {
  if (!await isBrainReady()) {
    printError('Brain is not ready. Install Synap first: `eve add synap`');
    process.exit(1);
  }

  const { randomUUID } = await import('node:crypto');
  const { readFile, writeFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { join: pathJoin } = await import('node:path');

  // Generate a UUID v4 secret key — Nango validates the key must be UUID v4 format
  const secrets = await readEveSecrets(process.cwd()).catch(() => null);
  const existingKey = secrets?.connectors?.nango?.secretKey;
  const uuidV4Re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const secretKey = (existingKey && uuidV4Re.test(existingKey)) ? existingKey : randomUUID();

  // Resolve deploy/.env early so we can read PUBLIC_URL and postgres credentials
  // BEFORE they're needed (the nango DB below is created with pgUser).
  // Detection order:
  //   1. SYNAP_DEPLOY_DIR env var (explicit override)
  //   2. Well-known path /opt/synap-backend/deploy
  //   3. Auto-detect from running backend container's compose project.working_dir label
  const _autoDetectDeployDir = async (): Promise<string | null> => {
    const container = await findSynapBackendContainer();
    if (!container) return null;
    try {
      const { stdout } = await execFileAsync('docker', [
        'inspect', container,
        '--format', '{{index .Config.Labels "com.docker.compose.project.working_dir"}}',
      ], { timeout: 4000 });
      const dir = stdout.trim();
      return dir || null;
    } catch { return null; }
  };
  const deployDir: string | null =
    process.env.SYNAP_DEPLOY_DIR ||
    (existsSync('/opt/synap-backend/deploy') ? '/opt/synap-backend/deploy' : null) ||
    await _autoDetectDeployDir();

  let podPublicUrl = '';
  let pgUser = 'synap';
  let pgPassword = 'synap';
  if (deployDir) {
    const { readFile: rf } = await import('node:fs/promises');
    const envPath = pathJoin(deployDir, '.env');
    try {
      const envContent = await rf(envPath, 'utf8');
      const matchUrl = envContent.match(/^PUBLIC_URL=(.+)$/m);
      if (matchUrl?.[1]) podPublicUrl = matchUrl[1].trim();
      const matchUser = envContent.match(/^POSTGRES_USER=(.+)$/m);
      if (matchUser?.[1]) pgUser = matchUser[1].trim();
      const matchPass = envContent.match(/^POSTGRES_PASSWORD=(.+)$/m);
      if (matchPass?.[1]) pgPassword = matchPass[1].trim();
    } catch { /* .env may not exist yet */ }
  }

  // Find the actual postgres container (name varies by compose project, e.g. synap-backend-postgres-1)
  const postgresContainer = await findSynapPostgresContainer();
  if (!postgresContainer) {
    printWarning('  Could not find synap-backend postgres container — skipping database creation.');
  } else {
    // Create the nango database in the shared postgres instance
    printInfo(`Creating Nango database in ${postgresContainer}...`);
    try {
      await execFileAsync('docker', [
        'exec', postgresContainer,
        'psql', '-U', pgUser, '-c',
        'CREATE DATABASE nango;',
      ], { timeout: 10_000 });
    } catch {
      // Ignore "already exists" errors — idempotent
    }

    // Nango runs on eve-network but postgres is on synap-backend's compose network.
    // Connect postgres to eve-network with the alias `eve-brain-postgres` so Nango
    // can resolve it by that hostname.
    try {
      await execFileAsync('docker', [
        'network', 'connect', '--alias', 'eve-brain-postgres',
        'eve-network', postgresContainer,
      ], { timeout: 10_000 });
      printInfo(`  Connected ${postgresContainer} to eve-network as eve-brain-postgres.`);
    } catch {
      // Already connected — fine
    }
  }

  // Pull image
  printInfo('Pulling nangohq/nango-server:hosted...');
  await execFileAsync('docker', ['pull', 'nangohq/nango-server:hosted'], { timeout: 120_000 });

  // Idempotent container start: remove stopped/crashed container, skip if already running
  const { stdout: runningOut } = await execFileAsync(
    'docker', ['ps', '--filter', 'name=eve-arms-nango', '--format', '{{.Names}}'],
    { timeout: 4000 },
  ).catch(() => ({ stdout: '' }));
  const alreadyRunning = runningOut.trim().split('\n').includes('eve-arms-nango');

  // Derive nangoHost early — needed both for NANGO_SERVER_URL in docker run
  // and for writing NANGO_HOST to deploy/.env. Uses secrets read at startup;
  // domain config won't change during this function.
  const _nangoDomain = secrets?.domain?.primary;
  const _nangoSsl = secrets?.domain?.ssl !== false;
  const nangoHost = _nangoDomain
    ? `${_nangoSsl ? 'https' : 'http'}://nango.${_nangoDomain}`
    : 'http://eve-arms-nango:3003';
  // Connect UI is served on port 3009 at a dedicated subdomain.
  // Falls back to empty string when no domain is configured — written to
  // deploy/.env only when a domain is known.
  const connectUrl = _nangoDomain
    ? `${_nangoSsl ? 'https' : 'http'}://connect.${_nangoDomain}`
    : '';

  if (!alreadyRunning) {
    // Remove stopped/exited container if it exists so docker run can reuse the name
    await execFileAsync('docker', ['rm', '-f', 'eve-arms-nango'], { timeout: 10_000 }).catch(() => {/* not found — fine */});

    // Derive a stable AES encryption key for the keystore (PBKDF2 for session tokens).
    // The keystore module always requires NANGO_ENCRYPTION_KEY — it throws at startup without it.
    const { createHash } = await import('node:crypto');
    const nangoEncryptionKey = createHash('sha256').update(secretKey).digest('base64');

    // Build docker run args — include webhook URL if pod public URL is known
    const dockerRunArgs = [
      'run', '-d',
      '--name', 'eve-arms-nango',
      '--network', 'eve-network',
      '--restart', 'unless-stopped',
      '-e', `NANGO_SECRET_KEY=${secretKey}`,
      // Self-hosted Nango authenticates Bearer tokens via NANGO_SECRET_KEY_<envname> env vars,
      // NOT via the api_secrets DB table. Setting these makes our secretKey the API key for
      // both the prod and dev environments created during account signup.
      '-e', `NANGO_SECRET_KEY_PROD=${secretKey}`,
      '-e', `NANGO_SECRET_KEY_DEV=${secretKey}`,
      // Required by @nangohq/keystore for AES encryption of session tokens — throws without it.
      '-e', `NANGO_ENCRYPTION_KEY=${nangoEncryptionKey}`,
      '-e', 'SERVER_PORT=3003',
      '-e', `NANGO_DATABASE_URL=postgresql://${pgUser}:${pgPassword}@eve-brain-postgres:5432/nango`,
      '-e', 'NODE_ENV=production',
      '-e', 'NANGO_EMAIL_ACCOUNT_VERIFICATION_REQUIRED=false',
      '-e', 'FLAG_SERVE_CONNECT_UI=true',
      '-e', 'NANGO_CONNECT_UI_PORT=3009',
      ...(nangoHost ? ['-e', `NANGO_SERVER_URL=${nangoHost}`] : []),
      // NANGO_PUBLIC_CONNECT_URL: read by Nango server to populate env.js connectUrl field
      // NANGO_CONNECT_URL: read by our NangoConnector to build redirect URLs for the pod backend
      ...(connectUrl ? ['-e', `NANGO_PUBLIC_CONNECT_URL=${connectUrl}`, '-e', `NANGO_CONNECT_URL=${connectUrl}`] : []),
      ...(podPublicUrl ? ['-e', `NANGO_WEBHOOK_URL=${podPublicUrl}/api/connectors/nango-webhook`] : []),
      '-v', 'eve-arms-nango-data:/var/lib/nango',
      'nangohq/nango-server:hosted',
    ];

    printInfo('Starting Nango container...');
    await execFileAsync('docker', dockerRunArgs, { timeout: 30_000 });

    // Patch Connect UI index.html with a setImmediate polyfill, then remount it
    // as a read-only volume so the fix survives container restarts.
    // The browser's native polyfill returns a number; Nango's bundle does
    // `'type' in handle` which throws TypeError on primitives → infinite spinner.
    await applyNangoConnectUiPolyfill(dockerRunArgs);
  } else {
    printInfo('Nango container already running.');
    // Show current admin info — no re-signup needed.
    // The admin account already exists (signup is idempotent but the email
    // prompt would be misleading on re-run).  Use `eve connectors admin`
    // to view or update credentials.
    printInfo('  View admin credentials:  eve connectors admin');
    printInfo('  Update admin email:      eve connectors admin --set-email <email>');
    printInfo('  Change admin password:   eve connectors admin --reset-password');
    // Still write env vars to deploy/.env (may not have been done on first run)
  }

  // Only attempt signup on fresh installs — on re-runs the account exists.
  let ownerEmail: string | undefined;
  if (!alreadyRunning) {
    ownerEmail = secrets?.synap?.userSession?.email ?? secrets?.builder?.openwebui?.adminEmail;
    if (!ownerEmail) {
      console.log();
      ownerEmail = await text({
        message: 'Nango admin email (used to sign in to the dashboard)',
        placeholder: 'you@example.com',
        validate: (v) => (v && v.includes('@') ? undefined : 'Enter a valid email address'),
      }) as string;
      if (isCancel(ownerEmail)) { cancel('Setup cancelled.'); process.exit(0); }
    }
  }
  // nangoAutoSignup returns the actual environment secret key from Nango's DB.
  // Nango generates its own key on first account creation — our generated UUID
  // is only used as NANGO_SECRET_KEY (container env identifier) but the API
  // Bearer token must match the environment key Nango stores internally.
  let effectiveSecretKey = secretKey;
  if (!alreadyRunning) {
    const nangoEnvKey = await nangoAutoSignup(secretKey, ownerEmail);
    if (nangoEnvKey) effectiveSecretKey = nangoEnvKey;
    if (nangoEnvKey && nangoEnvKey !== secretKey) {
      printInfo(`  Using Nango environment key for backend API calls: ${nangoEnvKey.slice(0, 8)}...`);
    }
  }

  if (!podPublicUrl) {
    printWarning('  PUBLIC_URL not found in deploy/.env — NANGO_WEBHOOK_URL not set.');
    printWarning('  After setting PUBLIC_URL, re-run: eve add nango');
  }

  // Write to secrets.json
  await writeEveSecrets({
    ...(secrets ?? {}),
    connectors: {
      ...(secrets?.connectors ?? {}),
      nango: {
        secretKey: effectiveSecretKey,
        installedAt: new Date().toISOString(),
        oauthApps: secrets?.connectors?.nango?.oauthApps ?? {},
      },
    },
  }, process.cwd());

  // Write NANGO_HOST + NANGO_SECRET_KEY to pod deploy/.env
  if (deployDir) {
    const envPath = pathJoin(deployDir, '.env');
    let envContent = '';
    try { envContent = await readFile(envPath, 'utf8'); } catch { /* new file */ }

    const setEnvVar = (content: string, key: string, value: string): string => {
      const re = new RegExp(`^${key}=.*$`, 'm');
      const line = `${key}=${value}`;
      return re.test(content) ? content.replace(re, line) : `${content}\n${line}`;
    };

    // Write NANGO_HOST as the internal Docker URL — the backend calls Nango's API
    // directly, not through the reverse proxy (which strips the Authorization header).
    // The public URLs (NANGO_SERVER_URL, NANGO_CONNECT_URL) are for browser redirects only.
    envContent = setEnvVar(envContent, 'NANGO_HOST', 'http://eve-arms-nango:3003');
    envContent = setEnvVar(envContent, 'NANGO_SECRET_KEY', effectiveSecretKey);
    if (connectUrl) envContent = setEnvVar(envContent, 'NANGO_CONNECT_URL', connectUrl);
    await writeFile(envPath, envContent.trimStart(), 'utf8');
    printInfo(`  Wrote NANGO_HOST=${nangoHost} + NANGO_SECRET_KEY${connectUrl ? ` + NANGO_CONNECT_URL=${connectUrl}` : ''} to ${envPath}`);

    // Recreate synap-backend so it picks up the new env vars from .env.
    // `docker restart` keeps the original env — `compose up --force-recreate`
    // re-reads .env and creates a fresh container with updated vars.
    const backendContainer = await findSynapBackendContainer();
    if (backendContainer) {
      printInfo(`  Recreating ${backendContainer} to apply NANGO_SECRET_KEY...`);
      // Derive the compose service name from the container label
      const { stdout: svcOut } = await execFileAsync('docker', [
        'inspect', backendContainer,
        '--format', '{{index .Config.Labels "com.docker.compose.service"}}',
      ], { timeout: 4000 }).catch(() => ({ stdout: 'backend' }));
      const serviceName = svcOut.trim() || 'backend';
      await execFileAsync('docker', [
        'compose', '--project-directory', deployDir,
        'up', '-d', '--no-deps', '--force-recreate', serviceName,
      ], { timeout: 120_000 });
      printInfo('  Backend recreated with updated env.');
    } else {
      printWarning('  Could not find synap-backend container — run `docker compose up -d --force-recreate backend` in your deploy dir to apply NANGO_SECRET_KEY.');
    }
  } else {
    printWarning('  Could not locate deploy/.env — set SYNAP_DEPLOY_DIR and rerun to write env vars.');
    printInfo(`  Add manually: NANGO_HOST=http://eve-arms-nango:3003  NANGO_SECRET_KEY=${secretKey}`);
  }

  // Wire nango.{domain} subdomain via Traefik (no-op if no domain configured yet)
  await materializeTargets(null, ['traefik-routes']);

  if (!alreadyRunning) {
    const adminPw = `Nango_${secretKey.slice(0, 12)}`;
    printSuccess('Nango installed.');
    printInfo(`  Dashboard: ${nangoHost}`);
    printInfo(`  Admin email: ${ownerEmail ?? 'admin@eve.local'}`);
    printInfo(`  Admin password: ${adminPw}`);
    printInfo('  Email verification is bypassed — sign in directly, do not use the "sign up" link.');
  } else {
    printSuccess('Nango is running.');
    printInfo(`  Dashboard: ${nangoHost}`);
    printInfo('  Manage your account:  eve connectors admin');
  }
  console.log();
  printInfo('  Next: register an OAuth app so users can connect their accounts:');
  printInfo('    eve connectors setup google     # or github, notion, slack, linear');
  printInfo('  Until a provider is set up, `synap connect <provider>` returns "Integration does not exist".');
}

async function addRsshub(): Promise<void> {
  if (!await isBrainReady()) {
    printError('Brain is not ready. Please install Synap first: `eve add synap`');
    process.exit(1);
  }

  // Import the RSSHubService dynamically to avoid hard deps
  const { RSSHubService } = await import('@eve/eyes');
  const rsshub = new RSSHubService();
  if (await rsshub.isInstalled()) {
    printInfo('RSSHub is already installed. Use `eve eyes:start` to start it.');
    return;
  }
  await rsshub.install({ port: 1200 });
  await entityStateManager.updateOrgan('eyes', 'ready');
  printSuccess('RSSHub installed successfully!');
  printInfo('  URL: http://localhost:1200');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AddOptions {
  synapRepo?: string;
  model?: string;
}

/**
 * Add a component to the current entity.
 *
 * This is the shared implementation for both the `eve add` command and
 * programmatic use.
 */
export async function runAdd(
  componentId: string,
  opts: AddOptions = {},
): Promise<void> {
  const comp = resolveComponent(componentId);

  // Synap owns its compose project, persistent volumes and identity. Its
  // `eve-brain-synap` registry value is a network alias, so the generic
  // exact-container drift check below is not valid for this component.
  if (componentId === 'synap' && await reportExistingSynapDeployment()) {
    return;
  }

  const existing = await entityStateManager.isComponentInstalled(componentId);
  if (existing) {
    printWarning(`${comp.label} is already installed.`);
    // `comp.organ` is optional in the registry; fall back to `eve status`
    // when missing so we never print "eve undefined status".
    const statusCmd = comp.organ ? `eve ${comp.organ} status` : 'eve status';
    printInfo(`  Run "${statusCmd}" to check its state.`);

    // Drift detection: state.json says installed but the container is
    // gone (manually removed, host wiped, container never created
    // because a previous install failed mid-way). Auto-reinstall
    // instead of asking the user to manually recover.
    const containerName = comp.service?.containerName;
    if (containerName && !(await containerExists(containerName))) {
      printWarning(`  …but the ${containerName} container is missing. Reinstalling...`);
      await entityStateManager.updateComponentEntry(componentId, { state: 'error' });
      // Fall through to reinstall below
    } else {
      printInfo(`  Or "eve update ${componentId}" to pull the latest image.`);
      return;
    }
  }

  // Check prerequisites
  const currentComponents = await entityStateManager.getInstalledComponents();
  const missingDeps = (comp.requires ?? []).filter(dep => !currentComponents.includes(dep));
  if (missingDeps.length > 0) {
    const depNames = missingDeps.map(dep => {
      const info = COMPONENTS.find(c => c.id === dep);
      return info ? info.label : dep;
    });
    printError(`Missing prerequisites: ${depNames.join(', ')}`);
    printInfo(`  Install them first: ${missingDeps.map(d => `eve add ${d}`).join(' / ')}`);
    process.exit(1);
  }

  // Resolve synap repo from env or option
  if (opts.synapRepo) {
    process.env.SYNAP_REPO_ROOT = opts.synapRepo;
  }

  printHeader(`Adding ${comp.label}`, comp.emoji);
  console.log();
  printInfo(comp.description.split('\n')[0]);
  console.log();

  // Determine and run the add function
  let step: AddFn;
  try {
    step = buildAddStep(comp.id, opts);
  } catch (err) {
    printError(String(err));
    process.exit(1);
  }

  const spinner = createSpinner(step.label);
  spinner.start();
  try {
    await step.fn();
    spinner.succeed(step.label);
  } catch (err) {
    spinner.fail(step.label);
    printError(`Failed to add ${comp.label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Verify the component is actually serving (not just "docker run returned 0")
  const verifySpinner = createSpinner(`Verifying ${comp.label} is reachable...`);
  verifySpinner.start();
  const verification = await verifyComponent(comp.id);
  if (verification.ok) {
    verifySpinner.succeed(verification.summary);
  } else {
    verifySpinner.warn(verification.summary);
    for (const c of verification.checks) {
      if (!c.ok && c.detail) {
        printWarning(`  • ${c.name}: ${c.detail}`);
      }
    }
    printInfo(`  Component installed but not yet responding. Check logs: docker logs ${comp.id}`);
  }

  // Update state — mark as 'error' if verification failed so eve status / dashboard reflect reality
  await updateStateAfterAdd(comp.id, verification.ok ? 'ready' : 'error');

  // Auto-refresh Traefik routes so the new component is reachable via domain
  const [refresh] = await materializeTargets(null, ['traefik-routes']);
  if (refresh?.changed) {
    printInfo(refresh.summary);
  } else if (refresh && !refresh.ok) {
    printWarning(`Could not refresh Traefik routes: ${refresh.error ?? refresh.summary}`);
  }

  console.log();
  printSuccess(`${comp.label} added successfully!`);
  console.log();
  printInfo('Next steps:');
  printInfo(`  - Run "eve status" to check entity state`);
  if (comp.organ) printInfo(`  - Run "eve ${comp.organ} status" for ${comp.label} status`);
  if (refresh?.changed) printInfo(`  - Run "eve domain check" to verify routing`);
  console.log();
}

// ---------------------------------------------------------------------------
// Step builder
// ---------------------------------------------------------------------------

function buildAddStep(
  componentId: string,
  opts: AddOptions,
): AddFn {
  const model = opts.model || 'llama3.1:8b';

  switch (componentId) {
    case 'traefik':
      return {
        label: 'Setting up Traefik routing...',
        fn: addTraefik,
      };
    case 'synap':
      return {
        label: 'Installing Synap Data Pod...',
        fn: addSynap,
      };
    case 'ollama':
      return {
        label: 'Setting up Ollama + AI gateway...',
        fn: () => addOllama(model),
      };
    case 'openclaw':
      return {
        label: 'Installing OpenClaw...',
        fn: addOpenclaw,
      };
    case 'nango':
      return {
        label: 'Installing Nango (self-hosted OAuth platform)...',
        fn: addNango,
      };
    case 'rsshub':
      return {
        label: 'Installing RSSHub...',
        fn: addRsshub,
      };
    case 'openwebui': {
      return {
        label: 'Installing Open WebUI...',
        async fn() {
          const { mkdirSync, writeFileSync, existsSync } = await import('node:fs');
          const { join: pathJoin } = await import('node:path');
          const { readAgentKeyOrLegacy, readEveSecrets } = await import('@eve/dna');
          const { randomBytes } = await import('node:crypto');
          const { execa } = await import('execa');

          const deployDir = '/opt/openwebui';
          mkdirSync(deployDir, { recursive: true });

          // Read secrets for IS wiring. OpenWebUI calls Synap IS using the
          // openwebui-pipelines agent identity (its canonical pod identity),
          // falling back to legacy for un-migrated installs.
          const secrets = await readEveSecrets(process.cwd());
          const synapApiKey =
            (await readAgentKeyOrLegacy('openwebui-pipelines', process.cwd())) ||
            process.env.SYNAP_API_KEY ||
            '';
          const isUrl = process.env.SYNAP_IS_URL ?? 'http://intelligence-hub:3001';

          // Write a clean, self-contained compose file. We declare eve-network
          // as `external: true` so this container joins the same network as
          // Traefik (required for chat.<domain> routing to work).
          const composeYaml = `# Open WebUI — generated by Eve CLI
# Self-contained compose. Joins eve-network so Traefik can route chat.<domain>
# to this container. Uses SQLite by default (no external DB).

services:
  openwebui:
    image: ghcr.io/open-webui/open-webui:main
    container_name: hestia-openwebui
    restart: unless-stopped
    environment:
      - ENV=production
      - WEBUI_SECRET_KEY=\${WEBUI_SECRET_KEY:-change-me}
      - SCARF_NO_ANALYTICS=true
      - DO_NOT_TRACK=true
      # Synap IS as the OpenAI-compat backend
      - ENABLE_OPENAI_API=true
      - OPENAI_API_BASE_URLS=\${OPENAI_API_BASE_URLS:-http://eve-brain-synap:4000/v1}
      - OPENAI_API_KEYS=\${OPENAI_API_KEYS:-}
      # Local Ollama as fallback
      - OLLAMA_BASE_URL=\${OLLAMA_BASE_URL:-http://eve-brain-ollama:11434}
      # Features
      - ENABLE_RAG=true
      - ENABLE_WEB_SEARCH=true
      - WEB_SEARCH_ENGINE=duckduckgo
      - ENABLE_SIGNUP=\${ENABLE_SIGNUP:-true}
      - DEFAULT_USER_ROLE=\${DEFAULT_USER_ROLE:-user}
    ports:
      - "3011:8080"
    volumes:
      - openwebui-data:/app/backend/data
    networks:
      - eve-network

networks:
  eve-network:
    external: true

volumes:
  openwebui-data:
`;
          writeFileSync(pathJoin(deployDir, 'docker-compose.yml'), composeYaml);

          // Write .env (referenced by compose)
          const envPath = pathJoin(deployDir, '.env');
          if (!existsSync(envPath)) {
            writeFileSync(envPath, [
              '# Open WebUI — generated by Eve CLI',
              `SYNAP_API_KEY=${synapApiKey}`,
              `SYNAP_IS_URL=${isUrl}`,
              `WEBUI_SECRET_KEY=${randomBytes(32).toString('hex')}`,
              `OLLAMA_BASE_URL=http://eve-brain-ollama:11434`,
              `ENABLE_SIGNUP=true`,
              `DEFAULT_USER_ROLE=user`,
            ].join('\n'), { mode: 0o600 });
          }

          // Ensure eve-network exists (Traefik needs it; we declared it as external)
          try {
            await execa('docker', ['network', 'inspect', 'eve-network'], { stdio: 'ignore' });
          } catch {
            await execa('docker', ['network', 'create', 'eve-network'], { stdio: 'inherit' });
          }

          // Pull + start
          console.log(`  Config: ${deployDir}/docker-compose.yml`);
          await execa('docker', ['compose', 'up', '-d'], {
            cwd: deployDir,
            stdio: 'inherit',
          });
        },
      };
    }
    case 'openwebui-pipelines':
      return {
        label: 'Installing Open WebUI Pipelines sidecar...',
        async fn() {
          // Delegate to @eve/lifecycle — single source of truth for both
          // the CLI and the dashboard install path.
          const { runActionToCompletion } = await import('@eve/lifecycle');
          const result = await runActionToCompletion('openwebui-pipelines', 'install');
          if (!result.ok) {
            throw new Error(result.error ?? 'Pipelines install failed');
          }
          // Lifecycle yields logs as it goes — we already printed via spinner;
          // dump the structured logs now for the user.
          for (const line of result.logs) console.log('  ' + line);
        },
      };
    case 'eve-dashboard':
      return {
        label: 'Installing Eve Dashboard...',
        async fn() {
          const { randomBytes } = await import('node:crypto');

          // Generate a dashboard secret if one doesn't already exist.
          let secrets = await readEveSecrets(process.cwd());
          let secret = secrets?.dashboard?.secret;
          if (!secret) {
            secret = randomBytes(32).toString('hex');
            await writeEveSecrets({ dashboard: { secret, port: 7979 } });
            console.log();
            console.log(colors.primary.bold('Dashboard key generated — save this somewhere safe:'));
            console.log(colors.muted('─'.repeat(66)));
            console.log(colors.primary.bold(secret));
            console.log(colors.muted('─'.repeat(66)));
          } else {
            console.log();
            console.log(colors.muted('Reusing existing dashboard key.'));
          }

          installDashboardContainer({
            workspaceRoot: process.cwd(),
            secret,
          });
        },
      };
    // Thin delegate to the ONE install recipe in @eve/lifecycle — deliberately
    // NOT a second inline compose string here. `openwebui` has exactly that
    // (a different YAML in this file from the one lifecycle writes), and the
    // two have drifted; adding a third copy is how that becomes permanent.
    case 'freellmapi':
      return {
        label: 'Installing FreeLLMAPI gateway…',
        async fn() {
          const { runActionToCompletion } = await import('@eve/lifecycle');
          const result = await runActionToCompletion('freellmapi', 'install');
          // Print the transcript on FAILURE too. `runCommand` captures both
          // stdout and stderr as log events, so docker's actual complaint —
          // the only thing that makes this debuggable — is already in
          // `result.logs`. Throwing first discarded it and left the user with
          // a bare "docker compose up exited 1".
          for (const line of result.logs) console.log('  ' + line);
          if (!result.ok) throw new Error(result.error ?? 'FreeLLMAPI install failed');
        },
      };
    case 'hermes':
      return {
        label: 'Installing Hermes AI agent…',
        async fn() {
          const { runActionToCompletion } = await import('@eve/lifecycle');
          const result = await runActionToCompletion('hermes', 'install');
          if (!result.ok) throw new Error(result.error ?? 'Hermes install failed');
          for (const line of result.logs) console.log('  ' + line);
        },
      };
    case 'dokploy':
    case 'opencode':
    case 'openclaude':
      // Builders install via the lifecycle recipe (docker run / config write).
      // The CLI handles them here so interactive edge-cases (missing deps, drift)
      // surface the right recovery message.
      return {
        label: `Installing ${COMPONENTS.find(c => c.id === componentId)?.label ?? componentId}…`,
        async fn() {
          const { runActionToCompletion } = await import('@eve/lifecycle');
          const result = await runActionToCompletion(componentId, 'install');
          if (!result.ok) throw new Error(result.error ?? 'Install failed');
          for (const line of result.logs) console.log('  ' + line);
        },
      };
    case 't3code':
      // T3 Code: prompt for AI provider + key, then lifecycle deploys the
      // container (node:22-slim + npx t3) and wires backend .env.
      return {
        label: 'Installing T3 Code server…',
        async fn() {
          const { select: clackSelect, text: clackInput, password } = await import('@clack/prompts');
          const secrets = await readEveSecrets(process.cwd()).catch(() => null);
          const existing = secrets?.builder?.t3code ?? {};

          // Provider selection — default to whatever is already configured.
          // Prefer pod IS if already set up (no external key needed).
          const currentBaseUrl = existing.openaiBaseUrl ?? '';
          const podApiUrl = secrets?.synap?.apiUrl ? `${secrets.synap.apiUrl}/v1` : '';
          const isPodIs = currentBaseUrl && podApiUrl && currentBaseUrl === podApiUrl;
          const currentProvider = isPodIs ? 'pod'
            : currentBaseUrl.includes('openrouter') ? 'openrouter'
            : currentBaseUrl ? 'custom'
            : podApiUrl ? 'pod'
            : 'openai';

          const provider = await clackSelect({
            message: 'AI provider for Codex (T3 Code uses the OpenAI-compatible API)',
            options: [
              ...(podApiUrl ? [{ value: 'pod', label: 'Pod IS', hint: `${podApiUrl} — already configured` }] : []),
              { value: 'openai',     label: 'OpenAI',      hint: 'api.openai.com — official' },
              { value: 'openrouter', label: 'OpenRouter',  hint: 'openrouter.ai — 200+ models, unified key' },
              { value: 'custom',     label: 'Custom',      hint: 'Any OpenAI-compatible base URL' },
            ],
            initialValue: currentProvider,
          });
          if (typeof provider !== 'string') throw new Error('Cancelled');

          let openaiBaseUrl = '';
          if (provider === 'pod') {
            openaiBaseUrl = podApiUrl;
          } else if (provider === 'openrouter') {
            openaiBaseUrl = 'https://openrouter.ai/api/v1';
          } else if (provider === 'custom') {
            const url = await clackInput({
              message: 'Base URL (e.g. https://my-proxy.example.com/v1)',
              initialValue: currentBaseUrl,
              validate: (v: string) => v.trim() ? undefined : 'URL is required',
            });
            if (typeof url !== 'string') throw new Error('Cancelled');
            openaiBaseUrl = url.trim();
          }

          // Pod IS uses the agent API key — no separate key needed.
          const podKey = secrets?.synap?.agentApiKey ?? '';
          const existingKey = existing.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '';
          let openaiApiKey = provider === 'pod' ? podKey : existingKey;
          if (!openaiApiKey) {
            const keyLabel = provider === 'openrouter' ? 'OpenRouter API key' : 'API key';
            const val = await password({ message: keyLabel });
            if (typeof val !== 'string' || !val.trim()) throw new Error('API key is required');
            openaiApiKey = val.trim();
          }

          await writeEveSecrets({
            builder: { t3code: { ...existing, openaiApiKey, openaiBaseUrl: openaiBaseUrl || undefined } },
          });

          const { runActionToCompletion } = await import('@eve/lifecycle');
          const result = await runActionToCompletion('t3code', 'install');
          if (!result.ok) throw new Error(result.error ?? 'T3 Code install failed');
          for (const line of result.logs) console.log('  ' + line);
        },
      };
    default:
      throw new Error(`No add handler for component: ${componentId}`);
  }
}

// ---------------------------------------------------------------------------
// State update
// ---------------------------------------------------------------------------

async function updateStateAfterAdd(componentId: string, finalState: 'ready' | 'error' = 'ready'): Promise<void> {
  const organMap: Record<string, 'brain' | 'arms' | 'builder' | 'eyes' | 'legs'> = {
    synap: 'brain',
    ollama: 'brain',
    openclaw: 'arms',
    hermes: 'arms',   // Hermes is the primary agent, same organ as OpenClaw
    rsshub: 'eyes',
    traefik: 'legs',
    openwebui: 'eyes',
    'openwebui-pipelines': 'eyes',
    dokploy: 'builder',
    opencode: 'builder',
    openclaude: 'builder',
    t3code: 'builder',
    'eve-dashboard': 'legs',
  };

  const organ = organMap[componentId];
  if (organ) {
    await entityStateManager.updateOrgan(organ, finalState, { version: '0.1.0' });
  }

  await entityStateManager.updateComponentEntry(componentId, {
    state: finalState,
    version: '0.1.0',
    managedBy: 'eve',
  });

  // Update setup profile v2 components list (always — even errored components are
  // tracked so future installs see them and the user can `eve doctor` them)
  const current = await entityStateManager.getInstalledComponents();
  if (!current.includes(componentId)) {
    await entityStateManager.updateSetupProfile({ components: [...current, componentId] });
  }
}

// ---------------------------------------------------------------------------
// Builder picker
// ---------------------------------------------------------------------------

/** The builders users can pick from. Order matters — shown top-to-bottom. */
const BUILDER_OPTIONS = [
  {
    id: 'opencode',
    label: 'OpenCode',
    hint: 'AI-powered code editor running on your server',
  },
  {
    id: 'openclaude',
    label: 'OpenClaude',
    hint: 'Claude Code as a service — delegate hard coding tasks to Claude',
  },
  {
    id: 'dokploy',
    label: 'Dokploy',
    hint: 'Visual PaaS for deploying apps (like a self-hosted Railway)',
  },
  {
    id: 't3code',
    label: 'T3 Code',
    hint: 'External code execution backend — store connection details for DevPlane pipeline',
  },
] as const;

/**
 * Show an interactive picker for builder components and return the selected
 * component ID, or null if the user cancelled.
 */
async function pickBuilder(): Promise<string | null> {
  console.log();
  const choice = await select({
    message: 'Which builder would you like to install?',
    options: BUILDER_OPTIONS.map(b => ({
      value: b.id,
      label: b.label,
      hint: b.hint,
    })),
  });

  if (isCancel(choice)) {
    printInfo('Cancelled.');
    return null;
  }
  return choice as string;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export function addCommand(program: Command): void {
  program
    .command('add')
    .description('Add a component to an existing entity')
    .argument('[components...]', 'One component ID or category to add (hermes, synap, ollama, openclaw, rsshub, openwebui, builder, opencode, openclaude, dokploy, …)')
    .option('--synap-repo <path>', 'Path to synap-backend checkout (for synap component)')
    .option('--model <model>', 'Ollama model (for ollama component)', 'llama3.1:8b')
    .action(async (components: string[] | undefined, opts: { synapRepo?: string; model?: string }) => {
      const requested = components ?? [];
      if (requested.length > 1) {
        if (requested.includes('synap') && requested.includes('pod-admin')) {
          printInfo('Pod Admin ships with the Synap Data Pod; it is not a separately added component.');
          printInfo('Use `eve add synap` only for a new Pod, or `eve update synap` to recover an existing one.');
        } else {
          printWarning('`eve add` installs one component at a time.');
          printInfo(`Received: ${requested.join(', ')}`);
        }
        process.exitCode = 1;
        return;
      }

      let component = requested[0];
      // "eve add builder" — show picker for which builder to install
      if (component === 'builder') {
        const picked = await pickBuilder();
        if (!picked) process.exit(0);
        component = picked;
      }

      if (!component) {
        console.log();
        printHeader('Eve — Add Component', emojis.entity);
        console.log();
        printInfo('Usage: eve add <component>');
        console.log();

        // Group components for readability
        const groups: Array<{ heading: string; ids: string[] }> = [
          { heading: 'AI agents',      ids: ['hermes', 'openclaw'] },
          { heading: 'Data & inference', ids: ['synap', 'ollama', 'openwebui', 'openwebui-pipelines', 'rsshub'] },
          { heading: 'Builders',        ids: ['opencode', 'openclaude', 'dokploy', 't3code'] },
          { heading: 'Infrastructure',  ids: ['traefik', 'eve-dashboard'] },
        ];

        for (const group of groups) {
          console.log(colors.muted.bold(`\n  ${group.heading}`));
          for (const id of group.ids) {
            const comp = COMPONENTS.find(c => c.id === id);
            if (!comp) continue;
            const installed = await entityStateManager.isComponentInstalled(id);
            const tag = installed
              ? colors.success(' [installed]')
              : comp.deprecated
                ? colors.muted(' [deprecated]')
                : '';
            console.log(`  ${comp.emoji}  ${colors.primary.bold(comp.label)}${tag}`);
            console.log(`     ${colors.muted(comp.description.split('\n')[0])}`);
          }
        }

        console.log();
        printInfo('Tip: `eve add builder` shows a picker for OpenCode / OpenClaude / Dokploy');
        printInfo('Examples:');
        printInfo('  eve add hermes              # AI agent with sovereign memory');
        printInfo('  eve add ollama              # Local AI inference');
        printInfo('  eve add builder             # Pick a code-execution builder');
        console.log();
        return;
      }

      await runAdd(component, opts);
    });
}
