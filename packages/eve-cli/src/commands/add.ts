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
import { select, isCancel } from '@clack/prompts';
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

/** True if a container is running (Up status). */
/**
 * Find a running synap-backend container by compose labels.
 * `eve-brain-synap` is a Docker *network alias*, not a container name — the
 * real container is named by Docker Compose (e.g. `synap-backend-backend-1`
 * or `synap-backend-canary`). Querying by compose labels is the only reliable
 * way to find it regardless of the explicit `container_name` setting.
 */
async function findSynapBackendContainer(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'ps',
        '--filter', 'label=com.docker.compose.project=synap-backend',
        '--filter', 'label=com.docker.compose.service=backend',
        '--format', '{{.Names}}',
      ],
      { timeout: 4000 },
    );
    return stdout.trim().split('\n')[0]?.trim() || null;
  } catch { return null; }
}

async function findSynapPostgresContainer(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'ps',
        '--filter', 'label=com.docker.compose.project=synap-backend',
        '--filter', 'label=com.docker.compose.service=postgres',
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
  const secrets = await readEveSecrets(process.cwd()).catch(() => null);
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

async function addNango(): Promise<void> {
  if (!await isBrainReady()) {
    printError('Brain is not ready. Install Synap first: `eve add synap`');
    process.exit(1);
  }

  const { randomBytes } = await import('node:crypto');
  const { readFile, writeFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { join: pathJoin } = await import('node:path');

  // Generate a secret key if not already in secrets.json
  const secrets = await readEveSecrets(process.cwd()).catch(() => null);
  const existingKey = secrets?.connectors?.nango?.secretKey;
  const secretKey = existingKey ?? randomBytes(32).toString('hex');

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

  // Resolve deploy/.env early so we can read PUBLIC_URL and postgres credentials
  const deployDir =
    process.env.SYNAP_DEPLOY_DIR ||
    (existsSync('/opt/synap-backend/deploy') ? '/opt/synap-backend/deploy' : null);

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

  // Pull image
  printInfo('Pulling nangohq/nango-server:hosted...');
  await execFileAsync('docker', ['pull', 'nangohq/nango-server:hosted'], { timeout: 120_000 });

  // Idempotent container start: remove stopped/crashed container, skip if already running
  const { stdout: runningOut } = await execFileAsync(
    'docker', ['ps', '--filter', 'name=eve-arms-nango', '--format', '{{.Names}}'],
    { timeout: 4000 },
  ).catch(() => ({ stdout: '' }));
  const alreadyRunning = runningOut.trim().split('\n').includes('eve-arms-nango');

  if (!alreadyRunning) {
    // Remove stopped/exited container if it exists so docker run can reuse the name
    await execFileAsync('docker', ['rm', '-f', 'eve-arms-nango'], { timeout: 10_000 }).catch(() => {/* not found — fine */});

    // Build docker run args — include webhook URL if pod public URL is known
    const dockerRunArgs = [
      'run', '-d',
      '--name', 'eve-arms-nango',
      '--network', 'eve-network',
      '--restart', 'unless-stopped',
      '-e', `NANGO_SECRET_KEY=${secretKey}`,
      '-e', 'SERVER_PORT=3003',
      '-e', `NANGO_DATABASE_URL=postgresql://${pgUser}:${pgPassword}@eve-brain-postgres:5432/nango`,
      '-e', 'NODE_ENV=production',
      ...(podPublicUrl ? ['-e', `NANGO_WEBHOOK_URL=${podPublicUrl}/api/connectors/nango-webhook`] : []),
      '-v', 'eve-arms-nango-data:/var/lib/nango',
      'nangohq/nango-server:hosted',
    ];

    printInfo('Starting Nango container...');
    await execFileAsync('docker', dockerRunArgs, { timeout: 30_000 });
  } else {
    printInfo('Nango container already running — skipping start.');
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
        secretKey,
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

    // Prefer the public subdomain URL so the pod backend can reach Nango via
    // the same hostname that OAuth providers redirect to.
    const refreshedSecrets = await readEveSecrets(process.cwd()).catch(() => null);
    const domain = refreshedSecrets?.domain?.primary;
    const ssl = !!refreshedSecrets?.domain?.ssl;
    const nangoHost = domain
      ? `${ssl ? 'https' : 'http'}://nango.${domain}`
      : 'http://eve-arms-nango:3003';

    envContent = setEnvVar(envContent, 'NANGO_HOST', nangoHost);
    envContent = setEnvVar(envContent, 'NANGO_SECRET_KEY', secretKey);
    await writeFile(envPath, envContent.trimStart(), 'utf8');
    printInfo(`  Wrote NANGO_HOST=${nangoHost} + NANGO_SECRET_KEY to ${envPath}`);

    // Restart synap-backend so it picks up the new env vars immediately.
    const backendContainer = await findSynapBackendContainer();
    if (backendContainer) {
      printInfo(`  Restarting ${backendContainer} to apply NANGO_SECRET_KEY...`);
      await execFileAsync('docker', ['restart', backendContainer], { timeout: 60_000 });
      printInfo('  Backend restarted.');
    } else {
      printWarning('  Could not find synap-backend container — restart it manually to apply NANGO_SECRET_KEY.');
    }
  } else {
    printWarning('  Could not locate deploy/.env — set SYNAP_DEPLOY_DIR and rerun to write env vars.');
    printInfo(`  Add manually: NANGO_HOST=http://eve-arms-nango:3003  NANGO_SECRET_KEY=${secretKey}`);
  }

  // Wire nango.{domain} subdomain via Traefik (no-op if no domain configured yet)
  await materializeTargets(null, ['traefik-routes']);

  printSuccess('Nango installed. Connect your first account: eve connectors setup google');
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
    .argument('[component]', 'Component ID or category to add (hermes, synap, ollama, openclaw, rsshub, openwebui, builder, opencode, openclaude, dokploy, …)')
    .option('--synap-repo <path>', 'Path to synap-backend checkout (for synap component)')
    .option('--model <model>', 'Ollama model (for ollama component)', 'llama3.1:8b')
    .action(async (component: string | undefined, opts: { synapRepo?: string; model?: string }) => {
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
          { heading: 'Builders',        ids: ['opencode', 'openclaude', 'dokploy'] },
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
