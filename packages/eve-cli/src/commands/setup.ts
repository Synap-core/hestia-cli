import type { Command } from 'commander';
import { setupAdminCommand } from './setup-admin.js';
import { select, confirm, isCancel, text } from '@clack/prompts';
import { homedir, tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execa } from 'execa';
import {
  readSetupProfile,
  writeSetupProfile,
  getSetupProfilePath,
  readUsbSetupManifest,
  probeHardware,
  formatHardwareReport,
  readEveSecrets,
  writeEveSecrets,
  ensureSecretValue,
  defaultSkillsDir,
  ensureEveSkillsLayout,
  type SetupProfileKind,
  type EveSecrets,
} from '@eve/dna';
import { runBrainInit, runInferenceInit } from '@eve/brain';
import { runLegsProxySetup } from '@eve/legs';
import {
  gatherInstallConfig,
  defaultPrompts,
  InstallConfigError,
  migrateSetupProfileToSecrets,
} from '@eve/lifecycle';
import { getGlobalCliFlags, outputJson } from '@eve/cli-kit';
import { colors, emojis } from '../lib/ui.js';

export interface SetupCliOptions {
  profile?: string;
  dryRun?: boolean;
  synapRepo?: string;
  domain?: string;
  email?: string;
  model?: string;
  withOpenclaw?: boolean;
  withRsshub?: boolean;
  adminEmail?: string;
  adminPassword?: string;
  adminBootstrapMode?: 'preseed' | 'token';
  fromImage?: boolean;
  fromSource?: boolean;
  skipHardware?: boolean;
  nvidiaSmi?: boolean;
  /** local | provider | hybrid */
  aiMode?: string;
  /** default provider for Eve provider routing (openrouter|anthropic|openai|ollama) */
  aiProvider?: string;
  /** optional fallback provider */
  fallbackProvider?: string;
  /** pangolin | cloudflare — Data Pod / full only */
  tunnel?: string;
  tunnelDomain?: string;
}

function parseProfile(s: string | undefined): SetupProfileKind | null {
  if (!s) return null;
  const v = s.trim().toLowerCase().replace(/-/g, '_');
  if (v === 'inference_only' || v === 'inferenceonly') return 'inference_only';
  if (v === 'data_pod' || v === 'datapod') return 'data_pod';
  if (v === 'full') return 'full';
  return null;
}

function parseTunnel(s: string | undefined): 'pangolin' | 'cloudflare' | undefined {
  if (!s) return undefined;
  const v = s.trim().toLowerCase();
  if (v === 'pangolin') return 'pangolin';
  if (v === 'cloudflare' || v === 'cf') return 'cloudflare';
  return undefined;
}

function parseCodeEngine(
  s: string | undefined,
): 'opencode' | 'openclaude' | 'claudecode' | undefined {
  if (!s) return undefined;
  const v = s.trim().toLowerCase();
  if (v === 'opencode') return 'opencode';
  if (v === 'openclaude') return 'openclaude';
  if (v === 'claudecode' || v === 'claude_code' || v === 'claude-code') return 'claudecode';
  return undefined;
}

function parseAiMode(s: string | undefined): 'local' | 'provider' | 'hybrid' | undefined {
  if (!s) return undefined;
  const v = s.trim().toLowerCase();
  if (v === 'local' || v === 'provider' || v === 'hybrid') return v;
  return undefined;
}

function parseAiProvider(
  s: string | undefined,
): 'ollama' | 'openrouter' | 'anthropic' | 'openai' | undefined {
  if (!s) return undefined;
  const v = s.trim().toLowerCase();
  if (v === 'ollama' || v === 'openrouter' || v === 'anthropic' || v === 'openai') return v;
  return undefined;
}

function prevAiModeFromUsb(
  usb: { target_profile: SetupProfileKind } | null,
): 'local' | 'provider' | 'hybrid' | undefined {
  if (!usb) return undefined;
  if (usb.target_profile === 'inference_only') return 'local';
  return undefined;
}

const SYNAP_BACKEND_REPO_URL = 'https://github.com/synap-core/backend.git';
const SYNAP_BACKEND_TARBALL_URL =
  'https://codeload.github.com/synap-core/backend/tar.gz/refs/heads/main';

function looksLikeSynapRepo(repoRoot: string): boolean {
  return (
    existsSync(join(repoRoot, 'synap')) &&
    existsSync(join(repoRoot, 'deploy', 'docker-compose.yml'))
  );
}

function findLocalSynapRepo(startDir: string): string | null {
  const candidates = new Set<string>();
  const resolvedStart = resolve(startDir);
  let cursor = resolvedStart;
  for (let i = 0; i < 8; i += 1) {
    candidates.add(cursor);
    candidates.add(join(cursor, 'synap-backend'));
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  const home = homedir();
  for (const p of [
    '/opt/synap-backend',
    '/srv/synap-backend',
    join(home, 'synap-backend'),
    join(home, 'synap', 'synap-backend'),
  ]) {
    candidates.add(p);
  }

  for (const candidate of candidates) {
    if (looksLikeSynapRepo(candidate)) return candidate;
  }
  return null;
}

async function isDirectoryEmpty(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path);
    return entries.length === 0;
  } catch {
    return false;
  }
}

async function ensureSynapRepoForProfile(
  requestedPath: string | undefined,
  cwd: string,
  nonInteractive: boolean,
  jsonMode: boolean,
): Promise<string> {
  const explicit = requestedPath?.trim() || process.env.SYNAP_REPO_ROOT?.trim();
  if (explicit) {
    const resolved = resolve(explicit);
    if (!looksLikeSynapRepo(resolved)) {
      throw new Error(
        `Invalid synap repo at ${resolved}. Expected ${resolved}/synap and ${resolved}/deploy/docker-compose.yml`,
      );
    }
    return resolved;
  }

  const detected = findLocalSynapRepo(cwd);
  if (detected) return detected;

  const defaultCloneDir = '/opt/synap-backend';
  let targetDir = defaultCloneDir;

  if (!nonInteractive && !jsonMode) {
    const shouldClone = await confirm({
      message: `No synap-backend checkout detected. Clone it automatically to ${defaultCloneDir}?`,
      initialValue: true,
    });
    if (isCancel(shouldClone) || !shouldClone) {
      throw new Error(
        'data_pod/full requires a synap-backend checkout. Pass --synap-repo or set SYNAP_REPO_ROOT.',
      );
    }

    const maybePath = await text({
      message: 'Where should synap-backend be cloned?',
      placeholder: defaultCloneDir,
      defaultValue: defaultCloneDir,
    });
    if (isCancel(maybePath)) {
      throw new Error('Cancelled.');
    }
    const trimmed = maybePath.trim();
    targetDir = resolve(trimmed.length ? trimmed : defaultCloneDir);
  }

  if (existsSync(targetDir) && !looksLikeSynapRepo(targetDir)) {
    const empty = await isDirectoryEmpty(targetDir);
    if (empty) {
      await rm(targetDir, { recursive: true, force: true });
    } else if (!nonInteractive && !jsonMode) {
      const cleanup = await confirm({
        message: `${targetDir} exists but is not a valid synap-backend checkout. Remove it and retry download?`,
        initialValue: true,
      });
      if (isCancel(cleanup) || !cleanup) {
        throw new Error(
          `Cannot continue with invalid checkout at ${targetDir}. Pass --synap-repo to a valid checkout or remove that folder.`,
        );
      }
      await rm(targetDir, { recursive: true, force: true });
    } else {
      throw new Error(
        `Cannot auto-clone: target exists but is not a valid synap-backend checkout (${targetDir}). Remove it first or pass --synap-repo.`,
      );
    }
  }

  if (!existsSync(targetDir)) {
    if (!jsonMode) {
      console.log(`${emojis.info} Cloning synap-backend to ${colors.info(targetDir)} …`);
    }
    try {
      await execa(
        'git',
        [
          '-c',
          'credential.interactive=never',
          'clone',
          '--depth',
          '1',
          SYNAP_BACKEND_REPO_URL,
          targetDir,
        ],
        {
          stdio: 'inherit',
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
          },
        },
      );
    } catch {
      // Fallback: fetch public tarball directly (bypasses git credential rewrites/prompts).
      const archivePath = join(tmpdir(), `synap-backend-${Date.now()}.tar.gz`);
      try {
        if (!jsonMode) {
          console.log(
            `${emojis.info} git clone failed; trying public archive download from codeload.github.com …`,
          );
        }
        await mkdir(targetDir, { recursive: true });
        await execa('curl', ['-fsSL', SYNAP_BACKEND_TARBALL_URL, '-o', archivePath], {
          stdio: 'inherit',
        });
        await execa('tar', ['-xzf', archivePath, '--strip-components', '1', '-C', targetDir], {
          stdio: 'inherit',
        });
      } catch {
        throw new Error(
          `Failed to fetch public synap-backend source into ${targetDir}.\n` +
            `Ensure outbound HTTPS to github.com/codeload.github.com is allowed and no proxy blocks downloads.\n` +
            `You can also pass --synap-repo <path> (or set SYNAP_REPO_ROOT) to an existing checkout.`,
        );
      } finally {
        await rm(archivePath, { force: true }).catch(() => undefined);
      }
    }
  }

  if (!looksLikeSynapRepo(targetDir)) {
    throw new Error(`Cloned repo at ${targetDir}, but synap CLI layout was not found.`);
  }

  return targetDir;
}

export function setupCommand(program: Command): void {
  const setupCmd = program
    .command('setup')
    .description('Three-path guided setup: Ollama+gateway, Synap Data Pod, or both (logical prompts)')
    .option('--profile <p>', 'inference_only | data_pod | full')
    .option('--dry-run', 'Resolve profile and print plan; do not write state or install')
    .option('--synap-repo <path>', 'data_pod / full: path to synap-backend checkout')
    .option('--domain <host>', 'data_pod / full: synap install --domain (default: localhost, or from saved setup profile)')
    .option('--email <email>', 'data_pod / full: required if domain is not localhost')
    .option('--model <m>', 'inference_only / full: default Ollama model (default: llama3.1:8b)')
    .option('--with-openclaw', 'data_pod / full: synap install --with-openclaw')
    .option('--with-rsshub', 'data_pod / full: synap install --with-rsshub')
    .option('--admin-email <email>', 'data_pod / full: synap install --admin-email')
    .option('--admin-password <secret>', 'data_pod / full: synap install --admin-password (preseed mode)')
    .option('--admin-bootstrap-mode <mode>', 'data_pod / full: preseed | token (default token)')
    .option('--from-image', 'synap install --from-image')
    .option('--from-source', 'synap install --from-source')
    .option('--skip-hardware', 'Skip optional hardware summary')
    .option('--nvidia-smi', 'With hardware summary in non-interactive mode, run nvidia-smi')
    .option('--ai-mode <m>', 'local | provider | hybrid (AI foundation first); default after merge: hybrid')
    .option(
      '--ai-provider <p>',
      'Default provider for Eve provider routing: openrouter | anthropic | openai | ollama',
    )
    .option('--fallback-provider <p>', 'Fallback provider for Eve provider routing')
    .option('--tunnel <provider>', 'data_pod | full: pangolin or cloudflare (runs eve legs setup after install)')
    .option('--tunnel-domain <host>', 'Hostname for tunnel / ingress (optional)')
    .addHelpText(
      'after',
      '\nWhy three paths\n' +
        '  inference_only — Local Ollama + Traefik gateway (Basic auth on :11435). Synap is not installed.\n' +
        '  data_pod      — Official Synap stack via synap CLI (Caddy on 80/443). Use Eve for extra Docker apps.\n' +
        '  full          — data_pod first, then Ollama on Docker network only + same gateway (no host :11434).\n\n' +
        'State & manifests\n' +
        '  Writes .eve/setup-profile.json in the current working directory.\n' +
        '  Pre-filled profile if ~/.eve/usb-profile.json, /opt/eve/profile.json, or EVE_SETUP_MANIFEST exists.\n\n' +
        'Docs: hestia-cli/docs/EVE_SETUP_PROFILES.md, hestia-cli/docs/AI_ROUTING_CONSOLIDATION_ADR.md, and hestia-cli/README.md\n',
    )
    .action(async (opts: SetupCliOptions) => {
      const flags = getGlobalCliFlags();
      const cwd = process.cwd();
      const existing = await readSetupProfile(cwd);
      let loadedExistingPrefs = false;

      if (
        !existing &&
        existsSync(getSetupProfilePath(cwd)) &&
        !flags.nonInteractive &&
        !flags.json &&
        !opts.dryRun
      ) {
        console.log(
          colors.warning(
            `${emojis.warning} ${getSetupProfilePath(cwd)} is present but invalid or unreadable. Fix or remove it to enable "load saved preferences".`,
          ),
        );
      }

      if (existing && !flags.nonInteractive && !opts.dryRun && !flags.json) {
        const load = await confirm({
          message: `Load latest saved setup preferences from .eve/setup-profile.json (${existing.profile})?`,
          initialValue: true,
        });
        if (isCancel(load)) {
          console.log(colors.muted('Cancelled.'));
          return;
        }
        loadedExistingPrefs = Boolean(load);
      }

      let profile = parseProfile(opts.profile);
      const usb = await readUsbSetupManifest();
      if (!profile && usb) {
        profile = usb.target_profile;
        if (!flags.json) {
          console.log(
            `${emojis.info} Found USB/setup manifest → suggested profile: ${colors.info(profile)}`,
          );
        }
      }
      if (!profile && loadedExistingPrefs && existing?.profile) {
        profile = existing.profile;
      }

      if (!profile && !flags.nonInteractive) {
        const choice = await select({
          message: 'Choose setup profile',
          options: [
            {
              value: 'inference_only' as const,
              label: 'Ollama + gateway',
              hint: 'Local models + Traefik Basic auth on :11435 (Synap not installed)',
            },
            {
              value: 'data_pod' as const,
              label: 'Eve only',
              hint: 'Official synap install (Caddy on 80/443); Eve for extra Docker apps',
            },
            {
              value: 'full' as const,
              label: 'All',
              hint: 'Synap first, then Ollama on eve-network + gateway :11435',
            },
          ],
          initialValue: profile ?? 'data_pod',
        });
        if (isCancel(choice)) {
          console.log(colors.muted('Cancelled.'));
          return;
        }
        profile = choice as SetupProfileKind;
      }

      if (!profile) {
        console.error('Profile required: use --profile inference_only|data_pod|full or run interactively.');
        process.exit(1);
      }

      // AI foundation first (local/provider/hybrid) before Synap and side systems
      let aiMode =
        parseAiMode(opts.aiMode) ??
        prevAiModeFromUsb(usb) ??
        (loadedExistingPrefs ? existing?.aiMode : undefined);
      let defaultProvider =
        parseAiProvider(opts.aiProvider) ??
        (loadedExistingPrefs ? existing?.aiDefaultProvider : undefined);
      let fallbackProvider =
        parseAiProvider(opts.fallbackProvider) ??
        (loadedExistingPrefs ? existing?.aiFallbackProvider : undefined);

      if (!opts.dryRun && !flags.nonInteractive && !flags.json) {
        if (!aiMode) {
          const m = await select({
            message: 'AI foundation: where should inference run?',
            options: [
              { value: 'local' as const, label: 'Local only', hint: 'Ollama on this server' },
              { value: 'provider' as const, label: 'Provider only', hint: 'OpenRouter/Anthropic/OpenAI' },
              { value: 'hybrid' as const, label: 'Hybrid (recommended)', hint: 'Local + provider fallback' },
            ],
            initialValue: 'hybrid',
          });
          if (isCancel(m)) {
            console.log(colors.muted('Cancelled.'));
            return;
          }
          aiMode = parseAiMode(String(m));
        }

        if (!defaultProvider && aiMode !== 'local') {
          const p = await select({
            message: 'Choose default cloud provider',
            options: [
              { value: 'openrouter' as const, label: 'OpenRouter', hint: 'Multi-provider gateway' },
              { value: 'anthropic' as const, label: 'Anthropic' },
              { value: 'openai' as const, label: 'OpenAI' },
            ],
            initialValue: 'openrouter',
          });
          if (isCancel(p)) {
            console.log(colors.muted('Cancelled.'));
            return;
          }
          defaultProvider = parseAiProvider(String(p));
        }

        // Always propose fallback for resilience
        const askFallback = await confirm({
          message: 'Add a fallback provider?',
          initialValue: true,
        });
        if (isCancel(askFallback)) {
          console.log(colors.muted('Cancelled.'));
          return;
        }
        if (askFallback && !fallbackProvider) {
          const fp = await select({
            message: 'Fallback provider',
            options: [
              { value: 'openrouter' as const, label: 'OpenRouter' },
              { value: 'anthropic' as const, label: 'Anthropic' },
              { value: 'openai' as const, label: 'OpenAI' },
              { value: 'ollama' as const, label: 'Ollama local' },
              { value: 'none' as const, label: 'Skip fallback' },
            ],
            initialValue: aiMode === 'local' ? 'none' : 'ollama',
          });
          if (isCancel(fp)) {
            console.log(colors.muted('Cancelled.'));
            return;
          }
          fallbackProvider =
            fp === 'none' ? undefined : parseAiProvider(String(fp));
        }
      }

      if (!aiMode) aiMode = 'hybrid';
      if (!defaultProvider && aiMode !== 'local') defaultProvider = 'openrouter';

      // ---------------------------------------------------------------
      // One-shot: copy domain/email from .eve/setup-profile.json into
      // ~/.eve/secrets.json. Idempotent — only writes when secrets are
      // missing the field. Runs before gatherInstallConfig so the
      // resolver sees the back-filled values via the secrets source.
      // ---------------------------------------------------------------
      if (!opts.dryRun) {
        await migrateSetupProfileToSecrets(cwd).catch(() => {
          // Migration is best-effort. If it fails, the resolver still
          // reads the saved profile directly via its 'saved-profile'
          // source — operator just doesn't get the canonicalisation.
        });
      }

      // ---------------------------------------------------------------
      // Resolve install configuration via the shared funnel.
      //
      // The wizard owns AI-foundation (above) and the 3-path profile
      // selector; everything else (domain/SSL/email/admin/tunnel/install
      // mode) flows through gatherInstallConfig so eve install / eve setup
      // / eve init all share one resolution chain. Saved-profile loading
      // is on for setup so re-runs auto-resume.
      // ---------------------------------------------------------------
      const usbTunnelDomain = usb?.tunnel_domain?.trim() || undefined;
      let installDomain: string;
      let installEmail: string | undefined;
      let installMode: 'auto' | 'from_image' | 'from_source';
      let installWithOpenclaw: boolean;
      let installWithRsshub: boolean;
      let adminBootstrapMode: 'preseed' | 'token';
      let adminEmail: string | undefined;
      let adminPassword: string | undefined;
      let exposureMode: 'local' | 'public';
      let tunnelProvider: 'pangolin' | 'cloudflare' | undefined;
      let tunnelDomain: string | undefined;
      let legsHostStrategy: 'same_as_synap' | 'custom' | undefined;
      let resolvedSsl = false;

      if (profile === 'inference_only') {
        // No Synap install — only AI defaults matter. Skip the funnel.
        installDomain = 'localhost';
        installEmail = opts.email?.trim() || process.env.LETSENCRYPT_EMAIL?.trim();
        installMode = opts.fromImage ? 'from_image' : opts.fromSource ? 'from_source' : 'auto';
        installWithOpenclaw = Boolean(opts.withOpenclaw);
        installWithRsshub = Boolean(opts.withRsshub);
        adminBootstrapMode =
          opts.adminBootstrapMode === 'preseed' || opts.adminBootstrapMode === 'token'
            ? opts.adminBootstrapMode
            : 'token';
        adminEmail = opts.adminEmail?.trim() || process.env.ADMIN_EMAIL?.trim();
        adminPassword = opts.adminPassword?.trim() || process.env.ADMIN_PASSWORD?.trim();
        exposureMode = 'local';
        tunnelProvider = parseTunnel(opts.tunnel) ?? usb?.tunnel_provider;
        tunnelDomain = opts.tunnelDomain?.trim() || usbTunnelDomain;
      } else {
        const seedComponents = profile === 'data_pod'
          ? ['traefik', 'synap']
          : ['traefik', 'synap', 'ollama'];
        try {
          const cfg = await gatherInstallConfig({
            cwd,
            flags: {
              components: seedComponents,
              domain: opts.domain?.trim() || usb?.domain_hint || undefined,
              email: opts.email?.trim() || undefined,
              adminEmail: opts.adminEmail?.trim() || undefined,
              adminPassword: opts.adminPassword?.trim() || undefined,
              adminBootstrapMode: opts.adminBootstrapMode,
              fromImage: opts.fromImage,
              fromSource: opts.fromSource,
              withOpenclaw: opts.withOpenclaw,
              withRsshub: opts.withRsshub,
              tunnel: parseTunnel(opts.tunnel) ?? usb?.tunnel_provider,
              tunnelDomain: opts.tunnelDomain?.trim() || usbTunnelDomain,
            },
            interactive: !opts.dryRun && !flags.nonInteractive && !flags.json,
            loadSavedProfile: true,
            seed: {
              ai: { mode: aiMode, defaultProvider, fallbackProvider },
            },
            prompts: defaultPrompts,
          });
          installDomain = cfg.domain;
          installEmail = cfg.email;
          installMode = cfg.installMode;
          installWithOpenclaw = cfg.withOpenclaw;
          installWithRsshub = cfg.withRsshub;
          adminBootstrapMode = cfg.adminBootstrapMode;
          adminEmail = cfg.adminEmail;
          adminPassword = cfg.adminPassword;
          exposureMode = cfg.exposure;
          tunnelProvider = cfg.tunnel?.provider;
          tunnelDomain = cfg.tunnel?.domain;
          legsHostStrategy = cfg.tunnel?.hostStrategy;
          resolvedSsl = cfg.ssl;
        } catch (err) {
          if (err instanceof InstallConfigError) {
            console.error(err.message);
            process.exit(1);
          }
          throw err;
        }
      }

      // Interactive domain/email/SSL/admin/tunnel prompts have moved to
      // gatherInstallConfig (above) — single funnel shared with `eve install`.

      if (flags.nonInteractive && opts.tunnel && !tunnelProvider) {
        console.error('Invalid --tunnel (use pangolin or cloudflare).');
        process.exit(1);
      }
      if (flags.nonInteractive && opts.aiMode && !parseAiMode(opts.aiMode)) {
        console.error('Invalid --ai-mode (use local|provider|hybrid).');
        process.exit(1);
      }
      if (flags.nonInteractive && opts.aiProvider && !parseAiProvider(opts.aiProvider)) {
        console.error('Invalid --ai-provider (use openrouter|anthropic|openai|ollama).');
        process.exit(1);
      }
      if (
        flags.nonInteractive &&
        opts.adminBootstrapMode &&
        opts.adminBootstrapMode !== 'token' &&
        opts.adminBootstrapMode !== 'preseed'
      ) {
        console.error('Invalid --admin-bootstrap-mode (use token|preseed).');
        process.exit(1);
      }
      // Domain/email/admin presence is now validated by gatherInstallConfig
      // (above) — it throws InstallConfigError with a structured missing[]
      // list before reaching here.

      const synapInstallWithOpenclaw =
        installWithOpenclaw && adminBootstrapMode === 'preseed';
      if (installWithOpenclaw && adminBootstrapMode === 'token' && !opts.dryRun) {
        if (!flags.json) {
          console.log(
            colors.info(
              'OpenClaw: token bootstrap has no workspace at install time, so `synap install` runs without --with-openclaw. After you finish /admin/bootstrap, use the admin dashboard prompt or run `./synap services add openclaw` on the server.',
            ),
          );
        }
      }

      if (!flags.json) {
        const synapReachability =
          installDomain === 'localhost'
            ? 'local only (localhost/private network)'
            : `public via https://${installDomain}`;
        const legsReachability = tunnelProvider
          ? `enabled (${tunnelProvider}${tunnelDomain ? `, hostname: ${tunnelDomain}` : ''})`
          : 'disabled (no tunnel/public Legs route configured)';
        console.log(
          colors.info(
            '\nNetwork exposure plan:\n' +
              `  - Synap Data Pod (API/auth): ${synapReachability}\n` +
              `  - Eve side services (Legs routes): ${legsReachability}\n`,
          ),
        );
      }

      if (existing && !flags.nonInteractive && !opts.dryRun && !loadedExistingPrefs) {
        const ok = await confirm({
          message: `Existing setup profile (${existing.profile}). Overwrite and continue?`,
          initialValue: false,
        });
        if (isCancel(ok) || !ok) {
          console.log(colors.muted('Cancelled.'));
          return;
        }
      }

      if (opts.dryRun) {
        const plan = {
          profile,
          existing: existing?.profile ?? null,
          usbManifest: usb ? { target_profile: usb.target_profile } : null,
          ai: {
            mode: aiMode ?? null,
            defaultProvider: defaultProvider ?? null,
            fallbackProvider: fallbackProvider ?? null,
          },
          tunnel: tunnelProvider ?? null,
          tunnelDomain: tunnelDomain ?? null,
          legsHostStrategy: legsHostStrategy ?? null,
          synap: {
            domain: installDomain,
            email: installEmail ?? null,
            mode: installMode,
            withOpenclaw: installWithOpenclaw,
            synapInstallWithOpenclaw,
            withRsshub: installWithRsshub,
            adminBootstrapMode,
            adminEmail: adminEmail ?? null,
          },
        };
        if (flags.json) outputJson(plan);
        else console.log(JSON.stringify(plan, null, 2));
        return;
      }

      if (!opts.skipHardware && !flags.json) {
        if (flags.nonInteractive) {
          if (opts.nvidiaSmi) {
            const facts = await probeHardware(true);
            console.log(`\n${colors.primary('Hardware')}\n${formatHardwareReport(facts)}\n`);
          }
        } else {
          const showHw = await confirm({
            message: 'Show optional hardware summary (CPU, RAM, OS)?',
            initialValue: false,
          });
          if (!isCancel(showHw) && showHw) {
            const gpu = await confirm({
              message: 'Also run nvidia-smi (may fail if no NVIDIA GPU)?',
              initialValue: false,
            });
            const facts = await probeHardware(!isCancel(gpu) && Boolean(gpu));
            console.log(`\n${colors.primary('Hardware')}\n${formatHardwareReport(facts)}\n`);
          }
        }
      }

      await writeSetupProfile(
        {
          profile,
          source: usb ? 'usb_manifest' : flags.nonInteractive ? 'cli' : 'wizard',
          domainHint: installDomain,
          hearthName: usb?.hearth_name,
          tunnelProvider,
          tunnelDomain,
          aiMode,
          aiDefaultProvider: defaultProvider,
          aiFallbackProvider: fallbackProvider,
          network: {
            exposureMode,
            synapHost: installDomain,
            legs: tunnelProvider
              ? {
                  tunnelProvider,
                  hostStrategy: legsHostStrategy ?? (tunnelDomain ? 'custom' : undefined),
                  host: tunnelDomain,
                }
              : undefined,
          },
          synapInstall: {
            mode: installMode,
            tlsEmail: installEmail,
            withOpenclaw: installWithOpenclaw,
            withRsshub: installWithRsshub,
            adminBootstrapMode,
            adminEmail,
          },
        },
        cwd,
      );

      const prevSecrets = await readEveSecrets(cwd);
      type SecretsMerge = Omit<EveSecrets, 'version' | 'updatedAt'>;
      const skillsDir =
        prevSecrets?.builder?.skillsDir?.trim() ||
        process.env.EVE_SKILLS_DIR?.trim() ||
        defaultSkillsDir();

      const merge: SecretsMerge = {
        ai: {
          mode: aiMode,
          defaultProvider,
          fallbackProvider,
          syncToSynap: true,
          providers: [
            { id: 'ollama', enabled: aiMode !== 'provider', baseUrl: prevSecrets?.inference?.ollamaUrl ?? 'http://127.0.0.1:11434' },
            {
              id: 'openrouter',
              enabled: defaultProvider === 'openrouter' || fallbackProvider === 'openrouter',
              apiKey: prevSecrets?.ai?.providers?.find((p) => p.id === 'openrouter')?.apiKey ?? process.env.OPENROUTER_API_KEY,
              baseUrl: 'https://openrouter.ai/api/v1',
              defaultModel: prevSecrets?.ai?.providers?.find((p) => p.id === 'openrouter')?.defaultModel ?? process.env.OPENROUTER_MODEL,
            },
            {
              id: 'anthropic',
              enabled: defaultProvider === 'anthropic' || fallbackProvider === 'anthropic',
              apiKey: prevSecrets?.ai?.providers?.find((p) => p.id === 'anthropic')?.apiKey ?? process.env.ANTHROPIC_API_KEY,
              defaultModel: prevSecrets?.ai?.providers?.find((p) => p.id === 'anthropic')?.defaultModel ?? process.env.ANTHROPIC_MODEL,
            },
            {
              id: 'openai',
              enabled: defaultProvider === 'openai' || fallbackProvider === 'openai',
              apiKey: prevSecrets?.ai?.providers?.find((p) => p.id === 'openai')?.apiKey ?? process.env.OPENAI_API_KEY,
              defaultModel: prevSecrets?.ai?.providers?.find((p) => p.id === 'openai')?.defaultModel ?? process.env.OPENAI_MODEL,
            },
          ],
        },
        builder: {
          codeEngine:
            parseCodeEngine(process.env.BUILDER_CODE_ENGINE) ?? prevSecrets?.builder?.codeEngine,
          openclaudeUrl:
            profile === 'data_pod'
              ? prevSecrets?.builder?.openclaudeUrl ??
                (process.env.OPENCLAUDE_BRAIN_URL || undefined)
              : prevSecrets?.builder?.openclaudeUrl ??
                prevSecrets?.inference?.gatewayUrl ??
                'http://127.0.0.1:11435',
          dokployApiUrl: prevSecrets?.builder?.dokployApiUrl ?? process.env.DOKPLOY_API_URL ?? 'http://127.0.0.1:3000',
          dokployApiKey: ensureSecretValue(prevSecrets?.builder?.dokployApiKey ?? process.env.DOKPLOY_API_KEY),
          dokployWebhookUrl:
            prevSecrets?.builder?.dokployWebhookUrl ?? process.env.DOKPLOY_WEBHOOK_URL ?? undefined,
          workspaceDir: prevSecrets?.builder?.workspaceDir ?? join(homedir(), '.eve', 'workspace'),
          skillsDir,
        },
      };

      if (profile !== 'inference_only') {
        const podKey = ensureSecretValue(
          prevSecrets?.synap?.apiKey ?? process.env.SYNAP_API_KEY ?? process.env.OPENCLAW_SYNAP_API_KEY,
        );
        // We deliberately do NOT write `apiUrl` here. The pod URL is
        // derived at read time from `domain.primary` via
        // `resolveSynapUrl(secrets)` (see @eve/dna/components.ts). Storing
        // it would re-introduce the drift bug that wasted hours of
        // debugging: change domain → stored apiUrl goes stale → every
        // CLI call hits the wrong URL. Pure derivation can't drift.
        //
        // Existing `apiUrl` from previous installs is preserved by
        // writeEveSecrets' merge — that's intentional, since some users
        // explicitly point Eve at a remote pod (different from their
        // domain.primary). The resolver honors that override.
        merge.synap = {
          apiKey: podKey,
          hubBaseUrl: prevSecrets?.synap?.hubBaseUrl ?? process.env.SYNAP_HUB_BASE_URL ?? undefined,
        };
        merge.arms = {
          openclaw: { synapApiKey: podKey },
        };
      } else {
        merge.arms = {
          openclaw: {
            synapApiKey: ensureSecretValue(
              prevSecrets?.arms?.openclaw?.synapApiKey ?? process.env.OPENCLAW_SYNAP_API_KEY,
            ),
          },
        };
      }
      if (profile !== 'data_pod') {
        merge.inference = {
          ollamaUrl:
            prevSecrets?.inference?.ollamaUrl ??
            (profile === 'full' ? 'http://eve-brain-ollama:11434' : 'http://127.0.0.1:11434'),
          gatewayUrl: prevSecrets?.inference?.gatewayUrl ?? 'http://127.0.0.1:11435',
          gatewayUser: prevSecrets?.inference?.gatewayUser,
          gatewayPass: prevSecrets?.inference?.gatewayPass,
        };
      }
      // Persist resolved domain → secrets.json (single source of truth for
      // domain/ssl/email; consumed by preflight, runBrainInit, eve domain).
      if (installDomain && installDomain !== 'localhost') {
        merge.domain = {
          primary: installDomain,
          ssl: resolvedSsl,
          email: installEmail,
        };
      }
      await writeEveSecrets(merge, cwd);
      ensureEveSkillsLayout(skillsDir);

      if (flags.json) {
        outputJson({ ok: true, profile, persisted: true });
      }

      try {
        if (profile === 'inference_only') {
          await runInferenceInit({
            model: opts.model ?? 'llama3.1:8b',
            withGateway: true,
            internalOllamaOnly: false,
          });
        } else if (profile === 'data_pod') {
          const repo = await ensureSynapRepoForProfile(
            opts.synapRepo,
            cwd,
            Boolean(flags.nonInteractive),
            Boolean(flags.json),
          );
          await runBrainInit({
            synapRepo: repo,
            domain: installDomain,
            email: installEmail,
            withOpenclaw: synapInstallWithOpenclaw,
            withRsshub: installWithRsshub,
            fromImage: installMode === 'from_image',
            fromSource: installMode === 'from_source',
            adminBootstrapMode,
            adminEmail,
            adminPassword,
            withAi: false,
          });
          if (tunnelProvider) {
            const legsDomain =
              installDomain !== 'localhost' ? installDomain : tunnelDomain ?? undefined;
            await runLegsProxySetup({
              domain: legsDomain,
              tunnel: tunnelProvider,
              tunnelDomain,
              ssl: false,
              standalone: false,
            });
          }
        } else {
          const repo = await ensureSynapRepoForProfile(
            opts.synapRepo,
            cwd,
            Boolean(flags.nonInteractive),
            Boolean(flags.json),
          );
          if (!flags.json) {
            console.log(colors.info('\nFull profile: (1) Data Pod  (2) Ollama internal + gateway\n'));
          }
          await runBrainInit({
            synapRepo: repo,
            domain: installDomain,
            email: installEmail,
            withOpenclaw: synapInstallWithOpenclaw,
            withRsshub: installWithRsshub,
            fromImage: installMode === 'from_image',
            fromSource: installMode === 'from_source',
            adminBootstrapMode,
            adminEmail,
            adminPassword,
            withAi: false,
          });
          await runInferenceInit({
            model: opts.model ?? 'llama3.1:8b',
            withGateway: true,
            internalOllamaOnly: true,
          });
          if (tunnelProvider) {
            const legsDomain =
              installDomain !== 'localhost' ? installDomain : tunnelDomain ?? undefined;
            await runLegsProxySetup({
              domain: legsDomain,
              tunnel: tunnelProvider,
              tunnelDomain,
              ssl: false,
              standalone: false,
            });
          }
        }

        if (!flags.json) {
          console.log(
            `\n${emojis.check} Setup complete. Profile: ${colors.success(profile)}  (.eve/setup-profile.json)`,
          );
          console.log(
            colors.muted(
              'Ports: Synap Caddy 80/443; inference gateway 127.0.0.1:11435; Ollama direct 127.0.0.1:11434 when published. See hestia-cli/docs/EVE_SETUP_PROFILES.md',
            ),
          );
        }
      } catch (e) {
        console.error(e instanceof Error ? e.message : e);
        process.exit(1);
      }
    });

  // Sub-command: `eve setup admin`
  setupAdminCommand(setupCmd);
}
