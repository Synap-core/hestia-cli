import type { Command } from 'commander';
import { confirm, select, multiselect, isCancel, intro, outro, note, log } from '@clack/prompts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  entityStateManager,
  type SetupProfileKind,
  writeSetupProfile,
  type EveSecrets,
  readEveSecrets,
  writeEveSecrets,
  ensureEveSkillsLayout,
  defaultSkillsDir,
  ensureSecretValue,
  getServerIp,
} from '@eve/dna';
import { getGlobalCliFlags, outputJson } from '@eve/cli-kit';
import { runBrainInit, runInferenceInit, resolveSynapDelegate } from '@eve/brain';
import { runLegsProxySetup } from '@eve/legs';
import {
  colors,
  emojis,
  printHeader,
  printSuccess,
  printError,
  printInfo,
  createSpinner,
} from '../../lib/ui.js';
import {
  COMPONENTS,
  type ComponentInfo,
  resolveComponent,
  selectedIds,
  allComponentIds,
  addonComponentIds,
} from '../../lib/components.js';
import { RSSHubService } from '@eve/eyes';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InstallOptions {
  components?: string[];
  domain?: string;
  email?: string;
  model?: string;
  adminEmail?: string;
  adminPassword?: string;
  adminBootstrapMode?: 'preseed' | 'token';
  tunnel?: 'pangolin' | 'cloudflare';
  tunnelDomain?: string;
  aiMode?: 'local' | 'provider' | 'hybrid';
  aiProvider?: 'ollama' | 'openrouter' | 'anthropic' | 'openai';
  fallbackProvider?: 'ollama' | 'openrouter' | 'anthropic' | 'openai';
  withOpenclaw?: boolean;
  withRsshub?: boolean;
  fromImage?: boolean;
  fromSource?: boolean;
  skipHardware?: boolean;
  skipInteractive?: boolean;
  nvidiaSmi?: boolean;
  synapRepo?: string;
  /** Skip writing setup profile & secrets */
  dryRun?: boolean;
}

/**
 * Core install orchestrator. Resolves which components to install and
 * runs the appropriate service initialisation functions.
 *
 * This function is the shared implementation behind both the interactive
 * `eve install` wizard and the CLI-flag-driven non-interactive mode.
 */
export async function runInstall(opts: InstallOptions): Promise<void> {
  const flags = getGlobalCliFlags();
  const jsonMode = Boolean(flags.json);
  const nonInteractive = Boolean(flags.nonInteractive) || Boolean(opts.skipInteractive);

  // -----------------------------------------------------------------
  // 1. Determine which components to install
  // -----------------------------------------------------------------
  let componentSet: Record<string, boolean>;

  if (opts.components && opts.components.length > 0) {
    // Non-interactive: explicit component list
    componentSet = {};
    for (const id of opts.components) {
      const comp = COMPONENTS.find(c => c.id === id);
      if (!comp) {
        throw new Error(`Unknown component: ${id}. Available: ${COMPONENTS.map(c => c.id).join(', ')}`);
      }
      componentSet[id] = true;
    }
  } else if (nonInteractive) {
    // Non-interactive without --components: infer from legacy profile logic
    // Default: synap only (data_pod equivalent)
    componentSet = { traefik: true, synap: true };
  } else {
    // Interactive wizard
    componentSet = await interactiveComponentSelect();
    if (isCancel(componentSet)) {
      console.log(colors.muted('Installation cancelled.'));
      return;
    }
  }

  // Always ensure infrastructure
  for (const comp of COMPONENTS) {
    if (comp.alwaysInstall) {
      componentSet[comp.id] = true;
    }
  }

  const installList = selectedIds(componentSet);

  // -----------------------------------------------------------------
  // 2. Resolve shared settings (domain, email, model, AI mode)
  // -----------------------------------------------------------------
  const domain = opts.domain || 'localhost';
  const email = opts.email || process.env.LETSENCRYPT_EMAIL;

  // Legacy flags from the old setup command
  const withOpenclaw = opts.withOpenclaw || componentSet['openclaw'];
  const withRsshub = opts.withRsshub || componentSet['rsshub'] || componentSet['rsshub'];

  // Infer legacy profile for setup-profile.json backward compat
  const legacyProfile = inferLegacyProfile(installList);

  // -----------------------------------------------------------------
  // 3. Pre-flight checks
  // -----------------------------------------------------------------
  if (!opts.dryRun) {
    const spinner = createSpinner('Checking prerequisites...');
    spinner.start();

    // Resolve docker to its full path — execa has a restricted PATH that may not include /usr/local/bin
    let dockerPath = 'docker';
    try {
      const { stdout } = await execa('which', ['docker']);
      if (stdout) dockerPath = stdout;
    } catch {
      // Fallback to common Docker install paths
      const candidates = [
        '/usr/local/bin/docker',
        '/usr/bin/docker',
        '/usr/bin/containerd',
      ];
      for (const c of candidates) {
        if (existsSync(c)) {
          dockerPath = c;
          break;
        }
      }
    }

    // Try docker — retry with delay for daemon startup
    let dockerOk = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await execa(dockerPath, ['version']);
        dockerOk = true;
        break;
      } catch {
        if (attempt < 7) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }

    if (dockerOk) {
      spinner.succeed('Docker is running');
    }

    if (!dockerOk) {
      spinner.fail('Docker is not running');
      console.log();
      printError('Eve requires Docker to manage containers.');
      console.log();
      if (process.platform === 'darwin') {
        printInfo('macOS: Install Docker Desktop and start it, then run:');
        printInfo('  open -a Docker');
      } else if (process.platform === 'win32') {
        printInfo('Windows: Install Docker Desktop and start the app.');
      } else {
        printInfo('Docker is installed but the daemon is not responding.');
        printInfo('Make sure it is running:');
        printInfo('  sudo systemctl status docker');
        console.log();
        printInfo('If not running, start it:');
        printInfo('  sudo systemctl start docker');
        printInfo('  # wait ~5 seconds for it to initialize');
        console.log();
        printInfo('If Docker is not installed, run:');
        printInfo('  curl -fsSL https://get.docker.com | sudo bash');
      }
      console.log();
      process.exit(1);
    }
  }

  // -----------------------------------------------------------------
  // 4. Write setup profile & secrets
  // -----------------------------------------------------------------
  if (!opts.dryRun) {
    const cwd = process.cwd();
    const skillsDir = defaultSkillsDir();

    const setupProfile: Parameters<typeof writeSetupProfile>[0] = {
      profile: legacyProfile,
      source: nonInteractive ? 'cli' : 'wizard',
      domainHint: domain,
    };
    if (opts.tunnel) {
      setupProfile.tunnelProvider = opts.tunnel;
    }
    if (opts.tunnelDomain) {
      setupProfile.tunnelDomain = opts.tunnelDomain;
    }
    await writeSetupProfile(setupProfile, cwd);

    // Secrets
    const prevSecrets = await readEveSecrets(cwd);
    const merge: EveSecrets = {
      version: '1',
      updatedAt: new Date().toISOString(),
      ai: {
        mode: opts.aiMode || 'hybrid',
        defaultProvider: opts.aiProvider,
        fallbackProvider: opts.fallbackProvider,
        syncToSynap: true,
        providers: [],
      },
    };

    if (componentSet['synap']) {
      merge.synap = {
        apiUrl: prevSecrets?.synap?.apiUrl || 'http://127.0.0.1:4000',
        apiKey: ensureSecretValue(prevSecrets?.synap?.apiKey || process.env.SYNAP_API_KEY || process.env.OPENCLAW_SYNAP_API_KEY || ''),
        hubBaseUrl: prevSecrets?.synap?.hubBaseUrl,
      };
    }

    if (componentSet['ollama'] || componentSet['synap']) {
      merge.inference = {
        ollamaUrl: componentSet['ollama'] ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:11434',
        gatewayUrl: 'http://127.0.0.1:11435',
      };
    }

    await writeEveSecrets(merge, cwd);
    ensureEveSkillsLayout(skillsDir);
  }

  // -----------------------------------------------------------------
  // 5. Print install plan
  // -----------------------------------------------------------------
  if (!jsonMode) {
    console.log();
    printHeader('Eve Install Plan', emojis.entity);
    console.log();
    for (const comp of COMPONENTS) {
      if (!componentSet[comp.id]) continue;
      const tag = comp.alwaysInstall ? colors.muted(' [infrastructure]') : '';
      console.log(`  ${colors.success(emojis.check)} ${colors.primary.bold(comp.label)} ${colors.muted(comp.description.split('\n')[0])}${tag}`);
    }
    console.log();
    printInfo(`Domain: ${colors.info(domain)}${email ? `  TLS: ${colors.info(email)}` : ''}`);
    console.log();
  }

  if (opts.dryRun) {
    if (jsonMode) {
      outputJson({ ok: true, components: installList });
    }
    return;
  }

  // -----------------------------------------------------------------
  // 6. Execute installations
  // -----------------------------------------------------------------
  const steps = buildInstallSteps(installList, opts);
  const skippedComponents = new Set<string>();

  for (const step of steps) {
    if (jsonMode) {
      console.error(`[install] ${step.label}`);
    }
    const spinner = createSpinner(step.label);
    spinner.start();
    try {
      await step.fn();
      if (step.skips?.length) {
        spinner.warn(`${step.label} — skipped (no repo found)`);
        step.skips.forEach(c => skippedComponents.add(c));
      } else {
        spinner.succeed(step.label);
      }
    } catch (err) {
      spinner.fail(step.label);
      printError(`Failed to install ${step.label}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  // -----------------------------------------------------------------
  // 7. Update entity state & setup profile
  // -----------------------------------------------------------------
  const installedComponents = installList.filter(c => !skippedComponents.has(c));
  await updateEntityStateFromComponents(installedComponents, opts);

  // -----------------------------------------------------------------
  // 8. Done
  // -----------------------------------------------------------------
  if (!jsonMode) {
    console.log();
    printSuccess('Entity installation complete.');
    console.log();
    printInfo(`  Components installed: ${installList.join(', ')}`);
    console.log();
    printInfo('Next steps:');
    printInfo(`  - Run "eve status"               to check entity state`);
    printInfo(`  - Run "eve ui"                   to open the web dashboard`);
    printInfo(`  - Run "eve domain show"          to see all access URLs`);
    printInfo(`  - Run "eve domain set <domain>"  to configure remote domain access`);
    printInfo(`  - Run "eve grow organ"           to add more capabilities later`);
    printInfo(`  - Run "eve add <component>"      to add add-ons (dokploy, opencode, openclaude)`);
    const serverIp = getServerIp();
    if (serverIp) {
      console.log();
      console.log(colors.muted(`  Your server IP: ${serverIp}`));
      console.log(colors.muted(`  Dashboard: http://${serverIp}:7979  (open port 7979 in your firewall)`));
    }
    console.log();
  } else {
    outputJson({ ok: true, components: installList });
  }
}

// ---------------------------------------------------------------------------
// Step builder
// ---------------------------------------------------------------------------

interface InstallStep {
  label: string;
  /** Components to mark as skipped (not installed) rather than ready */
  skips?: string[];
  fn: () => Promise<void>;
}

function buildInstallSteps(
  components: string[],
  opts: InstallOptions,
): InstallStep[] {
  const steps: InstallStep[] = [];

  const hasSynap = components.includes('synap');
  const hasOllama = components.includes('ollama');
  const hasTraefik = components.includes('traefik');
  const hasOpenclaw = components.includes('openclaw');
  const hasRsshub = components.includes('rsshub');
  const hasHermes = components.includes('hermes');
  const hasDokploy = components.includes('dokploy');
  const hasOpenCode = components.includes('opencode');
  const hasOpenClaude = components.includes('openclaude');
  const hasBuilder = hasHermes || hasDokploy || hasOpenCode || hasOpenClaude;
  const hasTunnel = opts.tunnel;

  // 1. Traefik
  if (hasTraefik) {
    steps.push({
      label: 'Setting up Traefik routing...',
      async fn() {
        const domain = opts.domain || 'localhost';
        await runLegsProxySetup({
          domain: hasSynap ? domain : undefined,
          tunnel: opts.tunnel,
          tunnelDomain: opts.tunnelDomain,
          ssl: hasSynap && domain !== 'localhost',
          standalone: true,
        });
      },
    });
  }

  // 2. Synap
  if (hasSynap) {
    const synapRepo = opts.synapRepo || process.env.SYNAP_REPO_ROOT;
    const delegate = resolveSynapDelegate();
    const resolvedRepo = synapRepo || delegate?.repoRoot;

    if (resolvedRepo) {
      steps.push({
        label: 'Installing Synap Data Pod...',
        async fn() {
          await runBrainInit({
            synapRepo: resolvedRepo,
            domain: opts.domain,
            email: opts.email,
            adminBootstrapMode: opts.adminBootstrapMode || 'token',
            adminEmail: opts.adminEmail,
            adminPassword: opts.adminPassword,
            fromImage: opts.fromImage,
            fromSource: opts.fromSource,
            withOpenclaw: false,
            withRsshub: opts.withRsshub || hasRsshub,
            withAi: false,
          });
        },
      });
    } else {
      // No synap repo — install from Docker image automatically
      steps.push({
        label: 'Installing Synap Data Pod (from Docker image)...',
        async fn() {
          await runBrainInit({
            domain: opts.domain,
            email: opts.email,
            adminBootstrapMode: opts.adminBootstrapMode || 'token',
            adminEmail: opts.adminEmail,
            adminPassword: opts.adminPassword,
          });
        },
      });
    }
  }

  // 3. Ollama
  if (hasOllama) {
    steps.push({
      label: 'Setting up Ollama + AI gateway...',
      async fn() {
        await runInferenceInit({
          model: opts.model || 'llama3.1:8b',
          withGateway: true,
          internalOllamaOnly: hasSynap,
        });
      },
    });
  }

  // 4. OpenClaw (Docker lifecycle + synap-cli wiring when available)
  if (hasOpenclaw) {
    steps.push({
      label: 'Setting up OpenClaw...',
      async fn() {
        const { OpenClawService } = await import('@eve/arms');

        const ollamaUrl = 'http://127.0.0.1:11434';
        const openclaw = new OpenClawService();

        // Pull and start OpenClaw container
        await openclaw.install();
        await openclaw.configure(ollamaUrl);
        await openclaw.start();

        // If we have a synap-backend checkout AND synap was installed,
        // delegate wiring to synap-cli (skill install, entity seed, IS config)
        const synapPod = resolveSynapDelegate();
        if (synapPod && hasSynap) {
          console.log('  Delegating Synap↔OpenClaw wiring to synap-cli...');
          try {
            // Check if pod-config exists (from prior init/connect)
            const { homedir } = await import('node:os');
            const { existsSync } = await import('node:fs');
            const podConfigPath = join(homedir(), '.synap', 'pod-config.json');
            if (existsSync(podConfigPath)) {
              await spawnAsync('npx', ['-p', '@synap-core/cli', 'synap', 'finish', '--skip-ai-key', '--skip-domain'], {
                env: { ...process.env, SYNAP_DEPLOY_DIR: synapPod.deployDir },
                cwd: synapPod.repoRoot,
              });
            } else {
              console.log('  No pod-config found — skipping synap-cli finish.');
              console.log('  Run "synap connect --target=openclaw" then "synap finish" manually for full wiring.');
            }
          } catch (err) {
            console.log(`  synap-cli finish warning: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      },
    });
  }

  // 5. RSSHub
  if (hasRsshub) {
    steps.push({
      label: 'Setting up RSSHub...',
      async fn() {
        const rsshub = new RSSHubService();
        await rsshub.install();
        await rsshub.start();
      },
    });
  }

  // 6. Hermes daemon
  if (hasHermes) {
    steps.push({
      label: 'Setting up Hermes daemon...',
      async fn() {
        const { writeHermesEnvFile } = await import('@eve/dna');
        await writeHermesEnvFile(process.cwd());
        // Container is managed by the Eve compose stack — no extra start needed;
        // the env file written above is picked up on next docker compose up.
        console.log('  Hermes env file written to .eve/hermes.env');
        console.log('  Start with: docker compose up -d hermes');
      },
    });
  }

  // 7. Open WebUI
  const hasOpenWebUI = components.includes('openwebui');
  if (hasOpenWebUI) {
    steps.push({
      label: 'Setting up Open WebUI...',
      async fn() {
        const { mkdirSync, writeFileSync, existsSync } = await import('node:fs');
        const { join: pathJoin } = await import('node:path');
        const { readEveSecrets } = await import('@eve/dna');
        const { randomBytes } = await import('node:crypto');

        const deployDir = '/opt/openwebui';
        mkdirSync(deployDir, { recursive: true });

        const secrets = await readEveSecrets(process.cwd());
        const synapApiKey = secrets?.synap?.apiKey ?? process.env.SYNAP_API_KEY ?? '';
        const isUrl = process.env.SYNAP_IS_URL ?? 'http://intelligence-hub:3001';

        const envPath = pathJoin(deployDir, '.env');
        if (!existsSync(envPath)) {
          writeFileSync(envPath, [
            '# Open WebUI — generated by Eve CLI',
            `SYNAP_API_KEY=${synapApiKey}`,
            `SYNAP_IS_URL=${isUrl}`,
            `WEBUI_SECRET_KEY=${randomBytes(32).toString('hex')}`,
            `ENABLE_SIGNUP=true`,
            `DEFAULT_USER_ROLE=user`,
          ].join('\n'), { mode: 0o600 });
        }
        console.log(`  Open WebUI config written to ${deployDir}`);
        console.log('  Start with: docker compose --profile openwebui up -d');
      },
    });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Entity state
// ---------------------------------------------------------------------------

async function updateEntityStateFromComponents(
  components: string[],
  opts: InstallOptions,
): Promise<void> {
  const organMap: Record<string, 'brain' | 'arms' | 'builder' | 'eyes' | 'legs'> = {
    synap: 'brain',
    ollama: 'brain',
    openclaw: 'arms',
    hermes: 'builder',
    rsshub: 'eyes',
    traefik: 'legs',
    dokploy: 'builder',
    opencode: 'builder',
    openclaude: 'builder',
  };

  for (const compId of components) {
    const organ = organMap[compId];
    if (organ) {
      await entityStateManager.updateOrgan(organ, 'ready', { version: '0.1.0' });
    }
    await entityStateManager.updateComponentEntry(compId, {
      state: 'ready',
      version: '0.1.0',
      managedBy: 'eve',
    });
  }

  // Update setup profile v2
  await entityStateManager.updateSetupProfile({ components });
}

// ---------------------------------------------------------------------------
// Interactive wizard
// ---------------------------------------------------------------------------

// Preset bundles surfaced in the wizard
const PRESETS = [
  {
    value: 'personal',
    label: '🧠  Personal AI pod',
    hint: 'Synap + Traefik',
    ids: ['traefik', 'synap'],
  },
  {
    value: 'full',
    label: '🚀  Full stack',
    hint: 'Synap + Ollama + OpenClaw + Traefik',
    ids: ['traefik', 'synap', 'ollama', 'openclaw'],
  },
  {
    value: 'chat',
    label: '💬  AI chat server',
    hint: 'Synap + Open WebUI + Traefik',
    ids: ['traefik', 'synap', 'openwebui'],
  },
  {
    value: 'builder',
    label: '🏗️  Builder server',
    hint: 'Synap + Hermes + OpenClaw + Traefik',
    ids: ['traefik', 'synap', 'openclaw', 'hermes'],
  },
  {
    value: 'minimal',
    label: '⚡  Minimal',
    hint: 'Traefik only — add components later',
    ids: ['traefik'],
  },
  {
    value: 'custom',
    label: '🔧  Custom',
    hint: 'Pick each component individually',
    ids: [],
  },
] as const;

async function interactiveComponentSelect(): Promise<Record<string, boolean>> {
  intro(colors.primary.bold('Eve — Composable Installer'));

  // Step 1: pick a preset
  const preset = await select({
    message: 'What do you want to set up?',
    options: PRESETS as unknown as { value: string; label: string; hint: string }[],
    initialValue: 'full',
  });

  if (isCancel(preset)) return {};

  // Step 2: for custom or to adjust preset, show multiselect
  const selectableComponents = COMPONENTS.filter(c => !c.alwaysInstall);
  let presetIds: string[] = preset === 'custom'
    ? selectableComponents.filter(c => c.category !== 'add-on').map(c => c.id)
    : (PRESETS.find(p => p.value === preset)?.ids.filter(id => id !== 'traefik') ?? []);

  // Minimal preset skips the multiselect — just Traefik, no further selection needed.
  // All other presets offer a multiselect to confirm or adjust the component set.
  let finalIds: string[] | symbol = [];
  if (preset !== 'minimal') {
    finalIds = await multiselect({
      message: preset === 'custom' ? 'Select components:' : 'Adjust selection (space to toggle):',
      options: selectableComponents.map(c => ({
        value: c.id,
        label: `${c.emoji}  ${c.label}`,
        hint: c.description.split('.')[0],
      })),
      initialValues: presetIds,
      required: false,
    });
  }

  if (isCancel(finalIds)) return {};

  // Build result — traefik always on
  const result: Record<string, boolean> = { traefik: true };
  for (const id of (finalIds as string[])) {
    result[id] = true;
  }

  // Validate requires
  const missing: string[] = [];
  for (const id of Object.keys(result)) {
    const comp = COMPONENTS.find(c => c.id === id);
    for (const req of comp?.requires ?? []) {
      if (!result[req]) missing.push(`${comp!.label} requires ${req}`);
    }
  }
  if (missing.length) {
    note(missing.join('\n'), 'Dependency note — adding missing requirements');
    for (const id of Object.keys(result)) {
      const comp = COMPONENTS.find(c => c.id === id);
      for (const req of comp?.requires ?? []) result[req] = true;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Legacy profile inference
// ---------------------------------------------------------------------------

function inferLegacyProfile(components: string[]): SetupProfileKind {
  const set = new Set(components);
  const hasSynap = set.has('synap');
  const hasOllama = set.has('ollama');
  const hasBuilder = ['hermes', 'openclaw'].some(c => set.has(c));

  if (!hasSynap && hasOllama) return 'inference_only';
  if (hasSynap && hasOllama && hasBuilder) return 'full';
  if (hasSynap) return 'data_pod';
  return 'data_pod';
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export function installCommand(program: Command): void {
  program
    .command('install')
    .alias('i')
    .description('Composable component installer — pick what you need')
    .option(
      '--components <list>',
      'Comma-separated component IDs (traefik,synap,ollama,openclaw,hermes,rsshub,openwebui,dokploy,opencode,openclaude)',
    )
    .option('--domain <host>', 'Public hostname (default: localhost)', 'localhost')
    .option('--email <email>', "Let's Encrypt email for TLS")
    .option('--model <model>', 'Ollama model', 'llama3.1:8b')
    .option('--admin-email <email>', 'Admin bootstrap email for Synap')
    .option('--admin-password <secret>', 'Admin password for preseed bootstrap')
    .option('--admin-bootstrap-mode <mode>', 'Token | preseed (default: token)')
    .option('--tunnel <provider>', 'Tunnel provider: pangolin | cloudflare')
    .option('--tunnel-domain <host>', 'Tunnel hostname')
    .option('--ai-mode <m>', 'AI inference mode: local | provider | hybrid')
    .option('--ai-provider <p>', 'Default AI provider: openrouter | anthropic | openai | ollama')
    .option('--fallback-provider <p>', 'Fallback AI provider')
    .option('--synap-repo <path>', 'Path to synap-backend checkout')
    .option('--with-openclaw', 'Enable OpenClaw (legacy flag)')
    .option('--with-rsshub', 'Enable RSSHub (legacy flag)')
    .option('--from-image', 'Install Synap from prebuilt image')
    .option('--from-source', 'Install Synap from source')
    .option('--dry-run', 'Print planned steps without executing')
    .option('--skip-hardware', 'Skip hardware summary')
    .addHelpText(
      'after',
      `\nComponents\n` +
        `  ${colors.muted('Infrastructure')}  traefik (always)\n` +
        `  ${colors.muted('Data')}          synap, ollama\n` +
        `  ${colors.muted('Agent')}         openclaw\n` +
        `  ${colors.muted('Builder')}       hermes, dokploy, opencode, openclaude\n` +
        `  ${colors.muted('Perception')}    rsshub\n\n` +
        `Run "eve add <component>" to add components later.\n` +
        `Run "eve status" to see current state.\n`,
    )
    .action(async (rawOpts: {
      components?: string;
      domain?: string;
      email?: string;
      model?: string;
      adminEmail?: string;
      adminPassword?: string;
      adminBootstrapMode?: 'preseed' | 'token';
      tunnel?: string;
      tunnelDomain?: string;
      aiMode?: string;
      aiProvider?: string;
      fallbackProvider?: string;
      synapRepo?: string;
      withOpenclaw?: boolean;
      withRsshub?: boolean;
      fromImage?: boolean;
      fromSource?: boolean;
      dryRun?: boolean;
      skipHardware?: boolean;
    }) => {
      // Resolve environment
      if (rawOpts.synapRepo) {
        process.env.SYNAP_REPO_ROOT = rawOpts.synapRepo;
      }

      // Parse tunnel
      let tunnelProvider: 'pangolin' | 'cloudflare' | undefined;
      if (rawOpts.tunnel) {
        const t = rawOpts.tunnel.toLowerCase();
        if (t === 'pangolin') tunnelProvider = 'pangolin';
        else if (t === 'cloudflare' || t === 'cf') tunnelProvider = 'cloudflare';
        else {
          printError(`Unknown tunnel provider: ${rawOpts.tunnel} (use pangolin or cloudflare)`);
          process.exit(1);
        }
      }

      // Parse AI mode
      let aiMode: 'local' | 'provider' | 'hybrid' | undefined;
      if (rawOpts.aiMode) {
        const m = rawOpts.aiMode.toLowerCase();
        if (['local', 'provider', 'hybrid'].includes(m)) aiMode = m as any;
      }

      // Parse AI provider
      let aiProvider: 'ollama' | 'openrouter' | 'anthropic' | 'openai' | undefined;
      if (rawOpts.aiProvider) {
        const p = rawOpts.aiProvider.toLowerCase();
        if (['ollama', 'openrouter', 'anthropic', 'openai'].includes(p)) aiProvider = p as any;
      }

      let fallbackProvider: 'ollama' | 'openrouter' | 'anthropic' | 'openai' | undefined;
      if (rawOpts.fallbackProvider) {
        const p = rawOpts.fallbackProvider.toLowerCase();
        if (['ollama', 'openrouter', 'anthropic', 'openai'].includes(p)) fallbackProvider = p as any;
      }

      // Parse components
      let components: string[] | undefined;
      if (rawOpts.components) {
        components = rawOpts.components.split(',').map(s => s.trim()).filter(Boolean);
      }

      await runInstall({
        components,
        domain: rawOpts.domain,
        email: rawOpts.email,
        model: rawOpts.model,
        adminEmail: rawOpts.adminEmail,
        adminPassword: rawOpts.adminPassword,
        adminBootstrapMode: rawOpts.adminBootstrapMode,
        tunnel: tunnelProvider,
        tunnelDomain: rawOpts.tunnelDomain,
        aiMode,
        aiProvider,
        fallbackProvider,
        withOpenclaw: rawOpts.withOpenclaw,
        withRsshub: rawOpts.withRsshub,
        fromImage: rawOpts.fromImage,
        fromSource: rawOpts.fromSource,
        dryRun: rawOpts.dryRun,
      });
    });
}

// ---------------------------------------------------------------------------
// Minimal execa re-export for use outside organ packages
// ---------------------------------------------------------------------------

function execa(cmd: string, args: string[], opts?: Record<string, unknown>): Promise<{ stdout: string }> {
  return import('execa').then(mod => mod.execa(cmd, args, { ...(opts || {}), shell: true }));
}

function spawnAsync(
  cmd: string,
  args: string[],
  opts?: { env?: Record<string, string>; cwd?: string },
): Promise<void> {
  return import('execa').then(({ execa: execaFn }) =>
    execaFn(cmd, args, {
      env: { ...process.env, ...(opts?.env || {}) },
      cwd: opts?.cwd,
      stdio: 'inherit',
    }).then(() => undefined)
  );
}
