import { existsSync, readFileSync, writeFileSync, watchFile, readdirSync } from 'node:fs';
import { join, basename, relative, isAbsolute } from 'node:path';
import { execSync } from 'node:child_process';
import type {
  AppConfig,
  Framework,
  VercelConfig,
} from './deploy-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJSON<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function detectFramework(cwd: string): Framework {
  const pkg = readJSON<{
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  }>(join(cwd, 'package.json'));

  // Next.js
  const depMap = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (depMap['next']) return 'nextjs';
  if (existsSync(join(cwd, 'next.config.ts')) || existsSync(join(cwd, 'next.config.js')) || existsSync(join(cwd, 'next.config.mjs'))) return 'nextjs';

  // Static sites
  if (existsSync(join(cwd, 'index.html')) && !depMap['next']) return 'static';

  // Node/Express/Nest
  if (depMap['express'] || depMap['fastify'] || depMap['@nestjs/core']) return 'node';

  return 'unknown';
}

function detectBuildTool(cwd: string): 'pnpm' | 'npm' | 'yarn' {
  if (existsSync(join(cwd, 'pnpm-lock.yaml')) || existsSync(join(cwd, '.pnpm-workspace.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function detectBuildCommand(pkg: Record<string, unknown> | null, framework: Framework, vercelConfig: VercelConfig | null, cwd?: string): string {
  const scripts = pkg?.scripts as Record<string, string> | undefined;
  if (vercelConfig?.buildCommand) return vercelConfig.buildCommand;
  if (scripts?.build) return scripts.build;

  const tool = cwd ? detectBuildTool(cwd) : 'pnpm';
  switch (framework) {
    case 'nextjs': return `${tool} run build`;
    case 'static': return `${tool} run build`;
    case 'node': return `${tool} run build`;
    default: return `${tool} run build`;
  }
}

function detectOutputDir(framework: Framework, pkg: Record<string, unknown> | null, vercelConfig: VercelConfig | null): string {
  if (vercelConfig?.outputDirectory) return vercelConfig.outputDirectory;

  switch (framework) {
    case 'nextjs': return '.next';
    case 'static': return 'dist';
    case 'node': return 'dist';
    default: return 'dist';
  }
}

function detectStandalone(framework: Framework, pkg: Record<string, unknown> | null, cwd: string): boolean {
  if (framework !== 'nextjs') return false;

  const nc = readJSON<{ standalone?: boolean; output?: string }>(
    join(cwd, 'next.config.ts')
  );

  if (!nc) return false;
  if (nc?.standalone === true) return true;
  if (nc?.output === 'standalone') return true;

  // If vercel.json says framework: nextjs but no output specified, assume standalone
  // for Docker packaging.
  if (existsSync(join(cwd, 'vercel.json'))) {
    const vc = readJSON<VercelConfig>(join(cwd, 'vercel.json'));
    if (vc?.framework === 'nextjs') return true;
  }

  return false;
}

function detectWorkspaceRoot(cwd: string): string | null {
  // Check for pnpm-workspace.yaml
  const checkDir = isAbsolute(cwd) ? cwd : join(process.cwd(), cwd);
  let dir = checkDir;
  while (dir && dir !== '/') {
    if (existsSync(join(dir, '.pnpm-workspace.yaml'))) return dir;
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (existsSync(join(dir, 'turbo.json'))) return dir;
    dir = join(dir, '..');
  }
  return null;
}

function detectWorkspaceApp(cwd: string, workspaceRoot: string): string | null {
  if (!workspaceRoot) return null;
  const rel = relative(workspaceRoot, cwd);
  if (rel.startsWith('apps/')) {
    return rel.split('/')[1]; // e.g. "hub" from "apps/hub"
  }
  if (rel.startsWith('packages/@eve/')) {
    return rel.split('/')[2]; // e.g. "dna" from "packages/@eve/dna"
  }
  if (rel.startsWith('packages/')) {
    return rel.split('/')[1];
  }
  return null;
}

function detectBranch(cwd: string): string | null {
  try {
    const out = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function detectGitSha(cwd: string): string | null {
  try {
    const out = execSync('git rev-parse HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function detectVercelConfig(cwd: string): VercelConfig | null {
  const vcPath = join(cwd, 'vercel.json');
  if (!existsSync(vcPath)) return null;
  return readJSON<VercelConfig>(vcPath);
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Detect the app configuration at the given working directory.
 * Resolves package.json, framework, build command, workspace context.
 */
export function detectAppConfig(cwdToInspect?: string): AppConfig {
  const cwd = cwdToInspect || process.cwd();
  const pkg = readJSON<{ name?: string; scripts?: Record<string, string> }>(join(cwd, 'package.json'));

  const framework = detectFramework(cwd);
  const buildCommand = detectBuildCommand(pkg, framework, null, cwd);
  const outputDir = detectOutputDir(framework, pkg, null);
  const standalone = detectStandalone(framework, pkg, cwd);
  const vercelConfig = detectVercelConfig(cwd);

  // Override build command if vercel.json specifies different
  const finalBuildCommand = vercelConfig?.buildCommand || buildCommand;
  const finalOutputDir = vercelConfig?.outputDirectory || outputDir;

  const appName = pkg?.name || basename(cwd) || 'untitled';
  const workspaceRoot = detectWorkspaceRoot(cwd);
  const workspaceApp = detectWorkspaceApp(cwd, workspaceRoot || cwd);
  const branch = detectBranch(cwd);
  const sha = detectGitSha(cwd);

  return {
    name: appName,
    package: pkg?.name ?? null,
    framework,
    buildCommand: finalBuildCommand,
    outputDir: finalOutputDir,
    standalone,
    vercelConfig,
    cwd,
    workspaceRoot: workspaceRoot ?? undefined,
    workspaceApp: workspaceApp ?? undefined,
    branch: branch ?? undefined,
  };
}

/**
 * Get the app name to use as a Docker image identifier.
 * For monorepo apps: "repo@workspace-app" format.
 */
export function getAppImageName(config: AppConfig): string {
  if (config.workspaceApp) {
    // For workspace apps: use the workspace root name + app name
    const wsName = config.workspaceRoot
      ? basename(config.workspaceRoot)
      : config.name.split('/').at(-1) || config.name;
    return `${wsName}@${config.workspaceApp}`;
  }
  return config.name;
}
