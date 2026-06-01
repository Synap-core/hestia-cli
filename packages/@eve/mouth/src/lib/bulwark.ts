import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';

// execFile (argv array, NO shell) — no interpolated value is re-parsed by /bin/sh.
const execFileAsync = promisify(execFile);

/**
 * Bulwark — modern JMAP webmail client for Stalwart.
 *
 * Runs as a Docker sidecar on `eve-network`, fronted by Traefik at
 * `webmail.<domain>` (HTTP on container port 3000). When `JMAP_SERVER_URL` is
 * set the first-run wizard is skipped and the server is locked to Stalwart;
 * otherwise the operator points the wizard at the JMAP URL by hand.
 *
 * @see https://github.com/bulwarkmail/webmail
 */

export const BULWARK_IMAGE = 'ghcr.io/bulwarkmail/webmail:latest';
export const BULWARK_CONTAINER = 'eve-mouth-bulwark';

export interface BulwarkConfig {
  /** Stalwart JMAP base URL, e.g. https://mail.example.com. Sets JMAP_SERVER_URL. */
  jmapUrl?: string;
  /**
   * Secret used to encrypt stored credentials (SESSION_SECRET). Generated when
   * absent; persist it so a reinstall doesn't invalidate saved logins.
   */
  sessionSecret?: string;
}

export class BulwarkService {
  private config: BulwarkConfig;

  constructor(config: BulwarkConfig = {}) {
    this.config = config;
  }

  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('docker', [
        'ps', '--filter', `name=^${BULWARK_CONTAINER}$`, '--format', '{{.Names}}',
      ]);
      return stdout.trim() === BULWARK_CONTAINER;
    } catch {
      return false;
    }
  }

  async exists(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('docker', [
        'ps', '-aq', '--filter', `name=^${BULWARK_CONTAINER}$`,
      ]);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async ensureNetwork(): Promise<void> {
    try {
      await execFileAsync('docker', ['network', 'create', 'eve-network']);
    } catch {
      /* already exists — non-fatal */
    }
  }

  /**
   * Install + start Bulwark. Returns the SESSION_SECRET actually used
   * (generated when not supplied, `undefined` when the container was already
   * up) so the caller can persist it without clobbering a stored value.
   *
   * Idempotent: a stopped container is started rather than recreated.
   */
  async install(config?: BulwarkConfig): Promise<{ sessionSecret?: string }> {
    const merged = { ...this.config, ...config };

    if (await this.isRunning()) {
      console.log('Bulwark is already running');
      return { sessionSecret: merged.sessionSecret || undefined };
    }

    await this.ensureNetwork();

    if (await this.exists()) {
      console.log('Bulwark container exists but is stopped — starting it');
      await this.start();
      return { sessionSecret: merged.sessionSecret || undefined };
    }

    const sessionSecret =
      merged.sessionSecret && merged.sessionSecret.trim().length > 0
        ? merged.sessionSecret
        : randomBytes(32).toString('hex');

    console.log(`Pulling Bulwark image (${BULWARK_IMAGE})...`);
    await execFileAsync('docker', ['pull', BULWARK_IMAGE]);

    console.log('Starting Bulwark...');
    await execFileAsync('docker', [
      'run', '-d',
      '--name', BULWARK_CONTAINER,
      '--restart', 'unless-stopped',
      '--network', 'eve-network',
      '-e', `SESSION_SECRET=${sessionSecret}`,
      '-e', 'ADMIN_CONFIG_DIR=/data/admin',
      ...(merged.jmapUrl ? ['-e', `JMAP_SERVER_URL=${merged.jmapUrl}`] : []),
      '-v', 'bulwark-data:/data',
      BULWARK_IMAGE,
    ]);

    return { sessionSecret };
  }

  async start(): Promise<void> {
    if (await this.isRunning()) {
      console.log('Bulwark is already running');
      return;
    }
    await execFileAsync('docker', ['start', BULWARK_CONTAINER]);
    console.log('Bulwark started');
  }

  async stop(): Promise<void> {
    await execFileAsync('docker', ['stop', BULWARK_CONTAINER]);
    console.log('Bulwark stopped');
  }
}
