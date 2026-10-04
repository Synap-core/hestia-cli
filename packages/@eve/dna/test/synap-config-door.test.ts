// Eve writes the Synap pod's .env ONLY through the pod's own CLI
// (`synap config set|unset`, `synap apply`) — update-door plan P4.
//
// Seam test: a real deploy-dir layout (<root>/synap + <root>/deploy/) with a
// stub `synap` script that records its argv, its stdin and its environment,
// driven through the real synapConfigSetAt / synapConfigUnsetAt / synapApplyAt.
// What it proves: values travel on STDIN (never argv), the pod's compose pin is
// forwarded, `changed` comes from the door's own output, a pre-door CLI gets
// its legacy `config set KEY VALUE`, and a missing CLI is an error — never a
// silent direct write.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readSynapEnvValue,
  synapApplyAt,
  synapConfigSetAt,
  synapConfigUnsetAt,
} from '../src/synap-config-door.js';

let root: string;
let deploy: string;

const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$(dirname "$0")/argv.log"
cat > "$(dirname "$0")/stdin.log"
echo "project=\${COMPOSE_PROJECT_NAME:-}" > "$(dirname "$0")/env.log"
echo "deploy=\${SYNAP_DEPLOY_DIR:-}" >> "$(dirname "$0")/env.log"
if [ "$1 $2" = "config set" ]; then
  if grep -q '^PATH=' "$(dirname "$0")/stdin.log"; then echo "config: refused — PATH: unknown key" >&2; exit 1; fi
  sed -n 's/^\\([A-Z_]*\\)=.*/config: set \\1=********/p' "$(dirname "$0")/stdin.log"
fi
if [ "$1 $2" = "config unset" ]; then shift 2; for k in "$@"; do echo "config: unset $k"; done; fi
exit 0
`;

function log(name: string): string {
  return readFileSync(join(root, name), 'utf-8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eve-synap-door-'));
  deploy = join(root, 'deploy');
  mkdirSync(deploy);
  writeFileSync(join(deploy, 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(join(deploy, 'env-config.sh'), '# door present\n');
  writeFileSync(join(deploy, '.env'), "DOMAIN=pod.example.com\nCOMPOSE_PROJECT_NAME=synap-backend\nLABEL='Sign in'\n");
  writeFileSync(join(root, 'synap'), STUB);
  chmodSync(join(root, 'synap'), 0o755);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('synapConfigSetAt', () => {
  it('sends values on stdin, never argv, and reports what changed', () => {
    const r = synapConfigSetAt(deploy, { NANGO_SECRET_KEY: 'sk-SECRET-VALUE', NANGO_HOST: 'http://eve-arms-nango:3003' });
    expect(r.ok).toBe(true);
    expect(log('argv.log').trim().split('\n')).toEqual(['config', 'set', '--stdin']);
    expect(log('argv.log')).not.toContain('sk-SECRET-VALUE');
    expect(log('stdin.log')).toBe('NANGO_SECRET_KEY=sk-SECRET-VALUE\nNANGO_HOST=http://eve-arms-nango:3003\n');
    expect(r.changed).toEqual(['NANGO_SECRET_KEY', 'NANGO_HOST']);
  });

  it('forwards the pod pin and deploy dir, never a guessed project', () => {
    const saved = process.env.COMPOSE_PROJECT_NAME;
    delete process.env.COMPOSE_PROJECT_NAME;
    try {
      synapConfigSetAt(deploy, { DEBUG: 'true' });
    } finally {
      if (saved !== undefined) process.env.COMPOSE_PROJECT_NAME = saved;
    }
    expect(log('env.log')).toContain('project=synap-backend');
    expect(log('env.log')).toContain(`deploy=${deploy}`);
  });

  it('passes --force only when asked', () => {
    synapConfigSetAt(deploy, { POSTGRES_PASSWORD: 'x' }, { force: true });
    expect(log('argv.log').trim().split('\n')).toEqual(['config', 'set', '--force', '--stdin']);
  });

  it('surfaces a refusal as ok:false with the door\'s reason (nothing written by eve)', () => {
    const before = readFileSync(join(deploy, '.env'), 'utf-8');
    const r = synapConfigSetAt(deploy, { PATH: '/usr/bin' });
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain('PATH: unknown key');
    expect(readFileSync(join(deploy, '.env'), 'utf-8')).toBe(before);
  });

  it('uses the legacy `config set KEY VALUE` on a pod whose CLI predates the door', () => {
    rmSync(join(deploy, 'env-config.sh'));
    const r = synapConfigSetAt(deploy, { DEBUG: 'true' });
    expect(r.ok).toBe(true);
    expect(log('argv.log').trim().split('\n')).toEqual(['config', 'set', 'DEBUG', 'true']);
  });

  it('fails — never writes the file itself — when there is no synap CLI', () => {
    rmSync(join(root, 'synap'));
    const before = readFileSync(join(deploy, '.env'), 'utf-8');
    const r = synapConfigSetAt(deploy, { DEBUG: 'true' });
    expect(r.ok).toBe(false);
    expect(readFileSync(join(deploy, '.env'), 'utf-8')).toBe(before);
  });
});

describe('synapConfigUnsetAt / synapApplyAt', () => {
  it('unset goes through the door', () => {
    const r = synapConfigUnsetAt(deploy, ['KRATOS_CONFIG_DIR']);
    expect(r.ok).toBe(true);
    expect(log('argv.log').trim().split('\n')).toEqual(['config', 'unset', 'KRATOS_CONFIG_DIR']);
    expect(r.changed).toEqual(['KRATOS_CONFIG_DIR']);
  });

  it('apply = `synap apply`; a pre-door CLI gets `synap start backend`', () => {
    synapApplyAt(deploy);
    expect(log('argv.log').trim()).toBe('apply');
    rmSync(join(deploy, 'env-config.sh'));
    synapApplyAt(deploy);
    expect(log('argv.log').trim().split('\n')).toEqual(['start', 'backend']);
  });
});

describe('readSynapEnvValue', () => {
  it('reads the last assignment and strips one pair of quotes', () => {
    expect(readSynapEnvValue(join(deploy, '.env'), 'DOMAIN')).toBe('pod.example.com');
    expect(readSynapEnvValue(join(deploy, '.env'), 'LABEL')).toBe('Sign in');
    expect(readSynapEnvValue(join(deploy, '.env'), 'NOPE')).toBeUndefined();
    expect(existsSync(join(deploy, '.env.bak'))).toBe(false);
  });
});
