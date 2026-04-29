#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setGlobalCliFlags } from '@eve/cli-kit';
import { registerBrainCommands } from '@eve/brain';
import { registerArmsCommands } from '@eve/arms';
import { registerLegsCommands } from '@eve/legs';
import { registerEyesCommands } from '@eve/eyes';
import { registerBuilderCommands } from '@eve/builder';
import { statusCommand } from './commands/status.js';
import { doctorCommand } from './commands/doctor.js';
import { growCommand } from './commands/grow.js';
import { birthCommand } from './commands/lifecycle/birth.js';
import { installCommand } from './commands/lifecycle/install.js';
import { setupCommand } from './commands/setup.js';
import { runInstall } from './commands/lifecycle/install.js';
import { addCommand } from './commands/add.js';
import { removeCommand } from './commands/remove.js';
import { logsCommand } from './commands/debug/logs.js';
import { inspectCommand } from './commands/debug/inspect.js';
import { configCommands } from './commands/manage/config-cmd.js';
import { backupUpdateCommands } from './commands/manage/backup-update.js';
import { purgeCommand } from './commands/manage/purge.js';
import { aiCommandGroup } from './commands/ai.js';
import { uiCommand } from './commands/ui.js';
import { domainCommand } from './commands/domain.js';
import { colors, emojis } from './lib/ui.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
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
    `${emojis.arms} Arms    OpenClaw (agent messaging layer)\n` +
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
    `  ${colors.primary('Management')} config, backup, update, recreate\n` +
    `  ${colors.primary('AI')}         ai …\n`
);

// --- Lifecycle ---
setupCommand(program);
installCommand(program);
addCommand(program);
removeCommand(program);

program
  .command('init')
  .description('Alias for `eve install` — composable installer')
  .option('--components <list>', 'Comma-separated component IDs')
  .option('--domain <host>', 'Public hostname', 'localhost')
  .option('--email <email>', "Let's Encrypt email")
  .option('--model <model>', 'Ollama model', 'llama3.1:8b')
  .option('--synap-repo <path>', 'Path to synap-backend checkout')
  .option('--from-image', 'Install Synap from Docker image')
  .option('--admin-email <email>', 'Admin bootstrap email')
  .option('--admin-password <secret>', 'Admin password (preseed mode)')
  .option('--admin-bootstrap-mode <mode>', 'token | preseed')
  .option('--dry-run', 'Print plan without executing')
  .action(async (opts: {
    components?: string;
    domain?: string;
    email?: string;
    model?: string;
    synapRepo?: string;
    fromImage?: boolean;
    adminEmail?: string;
    adminPassword?: string;
    adminBootstrapMode?: 'token' | 'preseed';
    dryRun?: boolean;
  }) => {
    try {
      await runInstall({
        components: opts.components ? opts.components.split(',').map(s => s.trim()) : undefined,
        domain: opts.domain,
        email: opts.email,
        model: opts.model,
        synapRepo: opts.synapRepo,
        fromImage: opts.fromImage,
        adminEmail: opts.adminEmail,
        adminPassword: opts.adminPassword,
        adminBootstrapMode: opts.adminBootstrapMode,
        dryRun: opts.dryRun,
      });
    } catch (err) {
      console.error(String(err));
      process.exit(1);
    }
  });

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
purgeCommand(program);

// --- AI ---
aiCommandGroup(program);

// --- UI ---
uiCommand(program);

// --- Domain ---
domainCommand(program);

// --- Organs ---
const brain = program.command('brain').description('Intelligence & memory (Synap, Ollama)');
registerBrainCommands(brain);

const arms = program.command('arms').description('Action — OpenClaw (agent messaging layer)');
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
