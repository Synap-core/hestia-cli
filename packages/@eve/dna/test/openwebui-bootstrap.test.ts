import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configStore } from '../src/config-store.js';
import {
  ensureOpenWebuiBootstrapSecrets,
  writeOpenwebuiEnv,
} from '../src/openwebui-bootstrap.js';
import { readEveSecrets, writeEveSecrets } from '../src/secrets-contract.js';

vi.mock('../src/reconcile.js', () => ({
  reconcile: vi.fn(async () => undefined),
}));

const tmp = () => mkdtempSync(join(tmpdir(), 'eve-openwebui-bootstrap-'));

describe('OpenWebUI headless bootstrap', () => {
  let cwd: string;
  let deployDir: string;

  beforeEach(() => {
    cwd = tmp();
    deployDir = tmp();
    configStore.reset();
  });

  afterEach(() => {
    configStore.reset();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(deployDir, { recursive: true, force: true });
  });

  it('generates admin credentials once and reuses them', async () => {
    const first = await ensureOpenWebuiBootstrapSecrets(cwd);
    expect(first.generated).toEqual({
      adminEmail: true,
      adminPassword: true,
      adminName: true,
    });
    expect(first.secrets.builder?.openwebui?.adminEmail).toBe('admin@eve.local');
    expect(first.secrets.builder?.openwebui?.adminPassword).toBeTruthy();
    expect(first.secrets.builder?.openwebui?.adminName).toBe('Eve Admin');

    const second = await ensureOpenWebuiBootstrapSecrets(cwd);
    expect(second.generated).toEqual({
      adminEmail: false,
      adminPassword: false,
      adminName: false,
    });
    expect(second.secrets.builder?.openwebui).toEqual(first.secrets.builder?.openwebui);
  });

  it('preserves existing admin credentials', async () => {
    await writeEveSecrets({
      builder: {
        openwebui: {
          adminEmail: 'owner@example.com',
          adminPassword: 'existing-password',
          adminName: 'Owner',
        },
      },
    }, cwd);

    const result = await ensureOpenWebuiBootstrapSecrets(cwd);
    expect(result.generated).toEqual({
      adminEmail: false,
      adminPassword: false,
      adminName: false,
    });
    expect((await readEveSecrets(cwd))?.builder?.openwebui).toEqual({
      adminEmail: 'owner@example.com',
      adminPassword: 'existing-password',
      adminName: 'Owner',
    });
  });

  it('writes headless OpenWebUI env and preserves custom values', () => {
    const envPath = join(deployDir, '.env');
    writeFileSync(envPath, [
      'WEBUI_SECRET_KEY=stable-secret',
      'CUSTOM_FLAG=yes',
      'WEBUI_NAME=Old Name',
    ].join('\n'));

    const result = writeOpenwebuiEnv(deployDir, {
      synapApiKey: 'synap-key',
      synapIsUrl: 'http://eve-brain-synap:4000',
      webuiUrl: 'https://chat.example.com',
      adminEmail: 'owner@example.com',
      adminPassword: 'admin-password',
      adminName: 'Owner',
    });
    const env = readFileSync(result.envPath, 'utf-8');

    expect(result.secretKeyGenerated).toBe(false);
    expect(env).toContain('WEBUI_SECRET_KEY=stable-secret\n');
    expect(env).toContain('WEBUI_ADMIN_EMAIL=owner@example.com\n');
    expect(env).toContain('WEBUI_ADMIN_PASSWORD=admin-password\n');
    expect(env).toContain('WEBUI_ADMIN_NAME=Owner\n');
    expect(env).toContain('ENABLE_PERSISTENT_CONFIG=true\n');
    expect(env).toContain('CUSTOM_FLAG=yes\n');
    expect(env).toContain('WEBUI_NAME=Eve\n');
  });

  it('creates WEBUI_SECRET_KEY when missing', () => {
    const result = writeOpenwebuiEnv(deployDir, {
      synapApiKey: '',
      synapIsUrl: 'http://eve-brain-synap:4000',
      webuiUrl: '',
      adminEmail: 'admin@eve.local',
      adminPassword: 'password',
      adminName: 'Eve Admin',
    });
    const env = readFileSync(result.envPath, 'utf-8');

    expect(existsSync(result.envPath)).toBe(true);
    expect(result.secretKeyGenerated).toBe(true);
    expect(env).toMatch(/WEBUI_SECRET_KEY=[a-f0-9]{64}\n/);
  });
});
