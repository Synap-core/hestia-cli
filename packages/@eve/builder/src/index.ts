import { Command } from 'commander';
import { OpenCodeService } from './lib/opencode.js';
import { OpenClaudeService } from './lib/openclaude.js';
import { DokployService, type DokployStatus, type DokployProject } from './lib/dokploy.js';
import { ClaudeCodeService } from './lib/claudecode.js';
import { HermesDaemon } from './lib/hermes-daemon.js';
import { TaskPoller } from './lib/task-poll.js';
import { TaskExecutor } from './lib/task-executor.js';
import { TaskQueue } from './lib/task-queue.js';
import { runBuilderOrganSetup } from './lib/builder-organ.js';
import { initCommand } from './commands/init.js';
import { deployCommand } from './commands/deploy.js';
import { stackCommand } from './commands/stack.js';
import { sandboxCommand } from './commands/sandbox.js';
import { registerHermesCommands } from './commands/hermes.js';

// Re-export services
export { OpenCodeService } from './lib/opencode.js';
export { OpenClaudeService } from './lib/openclaude.js';
export { ClaudeCodeService } from './lib/claudecode.js';
export { resolveBuilderProjectDir, scaffoldNonOpencodeProject } from './lib/project-paths.js';
export { runBuilderOrganSetup, type RunBuilderOrganOptions, type RunBuilderOrganResult, type BuilderEngine } from './lib/builder-organ.js';
export {
  DokployService,
  type DokployStatus,
  type DokployProject
} from './lib/dokploy.js';

// Re-export Hermes
export { HermesDaemon } from './lib/hermes-daemon.js';
export { TaskPoller } from './lib/task-poll.js';
export { TaskExecutor } from './lib/task-executor.js';
export { TaskQueue } from './lib/task-queue.js';
export { registerHermesCommands } from './commands/hermes.js';

// Re-export commands
export { initCommand } from './commands/init.js';
export { deployCommand } from './commands/deploy.js';

// Builder class that orchestrates the creation suite
export class Builder {
  opencode: OpenCodeService;
  openclaude: OpenClaudeService;
  dokploy: DokployService;
  claudecode: ClaudeCodeService;

  constructor() {
    this.opencode = new OpenCodeService();
    this.openclaude = new OpenClaudeService();
    this.dokploy = new DokployService();
    this.claudecode = new ClaudeCodeService();
  }

  /**
   * Legacy programmatic init — same as `eve builder init` (Builder organ first).
   * @param withDokploy default false (Dokploy is optional / often overkill).
   */
  async init(name: string, template?: string, brainUrl?: string, withDokploy = false): Promise<void> {
    await runBuilderOrganSetup({
      name,
      cwd: process.cwd(),
      engines: new Set(['opencode', 'openclaude', 'claudecode']),
      template,
      brainUrl: brainUrl || 'http://localhost:11434',
      withDokploy,
    });
  }

  async generate(): Promise<void> {
    await this.opencode.generate();
  }

  async build(): Promise<void> {
    await this.opencode.build();
  }

  async generateCode(prompt: string): Promise<string> {
    return this.openclaude.generateCode(prompt);
  }

  async deploy(projectId?: string): Promise<void> {
    const id = projectId || this.dokploy.listProjects()[0]?.id;
    if (!id) {
      throw new Error('No project to deploy');
    }
    await this.dokploy.deploy(id);
  }

  async getStatus(): Promise<{
    opencode: string | null;
    openclaude: { configured: boolean; brainUrl: string | null };
    dokploy: DokployStatus;
  }> {
    return {
      opencode: this.opencode.getProjectPath(),
      openclaude: {
        configured: this.openclaude.isConfigured(),
        brainUrl: this.openclaude.getConfig()?.brainUrl || null,
      },
      dokploy: await this.dokploy.getStatus(),
    };
  }
}

/** Register Builder leaf commands on an existing `eve builder` Commander node */
export function registerBuilderCommands(builder: Command): void {
  initCommand(builder);
  deployCommand(builder);
  stackCommand(builder);
  sandboxCommand(builder);
  registerHermesCommands(builder);

  builder
    .command('generate')
    .description('Generate content with OpenCode')
    .action(async () => {
      const builder = new Builder();
      await builder.opencode.generate();
    });

  builder
    .command('code <prompt>')
    .description('Generate code with OpenClaude (Ollama). For Claude Code use the `claude` CLI in your project.')
    .option('--output <file>', 'Output file path')
    .option('--engine <e>', 'openclaude (default only — Ollama path)', 'openclaude')
    .action(async (prompt, options: { output?: string; engine?: string }) => {
      if (options.engine && options.engine !== 'openclaude') {
        console.error('Only --engine openclaude is supported here. Use: claude (Claude Code) in the project directory.');
        process.exit(1);
      }
      const builder = new Builder();
      await builder.openclaude.start();
      const code = await builder.openclaude.generateCode(prompt);
      
      if (options.output) {
        const { writeFileSync } = await import('fs');
        writeFileSync(options.output, code);
        console.log(`Code written to: ${options.output}`);
      } else {
        console.log('\n--- Generated Code ---\n');
        console.log(code);
        console.log('\n--- End of Code ---\n');
      }
    });

  builder
    .command('status')
    .description('Check builder status')
    .action(async () => {
      const builder = new Builder();
      const status = await builder.getStatus();
      
      console.log('Builder Status');
      console.log('==============');
      console.log('');
      console.log('OpenCode:');
      console.log(`  Project: ${status.opencode || 'Not initialized'}`);
      console.log('');
      console.log('OpenClaude:');
      console.log(`  Configured: ${status.openclaude.configured}`);
      console.log(`  Brain URL: ${status.openclaude.brainUrl || 'Not set'}`);
      console.log('');
      console.log('Dokploy:');
      console.log(`  Installed: ${status.dokploy.installed}`);
      console.log(`  Running: ${status.dokploy.running}`);
      console.log(`  Version: ${status.dokploy.version || 'Unknown'}`);
      console.log(`  Projects: ${status.dokploy.projects.length}`);
      
      if (status.dokploy.projects.length > 0) {
        console.log('  Project List:');
        for (const proj of status.dokploy.projects) {
          console.log(`    - ${proj.name} (${proj.status})`);
          if (proj.url) {
            console.log(`      URL: ${proj.url}`);
          }
        }
      }
    });
}

// Default export
export default Builder;
