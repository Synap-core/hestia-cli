import { Command } from 'commander';
import { execa } from 'execa';
import { entityStateManager, type Organ, COMPONENTS, readEveSecrets, getAccessUrls } from '@eve/dna';
import { verifyComponent } from '@eve/legs';
import { probeRoutes, probeVerdict, type RouteProbe } from '../lib/probe-routes.js';
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
  status: 'pass' | 'fail' | 'warn';
  message: string;
  fix?: string;
}

export function doctorCommand(program: Command): void {
  program
    .command('doctor')
    .alias('doc')
    .description('Run comprehensive diagnostics on the entity')
    .option('-v, --verbose', 'Show verbose output')
    .action(async (options) => {
      try {
        await runDiagnostics(options.verbose);
      } catch (error) {
        printError('Diagnostics failed: ' + String(error));
        process.exit(1);
      }
    });
}

async function runDiagnostics(verbose = false): Promise<void> {
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

  // Check 4c: Domain & route health (only if a domain is configured)
  const secrets = await readEveSecrets(process.cwd());
  if (secrets?.domain?.primary) {
    const routeCheck = createSpinner(`Probing domain routes (${secrets.domain.primary})...`);
    routeCheck.start();
    try {
      const urls = getAccessUrls(secrets, installed);
      const probes: RouteProbe[] = probeRoutes(urls);
      routeCheck.succeed(`Probed ${probes.length} route(s)`);

      for (const p of probes) {
        if (p.outcome === 'ok') {
          checks.push({ name: `route: ${p.host}`, status: 'pass', message: `${p.httpStatus} reachable` });
        } else if (p.outcome === 'upstream-down') {
          checks.push({
            name: `route: ${p.host}`,
            status: 'fail',
            message: `${p.httpStatus} — route OK, upstream not responding`,
            fix: `Check the upstream container is running and listening on its port.`,
          });
        } else if (p.outcome === 'not-routing') {
          checks.push({
            name: `route: ${p.host}`,
            status: 'fail',
            message: `Traefik returned 404 — no router matched`,
            fix: `eve domain repair`,
          });
        } else if (p.outcome === 'dns-missing') {
          checks.push({
            name: `route: ${p.host}`,
            status: 'warn',
            message: `No DNS A record for ${p.host}`,
            fix: `Create A record at your registrar pointing to your server IP`,
          });
        } else if (p.outcome === 'dns-wrong') {
          checks.push({
            name: `route: ${p.host}`,
            status: 'warn',
            message: `DNS resolves to ${p.dnsResolved} (not this server)`,
            fix: `Update A record at your registrar`,
          });
        }
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
  const warnings = checks.filter(c => c.status === 'warn').length;

  for (const check of checks) {
    const icon = check.status === 'pass' ? emojis.check : check.status === 'fail' ? emojis.cross : emojis.warning;
    const color = check.status === 'pass' ? colors.success : check.status === 'fail' ? colors.error : colors.warning;
    
    console.log(`${color(icon)} ${check.name}`);
    if (verbose || check.status !== 'pass') {
      console.log(colors.muted(`  ${check.message}`));
      if (check.fix) {
        console.log(colors.info(`  Fix: ${check.fix}`));
      }
    }
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
