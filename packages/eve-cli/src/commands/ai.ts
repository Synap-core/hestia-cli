import { Command } from 'commander';
import { execa } from 'execa';
import { OllamaService } from '@eve/brain';
import { getGlobalCliFlags, outputJson } from '@eve/cli-kit';
import { colors, printError, printInfo } from '../lib/ui.js';

export function aiCommandGroup(program: Command): void {
  const ai = program.command('ai').description('Local AI (Ollama) helpers');

  ai
    .command('status')
    .description('Show whether Ollama is running and list models')
    .action(async () => {
      const ollama = new OllamaService();
      try {
        const s = await ollama.getStatus();
        if (getGlobalCliFlags().json) {
          outputJson(s);
          return;
        }
        console.log(colors.primary.bold('Ollama'));
        console.log(`  Running: ${s.running ? 'yes' : 'no'}`);
        console.log(`  Models: ${s.modelsInstalled.length ? s.modelsInstalled.join(', ') : '(none)'}`);
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  ai
    .command('models')
    .description('List models (docker exec ollama list)')
    .action(async () => {
      const ollama = new OllamaService();
      const models = await ollama.listModels();
      if (getGlobalCliFlags().json) {
        outputJson({ models });
        return;
      }
      for (const m of models) {
        console.log(`  ${m}`);
      }
      if (models.length === 0) {
        printInfo('No models or Ollama not running. Try: eve brain init --with-ai');
      }
    });

  ai
    .command('pull')
    .description('Pull a model into Ollama')
    .argument('<model>', 'Model tag e.g. llama3.1:8b')
    .action(async (model: string) => {
      const ollama = new OllamaService();
      try {
        await ollama.pullModel(model);
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  ai
    .command('chat')
    .description('Send a one-shot prompt to ollama run (requires CLI on host or use docker exec)')
    .argument('<prompt>', 'Prompt text')
    .option('--model <m>', 'Model name', 'llama3.1:8b')
    .action(async (prompt: string, opts: { model?: string }) => {
      try {
        await execa(
          'docker',
          ['exec', '-i', 'eve-brain-ollama', 'ollama', 'run', opts.model ?? 'llama3.1:8b', prompt],
          { stdio: 'inherit' }
        );
      } catch (e) {
        printError(
          e instanceof Error
            ? e.message
            : 'Failed. Ensure container eve-brain-ollama is running (eve brain init --with-ai).'
        );
        process.exit(1);
      }
    });
}
