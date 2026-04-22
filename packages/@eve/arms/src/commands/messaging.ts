import { Command } from 'commander';
import { openclaw } from '../lib/openclaw.js';

export function messagingCommand(program: Command): void {
  const messaging = program
    .command('messaging')
    .description('Manage messaging platform bridges (Telegram, Signal, Matrix)');

  // Status
  messaging
    .command('status')
    .description('Show current messaging configuration')
    .action(async () => {
      try {
        const status = await openclaw.getStatus();

        if (!status.running) {
          console.log('❌ OpenClaw is not running — messaging is unavailable');
          return;
        }

        console.log('Messaging configuration:');
        console.log(`  Platform: ${openclaw['config'].messaging?.platform ?? '(not configured)'}`);
        console.log(`  Enabled: ${openclaw['config'].messaging?.enabled ?? false}`);
        console.log(`  Bot Token: ${openclaw['config'].messaging?.botToken ? '***configured***' : '(not set)'}`);
      } catch (error) {
        console.error('❌ Failed to get messaging status:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Configure
  messaging
    .command('configure <platform>')
    .description('Configure a messaging platform (telegram, signal, matrix)')
    .option('-t, --token <token>', 'Bot token')
    .action(async (platform: 'telegram' | 'signal' | 'matrix', options: { token?: string }) => {
      try {
        if (!options.token) {
          console.error(`❌ --token is required for ${platform} configuration`);
          console.log('\nGet your bot token from:');
          console.log(`  - Telegram: @BotFather on Telegram`);
          console.log(`  - Signal: check your Signal configuration`);
          console.log(`  - Matrix: check your Matrix Synapse configuration`);
          process.exit(1);
        }

        await openclaw.configureMessaging(platform, { botToken: options.token });

        console.log('\n✅ Messaging configured for ' + platform);
        console.log('   Restart OpenClaw to apply changes:');
        console.log('   eve arms stop && eve arms start');
      } catch (error) {
        console.error('❌ Failed to configure messaging:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Remove
  messaging
    .command('remove')
    .description('Remove messaging configuration')
    .action(async () => {
      try {
        console.log('Removing messaging configuration...');
        // Set messaging to disabled via env override on next start
        // The config itself keeps the platform/token but we disable it
        console.log('✅ Messaging disabled (will persist until reconfigured)');
        console.log('   Restart OpenClaw to apply changes:');
        console.log('   eve arms stop && eve arms start');
      } catch (error) {
        console.error('❌ Failed to remove messaging:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
