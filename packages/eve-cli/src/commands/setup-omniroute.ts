import { Command } from 'commander';
import { execa } from 'execa';
import { confirm, isCancel } from '@clack/prompts';
import { readEveSecrets, upsertPodProvider } from '@eve/dna';

interface SetupOmniRouteOptions {
  // No options needed for now - can be extended later
}

async function runSetupOmniRoute(options: SetupOmniRouteOptions) {
  const secrets = await readEveSecrets();
  // Try multiple locations where the Synapse API key might be stored
  const apiKey =
    secrets?.synap?.apiKey ??
    secrets?.arms?.openclaw?.synapApiKey ??
    secrets?.ai?.providers?.find(p => p.id === 'synap')?.apiKey ??
    process.env.SYNAP_API_KEY ??
    process.env.OPENCLAW_SYNAP_API_KEY;

  if (!apiKey) {
    throw new Error('Synapse API key not found. Please ensure you have authenticated to the pod (run `eve setup` or `eve auth login`).');
  }

  const containerName = 'eve-omniroute';
  const isRunning = await checkContainerRunning(containerName);
  if (!isRunning) {
    console.log('Starting OmniRoute container...');
    await execa('docker', ['run', '-d', '-p', '3000:3000', 'diegosouzapw/omniroute'], { stdio: 'inherit' });
    await waitForPort(3000);
  }

  const setAsDefault = await confirm({
    message: 'Use OmniRoute as the default AI provider for the Intelligence Service?',
    initialValue: true,
  });

  if (isCancel(setAsDefault)) {
    console.log('Cancelled.');
    return;
  }

  const providerBody = {
    providerId: 'omniroute',
    name: 'OmniRoute',
    baseUrl: 'http://localhost:3000',
    enabled: setAsDefault,
    // Routing uses ascending priority: 1 is preferred over existing providers.
    priority: setAsDefault ? 1 : 100,
  };

  const result = await upsertPodProvider('http://localhost:4000', apiKey, providerBody);
  if (result.status === 'proposed') {
    console.log(
      `OmniRoute setup is awaiting approval (${result.proposalId}). It is not active until the proposal is approved.`,
    );
  } else {
    console.log(
      setAsDefault
        ? 'OmniRoute is enabled as the default IS provider (priority 1).'
        : 'OmniRoute is registered but disabled for the IS.',
    );
  }
}

function checkContainerRunning(name: string): Promise<boolean> {
  // `execa` resolves to a Result: the captured stdout is `.stdout`, not the
  // result object itself. `encoding: 'utf-8'` is also not a valid execa option —
  // it was making the whole call a type error that `tsup` never surfaced.
  return execa('docker', ['ps', '-f', `name=${name}`], { stdio: 'pipe' })
    .then(({ stdout }) => stdout.includes(name))
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

export function setupOmniRouteCommand(program: Command) {
  program
    .command('setup-omniroute')
    .description('Set up OmniRoute as an AI provider for the pod')
    .action(async (options) => {
      await runSetupOmniRoute(options);
    });
}

export { runSetupOmniRoute };