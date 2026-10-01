import { Command } from 'commander';
import { execa } from 'execa';
import { confirm, isCancel } from '@clack/prompts';
import { readEveSecrets, upsertPodProvider, resolveSynapUrlOnHost, readAgentKeyOrLegacySync } from '@eve/dna';

interface SetupOmniRouteOptions {
  // No options needed for now - can be extended later
}

/**
 * OmniRoute container name. Follows the `eve-brain-*` convention so the
 * Synap IS can reach it by container name on `eve-network` (see
 * `installFreellmapi` in @eve/lifecycle for the precedent).
 */
const CONTAINER_NAME = 'eve-brain-omniroute';

/**
 * OmniRoute's own server port. The image boots on 20128, not 3000 — see
 * https://hub.docker.com/r/diegosouzapw/omniroute ("server boots on
 * localhost:20128"). Publishing 3000 was wrong on two counts: the image
 * never listens there, and 3000 is already taken by the dashboard /
 * OpenClaw / Dokploy stack, which is what actually surfaced the failure.
 */
const OMNIROUTE_PORT = 20128;

/**
 * Resolve the pod URL the same way every other eve command does: probe the
 * loopback Eve publishes first, then fall back to the env var. Hardcoding
 * `http://localhost:4000` only works when the pod happens to be on 4000 and
 * the caller is on the same host — `eve brain providers add` resolves it
 * properly instead (see `resolveAuth` in commands/providers.ts).
 */
async function resolvePodUrl(secrets: Awaited<ReturnType<typeof readEveSecrets>>): Promise<string> {
  const podUrl = (await resolveSynapUrlOnHost(secrets)) || process.env.SYNAP_POD_URL;
  if (!podUrl) {
    throw new Error(
      'Pod URL not configured. Run `eve setup` first, or set SYNAP_POD_URL.',
    );
  }
  return podUrl;
}

async function runSetupOmniRoute(_options: SetupOmniRouteOptions) {
  const secrets = await readEveSecrets();
  // Use the canonical resolver: per-agent key first (agents.eve.hubApiKey),
  // then legacy synap.apiKey fallback. This is the same order every other
  // Synap consumer uses (readAgentKeyOrLegacySync in @eve/dna).
  const apiKey = readAgentKeyOrLegacySync('eve', secrets);

  if (!apiKey) {
    throw new Error('Synapse API key not found. Please ensure you have authenticated to the pod (run `eve setup` or `eve auth login`).');
  }

  const podUrl = await resolvePodUrl(secrets);

  // Start the container if it isn't already running. No host port is
  // published — the IS reaches it by container name on eve-network, exactly
  // like FreeLLMAPI. Publishing a host port would only widen exposure
  // (the upstream gateway is "guarded only by the unified API key") and
  // risk a collision with the stack's other 3000-bound services.
  const isRunning = await checkContainerRunning(CONTAINER_NAME);
  if (!isRunning) {
    console.log('Starting OmniRoute container...');
    await execa('docker', [
      'run', '-d',
      '--name', CONTAINER_NAME,
      '--network', 'eve-network',
      '--restart', 'unless-stopped',
      '-e', `PORT=${OMNIROUTE_PORT}`,
      'diegosouzapw/omniroute',
    ], { stdio: 'inherit' });
    await waitForHealthy(CONTAINER_NAME);
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
    // Container-name addressing on eve-network, with the image's real port.
    // The IS runs inside a container, so `localhost` here would point at the
    // IS itself, not at OmniRoute — same reason FreeLLMAPI uses
    // `http://eve-brain-freellmapi:3001/v1`.
    baseUrl: `http://${CONTAINER_NAME}:${OMNIROUTE_PORT}/v1`,
    enabled: setAsDefault,
    // Routing uses ascending priority: 1 is preferred over existing providers.
    priority: setAsDefault ? 1 : 100,
  };

  const result = await upsertPodProvider(podUrl, apiKey, providerBody);
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

/**
 * Poll the container's own health endpoint until it answers.
 *
 * The image does not document a `/health` path, and it may not ship `curl`
 * either — so we probe through Node's global `fetch`, the same primitive
 * FreeLLMAPI's own healthcheck uses (`docker exec eve-brain-freellmapi
 * node -e "fetch('http://127.0.0.1:3001/livez')..."`). Node is a safe bet for
 * a gateway image; curl is not. We try the endpoints in order of likelihood
 * and stop at the first that answers, so a first-boot delay (model loading,
 * config migration) doesn't get mistaken for a dead container.
 */
async function waitForHealthy(name: string): Promise<void> {
  const timeout = 60000;
  const interval = 1000;
  let elapsed = 0;
  let lastErr: string = '';
  while (elapsed < timeout) {
    try {
      await execa('docker', [
        'exec', name, 'node', '-e',
        `fetch('http://127.0.0.1:${OMNIROUTE_PORT}/v1/models').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))`,
      ], { timeout: 5000 });
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      elapsed += interval;
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  throw new Error(
    `OmniRoute did not become healthy in time (probed http://127.0.0.1:${OMNIROUTE_PORT}/v1/models every ${interval}ms for ${timeout}ms; last error: ${lastErr.slice(0, 200)}). ` +
    `Check: docker logs ${name}`,
  );
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