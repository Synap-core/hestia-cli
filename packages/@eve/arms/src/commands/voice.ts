import { Command } from 'commander';
import { openclaw } from '../lib/openclaw.js';

export function voiceCommand(program: Command): void {
  const voice = program
    .command('voice')
    .description('Manage voice/telephony configuration (Twilio, Signal, SIP)');

  // Status
  voice
    .command('status')
    .description('Show current voice configuration')
    .action(async () => {
      try {
        const status = await openclaw.getStatus();

        if (!status.running) {
          console.log('❌ OpenClaw is not running — voice is unavailable');
          return;
        }

        console.log('Voice configuration:');
        console.log(`  Provider: ${openclaw['config'].voice?.provider ?? '(not configured)'}`);
        console.log(`  Enabled: ${openclaw['config'].voice?.enabled ?? false}`);
        if (openclaw['config'].voice?.phoneNumber) {
          console.log(`  Phone Number: ${openclaw['config'].voice.phoneNumber}`);
        }
        if (openclaw['config'].voice?.sipUri) {
          console.log(`  SIP URI: ${openclaw['config'].voice.sipUri}`);
        }
      } catch (error) {
        console.error('❌ Failed to get voice status:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Configure
  voice
    .command('configure <provider>')
    .description('Configure voice provider (twilio, signal, selfhosted)')
    .option('-p, --phone <number>', 'Phone number (e.g. +1234567890)')
    .option('-s, --sip-uri <uri>', 'SIP URI (e.g. sip:bot@example.com)')
    .action(async (provider: 'twilio' | 'signal' | 'selfhosted', options: { phone?: string; sipUri?: string }) => {
      try {
        const voiceConfig: {
          provider?: 'twilio' | 'signal' | 'selfhosted';
          phoneNumber?: string;
          sipUri?: string;
        } = {
          provider,
        };

        if (options.phone) voiceConfig.phoneNumber = options.phone;
        if (options.sipUri) voiceConfig.sipUri = options.sipUri;

        // Validate provider requirements
        if (provider === 'twilio' && !options.phone) {
          console.error('❌ --phone is required for twilio configuration');
          process.exit(1);
        }

        if (provider === 'selfhosted' && !options.sipUri) {
          console.error('❌ --sip-uri is required for selfhosted configuration');
          process.exit(1);
        }

        await openclaw.configureVoice(voiceConfig);

        console.log('\n✅ Voice configured for ' + provider);
        console.log('   Restart OpenClaw to apply changes:');
        console.log('   eve arms stop && eve arms start');
      } catch (error) {
        console.error('❌ Failed to configure voice:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
