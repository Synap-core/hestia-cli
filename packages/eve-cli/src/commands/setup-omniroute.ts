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
  //
  // Existence is judged by IMAGE, not by name. A container named
  // `eve-brain-omniroute` that is running but built from another image is
  // not OmniRoute, and probing it fails forever while its logs look like
  // someone else's service. Checking `Config.Image` is what makes the
  // distinction; `docker ps -f name=` cannot.
  const existingImage = await containerImage(CONTAINER_NAME);
  if (existingImage && !existingImage.includes(OMNIROUTE_IMAGE)) {
    throw new Error(
      `A container named ${CONTAINER_NAME} already exists but runs "${existingImage}", not ${OMNIROUTE_IMAGE}. ` +
      `Refusing to use it — its logs show another service, and the provider would point at the wrong endpoint. ` +
      `Remove it first: docker rm -f ${CONTAINER_NAME}`,
    );
  }

  const isRunning = existingImage ? await isContainerRunning(CONTAINER_NAME) : false;
  if (!isRunning) {
    console.log('Starting OmniRoute container...');
    // `--name` fails when the name is taken, so drop a stopped leftover first.
    await execa('docker', ['rm', '-f', CONTAINER_NAME], { stdio: 'ignore' }).catch(() => {});
    await execa('docker', [
      'run', '-d',
      '--name', CONTAINER_NAME,
      '--network', 'eve-network',
      '--restart', 'unless-stopped',
      '-e', `PORT=${OMNIROUTE_PORT}`,
      OMNIROUTE_IMAGE,
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
    baseUrl: `http://${CONTAINER_NAME}:${resolvedPort ?? OMNIROUTE_PORT}/v1`,
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

/**
 * The image whose name/container is the identity we care about. Kept as a
 * constant so the existence check and the `docker run` cannot drift.
 */
const OMNIROUTE_IMAGE = 'diegosouzapw/omniroute';

/** The image a container was created from, or null when it doesn't exist. */
async function containerImage(name: string): Promise<string | null> {
  return execa('docker', ['inspect', '-f', '{{.Config.Image}}', name], { stdio: 'pipe' })
    .then(({ stdout }) => stdout.trim() || null)
    .catch(() => null);
}

async function isContainerRunning(name: string): Promise<boolean> {
  return execa('docker', ['inspect', '-f', '{{.State.Running}}', name], { stdio: 'pipe' })
    .then(({ stdout }) => stdout.trim() === 'true')
    .catch(() => false);
}

/**
 * Probe OmniRoute from a THROWAWAY SIDECAR on `eve-network`, not with
 * `docker exec`.
 *
 * `docker exec <name> curl/node/python` requires an HTTP client to exist
 * INSIDE the target image. OmniRoute ships none of the three (the pod proved
 * it: `exec: "curl": executable file not found`), so every in-container
 * probe fails identically and looks exactly like a dead container — while
 * the container is in fact running and healthy.
 *
 * A sidecar needs nothing from the target image, and it tests the path that
 * actually matters: container-name DNS resolution over `eve-network` — the
 * exact route the Synap IS will use to reach OmniRoute. Probing
 * `127.0.0.1` inside the container could pass while that route was still
 * broken (wrong network, no DNS), so this is strictly more informative than
 * the in-container probe it replaces.
 */
/**
 * The port that actually answered. Module-scoped because `waitForHealthy`
 * discovers it and `runSetupOmniRoute` needs it to build the provider URL —
 * the baseUrl must name the port we PROVED serves, never a documented guess.
 */
let resolvedPort: number | undefined;

/**
 * Ports to probe: the documented default, plus whatever the container is
 * actually listening on. `ss`/`netstat` inside the image are unreliable
 * (this one has neither curl nor node), so the observed set comes from the
 * Docker-assigned list where published, falling back to the default alone.
 */
async function candidatePorts(name: string): Promise<number[]> {
  const ports = new Set<number>([OMNIROUTE_PORT]);
  const listening = await execa('docker', ['exec', name, 'sh', '-c', 'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null'], { stdio: 'pipe' })
    .then(({ stdout }) => stdout)
    .catch(() => '');
  // /proc/net/tcp holds hex `local_address` as LADDR:PORT with PORT in hex.
  for (const line of listening.split('\n')) {
    const m = line.trim().match(/^[\dA-Fa-f]+:\s+([\dA-Fa-f]{4})\s/);
    if (!m) continue;
    const port = parseInt(m[1], 16);
    if (port > 1024 && port < 65536) ports.add(port);
  }
  return [...ports];
}

async function waitForHealthy(name: string): Promise<void> {
  const timeout = 90000;
  const interval = 2000;
  let elapsed = 0;
  const errors: string[] = [];

  while (elapsed < timeout) {
    // Try the documented port first, then sweep the ports the container is
    // actually LISTENING on. The documented default is not evidence — this
    // image emits Synap's own boot logs, so the port has to be observed.
    // Discovering it here also means the provider baseUrl below is the port
    // that was proven to answer, not the one we assumed.
    for (const port of await candidatePorts(name)) {
      const url = `http://${name}:${port}/v1/models`;
      try {
        // `--rm` so the probe container never accumulates. `curlimages/curl`
        // is purpose-built for this and needs no host port.
        await execa('docker', [
          'run', '--rm', '--network', 'eve-network',
          'curlimages/curl:latest',
          '-sf', '--max-time', '5', url,
        ], { timeout: 20_000 });
        resolvedPort = port;
        return;
      } catch (err) {
        errors.push(`${port}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    elapsed += interval;
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  // Evidence, because the generic timeout is indistinguishable across the
  // real causes: wrong port, wrong network, container not serving.
  const [state, ports, logs, nets, env, entrypoint] = await Promise.all([
    execa('docker', ['inspect', '-f', '{{.State.Status}} exit={{.State.ExitCode}}', name], { stdio: 'pipe' })
      .then(({ stdout }) => stdout.trim()).catch(() => 'unknown'),
    execa('docker', ['port', name], { stdio: 'pipe' })
      .then(({ stdout }) => stdout.trim() || '(no published ports)').catch(() => '(unknown)'),
    execa('docker', ['logs', '--tail', '20', name], { stdio: 'pipe' })
      .then(({ stdout }) => stdout.trim()).catch(() => '(no logs)'),
    // The network is the probe's own precondition: if this container is not
    // on eve-network, container-name DNS can never resolve, no matter which
    // port the image serves.
    execa('docker', ['inspect', '-f', '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}', name], { stdio: 'pipe' })
      .then(({ stdout }) => stdout.trim()).catch(() => '(unknown)'),
    execa('docker', ['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', name], { stdio: 'pipe' })
      .then(({ stdout }) => stdout.split('\n').filter(l => /^(PORT|HOST|API_URL|BASE_URL|NODE_ENV)/.test(l)).join(' '))
      .catch(() => '(unknown)'),
    execa('docker', ['inspect', '-f', '{{json .Config.Entrypoint}} {{json .Config.Cmd}}', name], { stdio: 'pipe' })
      .then(({ stdout }) => stdout.trim()).catch(() => '(unknown)'),
  ]);

  throw new Error(
    `OmniRoute never answered on eve-network in ${Math.round(timeout / 1000)}s ` +
    `(probed ports: ${(await candidatePorts(name)).join(', ')} — the container reports listening on these).\n` +
    `Container state: ${state}\n` +
    `Networks: ${nets}\n` +
    `Entry/Cmd: ${entrypoint}\n` +
    `PORT-ish env: ${env}\n` +
    `Published ports: ${ports}\n` +
    `Per-port probe errors:\n${errors.slice(-5).join('\n').slice(0, 600)}\n` +
    `Last log lines:\n${logs.slice(0, 800)}`,
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