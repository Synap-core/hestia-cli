import { Command } from 'commander';
import { readSetupProfile } from '@eve/dna';
import { runBuilderOrganSetup, type BuilderEngine } from '../lib/builder-organ.js';

function parseEngines(raw: string | undefined, profileDefault?: string | undefined): Set<BuilderEngine> {
  const v = (raw ?? 'all').trim().toLowerCase();
  if (!v || v === 'all') {
    return new Set<BuilderEngine>(['opencode', 'openclaude', 'claudecode']);
  }
  const set = new Set<BuilderEngine>();
  for (const part of v.split(',')) {
    const p = part.trim().toLowerCase();
    if (p === 'opencode' || p === 'openclaude' || p === 'claudecode' || p === 'claude_code' || p === 'claude-code') {
      set.add(p === 'claude_code' || p === 'claude-code' ? 'claudecode' : (p as BuilderEngine));
    }
  }
  if (set.size === 0 && profileDefault) {
    const d = profileDefault.trim().toLowerCase();
    if (d === 'opencode' || d === 'openclaude' || d === 'claudecode') set.add(d as BuilderEngine);
  }
  if (set.size === 0) {
    return new Set<BuilderEngine>(['opencode', 'openclaude', 'claudecode']);
  }
  return set;
}

export function initCommand(program: Command): void {
  program
    .command('init <name>')
    .description(
      'Builder organ first: OpenCode + OpenClaude + Claude Code (Hub .env + skills). Traefik / Pangolin / Dokploy are separate — use --with-dokploy only if you want Dokploy.',
    )
    .option('--template <template>', 'Project template (website, docs, app)')
    .option('--brain-url <url>', 'Brain/Ollama URL for OpenClaude (defaults to .eve/secrets)')
    .option(
      '--engines <list>',
      'Comma list or all: opencode,openclaude,claudecode (Claude Code). Default all.',
      'all',
    )
    .option(
      '--with-dokploy',
      'Install Dokploy CLI and create a project (optional; often skipped in favour of webhooks or static hosting)',
    )
    .action(
      async (
        name,
        options: { template?: string; brainUrl?: string; engines?: string; withDokploy?: boolean },
      ) => {
        console.log(`Initializing Builder organ: ${name}`);
        console.log('');

        const sp = await readSetupProfile(process.cwd());
        const engines = parseEngines(options.engines, sp?.builderEngine);
        const withDokploy = Boolean(options.withDokploy);

        try {
          console.log('📦 Step 1: Engines (central Hub + skills wiring)');
          console.log('-------------------------------------------');
          console.log(`Engines: ${[...engines].join(', ')}`);
          console.log(`Dokploy: ${withDokploy ? 'yes (--with-dokploy)' : 'skipped (use DOKPLOY_WEBHOOK_URL in .env or eve builder stack)'}\n`);

          if (sp?.profile === 'data_pod') {
            console.log(
              'Note: setup profile is data_pod — use inference gateway URL for OpenClaude --brain-url if needed (e.g. http://127.0.0.1:11435).\n',
            );
          }

          console.log('🏗️  Step 2: Project tree + .env + skills…');
          console.log('-------------------------------------------');

          const { projectDir, dokployUsed } = await runBuilderOrganSetup({
            name,
            cwd: process.cwd(),
            engines,
            template: options.template,
            brainUrl: options.brainUrl,
            withDokploy,
          });

          console.log('✅ Builder organ ready');
          console.log('');
          console.log(`Project path: ${projectDir}`);
          console.log('  .env — SYNAP_API_URL, SYNAP_API_KEY, HUB_BASE_URL, EVE_SKILLS_DIR, DOKPLOY_WEBHOOK_URL');
          if (engines.has('claudecode')) {
            console.log('  .claude/settings.json + .claude/skills/synap/ — Claude Code');
          }
          console.log('');
          console.log('Next (still in Builder):');
          console.log(`  cd "${projectDir}"`);
          if (engines.has('opencode')) console.log('  eve builder generate');
          if (engines.has('openclaude')) console.log('  eve builder code "<prompt>"');
          if (engines.has('claudecode')) console.log('  claude   # Claude Code in this directory');
          if (dokployUsed) console.log('  eve builder deploy');
          else
            console.log(
              '  eve builder deploy   # only if you used --with-dokploy; else use your webhook / CI',
            );
          console.log('  eve builder sandbox up   # optional isolated Node + workspace');
          console.log('');
          console.log('Then (other Eve organs — order as you like):');
          console.log('  eve setup | eve legs setup | eve legs newt up | eve builder stack up');
          console.log('');
        } catch (error) {
          console.error('❌ Initialization failed:', error);
          process.exit(1);
        }
      },
    );
}
