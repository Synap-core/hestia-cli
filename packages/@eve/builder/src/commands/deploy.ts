import { Command } from 'commander';
import { DokployService } from '../lib/dokploy.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export function deployCommand(program: Command): void {
  program
    .command('deploy [project]')
    .description('Deploy project via Dokploy')
    .option('--domain <domain>', 'Custom domain for deployment')
    .option('--env <vars...>', 'Environment variables (KEY=value)')
    .action(async (projectName, options) => {
      console.log('🚀 Deploying with Dokploy');
      console.log('');

      const dokploy = new DokployService();

      try {
        // Ensure Dokploy is installed
        await dokploy.install();

        // Load builder state to find project
        const statePath = join(process.cwd(), '.hestia', 'builder-state.json');
        let projectId: string | null = null;

        if (existsSync(statePath)) {
          const state = JSON.parse(readFileSync(statePath, 'utf-8'));
          
          // Find project by name or use the current project
          if (projectName) {
            // Look for project with matching name
            const status = await dokploy.getStatus();
            const found = status.projects.find(p => p.name === projectName);
            if (found) {
              projectId = found.id;
            }
          } else if (state.components?.dokploy?.projectName) {
            // Use current project's dokploy project
            const status = await dokploy.getStatus();
            const found = status.projects.find(
              p => p.name === state.components.dokploy.projectName
            );
            if (found) {
              projectId = found.id;
            }
          }
        }

        if (!projectId) {
          if (projectName) {
            console.log(`Creating new Dokploy project: ${projectName}`);
            await dokploy.createProject(projectName);
            const status = await dokploy.getStatus();
            const newProject = status.projects.find(p => p.name === projectName);
            if (newProject) {
              projectId = newProject.id;
            }
          } else {
            throw new Error(
              'No project specified. Run "eve builder init <name>" first or provide a project name.'
            );
          }
        }

        if (!projectId) {
          throw new Error('Could not determine project to deploy');
        }

        // Configure domain if provided
        if (options.domain) {
          console.log(`Configuring custom domain: ${options.domain}`);
          await dokploy.configureDomain(options.domain);
        }

        // Handle environment variables
        if (options.env && options.env.length > 0) {
          console.log('Setting environment variables:');
          for (const envVar of options.env) {
            const [key, value] = envVar.split('=');
            if (key && value) {
              console.log(`  ${key}=${'*'.repeat(value.length)}`);
            }
          }
        }

        console.log('');
        console.log('Starting deployment...');
        console.log('-------------------------------------------');

        // Deploy
        await dokploy.deploy(projectId);

        // Get final status
        const status = await dokploy.getStatus();
        const project = status.projects.find(p => p.id === projectId);

        console.log('-------------------------------------------');
        console.log('✅ Deployment successful!');
        console.log('');
        
        if (project?.url) {
          console.log(`🌐 Project URL: ${project.url}`);
        }
        
        if (options.domain) {
          console.log(`🔗 Custom Domain: https://${options.domain}`);
        }
        
        console.log('');
        console.log('Deployment status:', project?.status);

      } catch (error) {
        console.error('❌ Deployment failed:', error);
        process.exit(1);
      }
    });
}
