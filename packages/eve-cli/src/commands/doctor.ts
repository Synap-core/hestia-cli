import { Command } from 'commander';
import { execa } from 'execa';
import { entityStateManager, type Organ } from '@eve/dna';
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
  printEveDeprecation,
  requireDelegationConfirmed,
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
    .option('-f, --fix', 'Attempt to fix issues automatically')
    .option('-v, --verbose', 'Show verbose output')
    .action(async (options) => {
      printEveDeprecation('doctor', './synap diagnose (on your server)  or  npx @synap-core/cli status (from your laptop)');
      requireDelegationConfirmed();

      try {
        await runDiagnostics(options.fix, options.verbose);
      } catch (error) {
        printError('Diagnostics failed: ' + String(error));
        process.exit(1);
      }
    });
}

async function runDiagnostics(attemptFix = false, verbose = false): Promise<void> {
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

  // Check 4: Entity State
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
          name: `${formatOrgan(organ)}`, 
          status: 'pass', 
          message: 'Organ is healthy' 
        });
      } else if (organState.state === 'error') {
        checks.push({ 
          name: `${formatOrgan(organ)}`, 
          status: 'fail', 
          message: organState.errorMessage || 'Organ has errors',
          fix: `Run: eve ${organ} status`
        });
      } else if (organState.state === 'missing') {
        checks.push({ 
          name: `${formatOrgan(organ)}`, 
          status: 'warn', 
          message: 'Organ not installed',
          fix: `Run: eve ${organ} install`
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
    if (attemptFix) {
      console.log();
      printInfo('Automatic fixes are not implemented yet. Follow the Fix hints above or run eve inspect.');
    }
  }
  console.log();
}
