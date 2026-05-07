/**
 * Type definitions for the eve deploy pipeline.
 * Used by both @eve/dna (core logic) and @eve/cli (commands).
 */

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

/** Supported web frameworks we can auto-detect. */
export type Framework = 'nextjs' | 'node' | 'static' | 'deno' | 'unknown';

/** Information about the current app directory. */
export interface AppConfig {
  /** App name from package.json "name" field. */
  name: string;
  /** Package name or null if no name. */
  package?: string | null;
  /** The detected framework. */
  framework: Framework;
  /** Local build command from package.json "scripts.build". */
  buildCommand: string;
  /** Output directory after build (e.g. ".next", "dist"). */
  outputDir: string;
  /** True if the build output should be docker-standalone. */
  standalone: boolean;
  /** Optional override from vercel.json. */
  vercelConfig?: VercelConfig | null;
  /** The working directory we ran from. */
  cwd: string;
  /** Parent workspace root if inside a pnpm workspace. */
  workspaceRoot?: string;
  /** Monorepo app name if inside a workspace (e.g. "hub", "web"). */
  workspaceApp?: string;
  /** The branch name detected via `git rev-parse` or null. */
  branch?: string | null;
}

/** Minimal vercel.json shape. */
export interface VercelConfig {
  framework?: string;
  buildCommand?: string;
  outputDirectory?: string;
  installCommand?: string;
}

// ---------------------------------------------------------------------------
// Docker image packaging
// ---------------------------------------------------------------------------

/** Result from the Docker packaging step. */
export interface DockerPackResult {
  /** Full image name: e.g. "ghcr.io/synap-core/app-name:branch-sha". */
  imageName: string;
  /** Tag extracted from image name. */
  tag: string;
  /** The Dockerfile we generated (for debugging/logging). */
  generatedDockerfile: string;
}

// ---------------------------------------------------------------------------
// Coolify deployment
// ---------------------------------------------------------------------------

/** Coolify environment target. */
export type DeployEnv = 'staging' | 'production';

/** Configuration for a Coolify target. */
export interface CoolifyTarget {
  /** Base URL of the Coolify instance (e.g. http://10.10.0.20:8000). */
  apiUrl: string;
  /** API bearer token. */
  authToken: string;
  /** Human label for logging. */
  label: string;
}

/** A Coolify application resource. */
export interface CoolifyApp {
  /** UUID of the application in Coolify. */
  id: string;
  /** Name as shown in Coolify UI. */
  name: string;
  /** Current deployment status code. */
  status: string;
  /** The URL Coolify has assigned. */
  url?: string;
  /** Project/Workspace UUID that this app belongs to in Coolify. */
  projectId?: string;
  /** Resource type (e.g. "docker", "docker_image"). */
  resourceType?: string;
  /** Git repository URL if tracked via git. */
  gitRepo?: string;
}

/** Result from a deploy operation. */
export interface DeployResult {
  /** True if the deploy succeeded. */
  success: boolean;
  /** App name as deployed (for display). */
  appName: string;
  /** Full image name that was deployed. */
  image: string;
  /** Target environment. */
  env: DeployEnv;
  /** Coolify application UUID (if one existed or was created). */
  appId?: string;
  /** The deployed URL (if resolved). */
  url?: string;
  /** Deployment log / status snippet. */
  message: string;
  /** Human-readable success / error message for the CLI. */
  statusMessage?: string;
}

/** Parameters for the deploy function. */
export interface DeployParams {
  /** The detected app configuration. */
  config: AppConfig;
  /** Docker image to deploy. */
  dockerImage: string;
  /** Target environment (staging or production). */
  targetEnv: DeployEnv;
  /** Target configuration (Coolify URLs + tokens). */
  targets: Record<DeployEnv, CoolifyTarget>;
  /** Optional custom env vars to pass to the container. */
  envVars?: Record<string, string>;
  /** Custom domain override for the deployed app. */
  customDomain?: string;
  /** Optional Coolify project ID to deploy into. */
  projectId?: string;
  /** Whether to force recreate (delete + create) the app in Coolify. */
  force?: boolean;
}

// ---------------------------------------------------------------------------
// Login / credentials
// ---------------------------------------------------------------------------

/** Credentials stored by `eve login`. */
export interface EveCredentials {
  /** GitHub Personal Access Token for GHCR access. */
  ghcrToken?: string | null;
  /** Stored Coolify staging token (optional, can also read from server). */
  coolifyStagingToken?: string | null;
  /** Stored Coolify production token (optional, can also read from server). */
  coolifyProdToken?: string | null;
  /** When these credentials were last refreshed. */
  lastChecked?: string;
}

/** Registry URL for GitHub Container Registry. */
export const GHCR_REGISTRY = 'ghcr.io';

/** Default organization for Docker images. */
export const GHCR_ORG = 'synap-core';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default image tag format: "branch-sha". */
export function defaultImageTag(branch: string, sha: string): string {
  const safeBranch = branch.replace(/[\/\.\-\s]/g, '-').slice(0, 50);
  return `${safeBranch}-${sha.slice(0, 7)}`;
}

/** Default image tag for staging. */
export function stagingImageTag(branch: string, sha: string): string {
  return `${defaultImageTag(branch, sha)}-staging`;
}

/** Default image tag for production. */
export function prodImageTag(branch: string, sha: string): string {
  return `${defaultImageTag(branch, sha)}-prod`;
}
