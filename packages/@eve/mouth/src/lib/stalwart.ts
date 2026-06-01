import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// execFile (argv array, NO shell) — interpolated values can never be
// re-parsed by /bin/sh, so domain/password provenance can't inject commands.
const execFileAsync = promisify(execFile);

/**
 * Stalwart mail server — the "mouth" organ.
 *
 * Stalwart bundles SMTP / IMAP / POP3 / JMAP / ManageSieve into a single Rust
 * binary. Eve runs it as a Docker sidecar on `eve-network`.
 *
 * Port model (decision: direct host ports for raw TCP):
 *   - Public mail ports (25 MX, 465/587 submission, 993 IMAPS, 995 POP3S) are
 *     published on all host interfaces — they legitimately need internet reach.
 *   - Cleartext/management ports (143 IMAP, 110 POP3, 4190 ManageSieve) are
 *     bound to loopback only; clients should use the implicit-TLS ports. This
 *     keeps brute-force and plaintext surfaces off the public internet.
 *   - Traefik is HTTP-only and cannot route any of these — binding them
 *     straight to the container also preserves the real client IP that
 *     SPF/DMARC depend on.
 *   - The HTTP surface (JMAP + admin + WebDAV/CalDAV/CardDAV) listens on 8080
 *     **inside** the container only; Traefik fronts it at `mail.<domain>` via
 *     Docker DNS (file-based dynamic config from the component registry). It is
 *     intentionally NOT published on the host.
 *
 * @see docs/stalwart-mail-implementation-plan.md
 */

export const STALWART_IMAGE = 'stalwartlabs/stalwart:v0.16';
export const STALWART_CONTAINER = 'eve-mouth-stalwart';

/** Mail ports published on all interfaces (need public reachability). */
const PUBLIC_TCP_PORTS = [25, 465, 587, 993, 995];
/** Cleartext / management ports bound to loopback only (never public). */
const LOOPBACK_TCP_PORTS = [143, 110, 4190];

/** Ports an operator must allow through their host firewall (public mail). */
export const STALWART_PUBLIC_PORTS = PUBLIC_TCP_PORTS;

export interface StalwartConfig {
  /** Public base URL, e.g. https://mail.example.com. Sets STALWART_PUBLIC_URL. */
  publicUrl?: string;
  /** Bootstrap admin password. Generated when absent; preseeded so no log scrape. */
  adminPassword?: string;
}

export class StalwartService {
  private config: StalwartConfig;

  constructor(config: StalwartConfig = {}) {
    this.config = config;
  }

  /** True if the Stalwart container is running. */
  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('docker', [
        'ps', '--filter', `name=^${STALWART_CONTAINER}$`, '--format', '{{.Names}}',
      ]);
      return stdout.trim() === STALWART_CONTAINER;
    } catch {
      return false;
    }
  }

  /** True if a container with this name exists in any state (running or stopped). */
  async exists(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('docker', [
        'ps', '-aq', '--filter', `name=^${STALWART_CONTAINER}$`,
      ]);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /** Ensure the shared Docker bridge exists; ignores "already exists". */
  private async ensureNetwork(): Promise<void> {
    try {
      await execFileAsync('docker', ['network', 'create', 'eve-network']);
    } catch {
      /* already exists (or created concurrently) — non-fatal */
    }
  }

  /**
   * Install + start the Stalwart container. Returns the bootstrap admin
   * password (generated when not supplied, `undefined` when the container was
   * already up so the caller never clobbers a stored secret with '').
   *
   * Idempotent: a stopped container with the same name is started rather than
   * recreated (a bare `docker run --name` would otherwise fail on the conflict).
   */
  async install(config?: StalwartConfig): Promise<{ adminPassword?: string }> {
    const merged = { ...this.config, ...config };

    if (await this.isRunning()) {
      console.log('Stalwart is already running');
      return { adminPassword: merged.adminPassword || undefined };
    }

    await this.ensureNetwork();

    if (await this.exists()) {
      console.log('Stalwart container exists but is stopped — starting it');
      await this.start();
      return { adminPassword: merged.adminPassword || undefined };
    }

    const adminPassword =
      merged.adminPassword && merged.adminPassword.trim().length > 0
        ? merged.adminPassword
        : randomBytes(18).toString('base64url');

    console.log(`Pulling Stalwart image (${STALWART_IMAGE})...`);
    await execFileAsync('docker', ['pull', STALWART_IMAGE]);

    // Preseed the recovery admin via a 0600 env-file rather than `-e` on the
    // argv, so the password never lands in `ps`/shell history/Eve logs. (It is
    // still visible in `docker inspect`; rotating + clearing the recovery var
    // post-boot is tracked as a Phase-2 hardening task.)
    const dir = await mkdtemp(join(tmpdir(), 'eve-stalwart-'));
    const envFile = join(dir, 'stalwart.env');
    await writeFile(envFile, `STALWART_RECOVERY_ADMIN=admin:${adminPassword}\n`, { mode: 0o600 });

    const portArgs = [
      ...PUBLIC_TCP_PORTS.flatMap(p => ['-p', `${p}:${p}`]),
      ...LOOPBACK_TCP_PORTS.flatMap(p => ['-p', `127.0.0.1:${p}:${p}`]),
    ];

    try {
      console.log('Starting Stalwart...');
      await execFileAsync('docker', [
        'run', '-d',
        '--name', STALWART_CONTAINER,
        '--restart', 'unless-stopped',
        '--network', 'eve-network',
        ...portArgs,
        '--env-file', envFile,
        ...(merged.publicUrl ? ['-e', `STALWART_PUBLIC_URL=${merged.publicUrl}`] : []),
        '-v', 'stalwart-etc:/etc/stalwart',
        '-v', 'stalwart-data:/var/lib/stalwart',
        STALWART_IMAGE,
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    return { adminPassword };
  }

  async start(): Promise<void> {
    if (await this.isRunning()) {
      console.log('Stalwart is already running');
      return;
    }
    await execFileAsync('docker', ['start', STALWART_CONTAINER]);
    console.log('Stalwart started');
  }

  async stop(): Promise<void> {
    await execFileAsync('docker', ['stop', STALWART_CONTAINER]);
    console.log('Stalwart stopped');
  }
}
