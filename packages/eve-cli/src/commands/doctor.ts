import { Command } from 'commander';
import { execa } from 'execa';
import { execSync } from 'node:child_process';
import {
  entityStateManager,
  type Organ,
  COMPONENTS,
  readEveSecrets,
  getAccessUrls,
  hasAnyProvider,
} from '@eve/dna';
import { verifyComponent } from '@eve/legs';
import { runHubProtocolProbes, type HubProtocolDiagnostic } from '@eve/lifecycle';
import { probeRoutes, probeVerdict, type RouteProbe } from '../lib/probe-routes.js';
import { diagnoseFailedRoute, type DeepDiagnostic } from '../lib/diagnose-route.js';
import { DockerExecRunner, FallbackRunner, FetchRunner } from '../lib/doctor-runners.js';
import {
  colors,
  emojis,
  printHeader,
  printSuccess,
  printError,
  printWarning,
  printInfo,
  formatOrgan,
  createSpinner,
} from '../lib/ui.js';

interface CheckResult {
  name: string;
  /**
   * `skip` is rendered with the warning glyph but a "skipped" message —
   * distinct from `warn` ("something is sub-optimal") and `fail` ("broken").
   * The aggregate counter at the bottom still groups skip+warn together.
   */
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
  fix?: string;
  /**
   * Deep diagnostic data for failed routes — when present, the renderer
   * indents a sub-section under the row showing what we learned about the
   * upstream. Only set on route-check rows; other checks leave this undef.
   */
  deep?: DeepDiagnostic;
}

export function doctorCommand(program: Command): void {
  program
    .command('doctor')
    .alias('doc')
    .description('Run comprehensive diagnostics on the entity')
    .option('-v, --verbose', 'Show verbose output')
    .option(
      '--skip-probes',
      'Skip the Hub Protocol probes (idempotency, SSE, sub-tokens). Useful when debugging unrelated checks — the SSE probe alone takes up to 35s.',
    )
    .action(async (options) => {
      try {
        await runDiagnostics({
          verbose: Boolean(options.verbose),
          skipProbes: Boolean(options.skipProbes),
        });
      } catch (error) {
        printError('Diagnostics failed: ' + String(error));
        process.exit(1);
      }
    });
}

interface DoctorOptions {
  verbose: boolean;
  skipProbes: boolean;
}

async function runDiagnostics(opts: DoctorOptions = { verbose: false, skipProbes: false }): Promise<void> {
  const { verbose, skipProbes } = opts;
  console.log();
  printHeader('Entity Diagnostics', emojis.info);
  console.log();

  const checks: CheckResult[] = [];

  // Check 1: Docker
  const dockerCheck = createSpinner('Checking Docker...');
  dockerCheck.start();
  try {
    await execa('docker', ['version']);
    dockerCheck.succeed('Docker is running');
    checks.push({ name: 'Docker', status: 'pass', message: 'Docker daemon is running' });
  } catch {
    dockerCheck.fail('Docker is not running');
    checks.push({ 
      name: 'Docker', 
      status: 'fail', 
      message: 'Docker daemon is not running',
      fix: 'Start Docker Desktop or run: sudo systemctl start docker'
    });
  }

  // Check 2: Docker Compose
  const composeCheck = createSpinner('Checking Docker Compose...');
  composeCheck.start();
  try {
    await execa('docker', ['compose', 'version']);
    composeCheck.succeed('Docker Compose is available');
    checks.push({ name: 'Docker Compose', status: 'pass', message: 'Docker Compose is installed' });
  } catch {
    composeCheck.fail('Docker Compose not found');
    checks.push({ 
      name: 'Docker Compose', 
      status: 'fail', 
      message: 'Docker Compose is not installed',
      fix: 'Install Docker Compose: https://docs.docker.com/compose/install/'
    });
  }

  // Check 3: Network
  const networkCheck = createSpinner('Checking eve-network...');
  networkCheck.start();
  try {
    const { stdout } = await execa('docker', ['network', 'ls', '--format', '{{.Name}}']);
    if (stdout.includes('eve-network')) {
      networkCheck.succeed('eve-network exists');
      checks.push({ name: 'Network', status: 'pass', message: 'eve-network is created' });
    } else {
      networkCheck.warn('eve-network not found');
      checks.push({ 
        name: 'Network', 
        status: 'warn', 
        message: 'eve-network does not exist',
        fix: 'eve init will create it automatically'
      });
    }
  } catch {
    networkCheck.fail('Cannot check networks');
    checks.push({ name: 'Network', status: 'fail', message: 'Failed to check Docker networks' });
  }

  // Check 4: Live Docker containers — driven by registry, only check what's installed
  const installed = await entityStateManager.getInstalledComponents().catch(() => [] as string[]);
  const expectedContainers = COMPONENTS
    .filter(c => installed.includes(c.id) && c.service)
    .map(c => ({ name: c.service!.containerName, organ: c.organ ?? c.id, label: c.label }));

  const containerCheck = createSpinner('Checking installed containers...');
  containerCheck.start();
  try {
    const { stdout: psOut } = await execa('docker', [
      'ps', '--format', '{{.Names}}\t{{.Status}}',
    ]);
    const running = new Map<string, string>();
    for (const line of psOut.split('\n').filter(Boolean)) {
      const [name, ...statusParts] = line.split('\t');
      if (name) running.set(name.trim(), statusParts.join(' ').trim());
    }

    const { stdout: allOut } = await execa('docker', [
      'ps', '-a', '--format', '{{.Names}}\t{{.Status}}',
    ]);
    const all = new Map<string, string>();
    for (const line of allOut.split('\n').filter(Boolean)) {
      const [name, ...statusParts] = line.split('\t');
      if (name) all.set(name.trim(), statusParts.join(' ').trim());
    }

    containerCheck.succeed('Container check complete');
    for (const c of expectedContainers) {
      if (running.has(c.name)) {
        checks.push({
          name: c.name,
          status: 'pass',
          message: `Running — ${running.get(c.name)}`,
        });
      } else if (all.has(c.name)) {
        checks.push({
          name: c.name,
          status: 'fail',
          message: `Stopped — ${all.get(c.name)}`,
          fix: `docker start ${c.name}`,
        });
      } else {
        checks.push({
          name: c.name,
          status: 'warn',
          message: 'Not found — container missing',
          fix: `eve add ${c.organ}`,
        });
      }
    }
  } catch {
    containerCheck.fail('Could not query Docker containers');
    checks.push({ name: 'Containers', status: 'fail', message: 'docker ps failed — is Docker running?' });
  }

  // Check 4b: Network reachability — for each installed component with a service,
  // verify Traefik can actually reach it. Catches the openclaw-class 502 bug
  // (container is up, on the network, but bound to wrong interface or not yet ready).
  const reachabilityCheck = createSpinner('Probing service reachability from Traefik...');
  reachabilityCheck.start();
  try {
    for (const c of COMPONENTS) {
      if (!c.service || !installed.includes(c.id)) continue;
      const result = await verifyComponent(c.id);
      if (result.ok) {
        checks.push({ name: `${c.label} reachability`, status: 'pass', message: result.summary });
      } else {
        const failed = result.checks.find(ch => !ch.ok);
        checks.push({
          name: `${c.label} reachability`,
          status: 'fail',
          message: failed?.detail ?? result.summary,
          fix: `docker logs ${c.service.containerName} --tail 30`,
        });
      }
    }
    reachabilityCheck.succeed('Reachability check complete');
  } catch (err) {
    reachabilityCheck.warn('Could not probe reachability');
  }

  // Check 4b-bis: Hub Protocol probes — ONLY meaningful once we know the
  // Synap container is up. The probes themselves handle a missing
  // URL/key gracefully (each row reports `skip`), but running them when
  // the container is obviously stopped is just noise. We also skip the
  // whole block when `--skip-probes` is set so users debugging an
  // unrelated check don't sit through ~35s of SSE wait time.
  const secrets = await readEveSecrets(process.cwd());
  const synapInstalled = installed.includes('synap');
  if (synapInstalled && !skipProbes) {
    const synapApiUrl = secrets?.synap?.apiUrl ?? '';
    const synapApiKey = secrets?.synap?.apiKey ?? '';

    if (!synapApiUrl || !synapApiKey) {
      // Skipped — synap not configured locally. NOT a failure: the user
      // may have installed Synap on a different host and be running the
      // CLI against a remote pod via env vars they haven't set yet.
      checks.push({
        name: 'Synap Hub Protocol probes',
        status: 'skip',
        message: 'skipped — synap not configured locally (no apiUrl/apiKey in secrets.json)',
        fix: 'Run `eve add synap` to provision an API key, or set them manually in ~/.eve/secrets.json',
      });
    } else {
      const probeSpinner = createSpinner('Running Hub Protocol probes (≤35s)...');
      probeSpinner.start();
      let diagnostics: HubProtocolDiagnostic[] = [];
      // Build a runner that tries native fetch first and swaps to
      // `docker exec eve-legs-traefik wget` when the host loopback isn't
      // reachable. On Eve deployments behind Traefik, synap-backend has
      // no host port mapping — the configured `apiUrl` of
      // `http://127.0.0.1:4000` will hit ECONNREFUSED and the probes
      // would be useless without this fallback.
      const swapNotes: string[] = [];
      const runner = new FallbackRunner(
        new FetchRunner(),
        new DockerExecRunner(),
        (note) => swapNotes.push(note),
      );
      try {
        diagnostics = await runHubProtocolProbes({
          synapUrl: synapApiUrl,
          apiKey: synapApiKey,
          runner,
        });
        const noteSuffix = swapNotes.length > 0 ? ` — ${swapNotes[0]}` : '';
        probeSpinner.succeed(`Hub Protocol probes complete (${diagnostics.length} run)${noteSuffix}`);
      } catch (err) {
        probeSpinner.fail('Hub Protocol probes failed to run');
        checks.push({
          name: 'Hub Protocol probes',
          status: 'fail',
          message: err instanceof Error ? err.message : String(err),
        });
      }

      for (const diag of diagnostics) {
        // `skip` rows from the lifecycle module flow through unchanged —
        // the renderer shows them with the warning glyph + "skipped"
        // label so users see them as informational, not as broken.
        checks.push({
          name: diag.name,
          status: diag.status,
          message: diag.message,
          fix: diag.fix,
        });
      }
    }
  } else if (synapInstalled && skipProbes) {
    checks.push({
      name: 'Hub Protocol probes',
      status: 'skip',
      message: 'skipped (--skip-probes)',
    });
  }

  // Check 4c: Domain & route health (only if a domain is configured)
  if (secrets?.domain?.primary) {
    const routeCheck = createSpinner(`Probing domain routes (${secrets.domain.primary})...`);
    routeCheck.start();
    try {
      const urls = getAccessUrls(secrets, installed);
      const probes: RouteProbe[] = probeRoutes(urls);
      routeCheck.succeed(`Probed ${probes.length} route(s)`);

      // Route check + deep diagnostic for failed routes only. We never
      // run `diagnoseFailedRoute` on a healthy route — its docker probes
      // cost ~1s each, and a healthy multi-route stack would multiply
      // that needlessly.
      for (const p of probes) {
        if (p.outcome === 'ok') {
          checks.push({ name: `route: ${p.host}`, status: 'pass', message: `${p.httpStatus} reachable` });
          continue;
        }

        let row: CheckResult;
        if (p.outcome === 'upstream-down') {
          row = {
            name: `route: ${p.host}`,
            status: 'fail',
            message: `${p.httpStatus} — Traefik connected, upstream returned a non-success response`,
            fix: 'See deep diagnostic below for the matched cause.',
          };
        } else if (p.outcome === 'not-routing') {
          row = {
            name: `route: ${p.host}`,
            status: 'fail',
            message: 'Traefik returned 404 — no router matched',
            fix: 'eve domain repair',
          };
        } else if (p.outcome === 'dns-missing') {
          row = {
            name: `route: ${p.host}`,
            status: 'warn',
            message: `No DNS A record for ${p.host}`,
            fix: 'Create A record at your registrar pointing to your server IP',
          };
        } else if (p.outcome === 'dns-wrong') {
          row = {
            name: `route: ${p.host}`,
            status: 'warn',
            message: `DNS resolves to ${p.dnsResolved} (not this server)`,
            fix: 'Update A record at your registrar',
          };
        } else {
          // 'timeout'
          row = {
            name: `route: ${p.host}`,
            status: 'fail',
            message: 'Request timed out — Traefik may be down or unreachable',
            fix: 'See deep diagnostic below.',
          };
        }

        // Deep diagnostic for upstream-down / not-routing / timeout — DNS
        // problems aren't the upstream's fault, so skip the docker probes
        // there (the probe-from-Traefik would just confirm "yes Traefik
        // works, your DNS is wrong" which the row already says).
        if (p.outcome === 'upstream-down' || p.outcome === 'not-routing' || p.outcome === 'timeout') {
          try {
            row.deep = await diagnoseFailedRoute(p);
          } catch {
            // Deep diagnostic is best-effort enrichment — never let a
            // failure here demote the actual route check.
          }
        }
        checks.push(row);
      }

      const verdict = probeVerdict(probes);
      if (verdict !== 'ok') {
        // Pull aside one summary check for visibility
        checks.push({
          name: 'Domain routes',
          status: verdict === 'broken' ? 'fail' : 'warn',
          message: verdict === 'broken' ? 'No routes reachable' : 'Some routes failing',
        });
      }
    } catch {
      routeCheck.fail('Could not probe domain routes');
    }
  }

  // Check 4d: AI provider wiring
  const aiCheck = createSpinner('Checking AI provider wiring...');
  aiCheck.start();
  try {
    const aiSecrets = secrets ?? await readEveSecrets(process.cwd());
    if (!hasAnyProvider(aiSecrets)) {
      const aiConsumers = ['synap', 'openclaw', 'openwebui'];
      const willUseAi = installed.some(c => aiConsumers.includes(c));
      if (willUseAi) {
        aiCheck.warn('No AI provider configured');
        checks.push({
          name: 'AI provider',
          status: 'warn',
          message: 'No provider key in secrets.ai.providers',
          fix: 'eve ai providers add anthropic --api-key <key>',
        });
      } else {
        aiCheck.succeed('No AI provider configured (no AI-consuming components installed yet)');
      }
    } else {
      aiCheck.succeed('AI provider configured');

      // Verify each AI-consuming component is actually wired
      // OpenClaw — check for auth-profiles.json inside the container
      if (installed.includes('openclaw')) {
        try {
          const out = execSync(
            `docker exec eve-arms-openclaw test -f /home/node/.openclaw/agents/main/agent/auth-profiles.json && echo OK || echo MISSING`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
          ).trim();
          if (out === 'OK') {
            checks.push({ name: 'OpenClaw AI wiring', status: 'pass', message: 'auth-profiles.json present in container' });
          } else {
            checks.push({
              name: 'OpenClaw AI wiring',
              status: 'fail',
              message: 'auth-profiles.json missing — agent loop will fail',
              fix: 'eve ai apply',
            });
          }
        } catch {
          checks.push({
            name: 'OpenClaw AI wiring',
            status: 'warn',
            message: 'Could not check (container not running?)',
            fix: 'docker start eve-arms-openclaw',
          });
        }
      }

      // Open WebUI — check that .env mentions SYNAP_IS_URL
      if (installed.includes('openwebui')) {
        try {
          const { existsSync, readFileSync } = await import('node:fs');
          const envPath = '/opt/openwebui/.env';
          if (existsSync(envPath)) {
            const content = readFileSync(envPath, 'utf-8');
            if (content.includes('SYNAP_IS_URL') && content.includes('SYNAP_API_KEY')) {
              checks.push({ name: 'Open WebUI AI wiring', status: 'pass', message: '.env points at Synap IS' });
            } else {
              checks.push({
                name: 'Open WebUI AI wiring',
                status: 'warn',
                message: '.env missing SYNAP_IS_URL/SYNAP_API_KEY',
                fix: 'eve ai apply',
              });
            }
          }
        } catch { /* non-fatal */ }
      }

      // Synap IS — check that deploy/.env has at least one provider key
      if (installed.includes('synap')) {
        try {
          const { existsSync, readFileSync } = await import('node:fs');
          const deployDir = process.env.SYNAP_DEPLOY_DIR ?? '/opt/synap-backend/deploy';
          const envPath = `${deployDir}/.env`;
          if (existsSync(envPath)) {
            const content = readFileSync(envPath, 'utf-8');
            const hasKey = /^(OPENAI|ANTHROPIC|OPENROUTER)_API_KEY=.+/m.test(content);
            if (hasKey) {
              checks.push({ name: 'Synap IS AI wiring', status: 'pass', message: 'upstream provider key in deploy/.env' });
            } else {
              checks.push({
                name: 'Synap IS AI wiring',
                status: 'warn',
                message: 'No upstream provider key in Synap deploy/.env',
                fix: 'eve ai apply',
              });
            }
          }
        } catch { /* non-fatal */ }
      }
    }
  } catch {
    aiCheck.fail('AI wiring check failed');
  }

  // Check 5: Entity State
  const stateCheck = createSpinner('Checking entity state...');
  stateCheck.start();
  try {
    const state = await entityStateManager.getState();
    stateCheck.succeed('Entity state is accessible');

    // Check each organ
    const organs: Organ[] = ['brain', 'arms', 'builder', 'eyes', 'legs'];
    for (const organ of organs) {
      const organState = state.organs[organ];
      if (organState.state === 'ready') {
        checks.push({
          name: `${formatOrgan(organ)} (state)`,
          status: 'pass',
          message: 'Organ marked ready in state'
        });
      } else if (organState.state === 'error') {
        checks.push({
          name: `${formatOrgan(organ)} (state)`,
          status: 'fail',
          message: organState.errorMessage || 'Organ has errors',
          fix: `eve install --components=${organ}`,
        });
      } else if (organState.state === 'missing') {
        checks.push({
          name: `${formatOrgan(organ)} (state)`,
          status: 'warn',
          message: 'Organ not installed',
          fix: `eve install --components=${organ}`,
        });
      }
    }
  } catch (error) {
    stateCheck.fail('Cannot read entity state');
    checks.push({ name: 'Entity State', status: 'fail', message: 'Failed to read state' });
  }

  // Print results
  console.log();
  printHeader('Diagnostic Results', emojis.info);
  console.log();

  const passed = checks.filter(c => c.status === 'pass').length;
  const failed = checks.filter(c => c.status === 'fail').length;
  // `skip` and `warn` both render with the warning glyph and roll into
  // the same "warnings" counter — the visual distinction is in the
  // accompanying message ("skipped — ..." vs the warn explanation).
  const warnings = checks.filter(c => c.status === 'warn' || c.status === 'skip').length;

  for (const check of checks) {
    const icon = check.status === 'pass'
      ? emojis.check
      : check.status === 'fail'
        ? emojis.cross
        : emojis.warning;
    const color = check.status === 'pass'
      ? colors.success
      : check.status === 'fail'
        ? colors.error
        : colors.warning;

    console.log(`${color(icon)} ${check.name}`);
    if (verbose || check.status !== 'pass') {
      console.log(colors.muted(`  ${check.message}`));
      if (check.fix) {
        console.log(colors.info(`  Fix: ${check.fix}`));
      }
    }
    if (check.deep) renderDeepDiagnostic(check.deep);
  }

  console.log();
  console.log(colors.primary('─'.repeat(50)));
  console.log(`${colors.success(`${passed} passed`)}, ${colors.error(`${failed} failed`)}, ${colors.warning(`${warnings} warnings`)}`);

  // Overall status
  if (failed === 0 && warnings === 0) {
    console.log();
    printSuccess('Entity is healthy! All checks passed.');
  } else if (failed === 0) {
    console.log();
    printWarning('Entity has warnings but is functional.');
  } else {
    console.log();
    printError(`Entity has ${failed} issue(s) that need attention.`);
    printInfo('  Follow the Fix hints above, or run: eve inspect');
  }
  console.log();
}

/**
 * Render the deep-diagnostic block under a failing route. The format mirrors
 * the spec: a "Deep diagnostic:" header, a probe-from-Traefik line, a log
 * patterns sub-section, and a single "Recommended fix:" footer. Indented
 * two spaces so it visually nests under the parent route check.
 */
function renderDeepDiagnostic(deep: DeepDiagnostic): void {
  const indent = '  ';
  const subIndent = indent + '  ';
  console.log(colors.muted(`${indent}Deep diagnostic:`));

  // Probe-from-Traefik line ────────────────────────────────────────────────
  if (deep.upstreamContainer) {
    console.log(colors.muted(`${subIndent}From inside eve-legs-traefik:`));
    const probe = deep.upstreamProbe;
    let line = probe.summary;
    if (probe.contentPreview) {
      line += `\n${subIndent}  preview: ${probe.contentPreview}`;
    }
    const probeColor = probe.status === 'connected' ? colors.success : colors.warning;
    console.log(probeColor(`${subIndent}  ${line}`));
  } else {
    console.log(colors.muted(`${subIndent}${deep.upstreamProbe.summary}`));
  }

  // Matched log patterns ───────────────────────────────────────────────────
  if (deep.upstreamContainer) {
    if (deep.matchedPatterns.length > 0) {
      console.log(
        colors.muted(
          `${subIndent}Upstream container logs (last ${deep.logLineCount} lines, matched ${deep.matchedPatterns.length} pattern${deep.matchedPatterns.length === 1 ? '' : 's'}):`,
        ),
      );
      for (const m of deep.matchedPatterns) {
        console.log(colors.warning(`${subIndent}  [${m.tag}] ${m.explanation} (line ${m.lineNumber}).`));
        console.log(colors.muted(`${subIndent}    > ${m.matchedLine}`));
      }
    } else if (deep.logLineCount > 0) {
      console.log(colors.muted(`${subIndent}Upstream container logs (last ${deep.logLineCount} lines): no known issue matched.`));
    } else {
      console.log(colors.muted(`${subIndent}Upstream container logs: could not read (container missing or docker unreachable).`));
    }
  }

  // Recommended fix ────────────────────────────────────────────────────────
  console.log(colors.info(`${subIndent}Recommended fix:`));
  console.log(colors.info(`${subIndent}  ${deep.recommendedFix}`));
}
