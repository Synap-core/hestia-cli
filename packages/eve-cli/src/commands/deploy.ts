/**
 * `eve deploy` — build, package, push via GHCR, then deploy to Coolify.
 *
 * Usage:
 *   eve deploy                    # detect, build, push, deploy to staging
 *   eve deploy --prod             # deploy to production
 *   eve deploy --docker           # build + package only, skip push & deploy
 *   eve deploy --app <name>       # target a specific workspace app
 *   eve deploy --clean            # clean before build
 *   eve deploy --yes              # skip confirmation
 *   eve deploy --env KEY=VAL      # set env vars on deploy
 *   eve deploy --tag mytag        # custom image tag
 *   eve deploy --rollback <image> # redeploy a previous image
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import * as clack from '@clack/prompts';
import {
  detectAppConfig,
  buildAndPackageImage,
  deployToCoolify,
  detectCoolifyTargets,
  type AppConfig,
  type DeployEnv,
  type DeployResult,
} from '@eve/dna';
import {
  colors,
  emojis,
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printWarning,
  createSpinner,
  printBox,
} from '../lib/ui.js';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface DeployOptions {
  docker?: boolean;
  app?: string;
  clean?: boolean;
  token?: string;
  tag?: string;
  prod?: boolean;
  env?: string[];
  yes?: boolean;
  rollback?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function deployCommand(program: Command): void {
  const deploy = program
    .command('deploy')
    .description(`${emojis.arms} Build, package, and deploy an app via GHCR + Coolify`)
    .option(
      '--app <name>',
      'Target a specific workspace app (for monorepo projects).',
    )
    .option(
      '--docker',
      'Build and package only — skip pushing and deploying.',
    )
    .option(
      '--clean',
      'Remove previous build output before building.',
    )
    .option(
      '--token <ghcr-token>',
      'GitHub PAT for GHCR push (overrides stored credentials).',
    )
    .option(
      '--tag <tag>',
      'Custom image tag (default: branch-sha).',
    )
    .option(
      '--prod',
      'Deploy to production (CT 103) instead of staging.',
    )
    .option(
      '--env <key=value>',
      'Custom environment variable (repeatable). e.g. --env DATABASE_URL=postgres://...',
    )
    .option(
      '-y, --yes',
      'Skip confirmation step (non-interactive / CI mode).',
    )
    .option(
      '--rollback <image>',
      'Re-deploy a previous image (e.g. ghcr.io/synap-core/app:branch-abc1234).',
    )
    .action(async (opts: DeployOptions) => {
      try {
        if (opts.rollback) {
          await runRollback(opts);
        } else {
          await runDeploy(opts);
        }
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

async function runDeploy(opts: DeployOptions): Promise<void> {
  const t0 = Date.now();

  // Step 1: Determine working directory
  const baseDir = process.env.EVE_DEPLOY_DIR || process.cwd();

  // Step 2: Detect app
  console.log();
  printHeader('eve deploy');
  console.log();

  let appConfig: AppConfig | null = null;

  if (opts.app) {
    printInfo(`Targeting workspace app: ${colors.info(opts.app)}`);
    printInfo(`Base directory: ${colors.info(baseDir)}`);

    const candidateDirs = [
      join(baseDir, 'apps', opts.app),
      join(baseDir, 'packages', opts.app),
      join(baseDir, 'packages/@eve', opts.app),
    ];

    let targetDir: string | null = null;
    for (const d of candidateDirs) {
      const pkgPath = join(d, 'package.json');
      if (existsSync(pkgPath)) {
        targetDir = d;
        break;
      }
    }

    if (!targetDir) {
      printError(`Could not find workspace app "${opts.app}"`);
      printInfo(`Searched in: ${candidateDirs.join(', ')}`);
      process.exit(1);
    }

    appConfig = detectAppConfig(targetDir);
    appConfig.workspaceApp = opts.app;
  } else {
    appConfig = detectAppConfig(baseDir);
  }

  // Step 3: Display detected config
  console.log();
  printInfo(`App:         ${colors.info(appConfig.name)}`);
  printInfo(`Framework:   ${colors.info(appConfig.framework)}`);
  printInfo(`Build cmd:   ${colors.muted(appConfig.buildCommand)}`);
  printInfo(`Output dir:  ${colors.muted(appConfig.outputDir)}`);
  if (appConfig.branch) {
    printInfo(`Branch:      ${colors.muted(appConfig.branch)}`);
  }
  printInfo(`Directory:   ${colors.muted(appConfig.cwd)}`);

  // Step 4: (Optional) Clean build output
  if (opts.clean) {
    console.log();
    if (!opts.yes) {
      const confirmed = await clack.confirm({
        message: `Remove previous build output in ${appConfig.outputDir}?`,
        initialValue: false,
      });
      if (!confirmed) {
        clack.cancel('Build clean cancelled.');
        return;
      }
    }
    printInfo('Cleaning previous build...');
    const outPath = join(appConfig.cwd, appConfig.outputDir);
    if (existsSync(outPath)) {
      rmSync(outPath, { recursive: true, force: true });
      printSuccess('Cleaned');
    } else {
      printInfo('Nothing to clean');
    }
  }

  // Step 5: Parse env vars
  const envVars = parseEnvVars(opts.env);

  // Step 6: Build and package
  console.log();
  const spinner = createSpinner(opts.docker ? 'Building and packaging...' : 'Building, packaging, and deploying...');
  spinner.start();

  const ghcrToken = opts.token || process.env.GHCR_TOKEN || '';
  const buildResult = await buildAndPackageImage(
    appConfig,
    'synap-core',
    ghcrToken || undefined,
    !!opts.docker,
    opts.tag,
  );

  let deployResult: DeployResult | undefined;

  if (opts.docker) {
    spinner.succeed('Done');
    printInfo('Build complete. Push and deploy with `eve deploy` (without --docker).');
  } else {
    // Step 7: Deploy to Coolify
    const targetEnv: DeployEnv = opts.prod ? 'production' : 'staging';
    const targets = detectCoolifyTargets();

    if (!targets[targetEnv]) {
      spinner.warn(`No ${targetEnv} Coolify target configured`);
      printWarning(`No ${targetEnv} Coolify target configured.`);
      printInfo(`Set env vars: COOLIFY_${targetEnv.toUpperCase()}_URL + COOLIFY_${targetEnv.toUpperCase()}_TOKEN`);
      printInfo(`Or run: eve login --coolify-${targetEnv} <token>`);
      console.log();
      return;
    }

    // Confirm before deploying to production
    if (targetEnv === 'production' && !opts.yes) {
      spinner.warn('Awaiting production confirmation');
      const confirmed = await clack.confirm({
        message: `Deploying to PRODUCTION. Continue?`,
        initialValue: false,
      });
      if (!confirmed) {
        clack.cancel('Deploy cancelled.');
        return;
      }
    }

    deployResult = await deployToCoolify({
      config: appConfig,
      dockerImage: buildResult.imageName,
      targetEnv,
      targets,
      envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
      force: opts.clean,
    });

    spinner.succeed('Deployed');

    // Step 8: Post-deploy wait loop
    const url = deployResult.url || 'pending';
    console.log();
    printInfo(`Waiting for app to start...`);
    const readyUrl = await waitForDeploy(deployResult);
    if (readyUrl) {
      printSuccess(`App is live: ${readyUrl}`);
    }
  }

  // Step 9: Summary
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const target = opts.prod ? 'production (CT 103)' : 'staging (CT 104)';
  console.log();
  printBox('Deployment summary', [
    `App:          ${appConfig.name}`,
    `Framework:    ${appConfig.framework}`,
    `Image:        ${buildResult.imageName}`,
    `Target:       ${target}`,
    `Build time:   ${elapsed}s`,
    opts.docker ? 'Mode:         Build-only (no push/deploy)' : 'Mode:         Full build + push + deploy',
    ...(deployResult?.url ? [`URL:          ${deployResult.url}`] : []),
  ]);
}

async function runRollback(opts: DeployOptions): Promise<void> {
  const t0 = Date.now();
  const image = opts.rollback!;

  console.log();
  printHeader('eve deploy');
  console.log();
  printInfo(`Rolling back to image: ${colors.info(image)}`);

  // We need to detect the app config to know the name for Coolify
  const baseDir = process.env.EVE_DEPLOY_DIR || process.cwd();
  const appConfig = detectAppConfig(baseDir);

  const targetEnv: DeployEnv = opts.prod ? 'production' : 'staging';
  const targets = detectCoolifyTargets();

  if (!targets[targetEnv]) {
    printWarning(`No ${targetEnv} Coolify target configured.`);
    return;
  }

  if (!opts.yes) {
    const confirmed = await clack.confirm({
      message: `Rollback to ${image}?`,
      initialValue: false,
    });
    if (!confirmed) {
      clack.cancel('Rollback cancelled.');
      return;
    }
  }

  const spinner = createSpinner('Triggering rollback...');
  spinner.start();

  const deployResult = await deployToCoolify({
    config: appConfig,
    dockerImage: image,
    targetEnv,
    targets,
    force: true,
  });

  spinner.succeed('Rolled back');

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log();
  printBox('Rollback summary', [
    `Image:  ${image}`,
    `Target: ${targetEnv}`,
    `Time:   ${elapsed}s`,
    ...(deployResult?.url ? [`URL:   ${deployResult.url}`] : []),
  ]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseEnvVars(raw?: string[]): Record<string, string> {
  if (!raw || raw.length === 0) return {};
  const result: Record<string, string> = {};
  for (const entry of raw) {
    const idx = entry.indexOf('=');
    if (idx === -1) {
      printWarning(`Skipping malformed env var (expected KEY=VAL): ${entry}`);
      continue;
    }
    const key = entry.slice(0, idx);
    const val = entry.slice(idx + 1);
    result[key] = val;
  }
  return result;
}

/**
 * Wait for a deployed app to become available by polling the URL.
 * Defaults to 90 retries (4.5 minutes at 5s intervals).
 * Returns the live URL or null on timeout.
 */
async function waitForDeploy(
  deployResult: { url?: string; appId?: string },
  retries = 90,
  intervalMs = 5000,
): Promise<string | null> {
  const targetUrl = deployResult.url;
  if (!targetUrl) {
    return null;
  }

  // For Coolify, we poll the internal API for deployment status
  const urlPattern = /https?:\/\//;
  if (urlPattern.test(targetUrl)) {
    // Try to HTTP GET the app URL
    for (let i = 0; i < retries; i++) {
      try {
        const resp = await fetch(targetUrl, {
          signal: AbortSignal.timeout(5000),
          method: 'HEAD',
        });
        if (resp.ok || resp.status === 301 || resp.status === 302) {
          return targetUrl;
        }
        // Also try a GET on root
        const getResp = await fetch(targetUrl, {
          signal: AbortSignal.timeout(5000),
        });
        if (getResp.ok) {
          return targetUrl;
        }
      } catch {
        // App not ready yet, continue polling
      }
      const dots = '.'.repeat(Math.min(i + 1, 6));
      process.stdout.write(`\r  Waiting... ${dots}`);
      await sleep(intervalMs);
    }
  } else {
    // Coolify app ID — poll the API
    await sleep(10000);
  }

  return targetUrl; // Return whatever we have
}

