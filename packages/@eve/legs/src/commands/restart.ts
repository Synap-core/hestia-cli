import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';

const CONTAINER = 'eve-legs-traefik';
const CONFIG_DIR = '/opt/traefik';

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
        '-v', 'eve-legs-traefik-certs:/etc/traefik/acme.json',
        '--network', 'eve-network',
        'traefik:v3.0',
      ], { stdio: 'inherit' });

      if (result.status !== 0) {
        console.error('Failed to start Traefik container');
        process.exit(1);
      }

      console.log('✓ Traefik running — routes are live');
    });
}
