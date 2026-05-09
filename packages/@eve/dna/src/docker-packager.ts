import {
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  readdirSync,
  readFileSync,
  copyFileSync,
  statSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import type { AppConfig } from './deploy-types.js';

// ---------------------------------------------------------------------------
// Copy helpers
// ---------------------------------------------------------------------------

function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Dockerfile templates
// ---------------------------------------------------------------------------

function generateNextJsStandaloneDockerfile(): string {
  return `FROM node:20-alpine AS runner
WORKDIR /app

# Copy Next.js standalone output
COPY .next/standalone/ ./
COPY .next/static/ ./_next/static/
COPY public/ ./public/

# Run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
`;
}

function generateNextJsDockerfile(): string {
  return `FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .

RUN corepack enable && pnpm build

FROM node:20-alpine AS runner
WORKDIR /app

COPY --from=builder /app/.next/standalone/ ./
COPY --from=builder /app/.next/static/ ./_next/static/
COPY --from=builder /app/public/ ./public/

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
`;
}

function generateStaticDockerfile(): string {
  return `FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .

RUN corepack enable && pnpm build

FROM caddy:2-alpine
COPY --from=builder /app/dist /site
COPY --from=builder /app/public /public
COPY Caddyfile /etc/caddy/Caddyfile 2>/dev/null || echo "" > /etc/caddy/Caddyfile
Caddyfile <<EOF
* {
    root * /site
    file_server
    try_files {path} /index.html
}
EOF
`;
}

function generateNodeDockerfile(): string {
  return `FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .

RUN corepack enable && pnpm build

FROM node:20-alpine AS runner
WORKDIR /app

COPY --from=builder /app/dist/ ./
COPY --from=builder /app/package.json ./

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
`;
}

function generateGenericDockerfile(): string {
  return `FROM node:20-alpine
WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .

RUN corepack enable && pnpm build

EXPOSE 3000
CMD ["node", "server.js"]
`;
}

function generateDockerfile(config: AppConfig): string {
  switch (config.framework) {
    case 'nextjs':
      return config.standalone
        ? generateNextJsStandaloneDockerfile()
        : generateNextJsDockerfile();
    case 'static':
      return generateStaticDockerfile();
    case 'node':
      return generateNodeDockerfile();
    default:
      return generateGenericDockerfile();
  }
}

// ---------------------------------------------------------------------------
// Package function
// ---------------------------------------------------------------------------

interface DockerImage {
  full: string;
  tag: string;
}

export interface BuildResult {
  imageName: string;
  tag: string;
  sha: string;
  buildTime: number;
}

/**
 * Build the app, package it into a Docker image, and push to GHCR.
 */
export async function buildAndPackageImage(
  config: AppConfig,
  org: string = 'synap-core',
  ghcrToken?: string,
  buildOnly = false,
  customTag?: string,
): Promise<BuildResult> {
  const startTime = Date.now();
  const step = (msg: string) => console.log(`    ${msg}`);

  // ------------------------------------------------------------------
  // Step 1: Build the app
  // ------------------------------------------------------------------
  console.log('\n▸ Building app...');
  step(`Running: ${config.buildCommand}`);

  // Parse the build command to get tool + script
  const buildParts = config.buildCommand.match(/(\S+)\s+(.+)/s);
  if (!buildParts) {
    console.error(`\n✖ Could not parse build command: ${config.buildCommand}`);
    process.exit(1);
  }

  const tool = buildParts[1];
  const script = buildParts[2];

  let cmd: string;
  if (tool === 'pnpm') cmd = `pnpm ${script}`;
  else if (tool === 'npm' || tool === 'yarn') cmd = `${tool} ${script}`;
  else cmd = config.buildCommand; // execute as-is

  try {
    execSync(cmd, {
      cwd: config.cwd,
      stdio: 'inherit',
      timeout: 300_000, // 5 min
    });
  } catch (err) {
    console.error(
      `\n✖ Build failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.log('\nTip: Try running the build command manually:');
    console.log(`  cd ${config.cwd} && ${config.buildCommand}`);
    process.exit(1);
  }

  // ------------------------------------------------------------------
  // Step 2: Detect build output
  // ------------------------------------------------------------------
  console.log('\n▸ Locating build output...');
  const outputPath = join(config.cwd, config.outputDir);
  const standalonePath = join(outputPath, 'standalone');
  const hasOutput = existsSync(outputPath);
  const hasStandalone = existsSync(standalonePath);

  if (!hasOutput) {
    console.error(`\n✖ Build output not found at ${outputPath}`);
    console.log('\nExpected output directory based on framework:');
    console.log(`  ${config.framework}: ${config.outputDir}`);
    process.exit(1);
  }

  step(`Build output found at: ${config.outputDir}`);

  // ------------------------------------------------------------------
  // Step 3: Prepare Docker build context
  // ------------------------------------------------------------------
  console.log('\n▸ Preparing Docker context...');

  const tmpDir = join(config.cwd, '.eve-deploy-temp');
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  // Copy build output to context
  if (config.framework === 'nextjs' && hasStandalone) {
    step('Using Next.js standalone output');
    copyDir(standalonePath, tmpDir);
  } else {
    step(`Copying ${config.outputDir} to Docker context`);
    copyDir(outputPath, tmpDir);
  }

  // Copy public directory if it exists
  const publicDir = join(config.cwd, 'public');
  if (existsSync(publicDir)) {
    copyDir(publicDir, join(tmpDir, 'public'));
  }

  // Write Dockerfile
  const dockerfileContent = generateDockerfile(config);
  writeFileSync(join(tmpDir, 'Dockerfile'), dockerfileContent);
  step(`Dockerfile generated (${dockerfileContent.split('\n').length} lines)`);

  // ------------------------------------------------------------------
  // Step 4: Determine image name and tag
  // ------------------------------------------------------------------
  const appImageName = config.workspaceApp
    ? `${config.name}@${config.workspaceApp}`
    : config.name;

  const branch = config.branch || 'unknown';
  const cleanBranch = branch.replace(/[\/\.\-\s]/g, '-').slice(0, 50);

  // Try to get git SHA directly from git command
  let sha = 'local';
  try {
    sha = execSync('git rev-parse HEAD', {
      cwd: config.cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {}

  const tag = customTag || `${cleanBranch}-${sha.slice(0, 7)}`;
  const fullImage = `${org}/${appImageName}:${tag}`;

  // ------------------------------------------------------------------
  // Step 5: Build Docker image
  // ------------------------------------------------------------------
  console.log('\n▸ Building Docker image...');
  step(`Image: ${fullImage}`);

  try {
    execSync(`docker build --cache-from ${org}/${appImageName}:latest -t "${fullImage}" ${tmpDir}`, {
      stdio: 'inherit',
      timeout: 600_000, // 10 min for Docker build
    });
    // Tag as latest for next build cache
    execSync(`docker tag "${fullImage}" ${org}/${appImageName}:latest`);
  } catch (err) {
    console.error(
      `\n✖ Docker build failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  // ------------------------------------------------------------------
  // Step 6: Push to GHCR
  // ------------------------------------------------------------------
  if (buildOnly) {
    console.log(`\n✅ Docker image built: ${fullImage}`);
    console.log(`   Build only — to deploy, run: eve deploy --${config.name}`);
  } else {
    // Push to GHCR
    console.log('\n▸ Pushing to GitHub Container Registry...');

    if (ghcrToken) {
      try {
        execSync(`docker login ghcr.io -u USER --password-stdin <<< '${ghcrToken}'`, {
          stdio: 'pipe',
          timeout: 30_000,
        });
      } catch {
        console.error(`\n✖ GHCR login failed`);
        console.log('\nTip: Run `eve login --ghcr <token>` first');
        process.exit(1);
      }
    }

    try {
      execSync(`docker push "${fullImage}"`, {
        stdio: 'inherit',
        timeout: 600_000,
      });
    } catch (err) {
      console.error(
        `\n✖ Push failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    console.log(`\n✅ Pushed to GHCR: ${fullImage}`);
  }

  // Cleanup temp directory
  if (existsSync(tmpDir)) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  return {
    imageName: fullImage,
    tag,
    sha: sha.slice(0, 7),
    buildTime: Date.now() - startTime,
  };
}
