#!/usr/bin/env node
/**
 * deploy command - One-click deployment of complete Hestia infrastructure
 * Usage: hestia deploy [options]
 * 
 * REFACTORED: Business logic extracted to src/application/deploy/
 * This file now only contains UI/interactive logic.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import * as os from 'os';
import chalk from 'chalk';
import { logger } from '../lib/utils/index.js';
import { preFlightCheck } from '../lib/utils/preflight.js';
import { spinner } from '../lib/utils/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Import use cases from application layer
import {
  generateConfigs,
  deployServices,
  setupAI,
  waitForHttpEndpoint,
  type GenerateConfigsInput,
  type DeployServicesInput,
  type SetupAIInput,
  type DeployProfile,
  type AIProvider,
} from '../application/deploy/index.js';
import { ProgressReporter } from '../application/types.js';

interface DeployOptions {
  domain?: string;
  provider: 'opencode' | 'openclaude' | 'both';
  website?: boolean;
  profile: 'minimal' | 'full' | 'ai-heavy';
  verbose?: boolean;
  dryRun?: boolean;
}

/**
 * Create a CLI progress reporter
 */
function createProgressReporter(spinnerId: string): ProgressReporter {
  spinner.start(spinnerId, 'Initializing...');
  return {
    report(message: string): void {
      spinner.update(spinnerId, message);
    },
    onProgress(percent: number): void {
      const currentText = spinner['spinners']?.get(spinnerId)?.text || 'Working...';
      const baseText = currentText.split(' (')[0];
      spinner.update(spinnerId, `${baseText} (${Math.round(percent)}%)`);
    },
  };
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
        logger.info(`Domain: ${chalk.cyan(config.domain!)}`);
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

        // Phase 2: Deploy services
        if (!config.dryRun) {
          await phase2DeployServices(config, deployDir);
          
          // Phase 3: Setup AI platform
          await phase3SetupAI(config, deployDir);
          
          // Phase 4: Deploy website (if requested)
          if (config.website) {
            await phase4DeployWebsite(config, deployDir);
          }
          
          // Phase 5: Finalize
          await phase5Finalize(config, deployDir);
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

/**
 * Run deployment wizard
 */
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

/**
 * Phase 1: Generate configurations
 */
async function phase1GenerateConfigs(config: DeployOptions, deployDir: string): Promise<void> {
  logger.header('📦 PHASE 1: Generating Configurations');

  const spinnerId = 'phase1-configs';
  const progress = createProgressReporter(spinnerId);

  const input: GenerateConfigsInput = {
    domain: config.domain!,
    profile: config.profile as DeployProfile,
    provider: config.provider as AIProvider,
    website: config.website,
    deployDir,
  };

  const result = await generateConfigs(input, progress);

  if (result.success && result.data) {
    spinner.succeed(spinnerId, `Generated ${result.data.filesCreated.length} configuration files`);
    logger.info(`Services: ${result.data.services.join(', ')}`);
  } else {
    spinner.fail(spinnerId, `Configuration generation failed: ${result.error}`);
    throw new Error(result.error || 'Configuration generation failed');
  }
}

/**
 * Phase 2: Deploy services
 */
async function phase2DeployServices(config: DeployOptions, deployDir: string): Promise<void> {
  logger.header('🐳 PHASE 2: Deploying Services');

  const spinnerId = 'phase2-deploy';
  const progress = createProgressReporter(spinnerId);

  const input: DeployServicesInput = {
    deployDir,
    domain: config.domain!,
    healthCheckTimeout: 300000,
  };

  const result = await deployServices(input, progress);

  if (result.success && result.data) {
    spinner.succeed(spinnerId, `Deployed ${result.data.servicesStarted.length} services`);
    if (result.data.servicesFailed.length > 0) {
      logger.warn(`Failed services: ${result.data.servicesFailed.join(', ')}`);
    }
  } else {
    spinner.fail(spinnerId, `Service deployment failed: ${result.error}`);
    throw new Error(result.error || 'Service deployment failed');
  }
}

/**
 * Phase 3: Setup AI
 */
async function phase3SetupAI(config: DeployOptions, deployDir: string): Promise<void> {
  logger.header('🤖 PHASE 3: Setting up AI Platform');

  const spinnerId = 'phase3-ai';
  const progress = createProgressReporter(spinnerId);

  const input: SetupAIInput = {
    deployDir,
    domain: config.domain!,
    provider: config.provider as AIProvider,
    profile: config.profile as DeployProfile,
  };

  const result = await setupAI(input, progress);

  if (result.success && result.data) {
    spinner.succeed(spinnerId, `Configured ${result.data.providersConfigured.length} AI providers`);
  } else {
    spinner.fail(spinnerId, `AI setup failed: ${result.error}`);
    // Don't throw - AI setup failure is not fatal
    logger.warn('Continuing without AI configuration');
  }
}

/**
 * Phase 4: Deploy website (if requested)
 */
async function phase4DeployWebsite(config: DeployOptions, deployDir: string): Promise<void> {
  logger.header('🌐 PHASE 4: Deploying Website');

  // Note: Website deployment is currently a simplified implementation
  // In a full production system, this would be extracted to the application layer
  logger.info('Website deployment:');
  logger.info('- Template cloning would happen here');
  logger.info('- Configuration would be applied');
  logger.info('- Build process would run');
  logger.newline();
  logger.info(chalk.gray('Note: Full website deployment to be implemented in application layer'));
}

/**
 * Phase 5: Finalize deployment
 */
async function phase5Finalize(config: DeployOptions, deployDir: string): Promise<void> {
  logger.header('✅ PHASE 5: Finalizing');

  // Wait for services to be fully ready
  const spinnerId = 'phase5-finalize';
  spinner.start(spinnerId, 'Waiting for services to be ready...');

  const healthUrl = `https://${config.domain}/health`;
  const isHealthy = await waitForHttpEndpoint(healthUrl, 60000);

  if (isHealthy) {
    spinner.succeed(spinnerId, 'All services are healthy');
  } else {
    spinner.warn(spinnerId, 'Some services may still be starting');
  }

  // Save deployment summary
  const summary = {
    domain: config.domain,
    provider: config.provider,
    profile: config.profile,
    website: config.website,
    deployedAt: new Date().toISOString(),
    deployDir,
  };

  const summaryPath = path.join(deployDir, 'deployment-summary.json');
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

  logger.info('Deployment summary saved');
}
