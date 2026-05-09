import type { Command } from 'commander';
import { EntityStateManager, entityStateManager, readEveSecrets, getServerIp, discoverAndBackfillPodConfig } from '@eve/dna';

import { OllamaService } from '../lib/ollama.js';
import { execa, ensureNetwork } from '../lib/exec.js';
import { resolveSynapDelegate } from '../lib/synap-delegate.js';

export interface BrainInitOptions {
  withAi?: boolean;
  model?: string;
  /** Path to Synap backend repo checkout; uses official `synap` CLI (full Data Pod) instead of Eve Docker brain. */
  synapRepo?: string;
  /** DOMAIN for `synap install` (default localhost). */
  domain?: string;
  /** Required when domain is not localhost (Let's Encrypt / ops). */
  email?: string;
  withOpenclaw?: boolean;
  withRsshub?: boolean;
  fromImage?: boolean;
  fromSource?: boolean;
  adminEmail?: string;
  adminPassword?: string;
  adminBootstrapMode?: 'preseed' | 'token';
}

async function cleanupKnownStaleState(deployDir: string): Promise<void> {
  console.log('Cleaning known stale Synap artifacts...');
  try {
    await execa('bash', ['-lc', `rm -f "${deployDir}/patch_migration.js"`], { stdio: 'inherit' });
    await execa(
      'bash',
      [
        '-lc',
        `if [ -f "${deployDir}/docker-compose.override.yml" ] && grep -q "patch_migration.js" "${deployDir}/docker-compose.override.yml"; then rm -f "${deployDir}/docker-compose.override.yml"; fi`,
      ],
      { stdio: 'inherit' },
    );
  } catch {
    // Best-effort cleanup only; install flow should continue.
  }

  try {
    await execa('docker', ['rm', '-f', 'eve-brain-synap'], { stdio: 'pipe' });
  } catch {
    // Container may not exist.
  }
}

export async function runBrainInit(options: BrainInitOptions): Promise<void> {
  const repo =
    options.synapRepo?.trim() ||
    process.env.SYNAP_REPO_ROOT?.trim() ||
    undefined;

  if (repo) {
    process.env.SYNAP_REPO_ROOT = repo;
  }

  let domain = options.domain?.trim() || 'localhost';
  if (domain === 'localhost') {
    const discovered = await discoverAndBackfillPodConfig(process.cwd());
    if (discovered.domain) {
      domain = discovered.domain;
    }
  }
  const email = options.email?.trim() || process.env.LETSENCRYPT_EMAIL?.trim() || process.env.SYNAP_LETSENCRYPT_EMAIL?.trim();
  const adminEmail = options.adminEmail?.trim() || process.env.ADMIN_EMAIL?.trim();
  const adminPassword = options.adminPassword?.trim() || process.env.ADMIN_PASSWORD?.trim();
  const adminBootstrapMode = options.adminBootstrapMode ?? 'token';

  const delegate = options.fromImage ? null : resolveSynapDelegate();

  if (!delegate) {
    // No synap-backend checkout (or --from-image forced) — install from pre-built Docker image
    console.log('Installing Synap Data Pod from Docker image (ghcr.io/synap-core/backend)...\n');
    const { installSynapFromImage } = await import('../lib/synap-image-install.js');
    const result = await installSynapFromImage({
      domain,
      email,
      adminEmail,
      adminPassword,
      adminBootstrapMode,
    });

    const stateManager = new EntityStateManager();
    await stateManager.updateOrgan('brain', 'ready');
    await entityStateManager.updateComponentEntry('synap', {
      organ: 'brain',
      state: 'ready',
      version: 'main',
      managedBy: 'eve',
      config: { domain, repoRoot: result.deployDir },
    });

    console.log('\n✅ Synap Data Pod installed from image.');
    if (result.bootstrapToken) {
      // Resolve the best URL to show — prefer configured domain > server IP > localhost
      const secrets = await readEveSecrets(process.cwd()).catch(() => null);
      const configuredDomain = domain !== 'localhost' ? domain : secrets?.domain?.primary;
      const ssl = secrets?.domain?.ssl ?? false;
      const serverIp = getServerIp();

      console.log(`\n  Admin bootstrap token (save this — one-time use):`);
      console.log(`  ${result.bootstrapToken}`);
      console.log(`\n  Complete setup at:`);
      if (configuredDomain) {
        const proto = ssl ? 'https' : 'http';
        console.log(`    ${proto}://${configuredDomain}/admin/bootstrap`);
      }
      if (serverIp) {
        console.log(`    http://${serverIp}:4000/admin/bootstrap`);
      }
      console.log(`    http://localhost:4000/admin/bootstrap`);
    }
    return;
  }

  if (domain !== 'localhost' && !email) {
    throw new Error(
      'Non-localhost domain requires --email (or LETSENCRYPT_EMAIL) for synap install.',
    );
  }

  console.log('Initializing Eve brain via Synap Data Pod CLI...\n');
  console.log(`  SYNAP_REPO_ROOT (install cwd): ${delegate.repoRoot}`);
  console.log(`  SYNAP_DEPLOY_DIR (compose dir):  ${delegate.deployDir}`);
  console.log(
    '  Note: Eve state under .eve/ uses your shell cwd (where you ran eve); Synap always uses the paths above.\n',
  );

  await cleanupKnownStaleState(delegate.deployDir);

  const installArgs = [delegate.synapScript, 'install', '--non-interactive', '--domain', domain];
  if (email) {
    installArgs.push('--email', email);
  }
  if (adminBootstrapMode) {
    installArgs.push('--admin-bootstrap-mode', adminBootstrapMode);
  }
  if (adminEmail) {
    installArgs.push('--admin-email', adminEmail);
  }
  if (adminPassword) {
    installArgs.push('--admin-password', adminPassword);
  }
  if (options.fromImage) {
    installArgs.push('--from-image');
  }
  if (options.fromSource) {
    installArgs.push('--from-source');
  }
  if (options.withOpenclaw) {
    installArgs.push('--with-openclaw');
  }
  if (options.withRsshub) {
    installArgs.push('--with-rsshub');
  }

  await execa('bash', installArgs, {
    cwd: delegate.repoRoot,
    env: { ...process.env, SYNAP_DEPLOY_DIR: delegate.deployDir },
    stdio: 'inherit',
  });

  if (options.withAi) {
    console.log('\n🤖 Local Ollama (optional; not part of default Synap compose)\n');
    await ensureNetwork();
    const ollama = new OllamaService();
    await ollama.install();
    await ollama.start();
    await ollama.pullModel(options.model ?? 'llama3.1:8b');
  }

  const stateManager = new EntityStateManager();
  await stateManager.updateOrgan('brain', 'ready');

  // Write v2 component entry (managedBy: eve) alongside organ state
  await entityStateManager.updateComponentEntry('synap', {
    organ: 'brain',
    state: 'ready',
    version: '0.5.0',
    managedBy: 'eve',
    config: { domain, withRsshub: options.withRsshub, repoRoot: delegate.repoRoot },
  });

  console.log('\n✅ Eve brain initialized (Synap Data Pod).');
  if (domain === 'localhost') {
    console.log('  API: http://localhost:4000 (backend; Caddy may serve https://localhost when configured)');
  } else {
    console.log(`  Public URL: https://${domain} (see deploy .env PUBLIC_URL)`);
  }
  if (options.withRsshub) {
    console.log('  RSSHub: http://localhost:1200 (default compose port)');
  }
}

export function initCommand(program: Command): void {
  program
    .command('init')
    .description(
      'Install the Synap Data Pod. Uses pre-built Docker image by default; pass --synap-repo to use a local checkout.',
    )
    .option('--with-ai', 'Include local Ollama sidecar (optional)')
    .option('--model <model>', 'AI model to use', 'llama3.1:8b')
    .option(
      '--synap-repo <path>',
      'Path to synap-backend checkout (optional — auto-detected or uses Docker image)',
    )
    .option('--domain <host>', 'Domain for the data pod', 'localhost')
    .option('--email <email>', 'SSL contact email (required if domain is not localhost)')
    .option('--with-openclaw', 'With --synap-repo: pass --with-openclaw to synap install')
    .option('--with-rsshub', 'With --synap-repo: pass --with-rsshub to synap install')
    .option('--from-image', 'Force from-image install even if synap-repo is found')
    .option('--from-source', 'With --synap-repo: build from source instead of pulling image')
    .option('--admin-email <email>', 'Admin email for bootstrap')
    .option('--admin-password <secret>', 'Admin password (preseed bootstrap mode)')
    .option('--admin-bootstrap-mode <mode>', 'preseed | token (default: token)')
    .action(
      async (
        options: BrainInitOptions & {
          synapRepo?: string;
          domain?: string;
          email?: string;
          adminEmail?: string;
          adminPassword?: string;
          adminBootstrapMode?: 'preseed' | 'token';
        },
      ) => {
        try {
          await runBrainInit({
            withAi: options.withAi,
            model: options.model,
            synapRepo: options.synapRepo,
            domain: options.domain,
            email: options.email,
            withOpenclaw: options.withOpenclaw,
            withRsshub: options.withRsshub,
            fromImage: options.fromImage,
            fromSource: options.fromSource,
            adminEmail: options.adminEmail,
            adminPassword: options.adminPassword,
            adminBootstrapMode: options.adminBootstrapMode,
          });
        } catch (error) {
          console.error('Failed to initialize brain:', error);
          process.exit(1);
        }
      },
    );
}
