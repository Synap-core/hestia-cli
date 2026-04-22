import type { Command } from 'commander';
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
import { getGlobalCliFlags, outputJson } from '@eve/cli-kit';
import { colors, emojis, printEveDeprecation, requireDelegationConfirmed } from '../lib/ui.js';

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
  program
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
      printEveDeprecation('setup', './synap install (on your server)');
      requireDelegationConfirmed();

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

      if (opts.fromImage && opts.fromSource) {
        console.error('Use only one of --from-image or --from-source.');
        process.exit(1);
      }

      // No Commander default for --domain: a default of "localhost" prevented loading saved synapHost/domainHint.
      const domainArg = opts.domain?.trim();
      const explicitDomain = domainArg !== undefined && domainArg.length > 0 ? domainArg : undefined;
      let installDomain =
        explicitDomain ??
        (loadedExistingPrefs
          ? existing?.network?.synapHost?.trim() || existing?.domainHint?.trim()
          : undefined) ??
        'localhost';
      let installEmail = opts.email?.trim() || process.env.LETSENCRYPT_EMAIL?.trim() || undefined;
      if (!installEmail && loadedExistingPrefs) {
        installEmail = existing?.synapInstall?.tlsEmail?.trim() || installEmail;
      }
      let installMode: 'auto' | 'from_image' | 'from_source' =
        opts.fromImage ? 'from_image' : opts.fromSource ? 'from_source' : 'auto';
      if (!opts.fromImage && !opts.fromSource && loadedExistingPrefs && existing?.synapInstall?.mode) {
        installMode = existing.synapInstall.mode;
      }
      let installWithOpenclaw = Boolean(opts.withOpenclaw);
      if (!opts.withOpenclaw && loadedExistingPrefs && typeof existing?.synapInstall?.withOpenclaw === 'boolean') {
        installWithOpenclaw = existing.synapInstall.withOpenclaw;
      }
      let installWithRsshub = Boolean(opts.withRsshub);
      if (!opts.withRsshub && loadedExistingPrefs && typeof existing?.synapInstall?.withRsshub === 'boolean') {
        installWithRsshub = existing.synapInstall.withRsshub;
      }
      let adminBootstrapMode: 'preseed' | 'token' =
        opts.adminBootstrapMode === 'preseed' || opts.adminBootstrapMode === 'token'
          ? opts.adminBootstrapMode
          : 'token';
      if (
        !opts.adminBootstrapMode &&
        loadedExistingPrefs &&
        (existing?.synapInstall?.adminBootstrapMode === 'preseed' ||
          existing?.synapInstall?.adminBootstrapMode === 'token')
      ) {
        adminBootstrapMode = existing.synapInstall.adminBootstrapMode;
      }
      let adminEmail = opts.adminEmail?.trim() || process.env.ADMIN_EMAIL?.trim() || installEmail;
      if (!opts.adminEmail?.trim() && loadedExistingPrefs && existing?.synapInstall?.adminEmail?.trim()) {
        adminEmail = existing.synapInstall.adminEmail.trim();
      }
      let adminPassword = opts.adminPassword?.trim() || process.env.ADMIN_PASSWORD?.trim();
      let exposureMode: 'local' | 'public' = installDomain !== 'localhost' ? 'public' : 'local';

      let tunnelProvider = parseTunnel(opts.tunnel) ?? usb?.tunnel_provider;
      if (!opts.tunnel && !usb?.tunnel_provider && loadedExistingPrefs) {
        tunnelProvider = existing?.network?.legs?.tunnelProvider ?? existing?.tunnelProvider;
      }
      let tunnelDomain =
        (opts.tunnelDomain?.trim() || usb?.tunnel_domain || '').trim() || undefined;
      if (!tunnelDomain && loadedExistingPrefs) {
        tunnelDomain = existing?.network?.legs?.host?.trim() || existing?.tunnelDomain?.trim() || undefined;
      }
      let legsHostStrategy: 'same_as_synap' | 'custom' | undefined;
      if (loadedExistingPrefs) {
        const prior = existing?.network?.legs?.hostStrategy;
        if (prior === 'same_as_synap' || prior === 'custom') {
          legsHostStrategy = prior;
        }
      }

      if (
        !opts.dryRun &&
        (profile === 'data_pod' || profile === 'full') &&
        !flags.nonInteractive &&
        !flags.json
      ) {
        const accessMode = await select({
          message: 'How should users reach your Synap Data Pod API/auth endpoint?',
          options: [
            {
              value: 'local' as const,
              label: 'Local only (this machine / private network)',
              hint:
                'Sets Synap to localhost. Eve side services stay local unless you configure Legs exposure separately.',
            },
            {
              value: 'public' as const,
              label: 'Public domain (internet-accessible)',
              hint:
                'Sets Synap public URL (Caddy/API/auth). Eve side services are exposed only if Legs/tunnel is enabled.',
            },
          ],
          initialValue: installDomain !== 'localhost' ? 'public' : 'local',
        });
        if (isCancel(accessMode)) {
          console.log(colors.muted('Cancelled.'));
          return;
        }

        exposureMode = accessMode as 'local' | 'public';
        if (accessMode === 'local') {
          installDomain = 'localhost';
        } else {
          const d = await text({
            message: 'Public hostname for Synap (Caddy URL for API/auth, e.g. pod.example.com)',
            initialValue: installDomain !== 'localhost' ? installDomain : '',
            placeholder: 'pod.example.com',
          });
          if (isCancel(d)) {
            console.log(colors.muted('Cancelled.'));
            return;
          }
          const candidate = d.trim();
          if (!candidate || candidate === 'localhost') {
            console.error('Public mode requires a real hostname (not localhost).');
            process.exit(1);
          }
          installDomain = candidate;
        }

        if (installDomain !== 'localhost' && !installEmail) {
          const em = await text({
            message: "Let's Encrypt email for TLS certificates",
            placeholder: 'you@example.com',
            initialValue: '',
          });
          if (isCancel(em)) {
            console.log(colors.muted('Cancelled.'));
            return;
          }
          const trimmed = em.trim();
          if (!trimmed) {
            console.error('Non-localhost domain requires --email (or LETSENCRYPT_EMAIL).');
            process.exit(1);
          }
          installEmail = trimmed;
        }

        if (installMode === 'auto') {
          const mode = await select({
            message: 'Synap install mode',
            options: [
              { value: 'auto' as const, label: 'Auto', hint: 'Let synap decide (repo-aware default)' },
              { value: 'from_image' as const, label: 'From image', hint: 'Use prebuilt GHCR image' },
              { value: 'from_source' as const, label: 'From source', hint: 'Build locally from repo checkout' },
            ],
            initialValue: 'auto',
          });
          if (isCancel(mode)) {
            console.log(colors.muted('Cancelled.'));
            return;
          }
          installMode = mode as 'auto' | 'from_image' | 'from_source';
        }

        const bootstrapMode = await select({
          message: 'Admin bootstrap mode for Synap',
          options: [
            {
              value: 'token' as const,
              label: 'Token (recommended)',
              hint: 'Generate bootstrap token; create first admin later in UI/CLI.',
            },
            {
              value: 'preseed' as const,
              label: 'Preseed admin now',
              hint: 'Create first admin during install (needs email + password).',
            },
          ],
          initialValue: adminBootstrapMode,
        });
        if (isCancel(bootstrapMode)) {
          console.log(colors.muted('Cancelled.'));
          return;
        }
        adminBootstrapMode = bootstrapMode as 'preseed' | 'token';

        if (adminBootstrapMode === 'preseed') {
          const ae = await text({
            message: 'Admin email for initial Synap admin account',
            initialValue: adminEmail ?? '',
            placeholder: 'admin@example.com',
          });
          if (isCancel(ae)) {
            console.log(colors.muted('Cancelled.'));
            return;
          }
          adminEmail = ae.trim();
          if (!adminEmail) {
            console.error('Preseed mode requires an admin email.');
            process.exit(1);
          }
          if (!adminPassword) {
            const ap = await text({
              message: 'Admin password for initial account',
              initialValue: '',
              placeholder: 'Choose a strong password',
            });
            if (isCancel(ap)) {
              console.log(colors.muted('Cancelled.'));
              return;
            }
            adminPassword = ap.trim();
          }
          if (!adminPassword) {
            console.error('Preseed mode requires an admin password.');
            process.exit(1);
          }
        }

        const askOpenclaw = await confirm({
          message:
            adminBootstrapMode === 'preseed'
              ? 'Install OpenClaw during Synap install? (A workspace exists after preseed, so the add-on can provision immediately.)'
              : 'Enable OpenClaw for this pod? (Token bootstrap has no workspace yet — Synap install skips the add-on; the admin UI will offer setup after you register.)',
          initialValue:
            adminBootstrapMode === 'preseed' ? installWithOpenclaw : false,
        });
        if (isCancel(askOpenclaw)) {
          console.log(colors.muted('Cancelled.'));
          return;
        }
        installWithOpenclaw = Boolean(askOpenclaw);

        const askRsshub = await confirm({
          message: 'Enable RSSHub during Synap install?',
          initialValue: installWithRsshub,
        });
        if (isCancel(askRsshub)) {
          console.log(colors.muted('Cancelled.'));
          return;
        }
        installWithRsshub = Boolean(askRsshub);

        if (!tunnelProvider) {
          const t = await select({
            message: 'Expose Eve Legs (Traefik) via a tunnel after Synap install?',
            options: [
              { value: 'none' as const, label: 'No tunnel', hint: 'Localhost / manual Traefik only' },
              {
                value: 'pangolin' as const,
                label: 'Pangolin',
                hint: 'Installs Pangolin CLI and writes config under /opt/hestia/tunnels',
              },
              {
                value: 'cloudflare' as const,
                label: 'Cloudflare',
                hint: 'cloudflared + ingress config (stub credentials path)',
              },
            ],
            initialValue: 'none',
          });
          if (isCancel(t)) {
            console.log(colors.muted('Cancelled.'));
            return;
          }
          tunnelProvider =
            t === 'none' ? undefined : parseTunnel(String(t));
        }
        if (tunnelProvider && !tunnelDomain) {
          if (installDomain !== 'localhost') {
            const strategy = await select({
              message: 'Legs ingress hostname',
              options: [
                {
                  value: 'same_as_synap' as const,
                  label: `Reuse Synap host (${installDomain})`,
                  hint: 'No extra hostname needed.',
                },
                {
                  value: 'custom' as const,
                  label: 'Use a different hostname',
                  hint: 'Example: eve.example.com',
                },
              ],
              initialValue: 'same_as_synap',
            });
            if (isCancel(strategy)) {
              console.log(colors.muted('Cancelled.'));
              return;
            }
            legsHostStrategy = strategy as 'same_as_synap' | 'custom';
            if (legsHostStrategy === 'same_as_synap') {
              tunnelDomain = installDomain;
            }
          } else {
            legsHostStrategy = 'custom';
          }
          if (!tunnelDomain) {
            const d = await text({
              message: 'Public hostname for Eve Legs ingress',
              placeholder: 'eve.example.com',
              initialValue: '',
            });
            if (isCancel(d)) {
              console.log(colors.muted('Cancelled.'));
              return;
            }
            tunnelDomain = d.trim() || undefined;
          }
        }
      }

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
      if (installDomain !== 'localhost' && !installEmail) {
        console.error('Non-localhost domain requires --email (or LETSENCRYPT_EMAIL).');
        process.exit(1);
      }
      if (adminBootstrapMode === 'preseed' && !adminEmail) {
        console.error('Preseed admin bootstrap requires --admin-email (or ADMIN_EMAIL).');
        process.exit(1);
      }
      if (adminBootstrapMode === 'preseed' && !adminPassword) {
        console.error('Preseed admin bootstrap requires --admin-password (or ADMIN_PASSWORD).');
        process.exit(1);
      }

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
        merge.synap = {
          apiUrl: prevSecrets?.synap?.apiUrl ?? 'http://127.0.0.1:4000',
          apiKey: podKey,
          hubBaseUrl: prevSecrets?.synap?.hubBaseUrl ?? process.env.SYNAP_HUB_BASE_URL ?? undefined,
        };
        merge.arms = {
          openclawSynapApiKey: podKey,
        };
      } else {
        merge.arms = {
          openclawSynapApiKey: ensureSecretValue(
            prevSecrets?.arms?.openclawSynapApiKey ?? process.env.OPENCLAW_SYNAP_API_KEY,
          ),
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
}
