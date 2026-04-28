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
    try {
      execSync(`docker network connect eve-network ${name}`, { stdio: ['pipe', 'pipe', 'ignore'] });
      console.log(`  Reconnected ${name} → eve-network`);
    } catch {
      // Already connected
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
