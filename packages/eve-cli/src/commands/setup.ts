import type { Command } from 'commander';
import { select, confirm, isCancel, text } from '@clack/prompts';
import {
  readSetupProfile,
  writeSetupProfile,
  readUsbSetupManifest,
  probeHardware,
  formatHardwareReport,
  readEveSecrets,
  writeEveSecrets,
  ensureSecretValue,
  type SetupProfileKind,
  type EveSecrets,
} from '@eve/dna';
import { runBrainInit, runInferenceInit } from '@eve/brain';
import { runLegsProxySetup } from '@eve/legs';
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
  fromImage?: boolean;
  fromSource?: boolean;
  skipHardware?: boolean;
  nvidiaSmi?: boolean;
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

export function setupCommand(program: Command): void {
  program
    .command('setup')
    .description('Three-path guided setup: Ollama+gateway, Synap Data Pod, or both (logical prompts)')
    .option('--profile <p>', 'inference_only | data_pod | full')
    .option('--dry-run', 'Resolve profile and print plan; do not write state or install')
    .option('--synap-repo <path>', 'data_pod / full: path to synap-backend checkout')
    .option('--domain <host>', 'data_pod / full: synap install --domain', 'localhost')
    .option('--email <email>', 'data_pod / full: required if domain is not localhost')
    .option('--model <m>', 'inference_only / full: default Ollama model', 'llama3.1:8b')
    .option('--with-openclaw', 'data_pod / full: synap install --with-openclaw')
    .option('--with-rsshub', 'data_pod / full: synap install --with-rsshub')
    .option('--from-image', 'synap install --from-image')
    .option('--from-source', 'synap install --from-source')
    .option('--skip-hardware', 'Skip optional hardware summary')
    .option('--nvidia-smi', 'With hardware summary in non-interactive mode, run nvidia-smi')
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
        'Docs: hestia-cli/docs/EVE_SETUP_PROFILES.md and hestia-cli/README.md\n',
    )
    .action(async (opts: SetupCliOptions) => {
      const flags = getGlobalCliFlags();
      const cwd = process.cwd();

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
              label: 'Synap Data Pod only',
              hint: 'Official synap install (Caddy on 80/443); Eve for extra Docker apps',
            },
            {
              value: 'full' as const,
              label: 'Data Pod + Ollama',
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

      let tunnelProvider = parseTunnel(opts.tunnel) ?? usb?.tunnel_provider;
      let tunnelDomain =
        (opts.tunnelDomain?.trim() || usb?.tunnel_domain || '').trim() || undefined;

      if (
        !opts.dryRun &&
        (profile === 'data_pod' || profile === 'full') &&
        !flags.nonInteractive &&
        !flags.json
      ) {
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
          tunnelProvider = t === 'none' ? undefined : t;
        }
        if (tunnelProvider && !tunnelDomain) {
          const d = await text({
            message: 'Tunnel / ingress hostname (optional, e.g. eve.example.com)',
            placeholder: opts.domain && opts.domain !== 'localhost' ? opts.domain : '',
            initialValue: '',
          });
          if (isCancel(d)) {
            console.log(colors.muted('Cancelled.'));
            return;
          }
          tunnelDomain = d.trim() || undefined;
        }
      }

      if (flags.nonInteractive && opts.tunnel && !tunnelProvider) {
        console.error('Invalid --tunnel (use pangolin or cloudflare).');
        process.exit(1);
      }

      const existing = await readSetupProfile(cwd);
      if (existing && !flags.nonInteractive && !opts.dryRun) {
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
          tunnel: tunnelProvider ?? null,
          tunnelDomain: tunnelDomain ?? null,
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
          domainHint: opts.domain,
          hearthName: usb?.hearth_name,
          tunnelProvider,
          tunnelDomain,
        },
        cwd,
      );

      const prevSecrets = await readEveSecrets(cwd);
      type SecretsMerge = Omit<EveSecrets, 'version' | 'updatedAt'>;
      const merge: SecretsMerge = {
        builder: {
          openclaudeUrl:
            profile === 'data_pod'
              ? prevSecrets?.builder?.openclaudeUrl ??
                (process.env.OPENCLAUDE_BRAIN_URL || undefined)
              : prevSecrets?.builder?.openclaudeUrl ??
                prevSecrets?.inference?.gatewayUrl ??
                'http://127.0.0.1:11435',
          dokployApiUrl: prevSecrets?.builder?.dokployApiUrl ?? process.env.DOKPLOY_API_URL ?? 'http://127.0.0.1:3000',
          dokployApiKey: ensureSecretValue(prevSecrets?.builder?.dokployApiKey ?? process.env.DOKPLOY_API_KEY),
          workspaceDir: prevSecrets?.builder?.workspaceDir ?? `${cwd}/.eve/workspace`,
        },
        arms: {
          openclawSynapApiKey: ensureSecretValue(
            prevSecrets?.arms?.openclawSynapApiKey ??
              process.env.OPENCLAW_SYNAP_API_KEY ??
              prevSecrets?.synap?.apiKey,
          ),
        },
      };
      if (profile !== 'inference_only') {
        merge.synap = {
          apiUrl: prevSecrets?.synap?.apiUrl ?? 'http://127.0.0.1:4000',
          apiKey: ensureSecretValue(prevSecrets?.synap?.apiKey ?? process.env.SYNAP_API_KEY),
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

      if (flags.json) {
        outputJson({ ok: true, profile, persisted: true });
      }

      try {
        if (profile === 'inference_only') {
          await runInferenceInit({
            model: opts.model,
            withGateway: true,
            internalOllamaOnly: false,
          });
        } else if (profile === 'data_pod') {
          const repo = opts.synapRepo?.trim() || process.env.SYNAP_REPO_ROOT?.trim();
          if (!repo) {
            console.error('data_pod requires --synap-repo or SYNAP_REPO_ROOT');
            process.exit(1);
          }
          await runBrainInit({
            synapRepo: repo,
            domain: opts.domain,
            email: opts.email,
            withOpenclaw: opts.withOpenclaw,
            withRsshub: opts.withRsshub,
            fromImage: opts.fromImage,
            fromSource: opts.fromSource,
            withAi: false,
          });
          if (tunnelProvider) {
            const legsDomain =
              opts.domain && opts.domain !== 'localhost' ? opts.domain : tunnelDomain ?? undefined;
            await runLegsProxySetup({
              domain: legsDomain,
              tunnel: tunnelProvider,
              tunnelDomain,
              ssl: false,
              standalone: false,
            });
          }
        } else {
          const repo = opts.synapRepo?.trim() || process.env.SYNAP_REPO_ROOT?.trim();
          if (!repo) {
            console.error('full requires --synap-repo or SYNAP_REPO_ROOT');
            process.exit(1);
          }
          if (!flags.json) {
            console.log(colors.info('\nFull profile: (1) Data Pod  (2) Ollama internal + gateway\n'));
          }
          await runBrainInit({
            synapRepo: repo,
            domain: opts.domain,
            email: opts.email,
            withOpenclaw: opts.withOpenclaw,
            withRsshub: opts.withRsshub,
            fromImage: opts.fromImage,
            fromSource: opts.fromSource,
            withAi: false,
          });
          await runInferenceInit({
            model: opts.model,
            withGateway: true,
            internalOllamaOnly: true,
          });
          if (tunnelProvider) {
            const legsDomain =
              opts.domain && opts.domain !== 'localhost' ? opts.domain : tunnelDomain ?? undefined;
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
