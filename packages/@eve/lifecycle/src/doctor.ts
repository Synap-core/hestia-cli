import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  COMPONENTS,
  appendOperationalEvent,
  entityStateManager,
  hasAnyProvider,
  readEveSecrets,
  type DoctorCheck,
} from '@eve/dna';
import { verifyComponent } from '@eve/legs';

const execFileAsync = promisify(execFile);
const DOCKER_TIMEOUT_MS = 4000;

async function dockerOk(args: string[]): Promise<boolean> {
  try {
    await execFileAsync('docker', args, { timeout: DOCKER_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

async function listContainers(): Promise<{ running: Map<string, string>; all: Map<string, string> }> {
  const parse = (out: string) => {
    const map = new Map<string, string>();
    for (const line of out.split('\n').filter(Boolean)) {
      const [name, ...rest] = line.split('\t');
      if (name) map.set(name.trim(), rest.join(' ').trim());
    }
    return map;
  };

  try {
    const [running, all] = await Promise.all([
      execFileAsync('docker', ['ps', '--format', '{{.Names}}\t{{.Status}}'], { timeout: DOCKER_TIMEOUT_MS }),
      execFileAsync('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Status}}'], { timeout: DOCKER_TIMEOUT_MS }),
    ]);
    return { running: parse(running.stdout), all: parse(all.stdout) };
  } catch {
    return { running: new Map(), all: new Map() };
  }
}

export async function runDoctorChecks(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const [dockerReady, composeReady, networkPresent] = await Promise.all([
    dockerOk(['version']),
    dockerOk(['compose', 'version']),
    dockerOk(['network', 'inspect', 'eve-network']),
  ]);

  checks.push({
    group: 'platform',
    name: 'Docker daemon',
    status: dockerReady ? 'pass' : 'fail',
    message: dockerReady ? 'Docker is running' : 'Docker daemon is not reachable',
    fix: dockerReady ? undefined : 'Start Docker Desktop or system Docker',
  });
  checks.push({
    group: 'platform',
    name: 'Docker Compose',
    status: composeReady ? 'pass' : 'fail',
    message: composeReady ? 'Compose plugin available' : 'Compose plugin not installed',
  });
  checks.push({
    group: 'network',
    name: 'eve-network',
    status: networkPresent ? 'pass' : 'warn',
    message: networkPresent ? 'Shared bridge network exists' : 'eve-network is missing',
    repair: networkPresent ? undefined : { kind: 'create-eve-network', label: 'Create network' },
  });

  const [installed, containers, secrets] = await Promise.all([
    entityStateManager.getInstalledComponents().catch(() => [] as string[]),
    listContainers(),
    readEveSecrets().catch(() => null),
  ]);

  for (const component of COMPONENTS.filter((c) => installed.includes(c.id) && c.service)) {
    const containerName = component.service!.containerName;
    if (containers.running.has(containerName)) {
      checks.push({
        group: 'containers',
        name: component.label,
        status: 'pass',
        message: `Running - ${containers.running.get(containerName)}`,
        componentId: component.id,
        integrationId: component.doctor?.integrationId,
      });
    } else if (containers.all.has(containerName)) {
      checks.push({
        group: 'containers',
        name: component.label,
        status: component.doctor?.critical ? 'fail' : 'warn',
        message: `Stopped - ${containers.all.get(containerName)}`,
        fix: `Start ${component.label}`,
        componentId: component.id,
        integrationId: component.doctor?.integrationId,
        repair: { kind: 'start-component', label: 'Start' },
      });
    } else {
      checks.push({
        group: 'containers',
        name: component.label,
        status: component.doctor?.critical ? 'fail' : 'warn',
        message: 'Container missing',
        fix: `Install ${component.id}`,
        componentId: component.id,
        integrationId: component.doctor?.integrationId,
      });
    }

    if (containers.running.has(containerName)) {
      const verification = await verifyComponent(component.id, { quick: true }).catch((error) => ({
        ok: false,
        summary: error instanceof Error ? error.message : String(error),
      }));
      checks.push({
        group: 'network',
        name: `${component.label} reachability`,
        status: verification.ok ? 'pass' : 'warn',
        message: verification.summary,
        componentId: component.id,
        integrationId: component.doctor?.integrationId,
      });
    }
  }

  checks.push({
    group: 'ai',
    name: 'AI providers',
    status: hasAnyProvider(secrets) ? 'pass' : 'warn',
    message: hasAnyProvider(secrets) ? 'At least one AI provider is configured' : 'No AI providers configured',
    fix: hasAnyProvider(secrets) ? undefined : 'Add a provider in Eve AI settings',
  });

  for (const check of checks) {
    if (check.status === 'fail' || check.status === 'warn') {
      await appendOperationalEvent({
        type: 'doctor.issue.detected',
        target: check.name,
        componentId: check.componentId,
        ok: false,
        summary: check.message,
        details: { group: check.group, status: check.status, fix: check.fix },
      }).catch(() => {});
    }
  }

  return checks;
}
