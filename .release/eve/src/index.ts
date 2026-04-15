#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setGlobalCliFlags } from '@eve/cli-kit';
import {
  registerBrainCommands,
  runBrainInit,
} from '@eve/brain';
import { registerArmsCommands } from '@eve/arms';
import { registerLegsCommands } from '@eve/legs';
import { registerEyesCommands } from '@eve/eyes';
import { registerBuilderCommands } from '@eve/builder';
import { statusCommand } from './commands/status.js';
import { doctorCommand } from './commands/doctor.js';
import { growCommand } from './commands/grow.js';
import { birthCommand } from './commands/lifecycle/birth.js';
import { setupCommand } from './commands/setup.js';
import { logsCommand } from './commands/debug/logs.js';
import { inspectCommand } from './commands/debug/inspect.js';
import { configCommands } from './commands/manage/config-cmd.js';
import { backupUpdateCommands } from './commands/manage/backup-update.js';
import { aiCommandGroup } from './commands/ai.js';
import { colors, emojis } from './lib/ui.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as { version: string };

const program = new Command();

program.configureHelp({
  sortSubcommands: true,
  sortOptions: true,
});

program
  .name('eve')
  .description(`${emojis.entity} Eve — Entity Creation System`)
  .version(pkg.version, '-v, --version')
  .option('--json', 'Machine-readable output where supported')
  .option('-y, --yes', 'Non-interactive / assume confirm')
  .option('--verbose', 'Verbose logs')
  .hook('preAction', () => {
    const o = program.opts() as { json?: boolean; yes?: boolean; verbose?: boolean };
    setGlobalCliFlags({
      json: Boolean(o.json),
      nonInteractive: Boolean(o.yes),
      verbose: Boolean(o.verbose),
    });
  });

program.addHelpText(
  'before',
  `\n${colors.primary.bold('Eve — sovereign stack installer & operator')}\n\n` +
    `${emojis.brain} Brain   Synap + data stores + optional Ollama\n` +
    `${emojis.arms} Arms    OpenClaw / MCP\n` +
    `${emojis.builder} Builder OpenCode / OpenClaude / Dokploy\n` +
    `${emojis.eyes} Eyes    RSSHub\n` +
    `${emojis.legs} Legs    Traefik / domains\n`
);

program.addHelpText(
  'after',
  `\n${colors.muted('Categories:')}\n` +
    `  ${colors.primary('Lifecycle')}  setup, init, grow, birth, status\n` +
    `  ${colors.primary('Organs')}     brain, arms, eyes, legs, builder\n` +
    `  ${colors.primary('Debug')}      doctor, logs, inspect\n` +
    `  ${colors.primary('Management')} config, backup, update\n` +
    `  ${colors.primary('AI')}         ai …\n`
);

// --- Lifecycle ---
setupCommand(program);

program
  .command('init')
  .description(
    'Alias for brain init (Eve Docker brain, or full Data Pod with --synap-repo / SYNAP_REPO_ROOT)',
  )
  .option('--with-ai', 'Include Ollama for local AI')
  .option('--model <model>', 'AI model', 'llama3.1:8b')
  .option('--synap-repo <path>', 'synap-backend checkout → official synap install')
  .option('--domain <host>', 'With --synap-repo: synap install --domain', 'localhost')
  .option('--email <email>', "With --synap-repo: required when domain isn't localhost")
  .option('--with-openclaw', 'With --synap-repo: synap install --with-openclaw')
  .option('--with-rsshub', 'With --synap-repo: synap install --with-rsshub')
  .option('--from-image', 'With --synap-repo: synap install --from-image')
  .option('--from-source', 'With --synap-repo: synap install --from-source')
  .action(
    async (opts: {
      withAi?: boolean;
      model?: string;
      synapRepo?: string;
      domain?: string;
      email?: string;
      withOpenclaw?: boolean;
      withRsshub?: boolean;
      fromImage?: boolean;
      fromSource?: boolean;
    }) => {
      try {
        await runBrainInit({
          withAi: opts.withAi,
          model: opts.model,
          synapRepo: opts.synapRepo,
          domain: opts.domain,
          email: opts.email,
          withOpenclaw: opts.withOpenclaw,
          withRsshub: opts.withRsshub,
          fromImage: opts.fromImage,
          fromSource: opts.fromSource,
        });
      } catch {
        process.exit(1);
      }
    },
  );

birthCommand(program);
statusCommand(program);
growCommand(program);

// --- Debug ---
doctorCommand(program);
logsCommand(program);
inspectCommand(program);

// --- Management ---
configCommands(program);
backupUpdateCommands(program);

// --- AI ---
aiCommandGroup(program);

// --- Organs ---
const brain = program.command('brain').description('Intelligence & memory (Synap, DB, Redis, Ollama)');
registerBrainCommands(brain);

const arms = program.command('arms').description('Action — OpenClaw & MCP');
registerArmsCommands(arms);

const eyes = program.command('eyes').description('Perception — RSSHub');
registerEyesCommands(eyes);

const legs = program.command('legs').description('Exposure — Traefik & domains');
registerLegsCommands(legs);

const builder = program.command('builder').description('Creation — OpenCode / OpenClaude / Dokploy');
registerBuilderCommands(builder);

process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled:', reason);
  process.exit(1);
});

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
