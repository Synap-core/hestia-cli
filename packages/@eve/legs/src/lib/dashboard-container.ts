/**
 * Dashboard container lifecycle.
 *
 * The Eve Dashboard is a Next.js app shipped as a Docker image
 * (`eve-dashboard:local`, built from `packages/eve-dashboard/Dockerfile`).
 * It runs on `eve-network` so Traefik can route the `eve.<domain>` subdomain
 * to it by container name.
 *
 * Mounts:
 *  - /opt                     → /opt        (RW)  — secrets, synap/openwebui config
 *  - /root/.local/share/eve   → same        (RW)  — entity state.json
 *  - /var/run/docker.sock     → same        (RW)  — wire-ai docker exec
 *
 * The container reads secrets via EVE_HOME (set to the host workspace dir)
 * so it doesn't need its WORKDIR to match the host's eve install path.
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const CONTAINER_NAME = 'eve-dashboard';
const IMAGE_TAG = 'eve-dashboard:local';
const INTERNAL_PORT = 3000;
const HOST_PORT = 7979;

export interface DashboardInstallOptions {
  /** Workspace root that contains the Dockerfile + .eve/ secrets. Default: $PWD. */
  workspaceRoot?: string;
  /** Dashboard secret used for the unlock screen. Required. */
  secret: string;
  /** If true, force a fresh image build even when one exists. */
  rebuild?: boolean;
}

function ensureNetwork(name: string): void {
  try {
    execSync(`docker network inspect ${name}`, { stdio: 'ignore' });
  } catch {
    execSync(`docker network create ${name}`, { stdio: 'inherit' });
  }
}

function ensureEveNetwork(): void {
  ensureNetwork('eve-network');
}

function imageExists(): boolean {
  try {
    const out = execSync(`docker image inspect ${IMAGE_TAG}`, { stdio: ['pipe', 'pipe', 'ignore'] });
    return out.length > 0;
  } catch {
    return false;
  }
}

function buildImage(workspaceRoot: string): void {
  const dockerfile = resolve(workspaceRoot, 'packages/eve-dashboard/Dockerfile');
  if (!existsSync(dockerfile)) {
    throw new Error(`Dockerfile not found at ${dockerfile}. Are you in the eve workspace root?`);
  }
  console.log(`  Building ${IMAGE_TAG} (this takes a minute on first run)...`);
  const r = spawnSync(
    'docker',
    ['build', '-f', dockerfile, '-t', IMAGE_TAG, workspaceRoot],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error(`docker build exited with code ${r.status}`);
}

function removeContainer(): void {
  try {
    execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'ignore' });
  } catch { /* didn't exist */ }
}

function runContainer(workspaceRoot: string, secret: string): void {
  const stateDir = `${homedir()}/.local/share/eve`;
  const args = [
    'run', '-d',
    '--name', CONTAINER_NAME,
    '--restart', 'unless-stopped',
    '--network', 'eve-network',
    '-p', `${HOST_PORT}:${INTERNAL_PORT}`,
    '-e', `PORT=${INTERNAL_PORT}`,
    '-e', `EVE_HOME=${workspaceRoot}`,
    '-e', `EVE_DASHBOARD_SECRET=${secret}`,
    // Mounts that mirror what the host CLI would touch.
    '-v', '/opt:/opt',
    '-v', `${stateDir}:${stateDir}`,
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    IMAGE_TAG,
  ];
  const r = spawnSync('docker', args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`docker run exited with code ${r.status}`);
}

/**
 * Install (or reinstall) the dashboard container. Idempotent: if the image
 * is already built and not rebuilding, skips straight to (re)running.
 */
export function installDashboardContainer(opts: DashboardInstallOptions): void {
  const workspaceRoot = resolve(opts.workspaceRoot ?? process.cwd());

  ensureEveNetwork();

  if (opts.rebuild || !imageExists()) {
    buildImage(workspaceRoot);
  }

  removeContainer();
  runContainer(workspaceRoot, opts.secret);
}

/** Stop and remove the dashboard container. Image is left in place. */
export function uninstallDashboardContainer(): void {
  removeContainer();
}

export function dashboardContainerName(): string {
  return CONTAINER_NAME;
}

export function dashboardImageTag(): string {
  return IMAGE_TAG;
}

/** True when the dashboard container is running on this host. */
export function dashboardIsRunning(): boolean {
  try {
    const out = execSync(
      `docker ps --filter "name=^${CONTAINER_NAME}$" --format "{{.Names}}"`,
      { encoding: 'utf-8' },
    ).trim();
    return out === CONTAINER_NAME;
  } catch {
    return false;
  }
}
