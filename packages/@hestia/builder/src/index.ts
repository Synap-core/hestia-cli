import { Command } from 'commander';
import { OpenCodeService } from './lib/opencode.js';
import { OpenClaudeService } from './lib/openclaude.js';
import { DokployService, type DokployStatus, type DokployProject } from './lib/dokploy.js';
import { initCommand } from './commands/init.js';
import { deployCommand } from './commands/deploy.js';

// Re-export services
export { OpenCodeService } from './lib/opencode.js';
export { OpenClaudeService } from './lib/openclaude.js';
export { 
  DokployService, 
  type DokployStatus, 
  type DokployProject 
} from './lib/dokploy.js';

// Re-export commands
export { initCommand } from './commands/init.js';
export { deployCommand } from './commands/deploy.js';

// Builder class that orchestrates the creation suite
export class Builder {
  opencode: OpenCodeService;
  openclaude: OpenClaudeService;
  dokploy: DokployService;

  constructor() {
    this.opencode = new OpenCodeService();
    this.openclaude = new OpenClaudeService();
    this.dokploy = new DokployService();
  }

  async init(name: string, template?: string, brainUrl?: string): Promise<void> {
    // Install all components
    await this.opencode.install();
    await this.openclaude.install();
    await this.dokploy.install();

    // Initialize project
    await this.opencode.initProject(name, template);
    await this.openclaude.configure(brainUrl || 'http://localhost:11434');
    await this.openclaude.start();
    await this.dokploy.createProject(name);
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

// Register all builder commands
export function registerBuilderCommands(program: Command): void {
  initCommand(program);
  deployCommand(program);

  // Add generate command
  program
    .command('builder generate')
    .description('Generate content with OpenCode')
    .action(async () => {
      const builder = new Builder();
      await builder.opencode.generate();
    });

  // Add code command
  program
    .command('builder code <prompt>')
    .description('Generate code with OpenClaude')
    .option('--output <file>', 'Output file path')
    .action(async (prompt, options) => {
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

  // Add status command
  program
    .command('builder status')
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
