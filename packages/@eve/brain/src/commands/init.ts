import type { Command } from 'commander';
import { EntityStateManager } from '@eve/dna';

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

  const delegate = resolveSynapDelegate();

  if (!delegate) {
    throw new Error(
      'Legacy Eve-managed Synap install path has been removed. Provide a valid `--synap-repo` (or `SYNAP_REPO_ROOT`) pointing to a synap-backend checkout with `synap` and `deploy/docker-compose.yml`.',
    );
  }

  const domain = options.domain?.trim() || 'localhost';
  const email = options.email?.trim() || process.env.LETSENCRYPT_EMAIL?.trim() || process.env.SYNAP_LETSENCRYPT_EMAIL?.trim();
  const adminEmail = options.adminEmail?.trim() || process.env.ADMIN_EMAIL?.trim();
  const adminPassword = options.adminPassword?.trim() || process.env.ADMIN_PASSWORD?.trim();
  const adminBootstrapMode = options.adminBootstrapMode ?? 'token';

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
      'Initialize brain via Synap Data Pod (requires --synap-repo or SYNAP_REPO_ROOT)',
    )
    .option('--with-ai', 'Include local Ollama sidecar (optional)')
    .option('--model <model>', 'AI model to use', 'llama3.1:8b')
    .option(
      '--synap-repo <path>',
      'Path to backend checkout; required for official synap install',
    )
    .option('--domain <host>', 'With --synap-repo: DOMAIN for synap install', 'localhost')
    .option('--email <email>', "With --synap-repo: SSL contact (required if domain isn't localhost)")
    .option('--with-openclaw', 'With --synap-repo: pass --with-openclaw to synap install')
    .option('--with-rsshub', 'With --synap-repo: pass --with-rsshub to synap install')
    .option('--from-image', 'With --synap-repo: synap install --from-image')
    .option('--from-source', 'With --synap-repo: synap install --from-source')
    .option('--admin-email <email>', 'With --synap-repo: admin bootstrap email for synap install')
    .option('--admin-password <secret>', 'With --synap-repo: admin password for preseed bootstrap')
    .option('--admin-bootstrap-mode <mode>', "With --synap-repo: preseed | token (default token)")
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
        // Deprecation banner: brain init is a thin shim around the Synap bash
        // script. Keep it reachable behind --confirm-delegation so existing
        // automation breaks loudly rather than silently running under Eve.
        console.log(
          `
⚠️  \`eve brain init\` is deprecated.
    This command delegates to the Synap bash script.
    Please use instead:
        ./synap install (on your server)  or  npx @synap-core/cli init (on your laptop)
    (eve organs/brain/arms subcommands remain available for Eve Entity System use.)
`
        );
        if (!process.argv.includes('--confirm-delegation')) {
          console.log('    Pass --confirm-delegation to proceed anyway (not recommended).\n');
          process.exit(2);
        }

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
