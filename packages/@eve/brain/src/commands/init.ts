import type { Command } from 'commander';
import { EntityStateManager } from '@eve/dna';

import { SynapService } from '../lib/synap.js';
import { PostgresService } from '../lib/postgres.js';
import { RedisService } from '../lib/redis.js';
import { OllamaService } from '../lib/ollama.js';
import { execa } from '../lib/exec.js';
import { resolveSynapDelegate } from '../lib/synap-delegate.js';

export interface BrainInitOptions {
  withAi?: boolean;
  model?: string;
  /** Path to synap-backend repo; uses official `synap` CLI (full Data Pod) instead of Eve Docker brain. */
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

export async function runBrainInit(options: BrainInitOptions): Promise<void> {
  const repo =
    options.synapRepo?.trim() ||
    process.env.SYNAP_REPO_ROOT?.trim() ||
    undefined;

  if (repo) {
    process.env.SYNAP_REPO_ROOT = repo;
  }

  const delegate = resolveSynapDelegate();

  if (delegate) {
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
    console.log(`  Repo: ${delegate.repoRoot}\n`);

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
    return;
  }

  console.log('Initializing Eve brain (Eve-managed Docker containers)...\n');
  console.log(
    '  Tip: for the full Data Pod, clone synap-backend and run with\n' +
      '  SYNAP_REPO_ROOT=/path/to/synap-backend eve brain init\n' +
      '  or: eve brain init --synap-repo /path/to/synap-backend\n',
  );

  const synap = new SynapService();
  const postgres = new PostgresService();
  const redis = new RedisService();
  const ollama = new OllamaService();

  await ensureNetwork();

  console.log('\n📦 Synap Backend');
  await synap.install();
  await synap.start();

  console.log('\n📦 Data Stores');
  await postgres.install();
  await postgres.start();

  await redis.install();
  await redis.start();

  if (options.withAi) {
    console.log('\n🤖 AI Services');
    await ollama.install();
    await ollama.start();
    await ollama.pullModel(options.model ?? 'llama3.1:8b');
  }

  const stateManager = new EntityStateManager();
  await stateManager.updateOrgan('brain', 'ready');

  console.log('\n✅ Eve brain initialized successfully!');
  console.log('\nServices:');
  console.log('  Synap Backend: http://localhost:4000');
  console.log('  PostgreSQL: localhost:5432');
  console.log('  Redis: localhost:6379');
  if (options.withAi) {
    console.log('  Ollama: http://localhost:11434');
    console.log(`  Model: ${options.model}`);
  }
}

export function initCommand(program: Command): void {
  program
    .command('init')
    .description(
      'Initialize brain: Eve Docker stack, or full Synap Data Pod when --synap-repo / SYNAP_REPO_ROOT is set',
    )
    .option('--with-ai', 'Include Ollama for local AI (alongside Synap or Eve stack)')
    .option('--model <model>', 'AI model to use', 'llama3.1:8b')
    .option(
      '--synap-repo <path>',
      'Path to synap-backend checkout; runs official synap install instead of Eve brain containers',
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

async function ensureNetwork(): Promise<void> {
  try {
    const { stdout } = await execa('docker', ['network', 'ls', '--format', '{{.Name}}']);

    if (!stdout.includes('eve-network')) {
      console.log('Creating eve-network...');
      await execa('docker', ['network', 'create', 'eve-network']);
    }
  } catch (error) {
    console.warn('Could not ensure network:', error);
  }
}
