import type { Command } from 'commander';
import { select, confirm, isCancel } from '@clack/prompts';
import {
  readSetupProfile,
  writeSetupProfile,
  readUsbSetupManifest,
  probeHardware,
  formatHardwareReport,
  type SetupProfileKind,
} from '@eve/dna';
import { runBrainInit, runInferenceInit } from '@eve/brain';
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
}

function parseProfile(s: string | undefined): SetupProfileKind | null {
  if (!s) return null;
  const v = s.trim().toLowerCase().replace(/-/g, '_');
  if (v === 'inference_only' || v === 'inferenceonly') return 'inference_only';
  if (v === 'data_pod' || v === 'datapod') return 'data_pod';
  if (v === 'full') return 'full';
  return null;
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
        },
        cwd,
      );

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
