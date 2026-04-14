import { Command } from 'commander';
import { readSetupProfile } from '@eve/dna';
import { OpenCodeService } from '../lib/opencode.js';
import { OpenClaudeService } from '../lib/openclaude.js';
import { DokployService } from '../lib/dokploy.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export function initCommand(program: Command): void {
  program
    .command('init <name>')
    .description('Initialize builder project')
    .option('--template <template>', 'Project template (website, docs, app)')
    .option('--brain-url <url>', 'Brain Ollama URL', 'http://localhost:11434')
    .action(async (name, options) => {
      console.log(`Initializing Builder project: ${name}`);
      console.log('');

      const opencode = new OpenCodeService();
      const openclaude = new OpenClaudeService();
      const dokploy = new DokployService();

      try {
        // 1. Install OpenCode, OpenClaude, Dokploy
        console.log('📦 Step 1: Installing Builder components...');
        console.log('-------------------------------------------');
        
        await opencode.install();
        await openclaude.install();
        await dokploy.install();
        
        console.log('✅ All components installed');
        console.log('');

        const sp = await readSetupProfile(process.cwd());
        if (sp?.profile === 'data_pod') {
          console.log(
            'Note: .eve/setup-profile.json is data_pod — set OpenClaude --brain-url to your Ollama gateway (e.g. http://127.0.0.1:11435) if you use local inference.\n',
          );
        }

        // 2. Initialize project
        console.log('🏗️  Step 2: Initializing project...');
        console.log('-------------------------------------------');
        
        await opencode.initProject(name, options.template);
        await openclaude.configure(options.brainUrl);
        await openclaude.start();
        await dokploy.createProject(name);
        
        console.log('✅ Project initialized');
        console.log('');

        // 3. Update entity state (eve DNA integration)
        console.log('🧬 Step 3: Updating entity state...');
        console.log('-------------------------------------------');
        
        const eveDir = join(process.cwd(), '.eve');
        if (!existsSync(eveDir)) {
          mkdirSync(eveDir, { recursive: true });
        }

        const entityState = {
          type: 'builder_project',
          name,
          template: options.template || 'default',
          brainUrl: options.brainUrl,
          components: {
            opencode: {
              installed: true,
              projectPath: opencode.getProjectPath(),
            },
            openclaude: {
              installed: true,
              configured: openclaude.isConfigured(),
            },
            dokploy: {
              installed: true,
              projectName: name,
            },
          },
          createdAt: new Date().toISOString(),
          status: 'initialized',
        };

        writeFileSync(
          join(eveDir, 'builder-state.json'),
          JSON.stringify(entityState, null, 2)
        );

        console.log('✅ Entity state updated');
        console.log('');

        // Success output
        console.log('🎉 Builder project initialized successfully!');
        console.log('');
        console.log('Next steps:');
        console.log(`  cd ${name}`);
        console.log('  eve builder generate    # Generate content with OpenCode');
        console.log('  eve builder code "<prompt>"  # Generate code with OpenClaude');
        console.log('  eve builder deploy      # Deploy with Dokploy');
        console.log('');

      } catch (error) {
        console.error('❌ Initialization failed:', error);
        process.exit(1);
      }
    });
}
