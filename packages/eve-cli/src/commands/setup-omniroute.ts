import { Command } from 'commander';
import { execa } from 'execa';
import { readEveSecrets, upsertPodProvider } from '@eve/dna';

interface SetupOmniRouteOptions {
  // No options needed for now - can be extended later
}

async function runSetupOmniRoute(options: SetupOmniRouteOptions) {
  const secrets = await readEveSecrets();
  const apiKey = secrets?.ai?.providers?.find(p => p.id === 'synap')?.apiKey;
  if (!apiKey) {
    throw new Error('Synapse API key not found. Please ensure you have authenticated to the pod.');
  }

  const containerName = 'eve-omniroute';
  const isRunning = await checkContainerRunning(containerName);
  if (!isRunning) {
    console.log('Starting OmniRoute container...');
    await execa('docker', ['run', '-d', '-p', '3000:3000', 'diegosouzapw/omniroute'], { stdio: 'inherit' });
    await waitForPort(3000);
  }

  const providerBody = {
    providerId: 'omniroute',
    name: 'OmniRoute',
    baseUrl: 'http://localhost:3000',
    enabled: true,
    priority: 100,
  };

  const result = await upsertPodProvider('http://localhost:4000', apiKey, providerBody);
  console.log(`OmniRoute setup result: ${result.status} - ${result.summary}`);
}

function checkContainerRunning(name: string): Promise<boolean> {
  return execa('docker', ['ps', '-f', `name=${name}`], { encoding: 'utf-8', stdio: 'pipe' })
    .then(out => out.includes(name))
    .catch(() => false);
}

async function waitForPort(port: number): Promise<void> {
  const timeout = 30000;
  const interval = 1000;
  let elapsed = 0;
  while (elapsed < timeout) {
    try {
      await execa('curl', ['-s', `http://localhost:3000/health`], { timeout: 1000 });
      return;
    } catch {
      elapsed += interval;
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  throw new Error('OmniRoute did not become healthy in time');
}

export function setupOmniRouteCommand(program: any) {
  program
    .command('setup-omniroute')
    .description('Set up OmniRoute as an AI provider for the pod')
    .action(async (options) => {
      await runSetupOmniRoute(options);
    });
}

export { runSetupOmniRoute };