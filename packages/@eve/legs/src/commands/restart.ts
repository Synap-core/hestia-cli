import { Command } from 'commander';
import { spawnSync, execSync } from 'child_process';
import { existsSync } from 'fs';

const CONTAINER = 'eve-legs-traefik';
const CONFIG_DIR = '/opt/traefik';

function reconnectSynapToEveNetwork(): void {
  try {
    const name = execSync(
      `docker ps --filter "label=com.docker.compose.project=synap-backend" --filter "label=com.docker.compose.service=backend" --format "{{.Names}}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim().split('\n')[0]?.trim();
    if (!name) return;
    // Alias 'eve-brain-synap' so OWUI/Hermes resolve the pod by the hostname
    // every compose template + default base URL assumes. Without it, the
    // OpenAI-compat /v1/models call from OWUI fails with NXDOMAIN.
    try {
      const inspect = execSync(
        `docker inspect --format "{{json .NetworkSettings.Networks}}" ${name}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
      ).trim();
      const networks = JSON.parse(inspect) as Record<string, { Aliases?: string[] | null }>;
      const eve = networks['eve-network'];
      if (eve && (eve.Aliases ?? []).includes('eve-brain-synap')) return;
      if (eve) {
        try { execSync(`docker network disconnect eve-network ${name}`, { stdio: ['pipe', 'pipe', 'ignore'] }); } catch { /* ignore */ }
      }
    } catch { /* fall through */ }
    try {
      execSync(`docker network connect --alias eve-brain-synap eve-network ${name}`, { stdio: ['pipe', 'pipe', 'ignore'] });
      console.log(`  Reconnected ${name} → eve-network (alias: eve-brain-synap)`);
    } catch {
      // connect failed — already connected with right alias, or container gone
    }
  } catch {
    // Synap not running — skip
  }
}

function freePort(port: number): void {
  try {
    // Find any container binding this port and stop it
    const out = execSync(
      `docker ps --format '{{.Names}}\\t{{.Ports}}' | grep ':${port}->'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    for (const line of out.split('\n').filter(Boolean)) {
      const name = line.split('\t')[0]?.trim();
      if (name && name !== CONTAINER) {
        console.log(`  Stopping container holding port ${port}: ${name}`);
        spawnSync('docker', ['stop', name], { stdio: 'inherit' });
      }
    }
  } catch {
    // Nothing using that port
  }
}

export function restartCommand(program: Command): void {
  program
    .command('restart')
    .description('Recreate the Traefik container with correct volume mounts')
    .action(() => {
      if (!existsSync(`${CONFIG_DIR}/traefik.yml`)) {
        console.error(`No Traefik config found at ${CONFIG_DIR}/traefik.yml`);
        console.error('Run: eve domain set <domain> --ssl --email <email> first');
        process.exit(1);
      }

      console.log('Freeing ports 80 / 443...');
      freePort(80);
      freePort(443);

      // acme.json must be a file (not a directory) with mode 600.
      // Named volumes mount as directories — use a bind-mount file instead.
      const acmePath = `${CONFIG_DIR}/acme.json`;
      if (!existsSync(acmePath)) {
        execSync(`touch ${acmePath} && chmod 600 ${acmePath}`);
        console.log(`Created ${acmePath} (600)`);
      } else {
        execSync(`chmod 600 ${acmePath}`);
        console.log(`Fixed permissions on ${acmePath} → 600`);
      }

      console.log(`Removing existing ${CONTAINER} container (if any)...`);
      spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'inherit' });

      console.log('Starting Traefik with correct volume mounts...');
      const result = spawnSync('docker', [
        'run', '-d',
        '--name', CONTAINER,
        '--restart', 'unless-stopped',
        '-p', '80:80',
        '-p', '443:443',
        '-p', '8080:8080',
        '-v', '/var/run/docker.sock:/var/run/docker.sock:ro',
        '-v', `${CONFIG_DIR}/traefik.yml:/etc/traefik/traefik.yml:ro`,
        '-v', `${CONFIG_DIR}/dynamic:/etc/traefik/dynamic:ro`,
        '-v', `${acmePath}:/etc/traefik/acme.json`,
        '--network', 'eve-network',
        'traefik:v3.0',
      ], { stdio: 'inherit' });

      if (result.status !== 0) {
        // Show what's still using the ports
        console.error('\nFailed to start Traefik. Containers currently using port 80/443:');
        spawnSync('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}'], { stdio: 'inherit' });
        process.exit(1);
      }

      reconnectSynapToEveNetwork();
      console.log('✓ Traefik running — routes are live');
    });
}
