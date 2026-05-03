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
import { modeCommands } from './commands/mode.js';
import { authCommand } from './commands/auth.js';
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

// Header/banner is rendered inside the custom helpInformation() override below.

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
modeCommands(program);
authCommand(program);
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

// ---------------------------------------------------------------------------
// Help visibility: hide redundant/niche commands from default `eve --help`
// while keeping them fully runnable. They reappear via `eve help-all`.
// ---------------------------------------------------------------------------

const HIDDEN_FROM_DEFAULT_HELP = new Set([
  'init',     // alias for `install` — hide the duplicate entry
  'setup',    // niche guided 3-path wizard
  'birth',    // bare-metal provisioning (placeholder)
  'grow',     // semantic overlap with `add`
  'purge',    // destructive — keep out of default help
  'inspect',  // power-user debug
  'brain',    // organ wrapper (delegates to install/status)
  'arms',
  'eyes',
  'legs',
  'builder',
]);

for (const cmd of program.commands) {
  if (HIDDEN_FROM_DEFAULT_HELP.has(cmd.name())) {
    (cmd as Command & { hidden?: boolean }).hidden = true;
  }
}

// Categorized help renderer — used by both default `--help` and `help-all`.
// `showHidden=true` includes hidden commands grouped under their categories.
type HelpCategory = { title: string; commands: string[] };

const DEFAULT_CATEGORIES: HelpCategory[] = [
  { title: 'Lifecycle',     commands: ['install', 'update', 'add', 'remove'] },
  { title: 'Status',        commands: ['status', 'doctor'] },
  { title: 'Operations',    commands: ['logs', 'recreate', 'backup'] },
  { title: 'Configuration', commands: ['config', 'domain', 'mode', 'auth', 'ai'] },
  { title: 'UI',            commands: ['ui'] },
];

const HIDDEN_CATEGORIES: HelpCategory[] = [
  { title: 'Lifecycle (hidden)', commands: ['init', 'setup', 'birth', 'grow'] },
  { title: 'Debug (hidden)',     commands: ['inspect', 'purge'] },
  { title: 'Organs (hidden)',    commands: ['brain', 'arms', 'eyes', 'legs', 'builder'] },
];

function shortDesc(s: string): string {
  // First sentence only; clamp to 70 chars to keep the help screen tight.
  const firstSentence = s.split(/(?<=\.)\s|\.\s/)[0].trim();
  const base = firstSentence.length > 0 ? firstSentence : s;
  return base.length > 70 ? base.slice(0, 67).trimEnd() + '…' : base;
}

function describeCommand(name: string): { label: string; desc: string } | null {
  const cmd = program.commands.find((c) => c.name() === name);
  if (!cmd) return null;
  const aliases = cmd.aliases();
  const label = aliases.length > 0 ? `${cmd.name()} (${aliases.join(', ')})` : cmd.name();
  return { label, desc: shortDesc(cmd.description()) };
}

function renderCategories(categories: HelpCategory[]): string {
  const labelWidth = 16;
  const lines: string[] = [];
  for (const cat of categories) {
    const rows: string[] = [];
    for (const name of cat.commands) {
      const info = describeCommand(name);
      if (!info) continue;
      const label = info.label.padEnd(labelWidth);
      rows.push(`  ${colors.primary(label)} ${colors.muted(info.desc)}`);
    }
    if (rows.length === 0) continue;
    lines.push('');
    lines.push(colors.primary.bold(`${cat.title}:`));
    lines.push(...rows);
  }
  return lines.join('\n');
}

function buildHelpString(showHidden: boolean): string {
  // Header (banner + organ symbology) — branding stays
  const header =
    `\n${colors.primary.bold('Eve — sovereign stack installer & operator')}\n\n` +
    `${emojis.brain} Brain   Synap + data stores + optional Ollama\n` +
    `${emojis.arms} Arms    OpenClaw (agent messaging layer)\n` +
    `${emojis.builder} Builder OpenCode / OpenClaude / Dokploy\n` +
    `${emojis.eyes} Eyes    RSSHub\n` +
    `${emojis.legs} Legs    Traefik / domains\n`;

  const usage =
    `\n${colors.muted('Usage:')} eve [options] [command]\n` +
    `${colors.muted('Flags:')} ${colors.primary('--help-all')} ${colors.muted('(full list)')}  ` +
    `${colors.primary('-v')} ${colors.muted('version')}  ` +
    `${colors.primary('--json -y --verbose')} ${colors.muted('(see <command> --help)')}\n`;
  const globalOpts = '';

  const main = renderCategories(DEFAULT_CATEGORIES);
  const hidden = showHidden ? '\n\n' + renderCategories(HIDDEN_CATEGORIES) : '';

  const footer = showHidden
    ? `\n\n${colors.muted('These commands are hidden from default help but remain runnable.')}\n` +
      `${colors.muted('Run')} ${colors.primary('eve <command> --help')} ${colors.muted('for command-specific help.')}\n`
    : `\n\n${colors.muted('Run')} ${colors.primary('eve --help-all')} ${colors.muted('to see all commands including legacy and niche options.')}\n` +
      `${colors.muted('Run')} ${colors.primary('eve <command> --help')} ${colors.muted('for command-specific help.')}\n`;

  return header + usage + globalOpts + main + hidden + footer;
}

// Override top-level help output with our categorized layout. Subcommands
// keep commander's default help renderer (helpInformation is per-command).
program.helpInformation = function (): string {
  const argvHasHelpAll = process.argv.slice(2).includes('--help-all');
  let optsHelpAll = false;
  try {
    optsHelpAll = Boolean((program.opts() as { helpAll?: boolean }).helpAll);
  } catch {
    // opts() may throw before parse — fall back to argv inspection
  }
  return buildHelpString(argvHasHelpAll || optsHelpAll);
};

// `--help-all` flag — toggles the hidden categories in the help output.
program.option('--help-all', 'Show all commands including legacy/niche');

// Also expose `eve help-all` as a top-level command for discoverability.
program
  .command('help-all')
  .description('Show all commands including legacy/niche')
  .action(() => {
    process.stdout.write(buildHelpString(true));
  });

// If user passed --help-all without --help, still show the full help and exit.
const argv = process.argv.slice(2);
if (argv.includes('--help-all') && !argv.includes('--help') && !argv.includes('-h') && !argv.includes('help-all')) {
  process.stdout.write(buildHelpString(true));
  process.exit(0);
}

process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled:', reason);
  process.exit(1);
});

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
