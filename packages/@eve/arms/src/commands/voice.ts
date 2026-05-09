import { Command } from 'commander';
import { readEveSecrets, writeEveSecrets } from '@eve/dna';

export function voiceCommand(program: Command): void {
  const voice = program
    .command('voice')
    .description('Manage voice features (transcription, telephony)');

  // ─── Top-level status ──────────────────────────────────────────────────────

  voice
    .command('status')
    .description('Show voice feature status (transcription engine + telephony)')
    .action(async () => {
      try {
        const secrets = await readEveSecrets(process.cwd());

        // Transcription
        const t = secrets?.arms?.transcription;
        if (!t?.engine) {
          console.log('Transcription engine: not configured');
          console.log('  Run: eve arms voice transcription configure --engine whisper-local');
        } else {
          console.log('Transcription engine:');
          console.log(`  Engine:     ${t.engine}`);
          if (t.engine === 'whisper-local') {
            console.log(`  Model size: ${t.modelSize ?? 'base'}`);
          }
          if (t.engine === 'openai' || t.engine === 'deepgram') {
            console.log(`  API key:    ${t.apiKey ? '*** (set)' : '(not set)'}`);
          }
          if (t.language) console.log(`  Language:   ${t.language}`);
        }

        // Telephony
        const tel = (secrets?.arms as Record<string, unknown> | undefined)?.telephony as Record<string, unknown> | undefined;
        if (!tel?.provider) {
          console.log('\nTelephony: not configured');
          console.log('  Run: eve arms voice configure <provider>');
        } else {
          console.log('\nTelephony:');
          console.log(`  Provider: ${tel.provider}`);
        }
      } catch (error) {
        console.error('Failed to read voice config:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // ─── Telephony configure <provider> ───────────────────────────────────────

  voice
    .command('configure <provider>')
    .description('Configure telephony provider (e.g. twilio, vonage)')
    .action(async (provider: string) => {
      try {
        await writeEveSecrets({
          arms: {
            telephony: { provider } as Record<string, unknown>,
          },
        } as Parameters<typeof writeEveSecrets>[0], process.cwd());
        console.log(`Telephony provider configured: ${provider}`);
      } catch (error) {
        console.error('Failed to configure telephony:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // ─── transcription subcommand group ───────────────────────────────────────

  const transcription = voice
    .command('transcription')
    .description('Manage voice memo transcription engine (Whisper, OpenAI, Deepgram)');

  transcription
    .command('status')
    .description('Show current transcription engine configuration')
    .action(async () => {
      try {
        const secrets = await readEveSecrets(process.cwd());
        const t = secrets?.arms?.transcription;
        if (!t?.engine) {
          console.log('Transcription engine: not configured');
          console.log('  Run: eve arms voice transcription configure --engine whisper-local');
          return;
        }
        console.log('Transcription engine:');
        console.log(`  Engine:     ${t.engine}`);
        if (t.engine === 'whisper-local') {
          console.log(`  Model size: ${t.modelSize ?? 'base'}`);
        }
        if (t.engine === 'openai' || t.engine === 'deepgram') {
          console.log(`  API key:    ${t.apiKey ? '*** (set)' : '(not set)'}`);
        }
        if (t.language) console.log(`  Language:   ${t.language}`);
      } catch (error) {
        console.error('Failed to read transcription config:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  transcription
    .command('configure')
    .description('Configure the transcription engine for voice memos')
    .option('-e, --engine <engine>', 'Transcription engine: whisper-local, openai, deepgram')
    .option('-m, --model <size>', 'Whisper model size (whisper-local only): tiny, base, small, medium, large-v3')
    .option('-k, --api-key <key>', 'API key (openai or deepgram engines)')
    .option('-l, --language <lang>', 'BCP-47 language code for accuracy (e.g. en, fr)')
    .action(async (opts: { engine?: string; model?: string; apiKey?: string; language?: string }) => {
      try {
        const validEngines = ['whisper-local', 'openai', 'deepgram'];
        const validModels = ['tiny', 'base', 'small', 'medium', 'large-v3'];

        if (opts.engine && !validEngines.includes(opts.engine)) {
          console.error(`Unknown engine '${opts.engine}'. Choose: ${validEngines.join(', ')}`);
          process.exit(1);
        }
        if (opts.model && !validModels.includes(opts.model)) {
          console.error(`Unknown model '${opts.model}'. Choose: ${validModels.join(', ')}`);
          process.exit(1);
        }
        if ((opts.engine === 'openai' || opts.engine === 'deepgram') && !opts.apiKey) {
          console.error(`--api-key is required for the ${opts.engine} engine`);
          process.exit(1);
        }

        if (!opts.engine && !opts.model && !opts.apiKey && !opts.language) {
          console.error('No options provided. Use --engine, --model, --api-key, or --language');
          process.exit(1);
        }

        const engine = opts.engine as 'whisper-local' | 'openai' | 'deepgram' | undefined;
        const modelSize = opts.model as 'tiny' | 'base' | 'small' | 'medium' | 'large-v3' | undefined;
        const { apiKey, language } = opts;

        await writeEveSecrets({
          arms: {
            transcription: {
              ...(engine ? { engine } : {}),
              ...(modelSize ? { modelSize } : {}),
              ...(apiKey ? { apiKey } : {}),
              ...(language ? { language } : {}),
            },
          },
        } as Parameters<typeof writeEveSecrets>[0], process.cwd());

        const displayEngine = opts.engine ?? '(unchanged)';
        console.log(`Transcription engine configured: ${displayEngine}`);
        if (opts.engine === 'whisper-local') {
          console.log(`   Model: ${opts.model ?? 'base'}`);
          console.log('   Install whisper: pip install openai-whisper');
        }
      } catch (error) {
        console.error('Failed to configure transcription:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
