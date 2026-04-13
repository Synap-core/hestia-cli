#!/usr/bin/env node
/**
 * deploy command - One-click deployment of complete Hestia infrastructure
 * Usage: hestia deploy [options]
 * 
 * This command deploys:
 * - Synap Backend (Brain)
 * - OpenClaw (Hands) 
 * - OpenCode or OpenClaude (Dev) - user choice
 * - Optional: Website template
 * 
 * With automatic:
 * - Domain configuration
 * - SSL certificates (Let's Encrypt)
 * - Service discovery
 * - State synchronization
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import { execa } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { logger, withSpinner } from '../lib/utils/index.js';
import { preFlightCheck } from '../lib/utils/preflight.js';
import { generateDockerCompose } from '../lib/services/docker-compose-generator.js';
import { generateEnvFile } from '../lib/services/env-generator.js';
import { configureDomain } from '../lib/services/domain-service.js';
import { stateManager } from '../lib/domains/services/lib/state-manager.js';

interface DeployOptions {
  domain?: string;
  provider: 'opencode' | 'openclaude' | 'both';
  website?: boolean;
  profile: 'minimal' | 'full' | 'ai-heavy';
  verbose?: boolean;
  dryRun?: boolean;
}

export function deployCommand(program: Command): void {
  program
    .command('deploy')
    .description('Deploy complete Hestia infrastructure (Brain + Hands + Dev)')
    .option('-d, --domain <domain>', 'Domain name (e.g., mysite.com)')
    .option('-p, --provider <provider>', 'AI provider (opencode|openclaude|both)', 'opencode')
    .option('-w, --website', 'Deploy starter website', false)
    .option('--profile <profile>', 'Deployment profile (minimal|full|ai-heavy)', 'full')
    .option('--dry-run', 'Generate configs without deploying', false)
    .option('-v, --verbose', 'Verbose output')
    .action(async (options: DeployOptions) => {
      try {
        // Set defaults
        if (!options.profile) options.profile = 'full';
        if (!options.provider) options.provider = 'opencode';

        // Pre-flight checks
        logger.header('🚀 HESTIA DEPLOYMENT');
        logger.info('One-click deployment of your digital infrastructure\n');

        const check = await preFlightCheck({
          docker: true,
          internet: true,
          writeAccess: true
        });

        if (!check.ok) {
          logger.error('❌ Pre-flight checks failed:');
          check.errors.forEach(e => logger.error(`   ${e}`));
          process.exit(1);
        }

        // Interactive wizard if options not provided
        const config = await runDeployWizard(options);

        // Show deployment plan
        logger.header('📋 DEPLOYMENT PLAN');
        logger.info(`Domain: ${chalk.cyan(config.domain)}`);
        logger.info(`AI Provider: ${chalk.cyan(config.provider)}`);
        logger.info(`Website: ${config.website ? chalk.green('Yes') : chalk.gray('No')}`);
        logger.info(`Profile: ${chalk.cyan(config.profile)}`);
        logger.newline();

        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: 'Proceed with deployment?',
          default: true
        }]);

        if (!confirm) {
          logger.info('Deployment cancelled.');
          return;
        }

        // Execute deployment phases
        const domain = config.domain || 'default';
        const deployDir = path.join(os.homedir(), '.hestia', 'deployments', domain);
        await fs.mkdir(deployDir, { recursive: true });

        // Phase 1: Generate configurations
        await phase1GenerateConfigs(config, deployDir);

        // Phase 2: Configure domain & SSL
        await phase2ConfigureDomain(config, deployDir);

        // Phase 3: Deploy services
        if (!config.dryRun) {
          await phase3DeployServices(config, deployDir);
          
          // Phase 4: Setup AI platform
          await phase4SetupAI(config, deployDir);
          
          // Phase 5: Deploy website (if requested)
          if (config.website) {
            await phase5DeployWebsite(config, deployDir);
          }
          
          // Phase 6: Finalize & sync state
          await phase6Finalize(config, deployDir);
        }

        // Show success
        logger.header('✅ DEPLOYMENT SUCCESSFUL');
        logger.info(`Your digital infrastructure is ready!\n`);
        logger.info(`🧠 Brain (Synap): ${chalk.cyan(`https://${config.domain}`)}`);
        
  if (config.provider === 'both') {
          logger.info(`💻 Dev (OpenCode): ${chalk.cyan(`https://dev.${config.domain}`)}`);
        }
        
        if (config.provider === 'openclaude' || config.provider === 'both') {
          logger.info(`🤖 Claude: ${chalk.cyan(`CLI - opencode --pod https://${config.domain}`)}`);
        }
        
        if (config.website) {
          logger.info(`🌐 Website: ${chalk.cyan(`https://www.${config.domain}`)}`);
        }
        
        logger.newline();
        logger.info(`🔧 Management: ${chalk.cyan(`hestia status`)}`);
        logger.info(`📊 Monitoring: ${chalk.cyan(`hestia health`)}`);
        
      } catch (error: any) {
        logger.error(`\n❌ Deployment failed: ${error.message}`);
        if (options.verbose) {
          console.error(error);
        }
        process.exit(1);
      }
    });
}

async function runDeployWizard(options: DeployOptions): Promise<DeployOptions> {
  const questions: any[] = [];

  if (!options.domain) {
    questions.push({
      type: 'input',
      name: 'domain',
      message: 'Domain name for your Hestia instance:',
      validate: (input: string) => {
        if (!input || !input.includes('.')) {
          return 'Please enter a valid domain (e.g., mysite.com)';
        }
        return true;
      }
    });
  }

  if (!options.provider) {
    questions.push({
      type: 'list',
      name: 'provider',
      message: 'Choose your AI development platform:',
      choices: [
        { name: 'OpenCode (Web IDE - Recommended for beginners)', value: 'opencode' },
        { name: 'OpenClaude (CLI - For automation)', value: 'openclaude' },
        { name: 'Both (OpenCode + OpenClaude)', value: 'both' }
      ],
      default: 'opencode'
    });
  }

  if (options.website === undefined) {
    questions.push({
      type: 'confirm',
      name: 'website',
      message: 'Deploy starter website template?',
      default: true
    });
  }

  if (!options.profile) {
    questions.push({
      type: 'list',
      name: 'profile',
      message: 'Deployment profile:',
      choices: [
        { name: 'Minimal (Synap only, no AI)', value: 'minimal' },
        { name: 'Full (Synap + AI + all services)', value: 'full' },
        { name: 'AI-Heavy (Optimized for AI workloads)', value: 'ai-heavy' }
      ],
      default: 'full'
    });
  }

  const answers = await inquirer.prompt(questions);

  // Ensure required values have defaults
  if (!answers.profile) answers.profile = 'full';
  if (!answers.provider) answers.provider = 'opencode';

  return { ...options, ...answers };
}

async function phase1GenerateConfigs(config: DeployOptions, deployDir: string): Promise<void> {
  await withSpinner('Generating Docker Compose configuration...', async () => {
    const dockerCompose = await generateDockerCompose({
      domain: config.domain!,
      profile: config.profile,
      provider: config.provider,
      website: config.website
    });
    
    await fs.writeFile(
      path.join(deployDir, 'docker-compose.yml'),
      dockerCompose,
      'utf-8'
    );
  });

  await withSpinner('Generating environment configuration...', async () => {
    const envContent = await generateEnvFile({
      domain: config.domain!,
      profile: config.profile,
      provider: config.provider
    });
    
    await fs.writeFile(
      path.join(deployDir, '.env'),
      envContent,
      'utf-8'
    );
  });
}

async function phase2ConfigureDomain(config: DeployOptions, deployDir: string): Promise<void> {
  await withSpinner(`Configuring domain ${config.domain}...`, async () => {
    await configureDomain({
      domain: config.domain!,
      provider: 'traefik', // or 'caddy' or 'coolify'
      deployDir
    });
  });
}

async function phase3DeployServices(config: DeployOptions, deployDir: string): Promise<void> {
  logger.header('🐳 DEPLOYING SERVICES');
  
  await withSpinner('Pulling latest images...', async () => {
    await execa('docker', ['compose', 'pull'], {
      cwd: deployDir,
      timeout: 300000
    });
  });

  await withSpinner('Starting core services...', async () => {
    await execa('docker', ['compose', 'up', '-d', '--remove-orphans'], {
      cwd: deployDir,
      timeout: 300000
    });
  });

  await withSpinner('Waiting for services to be healthy...', async () => {
    // Wait for backend health
    await waitForService(`https://${config.domain}/health`, 300000);
  });
}

async function phase4SetupAI(config: DeployOptions, deployDir: string): Promise<void> {
  if (!config.provider || config.provider === 'opencode') return;
  
  logger.header('🤖 CONFIGURING AI PLATFORM');
  
  if (config.provider === 'both') {
    await withSpinner('Setting up OpenCode...', async () => {
      // Configure OpenCode service
      await execa('docker', ['compose', '--profile', 'opencode', 'up', '-d'], {
        cwd: deployDir
      });
      
      // Sync with Synap
      await stateManager.syncToLocal({
        config: {
          hearth: { name: config.domain!, role: 'primary' },
          intelligence: {
            provider: 'openai',
            model: 'gpt-4',
            endpoint: `https://${config.domain}/api/hub`
          }
        }
      });
    });
  }

  if (config.provider === 'openclaude' || config.provider === 'both') {
    await withSpinner('Setting up OpenClaude...', async () => {
      // Configure OpenClaude CLI profile
      await stateManager.syncToLocal({
        config: {
          aiPlatform: 'openclaude',
          hearth: { name: config.domain!, role: 'primary' }
        }
      });
    });
  }
}

async function phase5DeployWebsite(config: DeployOptions, deployDir: string): Promise<void> {
  logger.header('🌐 DEPLOYING WEBSITE');
  
  await withSpinner('Cloning starter template...', async () => {
    await execa('git', ['clone', 
      'https://github.com/synap-core/synap-starter-website.git',
      path.join(deployDir, 'website')
    ]);
  });

  await withSpinner('Configuring website...', async () => {
    const envFile = `NEXT_PUBLIC_SYNAP_URL=https://${config.domain}
NEXT_PUBLIC_SYNAP_API_KEY=${await getOrCreateApiKey(deployDir)}
NEXT_PUBLIC_TYPESENSE_URL=https://${config.domain}:8108
`;
    await fs.writeFile(
      path.join(deployDir, 'website', '.env.local'),
      envFile
    );
  });

  await withSpinner('Building website...', async () => {
    await execa('docker', ['compose', '--profile', 'website', 'up', '-d'], {
      cwd: deployDir
    });
  });
}

async function phase6Finalize(config: DeployOptions, deployDir: string): Promise<void> {
  await withSpinner('Finalizing configuration...', async () => {
    // Save deployment metadata
    const metadata = {
      domain: config.domain,
      provider: config.provider,
      profile: config.profile,
      website: config.website,
      deployedAt: new Date().toISOString(),
      deployDir
    };
    
    await fs.writeFile(
      path.join(deployDir, 'deployment.json'),
      JSON.stringify(metadata, null, 2)
    );
    
    // Final state sync
    await stateManager.syncAll();
  });
}

// Helper functions
async function waitForService(url: string, timeout: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function getOrCreateApiKey(deployDir: string): Promise<string> {
  // TODO: Get from Synap backend or generate
  return 'placeholder-api-key';
}
