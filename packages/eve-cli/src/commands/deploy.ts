/**
 * `eve deploy` — build, package, and push an app via GHCR.
 *
 * Usage:
 *   eve deploy                    # detect current app, build, package, push
 *   eve deploy --docker           # build + package only, skip push
 *   eve deploy --app <name>       # target a specific workspace app
 *   eve deploy --clean            # clean before build
 */

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  detectAppConfig,
  buildAndPackageImage,
  deployToCoolify,
  detectCoolifyTargets,
  type AppConfig,
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
}

export function deployCommand(program: Command): void {
  const deploy = program
    .command('deploy')
    .description(`${emojis.arms} Build, package, and push an app from the current directory`)
    .option(
      '--app <name>',
      'Target a specific workspace app (for monorepo projects).',
    )
    .option(
      '--docker',
      'Build and package only — skip pushing to GHCR.',
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
    .action(async (opts: DeployOptions) => {
      try {
        await runDeploy(opts);
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
    // Target a specific workspace app
    printInfo(`Targeting workspace app: ${colors.info(opts.app)}`);
    printInfo(`Base directory: ${colors.info(baseDir)}`);

    // Look for the app in common monorepo patterns
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
    // Auto-detect from current directory
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
    printInfo('Cleaning previous build...');
    const outPath = join(appConfig.cwd, appConfig.outputDir);
    if (existsSync(outPath)) {
      rmSync(outPath, { recursive: true, force: true });
      printSuccess('Cleaned');
    } else {
      printInfo('Nothing to clean');
    }
  }

  // Step 5: Build and package
  console.log();
  const spinner = createSpinner('Building and packaging...');
  spinner.start();

  const ghcrToken = opts.token || process.env.GHCR_TOKEN || '';
  const buildResult = await buildAndPackageImage(
    appConfig,
    'synap-core',
    ghcrToken || undefined,
    !!opts.docker,
  );

  spinner.succeed('Done');

  // Step 6: Summary
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const target = opts.prod ? 'production (CT 103)' : 'staging (CT 104)';
  console.log();
  printBox('Deployment summary', [
    `App:          ${appConfig.name}`,
    `Framework:    ${appConfig.framework}`,
    `Image:        ${buildResult.imageName}`,
    `Target:       ${target}`,
    `Build time:   ${elapsed}s`,
    opts.docker ? 'Mode:         Build-only (no GHCR push)' : 'Mode:         Full build + push',
  ]);
  if (opts.docker) {
    printInfo('Build complete. Push and deploy with `eve deploy` (without --docker).');
  }
}
