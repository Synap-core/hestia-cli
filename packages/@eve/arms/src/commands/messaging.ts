import { createInterface } from 'node:readline';
import { Command } from 'commander';
import {
  configureChannel,
  disableChannel,
  readChannelStatus,
  validateChannelCredentials,
  type ChannelCredentialInput,
  type ChannelPlatform,
  type ConfigureChannelOptions,
} from '@eve/dna';

const ALL_PLATFORMS: ReadonlyArray<ChannelPlatform> = [
  'telegram',
  'discord',
  'whatsapp',
  'signal',
  'matrix',
  'slack',
];

function isKnownPlatform(value: string): value is ChannelPlatform {
  return (ALL_PLATFORMS as ReadonlyArray<string>).includes(value);
}

function parseRouting(value?: string): ConfigureChannelOptions['routing'] | undefined {
  if (value === undefined) return undefined;
  if (value === 'hermes' || value === 'openclaw') return value;
  throw new Error(`--routing must be 'hermes' or 'openclaw' (got: ${value})`);
}

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

interface ConfigureFlags {
  token?: string;
  webhookSecret?: string;
  guildId?: string;
  appId?: string;
  signingSecret?: string;
  appToken?: string;
  phoneNumber?: string;
  apiUrl?: string;
  homeserverUrl?: string;
  accessToken?: string;
  roomId?: string;
  routing?: string;
  /** Commander turns `--no-validate` into `validate: false`. Default true. */
  validate?: boolean;
  /** WhatsApp Cloud API mode — triggers the Meta Graph API path. */
  cloudApi?: boolean;
  /** WhatsApp Cloud API: Meta phone number ID. */
  phoneNumberId?: string;
  /** WhatsApp Cloud API: webhook verify token. */
  verifyToken?: string;
}

async function promptValue(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function buildInput(platform: ChannelPlatform, opts: ConfigureFlags): ChannelCredentialInput {
  switch (platform) {
    case 'telegram': {
      if (!opts.token) {
        fail('Telegram requires --token <botToken>. Get it from @BotFather on Telegram.');
      }
      return {
        platform: 'telegram',
        botToken: opts.token,
        ...(opts.webhookSecret ? { webhookSecret: opts.webhookSecret } : {}),
      };
    }
    case 'discord': {
      if (!opts.token) {
        fail('Discord requires --token <botToken>. Get it from the Discord Developer Portal.');
      }
      return {
        platform: 'discord',
        botToken: opts.token,
        ...(opts.guildId ? { guildId: opts.guildId } : {}),
        ...(opts.appId ? { applicationId: opts.appId } : {}),
      };
    }
    case 'slack': {
      if (!opts.token) fail('Slack requires --token <botToken>.');
      if (!opts.signingSecret) fail('Slack requires --signing-secret <secret>.');
      return {
        platform: 'slack',
        botToken: opts.token,
        signingSecret: opts.signingSecret,
        ...(opts.appToken ? { appToken: opts.appToken } : {}),
      };
    }
    case 'signal': {
      if (!opts.phoneNumber) fail('Signal requires --phone-number <num>.');
      return {
        platform: 'signal',
        phoneNumber: opts.phoneNumber,
        ...(opts.apiUrl ? { apiUrl: opts.apiUrl } : {}),
      };
    }
    case 'matrix': {
      if (!opts.homeserverUrl) fail('Matrix requires --homeserver-url <url>.');
      if (!opts.accessToken) fail('Matrix requires --access-token <token>.');
      return {
        platform: 'matrix',
        homeserverUrl: opts.homeserverUrl,
        accessToken: opts.accessToken,
        ...(opts.roomId ? { roomId: opts.roomId } : {}),
      };
    }
    case 'whatsapp': {
      // Only reached for --cloud-api; caller ensures all three fields are set.
      if (!opts.phoneNumberId) fail('WhatsApp Cloud API requires --phone-number-id <id>.');
      if (!opts.accessToken) fail('WhatsApp Cloud API requires --access-token <token>.');
      if (!opts.verifyToken) fail('WhatsApp Cloud API requires --verify-token <token>.');
      return {
        platform: 'whatsapp',
        mode: 'cloud-api',
        phoneNumberId: opts.phoneNumberId,
        accessToken: opts.accessToken,
        verifyToken: opts.verifyToken,
      };
    }
  }
}

function platformLabel(platform: ChannelPlatform): string {
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

export function messagingCommand(program: Command): void {
  const messaging = program
    .command('messaging')
    .description(
      'Manage messaging platform credentials (Telegram, Discord, Slack, Signal, Matrix, WhatsApp)',
    );

  // ---- status -------------------------------------------------------------
  messaging
    .command('status')
    .description('Show current messaging configuration from secrets.json')
    .action(async () => {
      try {
        const rows = await readChannelStatus(process.cwd());
        console.log('Messaging channels (from .eve/secrets/secrets.json):\n');
        const header = `  ${'Platform'.padEnd(10)} ${'Enabled'.padEnd(8)} ${'Creds'.padEnd(7)} Routing`;
        console.log(header);
        console.log(`  ${'-'.repeat(header.length - 2)}`);
        for (const row of rows) {
          const enabled = row.enabled ? '✅ yes' : '— no';
          const creds = row.hasCredentials ? '✅' : '—';
          console.log(
            `  ${row.platform.padEnd(10)} ${enabled.padEnd(8)} ${creds.padEnd(7)} ${row.routing}`,
          );
        }
      } catch (error) {
        console.error('❌ Failed to read messaging status:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // ---- configure <platform> ----------------------------------------------
  messaging
    .command('configure <platform>')
    .description('Configure a messaging platform (telegram, discord, slack, signal, matrix, whatsapp)')
    .option('-t, --token <botToken>', 'Bot token (telegram, discord, slack)')
    .option('--webhook-secret <secret>', 'Telegram webhook shared secret')
    .option('--guild-id <id>', 'Discord guild ID')
    .option('--app-id <id>', 'Discord application ID')
    .option('--signing-secret <secret>', 'Slack signing secret')
    .option('--app-token <token>', 'Slack app-level token (xapp-…)')
    .option('--phone-number <num>', 'Signal phone number (E.164)')
    .option('--api-url <url>', 'Signal CLI REST API base URL')
    .option('--homeserver-url <url>', 'Matrix homeserver URL')
    .option('--access-token <token>', 'Matrix or WhatsApp Cloud API access token')
    .option('--room-id <id>', 'Matrix room ID')
    .option('--routing <agent>', "Agent that handles this platform: 'hermes' (default) or 'openclaw'")
    .option('--no-validate', 'Skip the platform credential probe (use for self-hosted Matrix on private networks)')
    .option('--cloud-api', 'WhatsApp Cloud API mode (Meta Graph API — no browser/QR scan required)')
    .option('--phone-number-id <id>', 'WhatsApp Cloud API: Meta phone number ID')
    .option('--verify-token <token>', 'WhatsApp Cloud API: webhook verify token')
    .action(async (platformArg: string, opts: ConfigureFlags) => {
      try {
        if (!isKnownPlatform(platformArg)) {
          fail(
            `Unknown platform '${platformArg}'. Supported: ${ALL_PLATFORMS.join(', ')}`,
          );
        }
        const platform: ChannelPlatform = platformArg;

        if (platform === 'whatsapp' && !opts.cloudApi) {
          console.log('WhatsApp supports two onboarding paths:');
          console.log('');
          console.log('  --cloud-api   Meta WhatsApp Cloud API (recommended)');
          console.log('                Requires a Meta Business account with a verified phone number.');
          console.log('                Run: eve arms messaging configure whatsapp --cloud-api');
          console.log('');
          console.log('  --browser     QR-scan via the Agents browser app');
          console.log('                Open the Agents app → "Connect Channel" → WhatsApp');
          console.log('                and scan the QR code with WhatsApp mobile');
          console.log('                (Settings → Linked Devices → Link a Device).');
          return;
        }

        if (platform === 'whatsapp' && opts.cloudApi) {
          // Prompt for any missing Cloud API fields interactively.
          if (!opts.phoneNumberId) {
            opts.phoneNumberId = await promptValue('Phone Number ID (from Meta Business Manager): ');
            if (!opts.phoneNumberId) fail('Phone Number ID is required for WhatsApp Cloud API.');
          }
          if (!opts.accessToken) {
            opts.accessToken = await promptValue('Access Token (permanent system user token): ');
            if (!opts.accessToken) fail('Access Token is required for WhatsApp Cloud API.');
          }
          if (!opts.verifyToken) {
            opts.verifyToken = await promptValue('Verify Token (webhook secret you choose): ');
            if (!opts.verifyToken) fail('Verify Token is required for WhatsApp Cloud API.');
          }
        }

        const routing = parseRouting(opts.routing);
        const input = buildInput(platform, opts);

        if (opts.validate !== false) {
          const v = await validateChannelCredentials(input);
          if (!v.ok) {
            fail(
              `${platformLabel(platform)} credential validation failed: ${v.error ?? 'unknown error'}.\n` +
              `   Re-run with --no-validate to persist anyway (e.g., self-hosted endpoint not reachable from this host).`,
            );
          }
          if (v.skipped) {
            console.log(`ℹ ${platformLabel(platform)} validation skipped (${v.details ?? 'no remote probe'}).`);
          } else {
            console.log(`✅ ${platformLabel(platform)} credentials valid (${v.details ?? 'authenticated'}).`);
          }
        }

        const result = await configureChannel(process.cwd(), input, routing ? { routing } : {});

        console.log(`✅ ${platformLabel(platform)} credentials saved.`);
        console.log(`   ${result.reconcileSummary}.`);
        if (!result.wired) {
          console.log('   (Hermes env not regenerated — install Hermes to activate channel routing.)');
        }
      } catch (error) {
        console.error('❌ Failed to configure messaging:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // ---- remove <platform> --------------------------------------------------
  messaging
    .command('remove <platform>')
    .description('Disable a messaging platform (credentials kept; set enabled=false)')
    .action(async (platformArg: string) => {
      try {
        if (!isKnownPlatform(platformArg)) {
          fail(
            `Unknown platform '${platformArg}'. Supported: ${ALL_PLATFORMS.join(', ')}`,
          );
        }
        await disableChannel(process.cwd(), platformArg);
        console.log(`✅ ${platformLabel(platformArg)} disabled. Credentials retained for re-enable.`);
      } catch (error) {
        console.error('❌ Failed to remove messaging:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
