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
  hasAnyProvider,
  type WireAiResult,
} from '@eve/dna';
import { getGlobalCliFlags, outputJson } from '@eve/cli-kit';
import { runBrainInit, runInferenceInit, resolveSynapDelegate } from '@eve/brain';
import { runLegsProxySetup } from '@eve/legs';
import { probeAdminStatus } from '../setup-admin.js';
import { text } from '@clack/prompts';
import {
  colors,
  emojis,
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printWarning,
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
import {
  runBackendPreflight,
  provisionAllAgents,
  materializeTargets,
  gatherInstallConfig,
  defaultPrompts,
  InstallConfigError,
  type ResolvedInstallConfig,
} from '@eve/lifecycle';

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
  // 2. Resolve shared settings — single funnel via gatherInstallConfig.
  //
  // Per-field source chain: flag → env → secrets.json → discovered →
  // saved-profile (off here) → interactive prompt → typed default.
  // Missing required fields in non-interactive mode throw a single
  // structured InstallConfigError instead of late `process.exit(1)`s.
  // -----------------------------------------------------------------
  let cfg: ResolvedInstallConfig;
  try {
    cfg = await gatherInstallConfig({
      cwd: process.cwd(),
      flags: {
        components: installList,
        // Commander defaults --domain to "localhost". Treat that as "no
        // explicit choice" so the resolver can promote a value from secrets.
        domain: opts.domain && opts.domain !== 'localhost' ? opts.domain : undefined,
        email: opts.email,
        adminEmail: opts.adminEmail,
        adminPassword: opts.adminPassword,
        adminBootstrapMode: opts.adminBootstrapMode,
        fromImage: opts.fromImage,
        fromSource: opts.fromSource,
        withOpenclaw: opts.withOpenclaw,
        withRsshub: opts.withRsshub,
        aiMode: opts.aiMode,
        aiProvider: opts.aiProvider,
        fallbackProvider: opts.fallbackProvider,
        tunnel: opts.tunnel,
        tunnelDomain: opts.tunnelDomain,
      },
      interactive: !nonInteractive && !jsonMode,
      loadSavedProfile: false,
      prompts: defaultPrompts,
    });
  } catch (err) {
    if (err instanceof InstallConfigError) {
      printError(err.message);
      process.exit(1);
    }
    throw err;
  }

  // Reflect resolved values back onto opts so the rest of the function
  // (buildInstallSteps, recap, post-install hooks) reads the canonical
  // values without taking a second resolution path.
  const domain = cfg.domain;
  const email = cfg.email;
  const withOpenclaw = cfg.withOpenclaw;
  const withRsshub = cfg.withRsshub;
  opts.domain = domain;
  opts.email = email;
  opts.withOpenclaw = withOpenclaw;
  opts.withRsshub = withRsshub;
  opts.adminEmail = cfg.adminEmail;
  opts.adminPassword = cfg.adminPassword;
  opts.adminBootstrapMode = cfg.adminBootstrapMode;
  opts.fromImage = cfg.installMode === 'from_image';
  opts.fromSource = cfg.installMode === 'from_source';
  opts.tunnel = cfg.tunnel?.provider;
  opts.tunnelDomain = cfg.tunnel?.domain;

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

    // Persist resolved domain → secrets.json. This is the single source of
    // truth for `domain.primary/ssl/email` (consumed by preflight,
    // runBrainInit, eve domain commands). Without this write, every later
    // command would re-prompt for the same values.
    if (cfg.domain && cfg.domain !== 'localhost') {
      merge.domain = {
        primary: cfg.domain,
        ssl: cfg.ssl,
        email: cfg.email,
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
    const sourceTag = (k: keyof typeof cfg.source) => {
      const s = cfg.source[k];
      return s && s !== 'flag' && s !== 'prompt' ? colors.muted(` (${s})`) : '';
    };
    printInfo(
      `Domain: ${colors.info(domain)}${sourceTag('domain')}` +
        `   SSL: ${colors.info(cfg.ssl ? 'Let\'s Encrypt' : 'off (proxy or HTTP)')}${sourceTag('ssl')}` +
        (email ? `   TLS email: ${colors.info(email)}${sourceTag('email')}` : ''),
    );
    console.log();
  }

  if (opts.dryRun) {
    if (jsonMode) {
      outputJson({ ok: true, components: installList });
    }
    return;
  }

  // -----------------------------------------------------------------
  // 6. Execute installations — best-effort. A failed step doesn't stop
  //    the run; we collect failures, mark affected components as
  //    not-installed, and surface everything in the recap with hints.
  // -----------------------------------------------------------------
  const steps = buildInstallSteps(installList, opts);
  const skippedComponents = new Set<string>();
  const failedComponents = new Set<string>();
  const failures: InstallFailure[] = [];

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
      const error = err instanceof Error ? err : new Error(String(err));
      const componentIds = step.componentIds ?? [];
      const hint = detectInstallHint(error);
      componentIds.forEach((c) => failedComponents.add(c));
      failures.push({ label: step.label, componentIds, error, hint });

      // Print failure detail INLINE so the operator sees what broke
      // immediately — not buried in the recap 5 steps later. The recap
      // still shows the consolidated list at the end.
      if (!jsonMode) {
        const firstLine = error.message.split('\n')[0] ?? '(no error message)';
        printError(`  ${firstLine}`);
        if (hint) {
          for (const line of hint.split('\n')) {
            console.log(`  ${colors.warning(line)}`);
          }
        }
        console.log(colors.muted(`  Continuing with the next step…`));
        console.log();
      }
    }
  }

  // -----------------------------------------------------------------
  // 7. Update entity state & setup profile
  // -----------------------------------------------------------------
  const installedComponents = installList.filter(
    (c) => !skippedComponents.has(c) && !failedComponents.has(c),
  );
  await updateEntityStateFromComponents(installedComponents, opts);

  // -----------------------------------------------------------------
  // 7b. (removed) Domain prompt has moved to upfront resolution via
  //     gatherInstallConfig — no post-install domain prompt needed.
  // -----------------------------------------------------------------

  // -----------------------------------------------------------------
  // 7c. Optional: AI provider setup (interactive only)
  // -----------------------------------------------------------------
  if (!jsonMode && !opts.skipInteractive) {
    await maybeOfferAiProviderSetup(installedComponents);
  }

  // -----------------------------------------------------------------
  // 7d. Auto-provision Synap agent keys (best-effort, always-on)
  // -----------------------------------------------------------------
  if (!jsonMode && installedComponents.includes('synap')) {
    await runPostInstallProvision(installedComponents);
  }

  // -----------------------------------------------------------------
  // 8. Final recap — context-aware. Always shown so failures are
  //    surfaced alongside what did succeed.
  // -----------------------------------------------------------------
  if (!jsonMode) {
    await printInstallationRecap(installedComponents, failures);
  } else {
    outputJson({
      ok: failures.length === 0,
      components: installList,
      installed: installedComponents,
      failed: failures.map((f) => ({
        label: f.label,
        components: f.componentIds,
        error: f.error.message,
        hint: f.hint,
      })),
    });
  }

  // Exit non-zero on any failure so CI / scripted callers see the signal.
  // The recap above already explained what broke + what to try next.
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

/**
 * After install: try to reach the backend and mint agent keys automatically.
 *
 * Three outcomes:
 *   1. Success → agent keys are ready, operators can use Eve immediately.
 *   2. Admin needed → print the setup URL and the command to run next.
 *   3. Backend not ready → print actionable command with no blocking wait.
 *
 * Never throws — install should never fail at this step.
 */
async function runPostInstallProvision(installedComponents: string[]): Promise<void> {
  console.log();
  const spinner = createSpinner('Connecting Eve agents to Synap…');
  spinner.start();

  let synapUrl: string;
  let provisioningToken: string;
  try {
    const preflight = await runBackendPreflight({ cwd: process.cwd() });
    synapUrl = preflight.synapUrl;
    provisioningToken = preflight.provisioningToken;
  } catch (err) {
    spinner.warn('Backend not reachable yet (still starting up)');
    console.log();
    printInfo('Once it\'s up, run:');
    console.log(`  ${colors.info('eve auth provision')}`);
    printInfo('This will create your first admin account and mint agent API keys.');
    return;
  }

  const adminStatus = await probeAdminStatus();
  if (adminStatus === 'needed') {
    spinner.warn('Backend is up — first admin account required');
    const secrets = await readEveSecrets(process.cwd());
    const domain = secrets?.domain?.primary;
    const ssl = !!secrets?.domain?.ssl;
    const protocol = ssl ? 'https' : 'http';
    const setupUrl = domain ? `${protocol}://pod.${domain}/setup` : `${synapUrl}/setup`;
    console.log();
    printInfo('1. Create your admin account at:');
    console.log(`      ${colors.primary.bold(setupUrl)}`);
    console.log();
    printInfo('2. Then run:');
    console.log(`      ${colors.info('eve auth provision')}`);
    printInfo('   This mints API keys so Eve\'s services can talk to Synap.');
    return;
  }

  const results = await provisionAllAgents({
    installedComponentIds: installedComponents,
    deployDir: process.cwd(),
    reason: 'post-install',
    synapUrl,
    provisioningToken,
    skipIfPresent: true,
  });

  const ok = results.filter(r => r.provisioned);
  const failed = results.filter(r => !r.provisioned);

  if (failed.length === 0) {
    spinner.succeed(`Agent keys ready (${ok.length} agent${ok.length === 1 ? '' : 's'} provisioned)`);
  } else if (ok.length > 0) {
    spinner.warn(`${ok.length} agent${ok.length === 1 ? '' : 's'} provisioned, ${failed.length} failed`);
    for (const f of failed) {
      printWarning(`  ${f.agentType}: ${f.reason.split('\n')[0]}`);
    }
    console.log();
    printInfo(`Retry with: ${colors.info('eve auth provision')}`);
  } else {
    spinner.warn('Agent provisioning failed');
    const topReason = results[0]?.provisioned === false ? results[0].reason : '';
    if (topReason.includes('404') || topReason.includes('backend version')) {
      console.log();
      printInfo('Backend image is outdated. Run:');
      console.log(`  ${colors.info('eve update synap && eve auth provision')}`);
    } else {
      console.log();
      printInfo(`Reason: ${topReason.split('\n')[0] || 'unknown'}`);
      printInfo(`Retry with: ${colors.info('eve auth provision')}`);
    }
  }
}

/**
 * Final summary at the end of `eve install`. Tells the user clearly:
 *   - What was installed (with health if available)
 *   - What FAILED, with operator-actionable hints
 *   - Where to access it (domain if set, IP:port otherwise — domain preferred)
 *   - The dashboard key (so they can log in)
 *   - What's left to do (only what's actually missing)
 */
async function printInstallationRecap(
  installedComponents: string[],
  failures: InstallFailure[] = [],
): Promise<void> {
  const secrets = await readEveSecrets(process.cwd());
  const serverIp = getServerIp();
  const domain = secrets?.domain?.primary;
  const ssl = !!secrets?.domain?.ssl;
  const protocol = ssl ? 'https' : 'http';
  const hasAi = hasAnyProvider(secrets);
  const dashboardSecret = secrets?.dashboard?.secret;

  // Pick the best UI URL based on what's configured. Domain > IP > localhost.
  const uiUrl = domain
    ? `${protocol}://eve.${domain}`
    : serverIp
      ? `http://${serverIp}:7979`
      : `http://localhost:7979`;

  const headerColor = failures.length > 0 ? colors.warning : colors.success;
  const headerIcon = failures.length > 0 ? '⚠' : '✓';
  const headerText = failures.length > 0
    ? `Eve installation finished with ${failures.length} issue${failures.length === 1 ? '' : 's'}`
    : 'Eve installation complete';

  console.log();
  console.log(headerColor.bold('━'.repeat(60)));
  console.log(headerColor.bold(`  ${headerIcon}  ${headerText}`));
  console.log(headerColor.bold('━'.repeat(60)));
  console.log();

  // What was installed
  console.log(colors.primary.bold('  Installed components'));
  if (installedComponents.length === 0) {
    console.log(colors.muted('    (none — every step failed; see Issues below)'));
  }
  for (const id of installedComponents) {
    const comp = COMPONENTS.find(c => c.id === id);
    if (!comp) continue;
    const subdomainHint = domain && comp.service?.subdomain
      ? colors.muted(`  →  ${protocol}://${comp.service.subdomain}.${domain}`)
      : '';
    console.log(`    ${colors.success('●')} ${comp.emoji} ${comp.label.padEnd(22)} ${subdomainHint}`);
  }

  // What failed — print each step with its hint, before the dashboard
  // section so the operator sees blockers first.
  if (failures.length > 0) {
    console.log();
    console.log(colors.warning.bold('  Issues encountered'));
    for (const f of failures) {
      const compTag = f.componentIds.length > 0
        ? colors.muted(` [${f.componentIds.join(', ')}]`)
        : '';
      console.log(`    ${colors.error('✗')} ${f.label}${compTag}`);
      console.log(`        ${colors.muted('error:')} ${f.error.message.split('\n')[0]}`);
      if (f.hint) {
        for (const line of f.hint.split('\n')) {
          console.log(`        ${colors.warning(line)}`);
        }
      }
    }
  }

  // Open the dashboard
  console.log();
  console.log(colors.primary.bold('  Open your dashboard'));
  console.log(`    ${colors.primary.bold(uiUrl)}`);
  if (dashboardSecret) {
    console.log(`    ${colors.muted('Login key:')} ${colors.primary(dashboardSecret)}`);
  }
  if (!domain) {
    console.log(colors.warning(`    ! No domain set — using direct IP. For HTTPS access, run:  eve domain set <yourdomain> --ssl --email <you@example.com>`));
  } else if (!ssl) {
    console.log(colors.warning(`    ! Domain set but SSL not enabled — re-run "eve domain set ${domain} --ssl" to provision certs`));
  }

  // Builder workspace — surfaced when `ensureBuilderWorkspace` has
  // already run (post-install or post-update hook). Silent when absent
  // so a fresh install that hasn't reached `eve auth provision` yet
  // doesn't show a misleading half-state.
  const builderWorkspaceId = secrets?.builder?.workspaceId;
  if (builderWorkspaceId) {
    console.log(`    ${colors.muted('Builder workspace:')} ${colors.primary(builderWorkspaceId)}`);
  }

  // What's left to do — only show what's actually missing
  const todos: Array<{ label: string; cmd: string; severity: 'must' | 'recommended' }> = [];

  if (!domain) {
    todos.push({
      label: 'Configure a public domain so you can access the dashboard from anywhere',
      cmd: 'eve domain set <yourdomain> --ssl --email <you@example.com>',
      severity: 'recommended',
    });
  }
  if (!hasAi) {
    const aiConsumers = ['synap', 'openclaw', 'openwebui'];
    if (installedComponents.some(c => aiConsumers.includes(c))) {
      todos.push({
        label: 'Add an AI provider — OpenClaw / Open WebUI / agents are idle without one',
        cmd: 'eve ai providers add anthropic --api-key sk-ant-...',
        severity: 'must',
      });
    }
  }
  // Dashboard auto-restarts via Docker's `--restart unless-stopped` policy,
  // so no manual systemd setup is needed anymore.

  if (todos.length > 0) {
    console.log();
    console.log(colors.primary.bold('  Next steps'));
    for (const t of todos) {
      const dot = t.severity === 'must' ? colors.error('●') : colors.warning('●');
      console.log(`    ${dot} ${t.label}`);
      console.log(`        ${colors.muted('→')} ${colors.info(t.cmd)}`);
    }
  }

  // Quick reference
  console.log();
  console.log(colors.muted('  Quick reference'));
  console.log(colors.muted(`    eve status               check what's running`));
  console.log(colors.muted(`    eve doctor               full health diagnostic`));
  console.log(colors.muted(`    eve add <component>      install another component`));
  if (domain) {
    console.log(colors.muted(`    eve domain check         verify all routes`));
  }
  if (installedComponents.includes('synap')) {
    console.log(colors.muted(`    eve auth provision       mint/refresh agent keys`));
    console.log(colors.muted(`    eve auth status          check key health per agent`));
  }
  console.log();
  console.log(colors.success.bold('━'.repeat(60)));
  console.log();
}

// ---------------------------------------------------------------------------
// Optional post-install steps (interactive prompts)
// ---------------------------------------------------------------------------

/**
 * Offer to configure an AI provider so OpenClaw / Open WebUI / agents work
 * out of the box. Skips silently if a provider is already configured.
 *
 * The provider key is stored once in `secrets.ai.providers[]` and then
 * propagated to every installed component via `wireComponentAi()`. This is
 * the moment that turns Synap IS into the canonical AI hub.
 */
async function maybeOfferAiProviderSetup(installedComponents: string[]): Promise<void> {
  const existing = await readEveSecrets(process.cwd());
  if (hasAnyProvider(existing)) return; // already configured

  // Only worth prompting if at least one component will consume AI
  const aiConsumers = ['synap', 'openclaw', 'openwebui', 'hermes', 'opencode', 'openclaude'];
  const willUseAi = installedComponents.some(c => aiConsumers.includes(c));
  if (!willUseAi) return;

  console.log();
  console.log(colors.muted('Eve uses Synap IS as the central AI hub. Other components (OpenClaw,'));
  console.log(colors.muted('Open WebUI, agents) route through it — so you only set this once.'));
  console.log();

  const providerChoice = await select({
    message: 'Which AI provider do you want to use?',
    options: [
      { value: 'anthropic', label: 'Anthropic (Claude) — recommended', hint: 'best quality' },
      { value: 'openai',    label: 'OpenAI (GPT-5/4)' },
      { value: 'openrouter', label: 'OpenRouter (multi-provider)' },
      { value: 'ollama',    label: 'Ollama only (local, free)', hint: 'requires ollama component' },
      { value: 'skip',      label: 'Skip — configure later with `eve ai providers add`' },
    ],
    initialValue: 'anthropic',
  });

  if (isCancel(providerChoice) || providerChoice === 'skip') {
    printInfo('You can configure your AI provider later with: eve ai providers add <id> --api-key <key>');
    return;
  }

  // Ollama-only doesn't need a key
  if (providerChoice === 'ollama') {
    await writeEveSecrets({
      ai: {
        defaultProvider: 'ollama',
        providers: [{ id: 'ollama', enabled: true }],
      },
    });
    printSuccess('Ollama set as default provider (no API key needed).');
    return;
  }

  // Cloud provider — get API key
  const apiKey = await text({
    message: `Paste your ${providerChoice} API key:`,
    placeholder: providerChoice === 'anthropic' ? 'sk-ant-...' : providerChoice === 'openai' ? 'sk-...' : 'sk-or-...',
    validate: (v) => v && v.trim().length > 8 ? undefined : 'API key is required',
  });
  if (isCancel(apiKey)) {
    printInfo('Skipped. Configure later with: eve ai providers add ' + providerChoice + ' --api-key <key>');
    return;
  }

  // Default model per provider. OpenRouter has no useful default — must ask.
  // Anthropic/OpenAI have sensible recent defaults the user can refine in the
  // dashboard later.
  const DEFAULT_MODELS: Record<string, string> = {
    anthropic: 'claude-sonnet-4-7',
    openai: 'gpt-5',
    openrouter: 'anthropic/claude-sonnet-4-7',
  };

  let defaultModel: string = DEFAULT_MODELS[providerChoice as string];
  if (providerChoice === 'openrouter') {
    const modelInput = await text({
      message: 'Default model on OpenRouter:',
      placeholder: 'anthropic/claude-sonnet-4-7',
      initialValue: 'anthropic/claude-sonnet-4-7',
      validate: (v) => v && v.includes('/') ? undefined : 'Use the form provider/model (e.g. anthropic/claude-sonnet-4-7)',
    });
    if (isCancel(modelInput)) {
      printInfo('Skipped — no default model set. Configure in the dashboard later.');
      return;
    }
    defaultModel = modelInput.trim();
  } else {
    // Show the default and let the user override
    const modelInput = await text({
      message: `Default model (press enter to use "${defaultModel}"):`,
      placeholder: defaultModel,
      initialValue: defaultModel,
    });
    if (!isCancel(modelInput) && modelInput.trim()) {
      defaultModel = modelInput.trim();
    }
  }

  await writeEveSecrets({
    ai: {
      defaultProvider: providerChoice as 'anthropic' | 'openai' | 'openrouter',
      providers: [{
        id: providerChoice as 'anthropic' | 'openai' | 'openrouter',
        enabled: true,
        apiKey: apiKey.trim(),
        defaultModel,
      }],
    },
  });
  printSuccess(`${providerChoice} (${defaultModel}) saved.`);

  // Auto-wire every installed component so they pick up the new key
  console.log();
  const spinner = createSpinner('Wiring AI provider into installed components...');
  spinner.start();
  const updated = await readEveSecrets(process.cwd());
  const [materialized] = await materializeTargets(updated, ['ai-wiring'], { components: installedComponents });
  const results = Array.isArray(materialized?.details?.results)
    ? materialized.details.results as WireAiResult[]
    : [];
  const ok = results.filter(r => r.outcome === 'ok').length;
  const failed = results.filter(r => r.outcome === 'failed');

  if (failed.length === 0) {
    spinner.succeed(`AI wiring applied to ${ok} component(s)`);
  } else {
    spinner.warn(`AI wiring partially applied (${ok} ok, ${failed.length} failed)`);
    for (const r of failed) {
      printWarning(`  • ${r.id}: ${r.summary}${r.detail ? ' — ' + r.detail : ''}`);
    }
  }

  // Point the user at the dashboard for richer config
  console.log();
  printInfo('Configure model, fallback provider, and multiple providers in the dashboard:');
  printInfo('  eve ui   →   open the dashboard, navigate to "AI Providers"');
}

// ---------------------------------------------------------------------------
// Step builder
// ---------------------------------------------------------------------------

interface InstallStep {
  label: string;
  /** Components to mark as skipped (not installed) rather than ready */
  skips?: string[];
  /** Components this step installs — used to mark them as failed if `fn` throws. */
  componentIds?: string[];
  fn: () => Promise<void>;
}

interface InstallFailure {
  label: string;
  componentIds: string[];
  error: Error;
  /** Operator-actionable hint inferred from the error pattern. */
  hint?: string;
}

/**
 * Inspect an install error message and emit an operator-actionable hint.
 * Best-effort string match — returns undefined when nothing recognized.
 */
function detectInstallHint(err: Error): string | undefined {
  const msg = err.message ?? "";

  // Port collision. Most common when Eve's Traefik is already on 80/443
  // and Synap's Caddy tries to claim them too — two reverse proxies can't
  // share ports. RSSHub on 1200 hits the same problem when an earlier
  // attempt already started it.
  const portMatch = msg.match(/Bind for [0-9.:]*:(\d+) failed: port is already allocated/);
  if (portMatch) {
    const port = portMatch[1];
    const isWebPort = port === "80" || port === "443";
    if (isWebPort) {
      return [
        `Port ${port} is already bound on this host (likely by Eve's Traefik).`,
        `  → If Eve and Synap share the host, route Synap behind Traefik instead of letting Caddy claim ${port}.`,
        `  → Quick check: \`docker ps --format '{{.Names}}\\t{{.Ports}}' | grep ':${port}'\``,
        `  → Stop the conflicting service, then re-run \`eve update synap\`.`,
      ].join("\n");
    }
    if (port === "1200") {
      return [
        `Port 1200 is already bound — RSSHub from a previous run is still up.`,
        `  → \`docker ps | grep rsshub\` to identify the existing container.`,
        `  → \`docker rm -f synap-backend-rsshub\` then re-run \`eve update synap\`.`,
      ].join("\n");
    }
    return `Port ${port} is already bound — check \`sudo lsof -iTCP:${port} -sTCP:LISTEN\`.`;
  }

  if (/permission denied|EACCES/i.test(msg)) {
    return "Permission denied — try `sudo` or check file ownership.";
  }
  if (/no space left|ENOSPC/i.test(msg)) {
    return "Disk full — free space (try `docker system prune -a`) and re-run.";
  }
  if (/network .* not found|driver failed programming/i.test(msg)) {
    return "Docker network issue — check `docker network ls` and `eve doctor`.";
  }
  if (/synap install exited \d+/.test(msg)) {
    return "synap CLI failed — see logs above. Re-run with `eve update synap` after fixing the underlying issue.";
  }
  return undefined;
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
      componentIds: ['traefik'],
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
        componentIds: ['synap'],
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
        componentIds: ['synap'],
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
      componentIds: ['ollama'],
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
      componentIds: ['openclaw'],
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
      componentIds: ['rsshub'],
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
      componentIds: ['hermes'],
      async fn() {
        await materializeTargets(null, ['hermes-env']);
        // Container is managed by the Eve compose stack — no extra start needed;
        // the env file written above is picked up on next docker compose up.
        console.log('  Hermes env file written to .eve/hermes.env');
        console.log('  Start with: docker compose up -d hermes');
      },
    });
  }

  // 7. Eve Dashboard (always-installed UI). Builds the local Docker image
  //    from packages/eve-dashboard/Dockerfile and runs it on eve-network so
  //    Traefik can route eve.<domain> to it by container name.
  if (components.includes('eve-dashboard')) {
    steps.push({
      label: 'Building & starting Eve Dashboard...',
      componentIds: ['eve-dashboard'],
      async fn() {
        const { randomBytes } = await import('node:crypto');
        const { readEveSecrets, writeEveSecrets } = await import('@eve/dna');
        const { installDashboardContainer } = await import('@eve/legs');

        const secrets = await readEveSecrets(process.cwd());
        let secret = secrets?.dashboard?.secret;
        if (!secret) {
          secret = randomBytes(32).toString('hex');
          await writeEveSecrets({ dashboard: { secret, port: 7979 } });
          console.log();
          console.log(colors.primary.bold('Dashboard key generated — save this somewhere safe:'));
          console.log(colors.muted('─'.repeat(66)));
          console.log(colors.primary.bold(secret));
          console.log(colors.muted('─'.repeat(66)));
        }
        installDashboardContainer({
          workspaceRoot: process.cwd(),
          secret,
        });
      },
    });
  }

  // 8. Open WebUI
  const hasOpenWebUI = components.includes('openwebui');
  if (hasOpenWebUI) {
    steps.push({
      label: 'Setting up Open WebUI...',
      componentIds: ['openwebui'],
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
    hermes: 'arms',
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
